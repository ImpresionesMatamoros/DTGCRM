import type { SourceCell } from '@/import/contract';
import type { Queryable } from '../client';

/**
 * Two-layer provenance, both directions:
 *   cell → import_record → import_candidate → import_candidate_link → domain entity
 *   domain entity → import_candidate_link → import_candidate → import_record → cell
 * The granular STEP 05A cells stay in staging; the domain keeps SourceReference
 * rows (LEGACY_ID / EXCEL_ROW / HISTORICAL_PRICE_EVIDENCE) that point back here.
 */

export interface TracedRecord {
  recordId: string;
  recordKey: string;
  recordType: string;
  legacyId: string | null;
  role: string;
  cells: SourceCell[];
}

export interface CandidateTrace {
  candidateId: string;
  candidateKey: string;
  kind: string;
  lineageKey: string;
  reviewStatus: string;
  batch: {
    id: string;
    sourceFile: string;
    sourceSha256: string;
    parserVersion: string;
    dataClass: string;
  };
  records: TracedRecord[];
  links: { role: string; entityType: string; entityId: string; linkKind: string }[];
}

export async function traceCandidate(
  db: Queryable,
  candidateId: string,
): Promise<CandidateTrace | null> {
  const c = (
    await db.query(
      `select c.id, c.candidate_key, c.kind, c.lineage_key, c.review_status,
              b.id as batch_id, b.source_file, b.source_sha256, b.parser_version, b.data_class
         from import_candidate c join import_batch b on b.id = c.batch_id where c.id = $1`,
      [candidateId],
    )
  ).rows[0];
  if (!c) return null;
  const records = (
    await db.query(
      `select r.id, r.record_key, r.record_type, r.legacy_id, cs.role, r.source_cells
         from import_candidate_source cs join import_record r on r.id = cs.record_id
        where cs.candidate_id = $1 order by cs.ordinal`,
      [candidateId],
    )
  ).rows.map((r) => ({
    recordId: r.id,
    recordKey: r.record_key,
    recordType: r.record_type,
    legacyId: r.legacy_id,
    role: r.role,
    cells: r.source_cells as SourceCell[],
  }));
  const links = (
    await db.query(
      `select role, entity_type, entity_id, link_kind from import_candidate_link
        where candidate_id = $1 order by role, entity_id`,
      [candidateId],
    )
  ).rows.map((l) => ({
    role: l.role,
    entityType: l.entity_type,
    entityId: l.entity_id,
    linkKind: l.link_kind,
  }));
  return {
    candidateId: c.id,
    candidateKey: c.candidate_key,
    kind: c.kind,
    lineageKey: c.lineage_key,
    reviewStatus: c.review_status,
    batch: {
      id: c.batch_id,
      sourceFile: c.source_file,
      sourceSha256: c.source_sha256,
      parserVersion: c.parser_version,
      dataClass: c.data_class,
    },
    records,
    links,
  };
}

/** Every import candidate (and its Excel cells) behind a domain entity. */
export async function traceEntity(
  db: Queryable,
  entityType: string,
  entityId: string,
): Promise<CandidateTrace[]> {
  const ids = (
    await db.query(
      `select distinct l.candidate_id, c.published_at
         from import_candidate_link l join import_candidate c on c.id = l.candidate_id
        where l.entity_type = $1 and l.entity_id = $2
        order by c.published_at, l.candidate_id`,
      [entityType, entityId],
    )
  ).rows.map((r) => r.candidate_id as string);
  const out: CandidateTrace[] = [];
  for (const id of ids) {
    const t = await traceCandidate(db, id);
    if (t) out.push(t);
  }
  return out;
}
