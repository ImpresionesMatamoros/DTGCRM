import { ProposalSchema, type CandidateKind } from '@/import/proposal';
import { decisionById } from '@/decisions/reference';
import {
  bulkSummary,
  entriesToWrite,
  planBulk,
  type BulkCandidate,
  type BulkPlan,
  type BulkSummary,
} from '@/review/bulk';
import type { Draft } from '@/review/fields';
import type { Queryable } from '../client';
import { writeDraft, type LockedCandidate, type ReviewActionError } from './review';

/**
 * Explicit bulk resolution (STEP 06 §14–17). Preview and apply share the pure
 * planner; apply locks the candidates, recomputes the plan and refuses it if it
 * differs from the preview the person confirmed (planSha256). Different
 * existing values are only overwritten when `overwrite` is confirmed. There is
 * no bulk approval and no bulk publication.
 */

export const MAX_BULK_CANDIDATES = 2000;

export interface BulkRequest {
  candidateIds: string[];
  kind: CandidateKind;
  changes: Draft;
  /**
   * STRICT (STEP 08): the field must be valid for every selected candidate; a selection with another
   * kind or a not-applicable field is refused (INCOMPATIBLE_SELECTION) instead of silently skipped.
   */
  strict?: boolean;
}

export interface BulkPreview {
  plan: BulkPlan;
  labels: Record<string, string>;
  summary: BulkSummary;
}

async function load(db: Queryable, ids: string[], lock: boolean) {
  const rows = (
    await db.query(
      `select c.id, c.batch_id, c.kind, c.proposal, c.resolution, c.review_status, b.data_class,
              coalesce(v.label, v.item_name, c.lineage_key) as label
         from import_candidate c
         join import_batch b on b.id = c.batch_id
         join v_review_candidate v on v.id = c.id
        where c.id = any($1::uuid[]) order by c.id ${lock ? 'for update of c' : ''}`,
      [ids],
    )
  ).rows as (LockedCandidate & { label: string })[];
  return rows;
}

const toBulk = (r: LockedCandidate): BulkCandidate => ({
  id: r.id,
  kind: r.kind,
  reviewStatus: r.review_status,
  proposal: ProposalSchema.parse(r.proposal),
  draft: r.resolution,
});

type BulkError =
  | ReviewActionError
  | {
      code:
        | 'TOO_MANY'
        | 'STALE_PREVIEW'
        | 'NOTHING_TO_APPLY'
        | 'UNKNOWN_CANDIDATES'
        | 'REASON_REQUIRED'
        | 'INCOMPATIBLE_SELECTION'
        | 'DECISION_NOT_ANSWERED';
      message: string;
      field?: string;
    };

export async function previewBulk(
  db: Queryable,
  req: BulkRequest,
): Promise<{ ok: true; preview: BulkPreview } | { ok: false; errors: BulkError[] }> {
  const ids = [...new Set(req.candidateIds)];
  if (ids.length > MAX_BULK_CANDIDATES)
    return {
      ok: false,
      errors: [
        { code: 'TOO_MANY', message: `at most ${MAX_BULK_CANDIDATES} candidates per bulk change` },
      ],
    };
  const rows = await load(db, ids, false);
  if (rows.length !== ids.length)
    return {
      ok: false,
      errors: [
        {
          code: 'UNKNOWN_CANDIDATES',
          message: `${ids.length - rows.length} candidate ids do not exist`,
        },
      ],
    };
  const planned = planBulk(rows.map(toBulk), req.kind, req.changes, { strict: req.strict });
  if (!planned.ok)
    return {
      ok: false,
      errors: planned.errors.map((e) => ({
        code: planned.code ?? ('INVALID_RESOLUTION' as const),
        field: e.field,
        message: e.message,
      })),
    };
  return {
    ok: true,
    preview: {
      plan: planned.plan,
      labels: Object.fromEntries(rows.map((r) => [r.id, r.label])),
      summary: bulkSummary(planned.plan),
    },
  };
}

export interface BulkApplyInput extends BulkRequest {
  actor: string;
  planSha256: string;
  overwrite: boolean;
  reason?: string | null;
  origin: 'UI_BULK' | 'DECISION_GROUP';
  /** Decision group code (STEP 05C) when origin = DECISION_GROUP. */
  originRef?: string | null;
}

export async function applyBulk(
  db: Queryable,
  input: BulkApplyInput,
): Promise<
  | {
      ok: true;
      bulkOperationId: string;
      written: number;
      candidates: number;
      counts: BulkPlan['counts'];
    }
  | { ok: false; errors: BulkError[] }
> {
  const ids = [...new Set(input.candidateIds)];
  if (ids.length > MAX_BULK_CANDIDATES)
    return { ok: false, errors: [{ code: 'TOO_MANY', message: `at most ${MAX_BULK_CANDIDATES}` }] };
  if (input.origin === 'DECISION_GROUP' && !input.originRef?.trim())
    return {
      ok: false,
      errors: [{ code: 'REASON_REQUIRED', message: 'a decision group reference is required' }],
    };
  // STEP 08: a DECISION_GROUP operation exists only because the owner explicitly answered that decision.
  let decisionAnswerId: string | null = null;
  if (input.origin === 'DECISION_GROUP') {
    const ref = input.originRef!.trim();
    const answer = decisionById(ref)
      ? (
          await db.query(
            `select a.id from owner_decision_answer a
              where a.decision_id = $1
                and not exists (select 1 from owner_decision_answer n where n.supersedes_id = a.id)`,
            [ref],
          )
        ).rows[0]
      : undefined;
    if (!answer)
      return {
        ok: false,
        errors: [
          {
            code: 'DECISION_NOT_ANSWERED',
            message: `${ref} has no recorded owner answer: a decision group operation needs an explicit answer`,
          },
        ],
      };
    decisionAnswerId = answer.id as string;
  }
  const rows = await load(db, ids, true);
  if (rows.length !== ids.length)
    return {
      ok: false,
      errors: [
        {
          code: 'UNKNOWN_CANDIDATES',
          message: `${ids.length - rows.length} candidate ids do not exist`,
        },
      ],
    };
  const planned = planBulk(rows.map(toBulk), input.kind, input.changes, {
    overwrite: input.overwrite,
    strict: input.strict,
  });
  if (!planned.ok)
    return {
      ok: false,
      errors: planned.errors.map((e) => ({
        code: planned.code ?? ('INVALID_RESOLUTION' as const),
        field: e.field,
        message: e.message,
      })),
    };
  const plan = planned.plan;
  if (plan.planSha256 !== input.planSha256) {
    return {
      ok: false,
      errors: [
        {
          code: 'STALE_PREVIEW',
          message: 'the candidates changed since the preview; preview the bulk change again',
        },
      ],
    };
  }
  const toWrite = entriesToWrite(plan, input.overwrite);
  if (toWrite.length === 0)
    return {
      ok: false,
      errors: [
        { code: 'NOTHING_TO_APPLY', message: 'no candidate would change with this bulk change' },
      ],
    };

  const op = (
    await db.query(
      `insert into review_bulk_operation (actor, kind, changes, candidate_ids, counts, overwrite_confirmed,
         plan_sha256, origin, origin_ref, reason, decision_answer_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
      [
        input.actor,
        input.kind,
        JSON.stringify(plan.changes),
        ids,
        JSON.stringify(plan.counts),
        input.overwrite,
        plan.planSha256,
        input.origin,
        input.originRef?.trim() || null,
        input.reason?.trim() || null,
        decisionAnswerId,
      ],
    )
  ).rows[0].id as string;

  const byCandidate = new Map<string, Draft>();
  for (const e of toWrite) {
    const set = byCandidate.get(e.candidateId) ?? {};
    set[e.field] = e.next;
    byCandidate.set(e.candidateId, set);
  }
  const locked = new Map(rows.map((r) => [r.id, r]));
  let written = 0;
  for (const [id, set] of byCandidate) {
    const res = await writeDraft(
      db,
      locked.get(id)!,
      { set },
      {
        actor: input.actor,
        reason: input.reason,
        origin: input.origin,
        bulkOperationId: op,
      },
    );
    if (!res.ok)
      throw new Error(
        `bulk write failed for ${id}: ${res.errors.map((x) => x.message).join('; ')}`,
      );
    written += res.changed;
  }
  return {
    ok: true,
    bulkOperationId: op,
    written,
    candidates: byCandidate.size,
    counts: plan.counts,
  };
}

export interface BulkOperationView {
  id: string;
  actor: string;
  kind: string;
  changes: Record<string, unknown>;
  candidates: number;
  counts: Record<string, unknown>;
  overwriteConfirmed: boolean;
  origin: string;
  originRef: string | null;
  decisionAnswerId: string | null;
  reason: string | null;
  createdAt: string;
  events: number;
}

export async function listBulkOperations(db: Queryable, limit = 50): Promise<BulkOperationView[]> {
  return (
    await db.query(
      `select o.*, (select count(*)::int from review_event e where e.bulk_operation_id = o.id) as events
         from review_bulk_operation o order by o.created_at desc limit $1`,
      [limit],
    )
  ).rows.map((r: Record<string, unknown>) => ({
    id: r.id as string,
    actor: r.actor as string,
    kind: r.kind as string,
    changes: r.changes as Record<string, unknown>,
    candidates: (r.candidate_ids as string[]).length,
    counts: r.counts as Record<string, unknown>,
    overwriteConfirmed: r.overwrite_confirmed as boolean,
    origin: r.origin as string,
    originRef: (r.origin_ref as string | null) ?? null,
    decisionAnswerId: (r.decision_answer_id as string | null) ?? null,
    reason: (r.reason as string | null) ?? null,
    createdAt: new Date(String(r.created_at)).toISOString(),
    events: r.events as number,
  }));
}
