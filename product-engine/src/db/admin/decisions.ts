import type { Queryable } from '../client';
import { OWNER_DECISIONS, type OwnerDecision } from '@/decisions/reference';

/**
 * Links STEP 05C decisions to what exists in the database (read-only). A decision is affected-candidates
 * by LEGACY id; staging candidates are matched on the primary release candidate batch. Nothing here
 * mutates a candidate, and no decision is ever applied.
 */

type Row = Record<string, unknown>;

export interface DecisionLinks {
  decision: OwnerDecision;
  /** staged review candidates (CATALOG_ITEM, primary batch) for the affected legacy ids */
  candidates: { id: string; legacyId: string; name: string; reviewStatus: string }[];
  /** affected legacy ids with no staged candidate (not loaded / different batch) */
  unmatched: string[];
  /** product-engine items already carrying one of the legacy ids (LEGACY_ID provenance) */
  items: { id: string; publicCode: string; name: string; legacyId: string }[];
}

export async function decisionLinks(
  db: Queryable,
  decision: OwnerDecision,
): Promise<DecisionLinks> {
  const legacy = decision.affected.map((a) => a.legacyId);
  const candidates = (
    await db.query(
      `select c.id, c.proposal ->> 'legacyId' as legacy_id, c.proposal ->> 'name' as name, c.review_status
         from import_candidate c join import_batch b on b.id = c.batch_id
        where c.kind = 'CATALOG_ITEM' and b.source_role = 'PRIMARY_RC'
          and c.proposal ->> 'legacyId' = any($1) order by c.lineage_key`,
      [legacy],
    )
  ).rows as Row[];
  const found = new Set(candidates.map((r) => r.legacy_id as string));
  const items = (
    await db.query(
      `select i.id, i.public_code, i.canonical_name, s.source_locator
         from source_reference s join catalog_item i on i.id = s.entity_id
        where s.source_kind = 'LEGACY_ID' and s.entity_type = 'catalog_item' and s.source_locator = any($1)
        order by i.public_code`,
      [legacy],
    )
  ).rows as Row[];
  return {
    decision,
    candidates: candidates.map((r) => ({
      id: r.id as string,
      legacyId: r.legacy_id as string,
      name: (r.name as string | null) ?? '',
      reviewStatus: r.review_status as string,
    })),
    unmatched: legacy.filter((l) => !found.has(l)),
    items: items.map((r) => ({
      id: r.id as string,
      publicCode: r.public_code as string,
      name: r.canonical_name as string,
      legacyId: r.source_locator as string,
    })),
  };
}

export interface DecisionSummary {
  decision: OwnerDecision;
  stagedCandidates: number;
}

export async function decisionSummaries(db: Queryable): Promise<DecisionSummary[]> {
  const all = [...new Set(OWNER_DECISIONS.flatMap((d) => d.affected.map((a) => a.legacyId)))];
  const staged = new Set(
    (
      await db.query(
        `select c.proposal ->> 'legacyId' as legacy_id from import_candidate c join import_batch b on b.id = c.batch_id
          where c.kind = 'CATALOG_ITEM' and b.source_role = 'PRIMARY_RC' and c.proposal ->> 'legacyId' = any($1)`,
        [all],
      )
    ).rows.map((r: Row) => r.legacy_id as string),
  );
  return OWNER_DECISIONS.map((d) => ({
    decision: d,
    stagedCandidates: d.affected.filter((a) => staged.has(a.legacyId)).length,
  }));
}
