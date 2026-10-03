import type { SourceCell } from '@/import/contract';
import { ProposalSchema, type CandidateKind, type Proposal } from '@/import/proposal';
import { parseDraftResolution, parseResolution } from '@/import/resolution';
import { applyDraftPatch, fieldDef, fieldViews, openFields, type Draft } from '@/review/fields';
import type { FieldView } from '@/review/fields';
import { BLOCKING_EXPLANATIONS, explainIssue } from '@/review/labels';
import type { Queryable } from '../client';
import { validateBatch } from '../import/staging';
import { approveCandidate, rejectCandidate } from '../import/review';
import { previewCandidate, publishCandidate, type PublishError } from '../import/publish';
import { traceCandidate } from '../import/provenance';

/**
 * Review console services (STEP 06). Queries return plain, serializable DTOs;
 * mutations validate candidate state and resolution on the server, write the
 * field-level audit (review_event) and reuse the STEP 05B review/publish API.
 * Callers own the transaction (see tx.ts).
 */

type Row = Record<string, unknown>;

export const REVIEW_KINDS = [
  'CATALOG_ITEM',
  'OPTION',
  'DECORATION',
  'COMPOSITION',
  'PRICE',
  'PRESENTATION',
] as const;
export const REVIEW_STATUSES = [
  'PENDING',
  'VALID',
  'WARNING',
  'BLOCKED',
  'APPROVED',
  'REJECTED',
  'PUBLISHED',
] as const;

export interface ReviewFilters {
  batchId?: string;
  kind?: CandidateKind;
  /** A review status, or TO_REVIEW = PENDING / VALID / WARNING (not decided yet). */
  status?: (typeof REVIEW_STATUSES)[number] | 'TO_REVIEW';
  severity?: 'ERROR' | 'WARNING' | 'INFO';
  /** CATALOG_ITEM fields: resolved / unresolved (after the draft). */
  catalogStatus?: 'resolved' | 'unresolved';
  itemType?: 'resolved' | 'unresolved';
  decorationPolicy?: 'resolved' | 'unresolved';
  /** Any kind: still has open fields or not. */
  open?: 'open' | 'complete';
  /** Any kind: this resolution field is still open (e.g. isRequired). */
  openField?: string;
  hasPrice?: boolean;
  hasHistorical?: boolean;
  hasDuplicate?: boolean;
  sheet?: string;
  workbook?: string;
  dataClass?: 'REAL' | 'FIXTURE';
  q?: string;
  /** Explicit candidate ids (e.g. a future STEP 05C decision group). */
  ids?: string[];
  sort?: 'lineage' | 'name' | 'open' | 'issues' | 'status' | 'source';
}

export interface ReviewRow {
  id: string;
  kind: CandidateKind;
  label: string | null;
  itemName: string | null;
  itemLegacyId: string | null;
  lineageKey: string;
  reviewStatus: string;
  dataClass: string;
  sourceFile: string;
  sheet: string | null;
  row: number | null;
  cell: string | null;
  errors: number;
  warnings: number;
  infos: number;
  openFields: string[];
  blockingReasons: string[];
  hasPrice: boolean;
  hasHistorical: boolean;
  hasDuplicate: boolean;
  /** Key fields with where their value comes from (source / reviewed / unresolved). */
  summary: { field: string; label: string; state: FieldView['state']; value: unknown }[];
}

export interface ReviewPage {
  rows: ReviewRow[];
  total: number;
  page: number;
  pageSize: number;
}

const SUMMARY_FIELDS: Record<CandidateKind, string[]> = {
  CATALOG_ITEM: ['itemType', 'status', 'decorationPolicy', 'customerSuppliedItem', 'categoryKey'],
  OPTION: ['isRequired', 'selectionMode', 'isDistributable', 'definition'],
  DECORATION: ['methodKey', 'decorationPolicy'],
  COMPOSITION: ['childLegacyId', 'role', 'quantity'],
  PRICE: ['validFrom', 'amountBasis', 'maxQuantity'],
  PRESENTATION: ['locale', 'isDefault'],
};

function buildWhere(f: ReviewFilters): { sql: string; params: unknown[] } {
  const where: string[] = [];
  const params: unknown[] = [];
  const p = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  if (f.batchId) where.push(`batch_id = ${p(f.batchId)}`);
  if (f.kind) where.push(`kind = ${p(f.kind)}::import_candidate_kind`);
  if (f.status === 'TO_REVIEW') where.push(`review_status in ('PENDING', 'VALID', 'WARNING')`);
  else if (f.status) where.push(`review_status = ${p(f.status)}::import_review_status`);
  if (f.severity === 'ERROR') where.push('error_count > 0');
  if (f.severity === 'WARNING') where.push('warning_count > 0');
  if (f.severity === 'INFO') where.push('info_count > 0');
  const fieldFilter = (field: string, v?: 'resolved' | 'unresolved') => {
    if (!v) return;
    where.push(`kind = 'CATALOG_ITEM'`);
    where.push(
      v === 'unresolved'
        ? `${p(field)} = any(open_fields)`
        : `not (${p(field)} = any(open_fields))`,
    );
  };
  fieldFilter('status', f.catalogStatus);
  fieldFilter('itemType', f.itemType);
  fieldFilter('decorationPolicy', f.decorationPolicy);
  if (f.open === 'open') where.push('cardinality(open_fields) > 0');
  if (f.open === 'complete') where.push('cardinality(open_fields) = 0');
  if (f.openField) where.push(`${p(f.openField)} = any(open_fields)`);
  if (f.hasPrice !== undefined) where.push(`has_price = ${p(f.hasPrice)}`);
  if (f.hasHistorical !== undefined) where.push(`has_historical = ${p(f.hasHistorical)}`);
  if (f.hasDuplicate !== undefined) where.push(`has_duplicate = ${p(f.hasDuplicate)}`);
  if (f.sheet) where.push(`source_sheet = ${p(f.sheet)}`);
  if (f.workbook) where.push(`source_file = ${p(f.workbook)}`);
  if (f.dataClass) where.push(`data_class = ${p(f.dataClass)}::import_data_class`);
  if (f.ids) where.push(`id = any(${p(f.ids)}::uuid[])`);
  if (f.q?.trim()) {
    const like = p(`%${f.q.trim()}%`);
    where.push(
      `(label ilike ${like} or item_name ilike ${like} or lineage_key ilike ${like} or item_legacy_id ilike ${like})`,
    );
  }
  return { sql: where.length ? `where ${where.join(' and ')}` : '', params };
}

const ORDER: Record<NonNullable<ReviewFilters['sort']>, string> = {
  lineage: 'lineage_key, id',
  name: 'coalesce(label, item_name) nulls last, lineage_key, id',
  open: 'cardinality(open_fields) desc, lineage_key, id',
  issues: 'error_count desc, warning_count desc, lineage_key, id',
  status: 'review_status, lineage_key, id',
  source: 'source_file, source_sheet, source_row nulls last, id',
};

export async function listReviewCandidates(
  db: Queryable,
  filters: ReviewFilters,
  page = 1,
  pageSize = 50,
): Promise<ReviewPage> {
  const { sql, params } = buildWhere(filters);
  const size = Math.min(Math.max(pageSize, 1), 200);
  const current = Math.max(page, 1);
  const total = (await db.query(`select count(*)::int as n from v_review_candidate ${sql}`, params))
    .rows[0].n as number;
  const res = await db.query(
    `select * from v_review_candidate ${sql} order by ${ORDER[filters.sort ?? 'lineage']}
      limit ${size} offset ${(current - 1) * size}`,
    params,
  );
  const rows = res.rows.map((r: Row): ReviewRow => {
    const proposal = ProposalSchema.parse(r.proposal);
    const draft = (r.resolution as Draft | null) ?? null;
    const views = fieldViews(proposal, draft);
    return {
      id: r.id as string,
      kind: r.kind as CandidateKind,
      label: (r.label as string | null) ?? null,
      itemName: (r.item_name as string | null) ?? null,
      itemLegacyId: (r.item_legacy_id as string | null) ?? null,
      lineageKey: r.lineage_key as string,
      reviewStatus: r.review_status as string,
      dataClass: r.data_class as string,
      sourceFile: r.source_file as string,
      sheet: (r.source_sheet as string | null) ?? null,
      row: (r.source_row as number | null) ?? null,
      cell: (r.source_cell as string | null) ?? null,
      errors: Number(r.error_count),
      warnings: Number(r.warning_count),
      infos: Number(r.info_count),
      openFields: r.open_fields as string[],
      blockingReasons: r.blocking_reasons as string[],
      hasPrice: r.has_price as boolean,
      hasHistorical: r.has_historical as boolean,
      hasDuplicate: r.has_duplicate as boolean,
      summary: SUMMARY_FIELDS[proposal.kind]
        .map((f) => views.find((v) => v.field === f))
        .filter((v): v is FieldView => v !== undefined)
        .map((v) => ({ field: v.field, label: v.label, state: v.state, value: v.value })),
    };
  });
  return { rows, total, page: current, pageSize: size };
}

/** Ids matching the filters, grouped by kind (for "select all matching" in the inbox). */
export async function listReviewIdsByKind(
  db: Queryable,
  filters: ReviewFilters,
  limit = 2000,
): Promise<{ total: number; byKind: Record<string, string[]> } | null> {
  const { sql, params } = buildWhere(filters);
  const total = (await db.query(`select count(*)::int as n from v_review_candidate ${sql}`, params))
    .rows[0].n as number;
  if (total > limit) return null;
  const rows = (
    await db.query(
      `select kind::text, array_agg(id order by lineage_key) as ids from v_review_candidate ${sql} group by 1`,
      params,
    )
  ).rows as { kind: string; ids: string[] }[];
  return { total, byKind: Object.fromEntries(rows.map((r) => [r.kind, r.ids])) };
}

export interface ReviewFacets {
  batches: { id: string; sourceFile: string; dataClass: string; candidates: number }[];
  sheets: { sheet: string; n: number }[];
  workbooks: { sourceFile: string; n: number }[];
}

export async function reviewFacets(db: Queryable, batchId?: string): Promise<ReviewFacets> {
  const batches = (
    await db.query(
      `select b.id, b.source_file, b.data_class, count(c.id)::int as n
         from import_batch b left join import_candidate c on c.batch_id = b.id
        group by 1, 2, 3, b.staged_at having count(c.id) > 0 order by b.staged_at desc`,
    )
  ).rows.map((r: Row) => ({
    id: r.id as string,
    sourceFile: r.source_file as string,
    dataClass: r.data_class as string,
    candidates: r.n as number,
  }));
  const scope = batchId ? 'where batch_id = $1' : '';
  const params = batchId ? [batchId] : [];
  const sheets = (
    await db.query(
      `select source_sheet as sheet, count(*)::int as n from v_review_candidate ${scope}
        group by 1 having source_sheet is not null order by 1`,
      params,
    )
  ).rows as { sheet: string; n: number }[];
  const workbooks = (
    await db.query(
      `select source_file, count(*)::int as n from v_review_candidate ${scope} group by 1 order by 1`,
      params,
    )
  ).rows.map((r: Row) => ({ sourceFile: r.source_file as string, n: r.n as number }));
  return { batches, sheets, workbooks };
}

// ---------------------------------------------------------------- detail

export interface IssueView {
  id: string;
  code: string;
  severity: string;
  origin: string;
  message: string;
  explanation: string;
  field: string | null;
  source: string | null;
  occurrences: number;
  detail: Record<string, unknown> | null;
}

export interface SourceRecordView {
  recordId: string;
  recordKey: string;
  recordType: string;
  legacyId: string | null;
  role: string;
  cells: SourceCell[];
  normalized: Record<string, unknown>;
}

export interface PreviewView {
  state: 'OK' | 'ADAPTER_ERRORS' | 'INCOMPLETE';
  ops: { op: string; summary: string; values: unknown }[];
  notes: string[];
  errors: { code: string; field: string | null; message: string }[];
}

export interface CandidateDetail {
  id: string;
  kind: CandidateKind;
  lineageKey: string;
  label: string | null;
  itemName: string | null;
  itemLegacyId: string | null;
  reviewStatus: string;
  blockingReasons: { code: string; explanation: string }[];
  parserValidationState: string;
  lineageStatus: string;
  proposal: Proposal;
  draft: Draft | null;
  fields: FieldView[];
  openFields: string[];
  approval: { by: string | null; at: string | null; sha256: string | null };
  rejection: { by: string | null; at: string | null; reason: string | null };
  publication: { by: string | null; at: string | null };
  batch: {
    id: string;
    sourceFile: string;
    sourceSha256: string;
    parserName: string;
    parserVersion: string;
    dataClass: 'REAL' | 'FIXTURE';
    stagedAt: string;
  };
  issues: IssueView[];
  records: SourceRecordView[];
  links: { role: string; entityType: string; entityId: string; linkKind: string }[];
  preview: PreviewView;
  /** Domain items carrying the candidate's LEGACY_ID (target LINK_EXISTING). */
  lineageMatches: { id: string; publicCode: string; name: string; status: string | null }[];
  related: {
    id: string;
    kind: string;
    label: string | null;
    reviewStatus: string;
    openFields: number;
  }[];
  historical: {
    recordId: string;
    priceLegacyId: string;
    amount: string | null;
    currency: string | null;
    conditions: unknown;
    sheet: string | null;
    row: number | null;
  }[];
  events: {
    id: string;
    action: string;
    field: string | null;
    oldValue: unknown;
    newValue: unknown;
    actor: string;
    reason: string | null;
    origin: string;
    bulkOperationId: string | null;
    createdAt: string;
    detail: unknown;
  }[];
  controls: {
    categories: { key: string; name: string }[];
    methods: { key: string; name: string }[];
    optionDefinitions: {
      key: string;
      label: string;
      valueKind: string;
      unit: string | null;
      values: { code: string; label: string }[];
    }[];
  };
}

const iso = (v: unknown) =>
  v === null || v === undefined ? null : new Date(String(v)).toISOString();

function summarizeOp(op: Record<string, unknown>): string {
  const v = (op.values ?? {}) as Record<string, unknown>;
  switch (op.op) {
    case 'CREATE_CATALOG_ITEM':
      return `CatalogItem nuevo · ${String(v.kind)} · ${String(v.canonicalName)} · status ${String(v.status)} · decoración ${String(v.decorationPolicy)} · código DTG asignado al publicar`;
    case 'ASSIGN_CATEGORY':
      return `Categoría primaria ${String(op.categoryKey)}`;
    case 'CREATE_OPTION_DEFINITION':
      return `Definición de opción nueva ${String(v.key)} (${String(v.valueKind)})`;
    case 'CREATE_OPTION_VALUE':
      return `Valor nuevo ${String(v.code)} · ${String(v.label)}`;
    case 'CREATE_ITEM_OPTION':
      return `Opción del item · obligatoria ${String(v.isRequired)} · ${String(v.selectionMode)} · distribuible ${String(v.isDistributable)}`;
    case 'CREATE_ITEM_OPTION_VALUE':
      return 'Valor permitido para el item';
    case 'CREATE_DECORATION_CAPABILITY':
      return `Capacidad de decoración (método ${String(op.methodId)})`;
    case 'SET_DECORATION_POLICY':
      return `Política de decoración ${String(op.from)} → ${String(op.to)}`;
    case 'CREATE_COMPOSITION_LINE':
      return `Línea de composición · ${String(v.role)} × ${String(v.quantity)}`;
    case 'CREATE_PRICE_DEFINITION':
      return `PriceDefinition DRAFT · ${String(v.model)} · vigente desde ${String(v.validFrom)}`;
    case 'CREATE_PRESENTATION':
      return `Presentación ${String(v.locale)} · ${String(v.displayName)} · default ${String(v.isDefault)}`;
    case 'ADD_SOURCE_REFERENCE':
      return `Procedencia ${String(op.sourceKind)} · ${String(op.locator)}`;
    case 'LINK':
      return `Enlace ${String(op.role)} (${String(op.linkKind)})`;
    default:
      return String(op.op);
  }
}

/**
 * Domain preview through the REAL adapter. A draft that does not even satisfy
 * the complete resolution schema is reported as INCOMPLETE (with the schema's
 * own messages) instead of being fed to the adapter.
 */
export async function previewDraft(
  db: Queryable,
  candidateId: string,
  kind: CandidateKind,
  draft: Draft | null,
): Promise<PreviewView> {
  const strict = parseResolution(kind, draft ?? {});
  if (!strict.ok) {
    return {
      state: 'INCOMPLETE',
      ops: [],
      notes: [],
      errors: strict.errors.map((e) => ({
        code: 'RESOLUTION_INCOMPLETE',
        field: e.path || null,
        message: e.message,
      })),
    };
  }
  const r = await previewCandidate(db, candidateId, strict.resolution);
  if (!r.ok) {
    return {
      state: 'ADAPTER_ERRORS',
      ops: [],
      notes: [],
      errors: r.errors.map((e: PublishError) => ({
        code: e.code,
        field: 'field' in e && e.field ? e.field : null,
        message: e.message,
      })),
    };
  }
  return {
    state: 'OK',
    ops: r.plan.ops.map((op) => ({
      op: op.op,
      summary: summarizeOp(op as unknown as Record<string, unknown>),
      values: 'values' in op ? op.values : null,
    })),
    notes: r.plan.notes,
    errors: [],
  };
}

export async function candidateDetail(
  db: Queryable,
  candidateId: string,
): Promise<CandidateDetail | null> {
  const r = (
    await db.query(
      `select v.*, c.parser_validation_state, c.lineage_status, c.approved_by, c.approved_at, c.approval_sha256,
              c.rejected_by, c.rejected_at, c.rejection_reason, c.published_by, c.published_at,
              b.source_sha256, b.parser_name, b.parser_version
         from v_review_candidate v
         join import_candidate c on c.id = v.id
         join import_batch b on b.id = v.batch_id
        where v.id = $1`,
      [candidateId],
    )
  ).rows[0] as Row | undefined;
  if (!r) return null;
  const proposal = ProposalSchema.parse(r.proposal);
  const draft = (r.resolution as Draft | null) ?? null;
  const kind = r.kind as CandidateKind;

  const trace = await traceCandidate(db, candidateId);
  const normalized = new Map<string, Record<string, unknown>>(
    (
      await db.query(
        `select r.id, r.normalized_payload from import_candidate_source cs
           join import_record r on r.id = cs.record_id where cs.candidate_id = $1`,
        [candidateId],
      )
    ).rows.map((x: Row) => [x.id as string, x.normalized_payload as Record<string, unknown>]),
  );

  const issues: IssueView[] = (
    await db.query(
      `select i.id, i.code, i.severity, i.origin, i.message, i.detail, i.occurrences,
              r.source_cells -> 0 ->> 'source_sheet' as sheet, r.source_cells -> 0 ->> 'source_cell' as cell
         from import_issue i left join import_record r on r.id = i.record_id
        where i.candidate_id = $1
           or i.record_id in (select record_id from import_candidate_source where candidate_id = $1)
        order by case i.severity when 'ERROR' then 0 when 'WARNING' then 1 else 2 end, i.code, i.id`,
      [candidateId],
    )
  ).rows.map((i: Row) => {
    const detail = (i.detail as Record<string, unknown> | null) ?? null;
    const ex = explainIssue(i.code as string, i.message as string, detail);
    return {
      id: i.id as string,
      code: i.code as string,
      severity: i.severity as string,
      origin: i.origin as string,
      message: i.message as string,
      explanation: ex.explanation,
      field: ex.field ?? ((detail?.field as string | undefined) || null),
      source: i.sheet ? `${String(i.sheet)}!${String(i.cell)}` : null,
      occurrences: Number(i.occurrences),
      detail,
    };
  });

  const itemLegacy = (r.item_legacy_id as string | null) ?? null;
  const lineageMatches = itemLegacy
    ? (
        await db.query(
          `select i.id, i.public_code, i.canonical_name, i.status
             from source_reference s join catalog_item i on i.id = s.entity_id
            where s.source_kind = 'LEGACY_ID' and s.entity_type = 'catalog_item' and s.source_locator = $1
            order by i.public_code`,
          [itemLegacy],
        )
      ).rows.map((x: Row) => ({
        id: x.id as string,
        publicCode: x.public_code as string,
        name: x.canonical_name as string,
        status: (x.status as string | null) ?? null,
      }))
    : [];

  const related = itemLegacy
    ? (
        await db.query(
          `select id, kind, label, review_status, cardinality(open_fields)::int as open
             from v_review_candidate
            where batch_id = $1 and item_legacy_id = $2 and id <> $3
            order by kind, lineage_key`,
          [r.batch_id, itemLegacy, candidateId],
        )
      ).rows.map((x: Row) => ({
        id: x.id as string,
        kind: x.kind as string,
        label: (x.label as string | null) ?? null,
        reviewStatus: x.review_status as string,
        openFields: x.open as number,
      }))
    : [];

  const historical = itemLegacy
    ? (
        await db.query(
          `select id, evidence, source_cells -> 0 ->> 'source_sheet' as sheet,
                  (source_cells -> 0 ->> 'source_row')::int as row
             from import_record
            where batch_id = $1 and evidence_class = 'HISTORICAL_PRICE' and evidence ->> 'item_legacy' = $2
            order by record_key`,
          [r.batch_id, itemLegacy],
        )
      ).rows.map((x: Row) => {
        const e = x.evidence as {
          price_legacy: unknown;
          money: { amount: string | null; currency: string | null };
          conditions: unknown;
        };
        return {
          recordId: x.id as string,
          priceLegacyId: String(e.price_legacy),
          amount: e.money?.amount ?? null,
          currency: e.money?.currency ?? null,
          conditions: e.conditions ?? null,
          sheet: (x.sheet as string | null) ?? null,
          row: (x.row as number | null) ?? null,
        };
      })
    : [];

  const events = (
    await db.query(
      `select id, action, field, old_value, new_value, detail, actor, reason, origin, bulk_operation_id, created_at
         from review_event where candidate_id = $1 order by id desc`,
      [candidateId],
    )
  ).rows.map((e: Row) => ({
    id: String(e.id),
    action: e.action as string,
    field: (e.field as string | null) ?? null,
    oldValue: e.old_value ?? null,
    newValue: e.new_value ?? null,
    actor: e.actor as string,
    reason: (e.reason as string | null) ?? null,
    origin: e.origin as string,
    bulkOperationId: (e.bulk_operation_id as string | null) ?? null,
    createdAt: iso(e.created_at)!,
    detail: e.detail ?? null,
  }));

  const categories = (
    await db.query('select key, name from category where is_active order by sort, name')
  ).rows as { key: string; name: string }[];
  const methods = (
    await db.query('select key, name from decoration_method where is_active order by key')
  ).rows as { key: string; name: string }[];
  const optionDefinitions =
    kind === 'OPTION'
      ? (
          await db.query(
            `select d.key, d.label, d.value_kind, d.unit,
                    coalesce(jsonb_agg(jsonb_build_object('code', v.code, 'label', v.label) order by v.sort, v.code)
                      filter (where v.id is not null), '[]') as values
               from option_definition d left join option_value v on v.option_definition_id = d.id
              group by 1, 2, 3, 4 order by 1`,
          )
        ).rows.map((d: Row) => ({
          key: d.key as string,
          label: d.label as string,
          valueKind: d.value_kind as string,
          unit: (d.unit as string | null) ?? null,
          values: d.values as { code: string; label: string }[],
        }))
      : [];

  return {
    id: r.id as string,
    kind,
    lineageKey: r.lineage_key as string,
    label: (r.label as string | null) ?? null,
    itemName: (r.item_name as string | null) ?? null,
    itemLegacyId: itemLegacy,
    reviewStatus: r.review_status as string,
    blockingReasons: (r.blocking_reasons as string[]).map((code) => ({
      code,
      explanation: BLOCKING_EXPLANATIONS[code] ?? code,
    })),
    parserValidationState: r.parser_validation_state as string,
    lineageStatus: r.lineage_status as string,
    proposal,
    draft,
    fields: fieldViews(proposal, draft),
    openFields: r.open_fields as string[],
    approval: {
      by: (r.approved_by as string | null) ?? null,
      at: iso(r.approved_at),
      sha256: (r.approval_sha256 as string | null) ?? null,
    },
    rejection: {
      by: (r.rejected_by as string | null) ?? null,
      at: iso(r.rejected_at),
      reason: (r.rejection_reason as string | null) ?? null,
    },
    publication: { by: (r.published_by as string | null) ?? null, at: iso(r.published_at) },
    batch: {
      id: r.batch_id as string,
      sourceFile: r.source_file as string,
      sourceSha256: r.source_sha256 as string,
      parserName: r.parser_name as string,
      parserVersion: r.parser_version as string,
      dataClass: r.data_class as 'REAL' | 'FIXTURE',
      stagedAt: iso(r.staged_at)!,
    },
    issues,
    records: (trace?.records ?? []).map((t) => ({
      ...t,
      normalized: normalized.get(t.recordId) ?? {},
    })),
    links: trace?.links ?? [],
    preview: await previewDraft(db, candidateId, kind, draft),
    lineageMatches,
    related,
    historical,
    events,
    controls: { categories, methods, optionDefinitions },
  };
}

// ---------------------------------------------------------------- mutations

export type ReviewActionError = {
  code:
    | 'CANDIDATE_NOT_FOUND'
    | 'NOT_EDITABLE'
    | 'INVALID_RESOLUTION'
    | 'UNKNOWN_FIELD'
    | 'NOTHING_CHANGED'
    | 'NOT_APPROVABLE'
    | 'UNRESOLVED_FIELD'
    | 'REASON_REQUIRED'
    | 'REAL_PUBLICATION_DISABLED'
    | 'NOT_APPROVED'
    | 'PUBLISH_FAILED'
    | 'REVIEWER_REQUIRED';
  message: string;
  field?: string;
};

export type ReviewActionResult<T = Record<string, unknown>> =
  ({ ok: true } & T) | { ok: false; errors: ReviewActionError[] };

interface Locked {
  id: string;
  batch_id: string;
  kind: CandidateKind;
  proposal: unknown;
  resolution: Draft | null;
  review_status: string;
  data_class: 'REAL' | 'FIXTURE';
}

async function lockCandidate(db: Queryable, id: string): Promise<Locked | undefined> {
  return (
    await db.query(
      `select c.id, c.batch_id, c.kind, c.proposal, c.resolution, c.review_status, b.data_class
         from import_candidate c join import_batch b on b.id = c.batch_id
        where c.id = $1 for update of c`,
      [id],
    )
  ).rows[0] as Locked | undefined;
}

const EDITABLE = new Set(['VALID', 'WARNING']);

export async function recordEvent(
  db: Queryable,
  e: {
    candidateId: string;
    action: 'SET' | 'CLEAR' | 'APPROVE' | 'REJECT' | 'WITHDRAW_APPROVAL' | 'PUBLISH';
    field?: string | null;
    oldValue?: unknown;
    newValue?: unknown;
    detail?: unknown;
    actor: string;
    reason?: string | null;
    origin: 'UI_SINGLE' | 'UI_BULK' | 'DECISION_GROUP';
    bulkOperationId?: string | null;
  },
) {
  const json = (v: unknown) => (v === undefined ? null : JSON.stringify(v));
  await db.query(
    `insert into review_event (candidate_id, action, field, old_value, new_value, detail, actor, reason, origin, bulk_operation_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      e.candidateId,
      e.action,
      e.field ?? null,
      json(e.oldValue),
      json(e.newValue),
      json(e.detail),
      e.actor,
      e.reason?.trim() || null,
      e.origin,
      e.bulkOperationId ?? null,
    ],
  );
}

/**
 * Writes a new draft for one locked, editable candidate: validates it with the
 * partial resolution schema, recomputes the open fields with `unresolvedFields`
 * and records one review_event per changed field.
 */
export async function writeDraft(
  db: Queryable,
  c: Locked,
  patch: { set?: Draft; clear?: readonly string[] },
  audit: {
    actor: string;
    reason?: string | null;
    origin: 'UI_SINGLE' | 'UI_BULK' | 'DECISION_GROUP';
    bulkOperationId?: string | null;
  },
): Promise<ReviewActionResult<{ changed: number; openFields: string[] }>> {
  if (!EDITABLE.has(c.review_status)) {
    return {
      ok: false,
      errors: [
        {
          code: 'NOT_EDITABLE',
          message:
            c.review_status === 'APPROVED'
              ? 'the candidate is APPROVED: withdraw the approval before changing its resolution'
              : `a ${c.review_status} candidate cannot be edited`,
        },
      ],
    };
  }
  for (const f of [...Object.keys(patch.set ?? {}), ...(patch.clear ?? [])]) {
    if (!fieldDef(c.kind, f))
      return {
        ok: false,
        errors: [{ code: 'UNKNOWN_FIELD', field: f, message: `${f} is not a ${c.kind} field` }],
      };
  }
  const { draft, changes } = applyDraftPatch(c.resolution, patch);
  if (changes.length === 0)
    return { ok: false, errors: [{ code: 'NOTHING_CHANGED', message: 'nothing changed' }] };
  const parsed = parseDraftResolution(c.kind, draft);
  if (!parsed.ok) {
    return {
      ok: false,
      errors: parsed.errors.map((e) => ({
        code: 'INVALID_RESOLUTION' as const,
        field: e.path,
        message: e.message,
      })),
    };
  }
  const proposal = ProposalSchema.parse(c.proposal);
  const open = openFields(proposal, parsed.resolution);
  const empty = Object.keys(parsed.resolution).length === 0;
  await db.query('update import_candidate set resolution = $2, open_fields = $3 where id = $1', [
    c.id,
    empty ? null : JSON.stringify(parsed.resolution),
    open,
  ]);
  for (const ch of changes) {
    const def = fieldDef(c.kind, ch.field);
    const source = def?.sourceValue(proposal);
    await recordEvent(db, {
      candidateId: c.id,
      action: ch.action,
      field: ch.field,
      oldValue: ch.oldValue,
      newValue: ch.newValue,
      detail: { sourceValue: source === undefined ? null : source, openFields: open },
      ...audit,
    });
  }
  c.resolution = empty ? null : parsed.resolution;
  return { ok: true, changed: changes.length, openFields: open };
}

export async function saveDraft(
  db: Queryable,
  actor: string,
  candidateId: string,
  patch: { set?: Draft; clear?: readonly string[] },
  reason?: string | null,
): Promise<ReviewActionResult<{ changed: number; openFields: string[] }>> {
  const c = await lockCandidate(db, candidateId);
  if (!c)
    return { ok: false, errors: [{ code: 'CANDIDATE_NOT_FOUND', message: 'candidate not found' }] };
  return writeDraft(db, c, patch, { actor, reason, origin: 'UI_SINGLE' });
}

/** Approves the saved draft through the STEP 05B workflow (no bulk approval exists). */
export async function approveDraft(
  db: Queryable,
  actor: string,
  candidateId: string,
  reason?: string | null,
): Promise<ReviewActionResult<{ approvalSha256: string }>> {
  const c = await lockCandidate(db, candidateId);
  if (!c)
    return { ok: false, errors: [{ code: 'CANDIDATE_NOT_FOUND', message: 'candidate not found' }] };
  const res = await approveCandidate(db, candidateId, {
    reviewer: actor,
    resolution: c.resolution ?? {},
  });
  if (!res.ok) {
    return {
      ok: false,
      errors: res.errors.map((e) => ({
        code:
          e.code === 'INVALID_RESOLUTION' ||
          e.code === 'UNRESOLVED_FIELD' ||
          e.code === 'REVIEWER_REQUIRED'
            ? e.code
            : 'NOT_APPROVABLE',
        message: e.message,
        field: e.field,
      })),
    };
  }
  await recordEvent(db, {
    candidateId,
    action: 'APPROVE',
    detail: { approvalSha256: res.approvalSha256, from: c.review_status },
    actor,
    reason,
    origin: 'UI_SINGLE',
  });
  return { ok: true, approvalSha256: res.approvalSha256! };
}

export async function rejectWithReason(
  db: Queryable,
  actor: string,
  candidateId: string,
  reason: string,
): Promise<ReviewActionResult> {
  const c = await lockCandidate(db, candidateId);
  if (!c)
    return { ok: false, errors: [{ code: 'CANDIDATE_NOT_FOUND', message: 'candidate not found' }] };
  const res = await rejectCandidate(db, candidateId, { reviewer: actor, reason });
  if (!res.ok) {
    return {
      ok: false,
      errors: res.errors.map((e) => ({
        code: e.code === 'REASON_REQUIRED' ? 'REASON_REQUIRED' : 'NOT_EDITABLE',
        message: e.message,
      })),
    };
  }
  await recordEvent(db, {
    candidateId,
    action: 'REJECT',
    detail: { from: c.review_status },
    actor,
    reason,
    origin: 'UI_SINGLE',
  });
  return { ok: true };
}

/** APPROVED → back to review (the trigger clears approved_*; validation recomputes the status). */
export async function withdrawApproval(
  db: Queryable,
  actor: string,
  candidateId: string,
  reason: string,
): Promise<ReviewActionResult<{ reviewStatus: string }>> {
  if (!reason?.trim())
    return { ok: false, errors: [{ code: 'REASON_REQUIRED', message: 'reason is required' }] };
  const c = await lockCandidate(db, candidateId);
  if (!c)
    return { ok: false, errors: [{ code: 'CANDIDATE_NOT_FOUND', message: 'candidate not found' }] };
  if (c.review_status !== 'APPROVED')
    return {
      ok: false,
      errors: [{ code: 'NOT_APPROVED', message: `candidate is ${c.review_status}` }],
    };
  const proposal = ProposalSchema.parse(c.proposal);
  await db.query(
    `update import_candidate set review_status = 'WARNING', open_fields = $2 where id = $1`,
    [candidateId, openFields(proposal, c.resolution)],
  );
  await validateBatch(db, c.batch_id);
  const status = (
    await db.query('select review_status from import_candidate where id = $1', [candidateId])
  ).rows[0].review_status as string;
  await recordEvent(db, {
    candidateId,
    action: 'WITHDRAW_APPROVAL',
    detail: { to: status },
    actor,
    reason,
    origin: 'UI_SINGLE',
  });
  return { ok: true, reviewStatus: status };
}

/**
 * Publication stays controlled by STEP 05B: only FIXTURE candidates, one at a
 * time. REAL candidates are refused here, before publishCandidate is even
 * called, and publishCandidate refuses them again (PUBLICATION_ENABLED_FOR).
 */
export async function publishFixtureCandidate(
  db: Queryable,
  actor: string,
  candidateId: string,
): Promise<ReviewActionResult<{ publicCode: string | null; links: number }>> {
  const c = await lockCandidate(db, candidateId);
  if (!c)
    return { ok: false, errors: [{ code: 'CANDIDATE_NOT_FOUND', message: 'candidate not found' }] };
  if (c.data_class !== 'FIXTURE') {
    return {
      ok: false,
      errors: [
        {
          code: 'REAL_PUBLICATION_DISABLED',
          message:
            'REAL candidates cannot be published in STEP 06 (PUBLICATION_ENABLED_FOR = FIXTURE); enabling it is an owner decision (P1-09)',
        },
      ],
    };
  }
  const res = await publishCandidate(db, candidateId, { publisher: actor });
  if (!res.ok) {
    return {
      ok: false,
      errors: res.errors.map((e) => ({
        code: e.code === 'NOT_APPROVED' ? 'NOT_APPROVED' : 'PUBLISH_FAILED',
        message: `${e.code}: ${e.message}`,
      })),
    };
  }
  await recordEvent(db, {
    candidateId,
    action: 'PUBLISH',
    detail: { publicCode: res.publicCode, links: res.links },
    actor,
    origin: 'UI_SINGLE',
  });
  return { ok: true, publicCode: res.publicCode, links: res.links.length };
}

export { lockCandidate };
export type { Locked as LockedCandidate };

/** Active categories and decoration methods offered by the resolution controls. */
export async function resolutionLists(db: Queryable) {
  const categories = (
    await db.query('select key, name from category where is_active order by sort, name')
  ).rows as { key: string; name: string }[];
  const methods = (
    await db.query('select key, name from decoration_method where is_active order by key')
  ).rows as { key: string; name: string }[];
  return { categories, methods };
}

export interface ReviewEventRow {
  id: string;
  candidateId: string;
  label: string;
  action: string;
  field: string | null;
  oldValue: unknown;
  newValue: unknown;
  actor: string;
  reason: string | null;
  origin: string;
  createdAt: string;
}

/** Latest review decisions across candidates (audit page). */
export async function listReviewEvents(db: Queryable, limit = 200): Promise<ReviewEventRow[]> {
  return (
    await db.query(
      `select e.id, e.candidate_id, e.action, e.field, e.old_value, e.new_value, e.actor, e.reason, e.origin, e.created_at,
              coalesce(v.label, v.item_name, v.lineage_key) as label
         from review_event e join v_review_candidate v on v.id = e.candidate_id
        order by e.id desc limit $1`,
      [limit],
    )
  ).rows.map((e: Row) => ({
    id: String(e.id),
    candidateId: e.candidate_id as string,
    label: e.label as string,
    action: e.action as string,
    field: (e.field as string | null) ?? null,
    oldValue: e.old_value ?? null,
    newValue: e.new_value ?? null,
    actor: e.actor as string,
    reason: (e.reason as string | null) ?? null,
    origin: e.origin as string,
    createdAt: iso(e.created_at)!,
  }));
}
