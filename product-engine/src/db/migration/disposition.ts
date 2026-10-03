import { z } from 'zod';
import type { DispositionRef } from '@/migration/gate';
import pack from '@/decisions/commercial-print.pack.json';
import type { Queryable } from '../client';
import { currentAnswer } from '../admin/decision-answers';

/**
 * STEP 09 completion · owner-backed disposition of source rows that are not products (migration 0018).
 * It records WHAT a row is (alias / configuration / style / never-valid legacy label), which canonical
 * source item(s) it belongs to, and the recorded owner answer behind it. It never creates, merges or
 * deletes a CatalogItem; the candidate's evidence stays in staging.
 */

type Row = Record<string, unknown>;

export const DISPOSITIONS = ['ALIAS', 'CONFIGURATION', 'STYLE', 'LEGACY_INVALID'] as const;

const Input = z
  .strictObject({
    itemLegacyId: z.string().min(1),
    disposition: z.enum(DISPOSITIONS),
    canonicalLegacyIds: z.array(z.string().min(1)).max(10),
    detail: z.string().trim().min(1).max(500),
    decisionId: z.string().regex(/^D-\d{3}$/),
    reason: z.string().trim().min(1).max(1000),
  })
  .refine((v) => (v.disposition === 'LEGACY_INVALID') === (v.canonicalLegacyIds.length === 0), {
    message: 'only a LEGACY_INVALID row has no canonical target; every other disposition needs one',
  });
export type DispositionInput = z.infer<typeof Input>;

export interface DispositionView extends DispositionRef {
  id: string;
  decisionAnswerId: string;
  reason: string;
  actor: string;
  decidedAt: string;
}

const view = (r: Row): DispositionView => ({
  id: r.id as string,
  itemLegacyId: r.item_legacy_id as string,
  disposition: r.disposition as DispositionView['disposition'],
  canonicalLegacyIds: r.canonical_legacy_ids as string[],
  detail: r.detail as string,
  decisionId: r.decision_id as string,
  decisionAnswerId: r.decision_answer_id as string,
  reason: r.reason as string,
  actor: r.actor as string,
  decidedAt: new Date(String(r.decided_at)).toISOString(),
});

/** Current (not superseded) dispositions. */
export async function currentDispositions(db: Queryable): Promise<DispositionView[]> {
  const rows = (
    await db.query(
      `select * from candidate_disposition d
        where not exists (select 1 from candidate_disposition n where n.supersedes_id = d.id)
        order by item_legacy_id`,
    )
  ).rows as Row[];
  return rows.map(view);
}

export type DispositionResult =
  | { ok: true; created: boolean; disposition: DispositionView }
  | { ok: false; errors: { code: string; message: string }[] };

/** Idempotent: recording the same disposition again changes nothing; a different one supersedes the earlier. */
export async function recordDisposition(
  db: Queryable,
  raw: unknown,
  actor: string,
): Promise<DispositionResult> {
  const parsed = Input.safeParse(raw);
  if (!parsed.success)
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => ({ code: 'INVALID_INPUT', message: i.message })),
    };
  const v = parsed.data;
  if (!actor.trim()) return { ok: false, errors: [{ code: 'ACTOR_REQUIRED', message: 'actor' }] };
  const scope = new Set(pack.items.map((p) => p.legacyId));
  for (const l of [v.itemLegacyId, ...v.canonicalLegacyIds])
    if (!scope.has(l))
      return {
        ok: false,
        errors: [{ code: 'OUT_OF_SCOPE', message: `${l} is not in the Commercial Print scope` }],
      };
  if (v.canonicalLegacyIds.includes(v.itemLegacyId))
    return {
      ok: false,
      errors: [{ code: 'SELF_TARGET', message: 'a row cannot be an alias of itself' }],
    };
  const answer = await currentAnswer(db, v.decisionId);
  if (!answer)
    return {
      ok: false,
      errors: [
        { code: 'DECISION_NOT_ANSWERED', message: `${v.decisionId} has no recorded answer` },
      ],
    };
  const prev = (await currentDispositions(db)).find((d) => d.itemLegacyId === v.itemLegacyId);
  if (
    prev &&
    prev.disposition === v.disposition &&
    prev.detail === v.detail &&
    prev.decisionAnswerId === answer.id &&
    [...prev.canonicalLegacyIds].sort().join() === [...v.canonicalLegacyIds].sort().join()
  )
    return { ok: true, created: false, disposition: prev };
  // A disposition may not point at another non-product row (no chains of aliases).
  const all = await currentDispositions(db);
  for (const c of v.canonicalLegacyIds)
    if (all.some((d) => d.itemLegacyId === c))
      return {
        ok: false,
        errors: [
          { code: 'TARGET_NOT_CANONICAL', message: `${c} is itself resolved as a non-product` },
        ],
      };
  const row = (
    await db.query(
      `insert into candidate_disposition (item_legacy_id, disposition, canonical_legacy_ids, detail,
                                          decision_id, decision_answer_id, reason, actor, supersedes_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning *`,
      [
        v.itemLegacyId,
        v.disposition,
        v.canonicalLegacyIds,
        v.detail,
        v.decisionId,
        answer.id,
        v.reason,
        actor,
        prev?.id ?? null,
      ],
    )
  ).rows[0] as Row;
  return { ok: true, created: true, disposition: view(row) };
}
