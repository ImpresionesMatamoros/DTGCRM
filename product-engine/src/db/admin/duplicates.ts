import { pairKey } from '@/quality/context';
import type { Queryable } from '../client';
import { loadQualityInput } from './quality';

/**
 * Duplicate review (STEP 08 §19). Possible duplicates come from the importer's explicit signals
 * (IMPORT_DUPLICATE_REVIEW). The reviewer compares the two items side by side and records
 * MARK_DISTINCT (silences the finding) or MARK_REVIEWED (downgrades it to INFO). There is NO merge:
 * merging real catalog items is a separately designed, later operation.
 */

type Row = Record<string, unknown>;

export interface DuplicateSide {
  legacyId: string;
  candidateId: string | null;
  name: string | null;
  category: string | null;
  status: string | null;
  reviewStatus: string | null;
  options: string[];
  priceEvidence: { candidates: number; observations: number; models: string[] };
  historicalEvidence: number;
  provenance: {
    workbook: string;
    sheet: string | null;
    row: number | null;
    cell: string | null;
  } | null;
}

export interface DuplicatePair {
  pairKey: string;
  kind: 'PROBABLE_DUPLICATE' | 'RELATIONSHIP_NOT_DUPLICATE';
  signals: string[];
  mark: 'DISTINCT' | 'REVIEWED' | null;
  markedBy: string | null;
  markedAt: string | null;
  sides: [DuplicateSide, DuplicateSide];
}

export async function duplicatePairs(db: Queryable, asOf: Date): Promise<DuplicatePair[]> {
  const input = await loadQualityInput(db, asOf);
  const marks = new Map(input.duplicateMarks.map((m) => [m.pairKey, m.mark]));
  const meta = new Map(
    (
      (
        await db.query(
          `select subject_key, actor, marked_at from quality_mark m where subject_type = 'DUPLICATE_PAIR'
              and not exists (select 1 from quality_mark n where n.supersedes_id = m.id)`,
        )
      ).rows as Row[]
    ).map((r) => [r.subject_key as string, r]),
  );
  const items = new Map(
    input.candidates
      .filter((c) => c.proposal.kind === 'CATALOG_ITEM')
      .map((c) => [(c.proposal as { legacyId: string }).legacyId, c]),
  );
  const side = (legacy: string): DuplicateSide => {
    const c = items.get(legacy) ?? null;
    const p = c?.proposal.kind === 'CATALOG_ITEM' ? c.proposal : null;
    const own = input.candidates.filter((x) => {
      const q = x.proposal;
      return 'itemLegacyId' in q && q.itemLegacyId === legacy;
    });
    const opts = own.flatMap((x) => (x.proposal.kind === 'OPTION' ? [x.proposal.name ?? '—'] : []));
    const prices = own.flatMap((x) => (x.proposal.kind === 'PRICE' ? [x.proposal] : []));
    const res = c?.resolution ?? null;
    return {
      legacyId: legacy,
      candidateId: c?.id ?? null,
      name: p?.name ?? null,
      category: (res?.categoryKey as string | undefined) ?? p?.categoryLegacy ?? null,
      status: (res?.status as string | undefined) ?? p?.status ?? null,
      reviewStatus: c?.reviewStatus ?? null,
      options: opts,
      priceEvidence: {
        candidates: prices.length,
        observations: prices.reduce((n, x) => n + x.observations.length, 0),
        models: [...new Set(prices.map((x) => x.model ?? 'sin modelo'))],
      },
      historicalEvidence: input.historicalCountByItemLegacy[legacy] ?? 0,
      provenance: c ? { workbook: c.batch.sourceFile, sheet: null, row: null, cell: null } : null,
    };
  };
  const out: DuplicatePair[] = input.duplicateSignals.map((s) => {
    const key = pairKey(s.legacyIds[0], s.legacyIds[1]);
    const m = meta.get(key);
    return {
      pairKey: key,
      kind: s.kind,
      signals: s.signals,
      mark: marks.get(key) ?? null,
      markedBy: (m?.actor as string | undefined) ?? null,
      markedAt: m ? new Date(String(m.marked_at)).toISOString() : null,
      sides: [side(s.legacyIds[0]), side(s.legacyIds[1])],
    };
  });
  // source sheet / row / cell of each item's candidate (first source cell)
  const ids = out.flatMap((p) => p.sides.map((s) => s.candidateId)).filter((x): x is string => !!x);
  if (ids.length) {
    const cells = (
      await db.query(
        `select id, source_sheet, source_row, source_cell from v_review_candidate where id = any($1::uuid[])`,
        [ids],
      )
    ).rows as Row[];
    const byId = new Map(cells.map((r) => [r.id as string, r]));
    for (const p of out)
      for (const s of p.sides) {
        const r = s.candidateId ? byId.get(s.candidateId) : undefined;
        if (r && s.provenance)
          s.provenance = {
            workbook: s.provenance.workbook,
            sheet: (r.source_sheet as string | null) ?? null,
            row: r.source_row === null ? null : Number(r.source_row),
            cell: (r.source_cell as string | null) ?? null,
          };
      }
  }
  return out.sort((a, b) =>
    a.kind === b.kind ? (a.pairKey < b.pairKey ? -1 : 1) : a.kind === 'PROBABLE_DUPLICATE' ? -1 : 1,
  );
}

export type MarkResult = { ok: true; markId: string } | { ok: false; message: string };

export async function markDuplicatePair(
  db: Queryable,
  input: { pairKey: string; mark: 'DISTINCT' | 'REVIEWED'; reason?: string | null; actor: string },
  asOf: Date,
): Promise<MarkResult> {
  const known = (await duplicatePairs(db, asOf)).find((p) => p.pairKey === input.pairKey);
  if (!known) return { ok: false, message: 'that pair is not a duplicate signal of the importer' };
  const prev = (
    await db.query(
      `select m.id from quality_mark m where m.subject_type = 'DUPLICATE_PAIR' and m.subject_key = $1
          and not exists (select 1 from quality_mark n where n.supersedes_id = m.id)`,
      [input.pairKey],
    )
  ).rows[0] as Row | undefined;
  const row = (
    await db.query(
      `insert into quality_mark (subject_type, subject_key, mark, reason, actor, supersedes_id)
       values ('DUPLICATE_PAIR', $1, $2, $3, $4, $5) returning id`,
      [input.pairKey, input.mark, input.reason?.trim() || null, input.actor, prev?.id ?? null],
    )
  ).rows[0] as Row;
  return { ok: true, markId: row.id as string };
}
