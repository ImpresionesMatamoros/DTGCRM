import { explainIssue } from '@/review/labels';
import type { Queryable } from '../client';

/** Import batches: only figures that exist in staging (no invented metrics). */

type Row = Record<string, unknown>;
const iso = (v: unknown) =>
  v === null || v === undefined ? null : new Date(String(v)).toISOString();

export interface BatchSummary {
  id: string;
  sourceFile: string;
  sourceSha256: string;
  sourceRole: string;
  dataClass: string;
  fixtureName: string | null;
  parserName: string;
  parserVersion: string;
  contractVersion: string;
  exporterVersion: string;
  lineageKey: string;
  attempt: number;
  status: string;
  stagedAt: string;
  stagedBy: string;
  validatedAt: string | null;
  records: number;
  candidates: number;
  historical: number;
  issues: { ERROR: number; WARNING: number; INFO: number };
  byStatus: Record<string, number>;
}

async function summaries(
  db: Queryable,
  where = '',
  params: unknown[] = [],
): Promise<BatchSummary[]> {
  const rows = (
    await db.query(
      `select b.*,
              (select count(*)::int from import_record r where r.batch_id = b.id) as records_live,
              (select jsonb_object_agg(s, n) from (select review_status::text as s, count(*)::int as n
                  from import_candidate c where c.batch_id = b.id group by 1) x) as by_status,
              (select jsonb_object_agg(s, n) from (select severity::text as s, count(*)::int as n
                  from import_issue i where i.batch_id = b.id group by 1) y) as by_severity
         from import_batch b ${where} order by b.staged_at desc, b.source_file`,
      params,
    )
  ).rows as Row[];
  return rows.map((b) => {
    const sev = (b.by_severity as Record<string, number> | null) ?? {};
    return {
      id: b.id as string,
      sourceFile: b.source_file as string,
      sourceSha256: b.source_sha256 as string,
      sourceRole: b.source_role as string,
      dataClass: b.data_class as string,
      fixtureName: (b.fixture_name as string | null) ?? null,
      parserName: b.parser_name as string,
      parserVersion: b.parser_version as string,
      contractVersion: b.contract_version as string,
      exporterVersion: b.exporter_version as string,
      lineageKey: b.lineage_key as string,
      attempt: b.attempt as number,
      status: b.status as string,
      stagedAt: iso(b.staged_at)!,
      stagedBy: b.staged_by as string,
      validatedAt: iso(b.validated_at),
      records: b.records_live as number,
      candidates: b.candidate_count as number,
      historical: b.historical_price_count as number,
      issues: { ERROR: sev.ERROR ?? 0, WARNING: sev.WARNING ?? 0, INFO: sev.INFO ?? 0 },
      byStatus: (b.by_status as Record<string, number> | null) ?? {},
    };
  });
}

export const listBatches = (db: Queryable) => summaries(db);

export interface BatchDetail extends BatchSummary {
  sheetsInspected: number;
  rowsInspected: number;
  workbook: unknown;
  parserCounts: unknown;
  kindStatus: { kind: string; status: string; n: number }[];
  issuesByCode: {
    code: string;
    severity: string;
    origin: string;
    n: number;
    occurrences: number;
    explanation: string;
    sample: string;
  }[];
  openFields: { kind: string; field: string; n: number }[];
  recordsByType: { type: string; n: number }[];
  lineage: Record<string, number>;
  reviewed: { decided: number; total: number };
}

export async function batchDetail(db: Queryable, batchId: string): Promise<BatchDetail | null> {
  const [summary] = await summaries(db, 'where b.id = $1', [batchId]);
  if (!summary) return null;
  const b = (await db.query('select * from import_batch where id = $1', [batchId])).rows[0] as Row;
  const kindStatus = (
    await db.query(
      `select kind::text, review_status::text as status, count(*)::int as n from import_candidate
        where batch_id = $1 group by 1, 2 order by 1, 2`,
      [batchId],
    )
  ).rows as { kind: string; status: string; n: number }[];
  const issuesByCode = (
    await db.query(
      `select code, severity::text, origin::text, count(*)::int as n, sum(occurrences)::int as occurrences,
              min(message) as sample, (array_agg(detail))[1] as detail
         from import_issue where batch_id = $1 group by 1, 2, 3 order by 4 desc, 1`,
      [batchId],
    )
  ).rows.map((r: Row) => ({
    code: r.code as string,
    severity: r.severity as string,
    origin: r.origin as string,
    n: r.n as number,
    occurrences: r.occurrences as number,
    sample: r.sample as string,
    explanation: explainIssue(
      r.code as string,
      r.sample as string,
      (r.detail as Record<string, unknown> | null) ?? null,
    ).explanation,
  }));
  const openFields = (
    await db.query(
      `select kind::text, f as field, count(*)::int as n
         from v_review_candidate, unnest(open_fields) f where batch_id = $1 group by 1, 2 order by 1, 3 desc, 2`,
      [batchId],
    )
  ).rows as { kind: string; field: string; n: number }[];
  const recordsByType = (
    await db.query(
      'select record_type as type, count(*)::int as n from import_record where batch_id = $1 group by 1 order by 2 desc, 1',
      [batchId],
    )
  ).rows as { type: string; n: number }[];
  const lineage = Object.fromEntries(
    (
      await db.query(
        'select lineage_status::text as s, count(*)::int as n from import_candidate where batch_id = $1 group by 1',
        [batchId],
      )
    ).rows.map((r: Row) => [r.s as string, r.n as number]),
  );
  const decided = ['APPROVED', 'PUBLISHED', 'REJECTED'].reduce(
    (acc, s) => acc + (summary.byStatus[s] ?? 0),
    0,
  );
  return {
    ...summary,
    sheetsInspected: b.sheets_inspected as number,
    rowsInspected: b.rows_inspected as number,
    workbook: b.workbook,
    parserCounts: b.parser_counts,
    kindStatus,
    issuesByCode,
    openFields,
    recordsByType,
    lineage,
    reviewed: { decided, total: summary.candidates },
  };
}
