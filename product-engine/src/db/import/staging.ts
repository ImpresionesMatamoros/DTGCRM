import type { ImportEnvelope } from '@/import/contract';
import { blockingReasons, unresolvedFields, type IssueLike } from '@/import/requirements';
import { planStaging, type StagingPlan } from '@/import/staging-plan';
import { ProposalSchema } from '@/import/proposal';
import type { Queryable } from '../client';

/**
 * Persistent staging. Callers own the transaction (scripts commit; tests roll back).
 * Staging never writes domain tables.
 */

export interface StageOptions {
  /** Explicit lineage (default: see defaultLineageKey). */
  lineageKey?: string;
  /** Stage again the exact same envelope as a new attempt (explicit re-run). */
  rerun?: boolean;
}

export interface StageResult {
  status: 'STAGED' | 'ALREADY_STAGED';
  batchId: string;
  attempt: number;
  previousBatchId: string | null;
  rerunOfBatchId: string | null;
  records: number;
  candidates: number;
  issues: number;
  lineage: { NEW: number; UNCHANGED: number; CHANGED: number };
}

export class StagingError extends Error {
  override name = 'StagingError';
}

const CHUNK = 400;

async function insertJson(
  db: Queryable,
  sql: string,
  rows: unknown[],
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < rows.length; i += CHUNK) {
    const res = await db.query(sql, [JSON.stringify(rows.slice(i, i + CHUNK))]);
    out.push(...(res.rows as Record<string, unknown>[]));
  }
  return out;
}

/**
 * Default lineage. The primary catalog is one logical source across versions
 * (v1.2 → v1.3 …): its runs share `workbook:PRIMARY_RC`. Comparison and
 * specialized workbooks are separate sources, keyed by file. Fixtures by name.
 */
export function defaultLineageKey(envelope: ImportEnvelope): string {
  const b = envelope.import_batch;
  if (b.data_class === 'FIXTURE') return `fixture:${b.fixture_name}`;
  return b.source_role === 'PRIMARY_RC'
    ? 'workbook:PRIMARY_RC'
    : `workbook:${b.source_role}:${b.source_file}`;
}

export async function stageEnvelope(
  db: Queryable,
  envelope: ImportEnvelope,
  options: StageOptions = {},
): Promise<StageResult> {
  const plan = planStaging(envelope);
  const b = envelope.import_batch;
  const identity = [
    b.source_sha256,
    envelope.producer.parser_version,
    envelope.contract_version,
    b.data_class,
    b.fixture_name ?? '',
  ];
  const prior = (
    await db.query(
      `select id, attempt, envelope_sha256, previous_batch_id, rerun_of_batch_id, record_count, candidate_count
         from import_batch
        where source_sha256 = $1 and parser_version = $2 and contract_version = $3
          and data_class = $4 and coalesce(fixture_name, '') = $5
        order by attempt desc limit 1`,
      identity,
    )
  ).rows[0] as Record<string, unknown> | undefined;

  if (prior) {
    if (prior.envelope_sha256 !== plan.envelopeSha256) {
      throw new StagingError(
        `envelope for ${b.source_file} (${b.source_sha256.slice(0, 12)}…) differs from the staged one with the same identity; bump the exporter/parser version instead of overwriting`,
      );
    }
    if (!options.rerun) {
      const issues = (
        await db.query('select count(*)::int as n from import_issue where batch_id = $1', [
          prior.id,
        ])
      ).rows[0].n;
      const lineage = await lineageCounts(db, prior.id as string);
      return {
        status: 'ALREADY_STAGED',
        batchId: prior.id as string,
        attempt: prior.attempt as number,
        previousBatchId: (prior.previous_batch_id as string | null) ?? null,
        rerunOfBatchId: (prior.rerun_of_batch_id as string | null) ?? null,
        records: prior.record_count as number,
        candidates: prior.candidate_count as number,
        issues,
        lineage,
      };
    }
  }

  const lineageKey = options.lineageKey ?? defaultLineageKey(envelope);
  const previous = (
    await db.query(
      'select id from import_batch where lineage_key = $1 order by staged_at desc, attempt desc, id desc limit 1',
      [lineageKey],
    )
  ).rows[0]?.id as string | undefined;
  const counts = { ERROR: 0, WARNING: 0, INFO: 0 };
  for (const i of plan.issues) counts[i.severity] += 1;

  const batchId = (
    await db.query(
      `insert into import_batch (source_batch_key, contract_version, exporter_version, parser_name, parser_version,
         source_file, source_sha256, source_role, data_class, fixture_name, lineage_key, attempt, rerun_of_batch_id,
         previous_batch_id, envelope_sha256, sheets_inspected, rows_inspected, record_count, candidate_count,
         historical_price_count, error_count, warning_count, info_count, parser_counts, workbook, profile, staged_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,
               clock_timestamp())
       returning id`,
      [
        b.source_batch_id,
        envelope.contract_version,
        envelope.producer.exporter_version,
        envelope.producer.parser_name,
        envelope.producer.parser_version,
        b.source_file,
        b.source_sha256,
        b.source_role,
        b.data_class,
        b.fixture_name,
        lineageKey,
        prior ? (prior.attempt as number) + 1 : 1,
        prior ? prior.id : null,
        previous ?? null,
        plan.envelopeSha256,
        b.sheets_inspected,
        b.rows_inspected,
        plan.records.length,
        plan.candidates.length,
        envelope.historical_prices.length,
        counts.ERROR,
        counts.WARNING,
        counts.INFO,
        JSON.stringify(b.parser_counts),
        JSON.stringify(envelope.provenance.workbook),
        envelope.provenance.profile === null ? null : JSON.stringify(envelope.provenance.profile),
      ],
    )
  ).rows[0].id as string;

  const recordIds = await insertRecords(db, batchId, plan);
  const candidateIds = await insertCandidates(db, batchId, previous ?? null, plan);
  await insertSources(db, batchId, plan, recordIds, candidateIds);
  await insertIssues(db, batchId, plan, recordIds);

  return {
    status: 'STAGED',
    batchId,
    attempt: prior ? (prior.attempt as number) + 1 : 1,
    previousBatchId: previous ?? null,
    rerunOfBatchId: prior ? (prior.id as string) : null,
    records: plan.records.length,
    candidates: plan.candidates.length,
    issues: plan.issues.length,
    lineage: await lineageCounts(db, batchId),
  };
}

async function lineageCounts(db: Queryable, batchId: string) {
  const out = { NEW: 0, UNCHANGED: 0, CHANGED: 0 };
  const res = await db.query(
    'select lineage_status, count(*)::int as n from import_candidate where batch_id = $1 group by 1',
    [batchId],
  );
  for (const r of res.rows) out[r.lineage_status as keyof typeof out] = r.n;
  return out;
}

async function insertRecords(db: Queryable, batchId: string, plan: StagingPlan) {
  const rows = await insertJson(
    db,
    `insert into import_record (batch_id, record_key, record_type, legacy_id, synthetic, raw_payload,
       normalized_payload, source_cells, evidence_class, evidence)
     select '${batchId}', x.record_key, x.record_type, x.legacy_id, x.synthetic, x.raw_payload,
            x.normalized_payload, x.source_cells, x.evidence_class, x.evidence
       from jsonb_to_recordset($1::jsonb) as x(record_key text, record_type text, legacy_id text, synthetic boolean,
            raw_payload jsonb, normalized_payload jsonb, source_cells jsonb, evidence_class text, evidence jsonb)
     returning id, record_key`,
    plan.records.map((r) => ({
      record_key: r.recordKey,
      record_type: r.recordType,
      legacy_id: r.legacyId,
      synthetic: r.synthetic,
      raw_payload: r.rawPayload,
      normalized_payload: r.normalizedPayload,
      source_cells: r.sourceCells,
      evidence_class: r.evidenceClass,
      evidence: r.evidence,
    })),
  );
  return new Map(rows.map((r) => [r.record_key as string, r.id as string]));
}

async function insertCandidates(
  db: Queryable,
  batchId: string,
  previousBatchId: string | null,
  plan: StagingPlan,
) {
  const previous = new Map<string, { id: string; sha: string }>();
  if (previousBatchId) {
    const res = await db.query(
      'select id, lineage_key, payload_sha256 from import_candidate where batch_id = $1',
      [previousBatchId],
    );
    for (const r of res.rows) previous.set(r.lineage_key, { id: r.id, sha: r.payload_sha256 });
  }
  const rows = await insertJson(
    db,
    `insert into import_candidate (batch_id, candidate_key, kind, lineage_key, parser_candidate_keys, proposal,
       payload_sha256, parser_validation_state, unresolved_fields, previous_candidate_id, lineage_status)
     select '${batchId}', x.candidate_key, x.kind::import_candidate_kind, x.lineage_key,
            array(select jsonb_array_elements_text(x.parser_candidate_keys)), x.proposal, x.payload_sha256,
            x.parser_validation_state, array(select jsonb_array_elements_text(x.unresolved_fields)),
            x.previous_candidate_id, x.lineage_status::import_lineage_status
       from jsonb_to_recordset($1::jsonb) as x(candidate_key text, kind text, lineage_key text,
            parser_candidate_keys jsonb, proposal jsonb, payload_sha256 text, parser_validation_state text,
            unresolved_fields jsonb, previous_candidate_id uuid, lineage_status text)
     returning id, candidate_key`,
    plan.candidates.map((c) => {
      const prev = previous.get(c.lineageKey);
      return {
        candidate_key: c.candidateKey,
        kind: c.kind,
        lineage_key: c.lineageKey,
        parser_candidate_keys: c.parserCandidateKeys,
        proposal: c.proposal,
        payload_sha256: c.payloadSha256,
        parser_validation_state: c.parserValidationState,
        unresolved_fields: unresolvedFields(c.proposal),
        previous_candidate_id: prev?.id ?? null,
        lineage_status: !prev ? 'NEW' : prev.sha === c.payloadSha256 ? 'UNCHANGED' : 'CHANGED',
      };
    }),
  );
  return new Map(rows.map((r) => [r.candidate_key as string, r.id as string]));
}

async function insertSources(
  db: Queryable,
  batchId: string,
  plan: StagingPlan,
  recordIds: Map<string, string>,
  candidateIds: Map<string, string>,
) {
  const rows = plan.candidates.flatMap((c) =>
    c.sources.map((s, ordinal) => {
      const recordId = recordIds.get(s.recordKey);
      if (!recordId)
        throw new StagingError(
          `candidate ${c.candidateKey} references unknown record ${s.recordKey}`,
        );
      return {
        candidate_id: candidateIds.get(c.candidateKey),
        record_id: recordId,
        role: s.role,
        ordinal,
      };
    }),
  );
  await insertJson(
    db,
    `insert into import_candidate_source (candidate_id, batch_id, record_id, role, ordinal)
     select x.candidate_id, '${batchId}', x.record_id, x.role, x.ordinal
       from jsonb_to_recordset($1::jsonb) as x(candidate_id uuid, record_id uuid, role text, ordinal int)`,
    rows,
  );
}

async function insertIssues(
  db: Queryable,
  batchId: string,
  plan: StagingPlan,
  recordIds: Map<string, string>,
) {
  await insertJson(
    db,
    `insert into import_issue (batch_id, issue_key, code, severity, origin, message, record_id, detail,
       source_cells, occurrences)
     select '${batchId}', x.issue_key, x.code, x.severity::import_issue_severity, x.origin::import_issue_origin,
            x.message, x.record_id, x.detail, x.source_cells, x.occurrences
       from jsonb_to_recordset($1::jsonb) as x(issue_key text, code text, severity text, origin text, message text,
            record_id uuid, detail jsonb, source_cells jsonb, occurrences int)`,
    plan.issues.map((i) => ({
      issue_key: i.issueKey,
      code: i.code,
      severity: i.severity,
      origin: i.origin,
      message: i.message,
      record_id: i.recordKey === null ? null : (recordIds.get(i.recordKey) ?? null),
      detail: i.detail,
      source_cells: i.sourceCells,
      occurrences: i.occurrences,
    })),
  );
}

// ---------------------------------------------------------------- validation

export interface ValidationSummary {
  batchId: string;
  byStatus: Record<string, number>;
}

/**
 * Computes blocking reasons and unresolved fields and moves candidates to
 * VALID / WARNING / BLOCKED. Approved, published and rejected candidates are
 * left untouched. Idempotent.
 */
export async function validateBatch(db: Queryable, batchId: string): Promise<ValidationSummary> {
  const issues = new Map<string, IssueLike[]>();
  const res = await db.query(
    `select cs.candidate_id, i.code, i.severity
       from import_candidate_source cs join import_issue i on i.record_id = cs.record_id
      where cs.batch_id = $1`,
    [batchId],
  );
  for (const r of res.rows) {
    const list = issues.get(r.candidate_id) ?? [];
    list.push({ code: r.code, severity: r.severity });
    issues.set(r.candidate_id, list);
  }
  const candidates = await db.query(
    `select id, proposal, parser_validation_state, review_status from import_candidate
      where batch_id = $1 and review_status in ('PENDING', 'VALID', 'WARNING', 'BLOCKED')`,
    [batchId],
  );
  const updates = candidates.rows.map((c) => {
    const proposal = ProposalSchema.parse(c.proposal);
    const found = issues.get(c.id) ?? [];
    const blocking = blockingReasons(proposal, c.parser_validation_state, found);
    const unresolved = unresolvedFields(proposal);
    const warned =
      found.some((i) => i.severity !== 'INFO') || c.parser_validation_state !== 'VALID';
    const status =
      blocking.length > 0 ? 'BLOCKED' : unresolved.length > 0 || warned ? 'WARNING' : 'VALID';
    return { id: c.id, status, blocking, unresolved };
  });
  await insertJson(
    db,
    `update import_candidate c
        set review_status = x.status::import_review_status,
            blocking_reasons = array(select jsonb_array_elements_text(x.blocking)),
            unresolved_fields = array(select jsonb_array_elements_text(x.unresolved))
       from jsonb_to_recordset($1::jsonb) as x(id uuid, status text, blocking jsonb, unresolved jsonb)
      where c.id = x.id
        and (c.review_status <> x.status::import_review_status
             or c.blocking_reasons <> array(select jsonb_array_elements_text(x.blocking))
             or c.unresolved_fields <> array(select jsonb_array_elements_text(x.unresolved)))`,
    updates,
  );
  await db.query(
    `update import_batch set status = 'VALIDATED', validated_at = coalesce(validated_at, now())
      where id = $1 and status <> 'VALIDATED'`,
    [batchId],
  );
  const summary = await db.query(
    'select review_status, count(*)::int as n from import_candidate where batch_id = $1 group by 1',
    [batchId],
  );
  return {
    batchId,
    byStatus: Object.fromEntries(summary.rows.map((r) => [r.review_status, r.n])),
  };
}
