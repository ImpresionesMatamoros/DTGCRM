import { z } from 'zod';
import { isPublishableVerdict, migrationGate, type MigrationGate } from '@/migration/gate';
import { buildContext, ownerLegacyOf } from '@/quality/context';
import { commercialPrintGate } from '@/quality/gate';
import pack from '@/decisions/commercial-print.pack.json';
import type { Queryable } from '../client';
import { currentAnswer } from '../admin/decision-answers';
import { currentDispositions } from './disposition';
import { qualityReport } from '../admin/quality';
import { permitCoversCandidate, previewCandidate, publishCandidate } from '../import/publish';

/**
 * STEP 09 · scoped REAL migration. Three explicit acts, none of them implicit:
 *   1. createMigrationPermit  — a person approves WHICH publishable items may go REAL (and why);
 *   2. dryRunMigration        — read-only: what each item would do (no write);
 *   3. publishUnderPermit     — a person runs the publication; one audited row per candidate.
 * The platform barrier (PUBLICATION_ENABLED_FOR) is never edited: a permit opens it for named candidates only.
 */

type Row = Record<string, unknown>;

export const SCOPE_KEY = 'commercial-print-mvp';
export const SCOPE_LABEL = 'Commercial Print MVP (21 items, STEP 05C)';
/** The Commercial Print permit (STEP 09): USA market, decisions the approval rests on. */
export const COMMERCIAL_PRINT_PERMIT = {
  scopeKey: SCOPE_KEY,
  scopeLabel: SCOPE_LABEL,
  markets: ['USA'] as ('USA' | 'MX')[],
  decisionIds: ['D-001', 'D-002', 'D-010', 'D-016'],
};
export const REQUIRED_DECISIONS = ['D-016'] as const;

const PermitInput = z.strictObject({
  scopeKey: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  scopeLabel: z.string().trim().min(1).max(200),
  markets: z.array(z.enum(['USA', 'MX'])).min(1),
  reason: z.string().trim().min(1).max(1000),
  /** Decisions the approval rests on; each must have a recorded answer. */
  decisionIds: z.array(z.string().regex(/^D-\d{3}$/)).max(30),
});
export type PermitInput = z.infer<typeof PermitInput>;

export interface PermitView {
  id: string;
  scopeKey: string;
  scopeLabel: string;
  markets: string[];
  status: 'ACTIVE' | 'REVOKED';
  approvedBy: string;
  approvedAt: string;
  reason: string;
  decisionRefs: { decisionId: string; answerId: string; revision: number }[];
  waivedDecisions: { decisionId: string; reason: string }[];
  scopedLegacyIds: string[];
  included: { candidateId: string; itemLegacyId: string; kind: string }[];
}

export async function activePermit(db: Queryable, scopeKey: string): Promise<PermitView | null> {
  const r = (
    await db.query(
      `select * from migration_permit p
        where p.scope_key = $1 and p.status = 'ACTIVE'
          and not exists (select 1 from migration_permit n where n.supersedes_id = p.id)
        order by p.approved_at desc limit 1`,
      [scopeKey],
    )
  ).rows[0] as Row | undefined;
  return r ? permitView(db, r) : null;
}

export async function permitById(db: Queryable, id: string): Promise<PermitView | null> {
  const r = (await db.query('select * from migration_permit where id = $1', [id])).rows[0] as
    Row | undefined;
  return r ? permitView(db, r) : null;
}

async function permitView(db: Queryable, r: Row): Promise<PermitView> {
  const items = (
    await db.query(
      'select candidate_id, item_legacy_id, kind from migration_permit_item where permit_id = $1 order by item_legacy_id, kind, candidate_id',
      [r.id],
    )
  ).rows as Row[];
  return {
    id: r.id as string,
    scopeKey: r.scope_key as string,
    scopeLabel: r.scope_label as string,
    markets: r.markets as string[],
    status: r.status as 'ACTIVE' | 'REVOKED',
    approvedBy: r.approved_by as string,
    approvedAt: (r.approved_at as Date).toISOString(),
    reason: r.reason as string,
    decisionRefs: r.decision_refs as PermitView['decisionRefs'],
    waivedDecisions: r.waived_decisions as PermitView['waivedDecisions'],
    scopedLegacyIds: r.scoped_legacy_ids as string[],
    included: items.map((i) => ({
      candidateId: i.candidate_id as string,
      itemLegacyId: i.item_legacy_id as string,
      kind: i.kind as string,
    })),
  };
}

/** The current verdict of every scoped item, computed from live staging + decisions. */
export async function currentMigrationGate(
  db: Queryable,
  markets: readonly string[],
  asOf = new Date(),
): Promise<{
  gate: MigrationGate;
  cp: ReturnType<typeof commercialPrintGate>;
  report: Awaited<ReturnType<typeof qualityReport>>;
}> {
  const report = await qualityReport(db, asOf, { dataClass: 'REAL' });
  const cp = commercialPrintGate(report.input, report.run.findings, report.readiness);
  return { gate: migrationGate(cp, markets, await currentDispositions(db)), cp, report };
}

export type PermitResult =
  | { ok: true; permit: PermitView; created: boolean }
  | { ok: false; errors: { code: string; message: string }[] };

/** Approve (or re-approve, idempotently) the scoped permit. Only publishable items are included. */
export async function createMigrationPermit(
  db: Queryable,
  raw: unknown,
  actor: string,
  asOf = new Date(),
): Promise<PermitResult> {
  const parsed = PermitInput.safeParse(raw);
  if (!parsed.success)
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => ({
        code: 'INVALID_INPUT',
        message: `${i.path.join('.')}: ${i.message}`,
      })),
    };
  const input = parsed.data;
  const refs: PermitView['decisionRefs'] = [];
  for (const id of new Set([...REQUIRED_DECISIONS, ...input.decisionIds])) {
    const a = await currentAnswer(db, id);
    if (!a)
      return {
        ok: false,
        errors: [{ code: 'DECISION_NOT_ANSWERED', message: `${id} has no recorded owner answer` }],
      };
    refs.push({ decisionId: id, answerId: a.id, revision: a.revision });
  }
  const { gate, report } = await currentMigrationGate(db, input.markets, asOf);
  const publishable = gate.items.filter((i) => isPublishableVerdict(i.verdict));
  if (publishable.length === 0)
    return {
      ok: false,
      errors: [{ code: 'NOTHING_PUBLISHABLE', message: 'no item of the scope passes its gate' }],
    };
  const ctx = buildContext(report.input);
  const included: PermitView['included'] = [];
  for (const it of publishable) {
    for (const c of ctx.candidates) {
      if (ownerLegacyOf(c) !== it.legacyId) continue;
      if (c.reviewStatus === 'REJECTED') continue;
      if (c.reviewStatus !== 'APPROVED' && c.reviewStatus !== 'PUBLISHED')
        return {
          ok: false,
          errors: [
            {
              code: 'CANDIDATE_NOT_APPROVED',
              message: `${it.legacyId}: candidate ${c.id} (${c.kind}) is ${c.reviewStatus}`,
            },
          ],
        };
      included.push({ candidateId: c.id, itemLegacyId: it.legacyId, kind: c.kind });
    }
  }
  const prev = await activePermit(db, input.scopeKey);
  const key = (xs: { candidateId: string }[]) =>
    xs
      .map((x) => x.candidateId)
      .sort()
      .join(',');
  if (prev && key(prev.included) === key(included))
    return { ok: true, permit: prev, created: false };
  const row = (
    await db.query(
      `insert into migration_permit (scope_key, scope_label, markets, status, approved_by, reason,
                                     decision_refs, waived_decisions, scoped_legacy_ids, supersedes_id)
       values ($1, $2, $3, 'ACTIVE', $4, $5, $6, $7, $8, $9) returning *`,
      [
        input.scopeKey,
        input.scopeLabel,
        input.markets,
        actor,
        input.reason,
        JSON.stringify(refs),
        JSON.stringify(gate.waivers),
        pack.items.map((p) => p.legacyId),
        prev?.id ?? null,
      ],
    )
  ).rows[0] as Row;
  for (const i of included)
    await db.query(
      'insert into migration_permit_item (permit_id, candidate_id, item_legacy_id, kind) values ($1, $2, $3, $4)',
      [row.id, i.candidateId, i.itemLegacyId, i.kind],
    );
  return { ok: true, permit: (await permitById(db, row.id as string))!, created: true };
}

export async function revokeMigrationPermit(
  db: Queryable,
  permitId: string,
  actor: string,
  reason: string,
) {
  const p = await permitById(db, permitId);
  if (!p) return { ok: false as const, message: 'permit not found' };
  const row = (
    await db.query(
      `insert into migration_permit (scope_key, scope_label, markets, status, approved_by, reason,
                                     decision_refs, waived_decisions, scoped_legacy_ids, supersedes_id)
       select scope_key, scope_label, markets, 'REVOKED', $2, $3, decision_refs, waived_decisions, scoped_legacy_ids, id
         from migration_permit where id = $1 returning id`,
      [permitId, actor, reason],
    )
  ).rows[0] as Row;
  return { ok: true as const, revokedBy: row.id as string };
}

// ---------------------------------------------------------------- dry run

export interface DryRunCandidate {
  candidateId: string;
  kind: string;
  ok: boolean;
  ops: string[];
  notes: string[];
  errors: string[];
}

/** Read-only: run the domain adapter over a candidate set without writing anything. */
export async function dryRunCandidates(db: Queryable, candidateIds: readonly string[]) {
  const out = new Map<string, DryRunCandidate>();
  for (const id of candidateIds) {
    const r = await previewCandidate(db, id);
    const kind = (
      (await db.query('select kind from import_candidate where id = $1', [id])).rows[0] as Row
    ).kind as string;
    out.set(
      id,
      r.ok
        ? {
            candidateId: id,
            kind,
            ok: true,
            ops: r.plan.ops.map((o) => o.op),
            notes: r.plan.notes,
            errors: [],
          }
        : {
            candidateId: id,
            kind,
            ok: false,
            ops: [],
            notes: [],
            errors: r.errors.map((e) => `${e.code}: ${e.message}`),
          },
    );
  }
  return out;
}

// ---------------------------------------------------------------- publication

const ORDER = ['CATALOG_ITEM', 'OPTION', 'DECORATION', 'COMPOSITION', 'PRICE', 'PRESENTATION'];

export interface ItemPublication {
  itemLegacyId: string;
  ok: boolean;
  alreadyPublished: boolean;
  publicCode: string | null;
  catalogItemId: string | null;
  candidates: { candidateId: string; kind: string; linked: number; created: number }[];
  errors: string[];
}

export type PublishPermitResult =
  | { ok: true; items: ItemPublication[] }
  | { ok: false; errors: { code: string; message: string }[] };

/**
 * Explicit REAL publication of the permit's items. Each item is all-or-nothing (savepoint); an already
 * published item is skipped, so running it twice creates nothing new. Never called by importing, loading
 * a page, approving or starting the app.
 */
export async function publishUnderPermit(
  db: Queryable,
  permitId: string,
  actor: string,
  asOf = new Date(),
): Promise<PublishPermitResult> {
  const permit = await permitById(db, permitId);
  if (!permit || permit.status !== 'ACTIVE')
    return { ok: false, errors: [{ code: 'PERMIT_NOT_ACTIVE', message: 'no active permit' }] };
  const active = await activePermit(db, permit.scopeKey);
  if (!active || active.id !== permit.id)
    return { ok: false, errors: [{ code: 'PERMIT_SUPERSEDED', message: 'permit was superseded' }] };
  // the gate is re-evaluated NOW: a permit never outlives the decisions/review state it was granted on
  const { gate } = await currentMigrationGate(db, permit.markets, asOf);
  const verdict = new Map(gate.items.map((i) => [i.legacyId, i]));
  const items: ItemPublication[] = [];
  const byItem = new Map<string, PermitView['included']>();
  for (const i of permit.included)
    byItem.set(i.itemLegacyId, [...(byItem.get(i.itemLegacyId) ?? []), i]);
  for (const [legacyId, cands] of [...byItem].sort(([a], [b]) => a.localeCompare(b))) {
    const res: ItemPublication = {
      itemLegacyId: legacyId,
      ok: false,
      alreadyPublished: false,
      publicCode: null,
      catalogItemId: null,
      candidates: [],
      errors: [],
    };
    items.push(res);
    const v = verdict.get(legacyId);
    if (!v || !isPublishableVerdict(v.verdict)) {
      res.errors.push(`item no longer passes its gate: ${v?.reasons.join('; ') ?? 'unknown'}`);
      continue;
    }
    const states = (
      await db.query('select id, review_status from import_candidate where id = any($1)', [
        cands.map((c) => c.candidateId),
      ])
    ).rows as Row[];
    const pending = cands.filter(
      (c) => states.find((s) => s.id === c.candidateId)?.review_status !== 'PUBLISHED',
    );
    if (pending.length === 0) {
      res.ok = res.alreadyPublished = true;
      await fillItemRefs(db, res, cands);
      continue;
    }
    await db.query('savepoint publish_item');
    try {
      for (const c of [...pending].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind))) {
        const r = await publishCandidate(db, c.candidateId, { publisher: actor, permitId });
        if (!r.ok) throw new Error(r.errors.map((e) => `${e.code}: ${e.message}`).join('; '));
        await db.query(
          `insert into migration_publication (permit_id, candidate_id, item_legacy_id, actor, outcome)
           values ($1, $2, $3, $4, $5)`,
          [
            permitId,
            c.candidateId,
            legacyId,
            actor,
            JSON.stringify({
              kind: c.kind,
              publicCode: r.publicCode,
              links: r.links,
              notes: r.notes,
            }),
          ],
        );
      }
      await db.query('release savepoint publish_item');
      res.ok = true;
      await fillItemRefs(db, res, cands);
    } catch (e) {
      await db.query('rollback to savepoint publish_item');
      res.errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  return { ok: true, items };
}

async function fillItemRefs(db: Queryable, res: ItemPublication, cands: PermitView['included']) {
  const itemCand = cands.find((c) => c.kind === 'CATALOG_ITEM');
  if (itemCand) {
    const l = (
      await db.query(
        `select l.entity_id, i.public_code from import_candidate_link l
           join catalog_item i on i.id = l.entity_id
          where l.candidate_id = $1 and l.entity_type = 'catalog_item' limit 1`,
        [itemCand.candidateId],
      )
    ).rows[0] as Row | undefined;
    res.catalogItemId = (l?.entity_id as string) ?? null;
    res.publicCode = (l?.public_code as string) ?? null;
  }
  for (const c of cands) {
    const n = (
      await db.query(
        `select count(*) filter (where link_kind = 'LINKED_EXISTING')::int as linked,
                count(*) filter (where link_kind = 'CREATED')::int as created
           from import_candidate_link where candidate_id = $1`,
        [c.candidateId],
      )
    ).rows[0] as Row;
    res.candidates.push({
      candidateId: c.candidateId,
      kind: c.kind,
      linked: Number(n.linked),
      created: Number(n.created),
    });
  }
}

export { permitCoversCandidate };

// ---------------------------------------------------------------- simulation

class Simulated extends Error {}

/**
 * Runs the permit approval + the whole publication and then rolls EVERYTHING back (savepoint), putting the
 * public-code allocator back as it was: a dry run that cannot leave a trace (ADR-0011: no code is issued).
 */
export async function simulateMigration(
  db: Queryable,
  input: unknown,
  actor: string,
  asOf = new Date(),
): Promise<{ permit: PermitResult; publish: PublishPermitResult | null }> {
  const seq = (await db.query('select last_value, is_called from catalog_item_public_code_seq'))
    .rows[0] as Row;
  await db.query('savepoint simulate_migration');
  let out: { permit: PermitResult; publish: PublishPermitResult | null } = {
    permit: { ok: false, errors: [] },
    publish: null,
  };
  try {
    const permit = await createMigrationPermit(db, input, actor, asOf);
    const publish = permit.ok ? await publishUnderPermit(db, permit.permit.id, actor, asOf) : null;
    out = { permit, publish };
    throw new Simulated();
  } catch (e) {
    if (!(e instanceof Simulated)) throw e;
  } finally {
    await db.query('rollback to savepoint simulate_migration');
    await db.query("select setval('catalog_item_public_code_seq', $1::bigint, $2)", [
      seq.last_value,
      seq.is_called,
    ]);
  }
  return out;
}
