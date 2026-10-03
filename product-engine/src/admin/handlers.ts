import { z } from 'zod';
import { REVIEW_KINDS } from '@/db/admin/review';
import {
  approveDraft,
  publishFixtureCandidate,
  rejectWithReason,
  saveDraft,
  withdrawApproval,
} from '@/db/admin/review';
import { applyBulk, previewBulk } from '@/db/admin/bulk';
import {
  applyDecisionAssignment,
  previewDecisionAssignment,
  recordDecisionAnswer,
} from '@/db/admin/decision-answers';
import { applyCategoryMapping, previewCategoryMapping } from '@/db/admin/category-mapping';
import { markDuplicatePair } from '@/db/admin/duplicates';
import { qualityReport } from '@/db/admin/quality';
import { ruleByCode } from '@/quality/rules';
import { createCatalogItem, updateCatalogItem } from '@/db/admin/catalog';
import { simulatePrice } from '@/db/admin/pricing';
import {
  analyzeConflictsFor,
  authorizePriceRevision,
  cloneAuthorizedToDraft,
  compareRevisions,
  createDraftPriceDefinition,
  createFxParameterRevision,
  deleteDraftPriceDefinition,
  impactPreview,
  setItemMarketPolicy,
  simulateDraft,
  updateDraftPriceDefinition,
} from '@/db/admin/price-admin';
import type { Queryable } from '@/db/client';
import type { TxRunner } from '@/db/admin/tx';
import {
  COMMERCIAL_PRINT_PERMIT,
  createMigrationPermit,
  permitById,
  publishUnderPermit,
  simulateMigration,
} from '@/db/migration/permit';
import { authorize, type Actor, type Capability } from './permissions';

/**
 * Admin action handlers: the server-side boundary behind every Server Action.
 * Each one parses its input with Zod, checks the actor's capability, and runs
 * the service inside one audited transaction. Nothing the browser sends is
 * trusted: a direct POST gets exactly the same validation as the UI.
 */

export type ActionError = { code: string; message: string; field?: string };
export type ActionResult<T = Record<string, unknown>> =
  ({ ok: true } & T) | { ok: false; errors: ActionError[] };

const invalid = (e: z.ZodError): { ok: false; errors: ActionError[] } => ({
  ok: false,
  errors: e.issues.map((i) => ({
    code: 'INVALID_INPUT',
    field: i.path.map(String).join('.') || undefined,
    message: i.message,
  })),
});

async function guarded<S extends z.ZodType, R extends { ok: boolean }>(
  actor: Actor | null,
  capability: Capability,
  schema: S,
  raw: unknown,
  run: (input: z.infer<S>, actor: Actor) => Promise<R>,
): Promise<R | { ok: false; errors: ActionError[] }> {
  const denied = authorize(actor, capability);
  if (denied) return { ok: false, errors: [denied] };
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error);
  return run(parsed.data, actor!);
}

const Id = z.uuid();
const Reason = z.string().trim().max(500).optional().nullable();
const FieldName = z.string().regex(/^[a-zA-Z][a-zA-Z0-9]*$/);

// ---------------------------------------------------------------- review

export const SaveDraftInput = z.strictObject({
  candidateId: Id,
  set: z.record(FieldName, z.json()).optional(),
  clear: z.array(FieldName).max(20).optional(),
  reason: Reason,
});

export const saveDraftHandler = (tx: TxRunner, actor: Actor | null, raw: unknown) =>
  guarded(actor, 'review.resolve', SaveDraftInput, raw, (v, a) =>
    tx(a.name, 'admin:review.save_draft', (db) =>
      saveDraft(db, a.name, v.candidateId, { set: v.set ?? {}, clear: v.clear ?? [] }, v.reason),
    ),
  );

export const CandidateAction = z.strictObject({ candidateId: Id, reason: Reason });
export const CandidateReasonAction = z.strictObject({
  candidateId: Id,
  reason: z.string().trim().min(1, 'reason is required').max(500),
});

export const approveHandler = (tx: TxRunner, actor: Actor | null, raw: unknown) =>
  guarded(actor, 'review.approve', CandidateAction, raw, (v, a) =>
    tx(a.name, 'admin:review.approve', (db) => approveDraft(db, a.name, v.candidateId, v.reason)),
  );

export const rejectHandler = (tx: TxRunner, actor: Actor | null, raw: unknown) =>
  guarded(actor, 'review.approve', CandidateReasonAction, raw, (v, a) =>
    tx(a.name, 'admin:review.reject', (db) =>
      rejectWithReason(db, a.name, v.candidateId, v.reason),
    ),
  );

export const withdrawHandler = (tx: TxRunner, actor: Actor | null, raw: unknown) =>
  guarded(actor, 'review.approve', CandidateReasonAction, raw, (v, a) =>
    tx(a.name, 'admin:review.withdraw_approval', (db) =>
      withdrawApproval(db, a.name, v.candidateId, v.reason),
    ),
  );

/** FIXTURE only; REAL is refused by the service and again by publishCandidate. */
export const publishFixtureHandler = (tx: TxRunner, actor: Actor | null, raw: unknown) =>
  guarded(actor, 'fixture.publish', CandidateAction, raw, (v, a) =>
    tx(a.name, 'admin:review.publish_fixture', (db) =>
      publishFixtureCandidate(db, a.name, v.candidateId),
    ),
  );

// ---------------------------------------------------------------- bulk

export const BulkPreviewInput = z.strictObject({
  candidateIds: z.array(Id).min(1).max(2000),
  kind: z.enum(REVIEW_KINDS),
  changes: z.record(FieldName, z.json()),
  /** STEP 08: refuse (instead of skipping) candidates the field does not apply to. */
  strict: z.boolean().optional(),
});

export const BulkApplyInput = BulkPreviewInput.extend({
  planSha256: z.string().regex(/^[0-9a-f]{64}$/),
  overwrite: z.boolean(),
  reason: Reason,
  /** Future STEP 05C decision group code; absent for a plain UI selection. */
  decisionGroup: z.string().trim().min(1).max(80).optional(),
}).strict();

export const bulkPreviewHandler = async (db: Queryable, actor: Actor | null, raw: unknown) =>
  guarded(actor, 'review.bulk', BulkPreviewInput, raw, async (v) => {
    const r = await previewBulk(db, v);
    return r.ok ? { ok: true as const, ...r.preview } : r;
  });

export const bulkApplyHandler = (tx: TxRunner, actor: Actor | null, raw: unknown) =>
  guarded(actor, 'review.bulk', BulkApplyInput, raw, (v, a) =>
    tx(a.name, 'admin:review.bulk_apply', (db) =>
      applyBulk(db, {
        candidateIds: v.candidateIds,
        kind: v.kind,
        changes: v.changes,
        strict: v.strict,
        planSha256: v.planSha256,
        overwrite: v.overwrite,
        reason: v.reason,
        actor: a.name,
        origin: v.decisionGroup ? 'DECISION_GROUP' : 'UI_BULK',
        originRef: v.decisionGroup ?? null,
      }),
    ),
  );

// ---------------------------------------------------------------- catalog

export const createItemHandler = (tx: TxRunner, actor: Actor | null, raw: unknown) =>
  guarded(actor, 'catalog.edit', z.unknown(), raw, (v, a) =>
    tx(a.name, 'admin:catalog.create', (db) => createCatalogItem(db, v)),
  );

export const UpdateItemInput = z.strictObject({ id: Id, patch: z.unknown() });

export const updateItemHandler = (tx: TxRunner, actor: Actor | null, raw: unknown) =>
  guarded(actor, 'catalog.edit', UpdateItemInput, raw, (v, a) =>
    tx(a.name, 'admin:catalog.update', (db) => updateCatalogItem(db, v.id, v.patch)),
  );

// ---------------------------------------------------------------- pricing (read-only)

export const simulateHandler = async (db: Queryable, raw: unknown, asOf: Date) => {
  const r = await simulatePrice(db, raw, asOf);
  if (!r.ok) return r;
  // Live simulation keeps its flat shape; a DRAFT simulation also returns the current answer for comparison.
  return {
    ok: true as const,
    ...r.result,
    simulatedDraft: r.simulatedDraft,
    current: r.current,
  };
};

// ---------------------------------------------------------------- pricing administration (STEP 07)

/** DB constraint failures become ActionErrors; the transaction is rolled back by the runner. */
async function txGuarded<R extends { ok: boolean }>(
  tx: TxRunner,
  actor: Actor,
  context: string,
  run: (db: Parameters<Parameters<TxRunner>[2]>[0]) => Promise<R>,
): Promise<R | { ok: false; errors: ActionError[] }> {
  try {
    return await tx(actor.name, context, run);
  } catch (e) {
    return { ok: false, errors: [{ code: 'DATABASE_REJECTED', message: (e as Error).message }] };
  }
}

const ReasonOpt = z.string().trim().max(500).optional().nullable();
const ctxOf = (a: Actor, now: Date, reason?: string | null) => ({ actor: a.name, now, reason });

export const createPriceDraftHandler = (
  tx: TxRunner,
  actor: Actor | null,
  raw: unknown,
  now: Date,
) =>
  guarded(actor, 'price.edit', z.unknown(), raw, (v, a) =>
    txGuarded(tx, a, 'admin:price.create_draft', (db) =>
      createDraftPriceDefinition(db, v, ctxOf(a, now)),
    ),
  );

export const updatePriceDraftHandler = (
  tx: TxRunner,
  actor: Actor | null,
  raw: unknown,
  now: Date,
) =>
  guarded(actor, 'price.edit', z.unknown(), raw, (v, a) =>
    txGuarded(tx, a, 'admin:price.update_draft', (db) =>
      updateDraftPriceDefinition(db, v, ctxOf(a, now)),
    ),
  );

const DefinitionRef = z.strictObject({ definitionId: Id, reason: ReasonOpt });

export const deletePriceDraftHandler = (
  tx: TxRunner,
  actor: Actor | null,
  raw: unknown,
  now: Date,
) =>
  guarded(actor, 'price.edit', DefinitionRef, raw, (v, a) =>
    txGuarded(tx, a, 'admin:price.delete_draft', (db) =>
      deleteDraftPriceDefinition(db, v.definitionId, ctxOf(a, now, v.reason)),
    ),
  );

export const cloneToDraftHandler = (tx: TxRunner, actor: Actor | null, raw: unknown, now: Date) =>
  guarded(
    actor,
    'price.edit',
    z.strictObject({
      definitionId: Id,
      validFrom: z.iso.datetime({ offset: true }).optional(),
      reason: ReasonOpt,
    }),
    raw,
    (v, a) =>
      txGuarded(tx, a, 'admin:price.clone_to_draft', (db) =>
        cloneAuthorizedToDraft(db, v.definitionId, ctxOf(a, now, v.reason), {
          validFrom: v.validFrom,
        }),
      ),
  );

/** Authorization is a capability-gated operation, never a direct edit (D-016 decides who holds it). */
export const authorizePriceHandler = (tx: TxRunner, actor: Actor | null, raw: unknown, now: Date) =>
  guarded(actor, 'price.authorize', DefinitionRef, raw, (v, a) =>
    txGuarded(tx, a, 'admin:price.authorize', (db) =>
      authorizePriceRevision(db, v.definitionId, ctxOf(a, now, v.reason)),
    ),
  );

export const setMarketPolicyHandler = (
  tx: TxRunner,
  actor: Actor | null,
  raw: unknown,
  now: Date,
) =>
  guarded(actor, 'market.policy', z.unknown(), raw, (v, a) =>
    txGuarded(tx, a, 'admin:market.set_policy', (db) => setItemMarketPolicy(db, v, ctxOf(a, now))),
  );

export const fxRevisionHandler = (tx: TxRunner, actor: Actor | null, raw: unknown, now: Date) =>
  guarded(actor, 'pricing.parameter', z.unknown(), raw, (v, a) =>
    txGuarded(tx, a, 'admin:pricing.fx_revision', (db) =>
      createFxParameterRevision(db, v, ctxOf(a, now)),
    ),
  );

// Read-only diagnostics (no capability: they change nothing).
export const conflictPreviewHandler = (db: Queryable, definitionId: string, now: Date) =>
  analyzeConflictsFor(db, definitionId, now);
export const impactHandler = (db: Queryable, definitionId: string, asOf: Date) =>
  impactPreview(db, definitionId, asOf);
export const compareHandler = (db: Queryable, fromId: string, toId: string) =>
  compareRevisions(db, fromId, toId);
export const simulateDraftHandler = simulateDraft;

// ---------------------------------------------------------------- STEP 08 · data quality

/** Records what the owner decided. The app never answers a decision (decision.record is a controlled role). */
export const recordDecisionHandler = (tx: TxRunner, actor: Actor | null, raw: unknown) =>
  guarded(actor, 'decision.record', z.unknown(), raw, (v, a) =>
    tx(a.name, 'admin:decision.record', async (db) => {
      const r = await recordDecisionAnswer(db, v, a.name);
      if (r.ok) return r;
      // an invalid answer must not leave a transaction half-written: nothing was inserted
      return {
        ok: false as const,
        errors: r.errors.map((e) => ({
          code: 'INVALID_ANSWER',
          field: e.path,
          message: e.message,
        })),
      };
    }),
  );

const DecisionRef = z.strictObject({
  decisionId: z.string().regex(/^D-\d{3}$/),
  index: z.number().int().min(0).max(49),
});

export const decisionPreviewHandler = (db: Queryable, actor: Actor | null, raw: unknown) =>
  guarded(actor, 'review.bulk', DecisionRef, raw, async (v) => {
    const r = await previewDecisionAssignment(db, v);
    return r.ok
      ? { ok: true as const, ...r.preview, answerId: r.answerId }
      : { ok: false as const, errors: [{ code: 'NOT_APPLICABLE', message: r.message }] };
  });

export const decisionApplyHandler = (tx: TxRunner, actor: Actor | null, raw: unknown) =>
  guarded(
    actor,
    'review.bulk',
    DecisionRef.extend({
      planSha256: z.string().regex(/^[0-9a-f]{64}$/),
      overwrite: z.boolean(),
      reason: Reason,
    }).strict(),
    raw,
    (v, a) =>
      tx(a.name, 'admin:decision.apply', (db) =>
        applyDecisionAssignment(db, { ...v, actor: a.name }),
      ),
  );

const CategoryMap = z.strictObject({
  sourceCategory: z.string().trim().min(1).max(80),
  categoryKey: z.string().regex(/^[a-z][a-z0-9_]*$/),
});

export const categoryPreviewHandler = (db: Queryable, actor: Actor | null, raw: unknown) =>
  guarded(actor, 'category.map', CategoryMap, raw, async (v) => {
    const r = await previewCategoryMapping(db, v.sourceCategory, v.categoryKey);
    return r.ok
      ? { ok: true as const, ...r.preview }
      : { ok: false as const, errors: [{ code: 'NOT_APPLICABLE', message: r.message }] };
  });

export const categoryApplyHandler = (tx: TxRunner, actor: Actor | null, raw: unknown) =>
  guarded(
    actor,
    'category.map',
    CategoryMap.extend({
      planSha256: z.string().regex(/^[0-9a-f]{64}$/),
      overwrite: z.boolean(),
      reason: Reason,
    }).strict(),
    raw,
    (v, a) =>
      tx(a.name, 'admin:category.map', (db) => applyCategoryMapping(db, { ...v, actor: a.name })),
  );

export const markDuplicateHandler = (tx: TxRunner, actor: Actor | null, raw: unknown) =>
  guarded(
    actor,
    'quality.mark',
    z.strictObject({
      pairKey: z.string().min(3).max(200),
      mark: z.enum(['DISTINCT', 'REVIEWED']),
      reason: Reason,
    }),
    raw,
    (v, a) =>
      tx(a.name, 'admin:quality.mark_duplicate', async (db) => {
        const r = await markDuplicatePair(db, { ...v, actor: a.name }, new Date());
        return r.ok
          ? r
          : { ok: false as const, errors: [{ code: 'NOT_A_SIGNAL', message: r.message }] };
      }),
  );

/**
 * Remediation of one data-quality rule through the existing bulk planner (never a bypass): the
 * candidates are the BULK_RESOLVABLE findings of that rule at this moment, the field is the rule's own
 * bulk field, the selection must be field-compatible (strict) and stale previews are refused.
 */
const RemediationInput = z.strictObject({
  ruleCode: z.string().regex(/^DQ-[A-Z]+-\d{3}$/),
  value: z.json(),
  category: z.string().max(80).optional(),
});

async function remediationTarget(db: Queryable, ruleCode: string, category?: string) {
  const rule = ruleByCode(ruleCode);
  if (!rule?.bulk) return { error: `${ruleCode} cannot be remediated in bulk` } as const;
  const report = await qualityReport(db, new Date());
  const ids = report.run.findings
    .filter(
      (f) =>
        f.ruleCode === ruleCode &&
        f.remediation === 'BULK_RESOLVABLE' &&
        f.candidateId !== null &&
        (!category || f.category === category),
    )
    .map((f) => f.candidateId!);
  if (ids.length === 0)
    return { error: 'no finding of this rule can be bulk-resolved right now' } as const;
  return { rule, ids: [...new Set(ids)].slice(0, 2000) } as const;
}

export const remediationPreviewHandler = (db: Queryable, actor: Actor | null, raw: unknown) =>
  guarded(actor, 'review.bulk', RemediationInput, raw, async (v) => {
    const t = await remediationTarget(db, v.ruleCode, v.category);
    if (!t.ids)
      return { ok: false as const, errors: [{ code: 'NOT_APPLICABLE', message: t.error }] };
    const r = await previewBulk(db, {
      candidateIds: t.ids,
      kind: t.rule.bulk!.kind,
      changes: { [t.rule.bulk!.field]: v.value },
      strict: true,
    });
    return r.ok ? { ok: true as const, ...r.preview } : r;
  });

export const remediationApplyHandler = (tx: TxRunner, actor: Actor | null, raw: unknown) =>
  guarded(
    actor,
    'review.bulk',
    RemediationInput.extend({
      planSha256: z.string().regex(/^[0-9a-f]{64}$/),
      overwrite: z.boolean(),
      reason: Reason,
    }).strict(),
    raw,
    (v, a) =>
      tx(a.name, 'admin:quality.remediate', async (db) => {
        const t = await remediationTarget(db, v.ruleCode, v.category);
        if (!t.ids)
          return { ok: false as const, errors: [{ code: 'NOT_APPLICABLE', message: t.error }] };
        return applyBulk(db, {
          candidateIds: t.ids,
          kind: t.rule.bulk!.kind,
          changes: { [t.rule.bulk!.field]: v.value },
          strict: true,
          planSha256: v.planSha256,
          overwrite: v.overwrite,
          reason: v.reason ?? `Remediación ${v.ruleCode}`,
          actor: a.name,
          origin: 'UI_BULK',
        });
      }),
  );

// ---------------------------------------------------------------- STEP 09 · scoped migration

/** The owner approves the scoped permit (OD-07). Only items that pass their own gate are included. */
export const migrationPermitHandler = (tx: TxRunner, actor: Actor | null, raw: unknown) =>
  guarded(
    actor,
    'migration.approve',
    z.strictObject({ reason: z.string().trim().min(10).max(1000) }),
    raw,
    (v, a) =>
      txGuarded(tx, a, 'admin:migration.approve', async (db) => {
        const r = await createMigrationPermit(
          db,
          { ...COMMERCIAL_PRINT_PERMIT, reason: v.reason },
          a.name,
        );
        return r.ok
          ? {
              ok: true as const,
              permitId: r.permit.id,
              created: r.created,
              items: r.permit.included.length,
            }
          : { ok: false as const, errors: r.errors };
      }),
  );

/** Read-only simulation of the whole publication: everything is rolled back. */
export const migrationSimulateHandler = (tx: TxRunner, actor: Actor | null, raw: unknown) =>
  guarded(actor, 'migration.approve', z.strictObject({ reason: ReasonOpt }), raw, (v, a) =>
    txGuarded(tx, a, 'admin:migration.simulate', async (db) => {
      const r = await simulateMigration(
        db,
        { ...COMMERCIAL_PRINT_PERMIT, reason: v.reason?.trim() || 'simulación' },
        a.name,
      );
      return {
        ok: true as const,
        permitOk: r.permit.ok,
        items:
          r.publish && r.publish.ok
            ? r.publish.items.map((i) => ({
                itemLegacyId: i.itemLegacyId,
                ok: i.ok,
                publicCode: i.publicCode,
                errors: i.errors,
              }))
            : [],
        errors: r.permit.ok ? [] : r.permit.errors,
      };
    }),
  );

/** The explicit REAL publication under an ACTIVE permit. Never triggered by importing, approving or loading a page. */
export const migrationPublishHandler = (tx: TxRunner, actor: Actor | null, raw: unknown) =>
  guarded(actor, 'migration.publish', z.strictObject({ permitId: Id }), raw, (v, a) =>
    txGuarded(tx, a, 'admin:migration.publish', async (db) => {
      if (!(await permitById(db, v.permitId)))
        return {
          ok: false as const,
          errors: [{ code: 'PERMIT_NOT_FOUND', message: 'permit not found' }],
        };
      const r = await publishUnderPermit(db, v.permitId, a.name);
      return r.ok
        ? {
            ok: true as const,
            items: r.items.map((i) => ({
              itemLegacyId: i.itemLegacyId,
              ok: i.ok,
              alreadyPublished: i.alreadyPublished,
              publicCode: i.publicCode,
              errors: i.errors,
            })),
          }
        : { ok: false as const, errors: r.errors };
    }),
  );
