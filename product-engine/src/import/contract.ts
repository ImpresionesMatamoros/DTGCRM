import { z } from 'zod';

/**
 * ImportEnvelope v1 — neutral interchange contract between the Python Excel
 * importer (tools/excel-importer) and the TypeScript import bridge (STEP 05B).
 *
 * - snake_case, like the v1 API wire contract; field names of the STEP 05A
 *   parser are kept verbatim so every value can be traced to its docs.
 * - Serializable JSON only: no Product Engine UUID, public code, publication
 *   flag or database-specific value. Staging assigns its own keys.
 * - Raw and normalized values and every SourceCell are preserved.
 * - Candidates reference records; historical prices never appear as candidates.
 */

export const IMPORT_ENVELOPE_CONTRACT = 'dtg.import-envelope';
export const IMPORT_ENVELOPE_MAJOR = 1;

const Key = z.string().regex(/^[0-9a-f]{24}$/, 'parser key (24 hex)');
const Sha256 = z.string().regex(/^[0-9a-f]{64}$/, 'sha256 hex');
const Decimal = z.string().regex(/^-?\d+(\.\d+)?$/, 'decimal string');
export const ScalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const Payload = z.record(z.string(), ScalarSchema);

export const IMPORT_ISSUE_CODES = [
  'IMPORT_MISSING_REQUIRED_SOURCE_VALUE',
  'IMPORT_UNKNOWN_CURRENCY',
  'IMPORT_CURRENCY_CONFLICT',
  'IMPORT_INVALID_MONEY',
  'IMPORT_INVALID_QUANTITY',
  'IMPORT_DUPLICATE_IDENTIFIER',
  'IMPORT_INVALID_IDENTIFIER',
  'IMPORT_POSSIBLE_DUPLICATE',
  'IMPORT_UNKNOWN_STATUS',
  'IMPORT_PRICE_CONFLICT',
  'IMPORT_UNMAPPED_CATEGORY',
  'IMPORT_UNMAPPED_OPTION',
  'IMPORT_DOMAIN_MAPPING_QUESTION',
  'IMPORT_UNRESOLVED_REFERENCE',
  'IMPORT_HEADER_MISMATCH',
  'IMPORT_FORMULA_VALUE_UNRESOLVED',
  'VARIANT_MATERIALIZATION_CANDIDATE',
] as const;
export type ImportIssueCode = (typeof IMPORT_ISSUE_CODES)[number];
export const ISSUE_SEVERITIES = ['ERROR', 'WARNING', 'INFO'] as const;
export type IssueSeverity = (typeof ISSUE_SEVERITIES)[number];

/** Minimal provenance unit (STEP 05A PROVENANCE-SPEC). */
export const SourceCellSchema = z.strictObject({
  source_file: z.string().min(1),
  workbook_sha256: Sha256,
  source_sheet: z.string().min(1),
  source_row: z.number().int().positive(),
  source_column: z.number().int().positive(),
  source_cell: z.string().regex(/^[A-Z]{1,3}[0-9]+$/),
  raw_value: ScalarSchema,
  normalized_value: ScalarSchema,
  data_type: z.string(),
  formula: z.string().nullable(),
  cached_value: ScalarSchema,
  number_format: z.string(),
});
export type SourceCell = z.infer<typeof SourceCellSchema>;

export const RawRecordSchema = z.strictObject({
  record_id: Key,
  record_type: z.string().min(1),
  legacy_id: ScalarSchema,
  synthetic: z.boolean(),
  raw_payload: Payload,
  normalized_payload: Payload,
  source: z.array(SourceCellSchema).min(1),
  issue_ids: z.array(Key),
});
export type RawRecord = z.infer<typeof RawRecordSchema>;

export const QuantitySchema = z.union([
  z.strictObject({ kind: z.literal('EXACT'), value: z.number().int().positive() }),
  z.strictObject({
    kind: z.literal('RANGE'),
    min: z.number().int().positive(),
    max: z.number().int().positive(),
  }),
  z.strictObject({ kind: z.literal('MINIMUM'), min: z.number().int().positive() }),
  z.strictObject({ kind: z.enum(['UNKNOWN', 'AMBIGUOUS']), value: z.null() }),
]);
export type Quantity = z.infer<typeof QuantitySchema>;

export const PriceEvidenceSchema = z.strictObject({
  item_legacy: ScalarSchema,
  price_legacy: ScalarSchema,
  classification: z.enum([
    'FIXED',
    'EXACT_QUANTITY_MATRIX',
    'DERIVED',
    'HISTORICAL_EVIDENCE_ONLY',
    'UNKNOWN_REVIEW_REQUIRED',
  ]),
  money: z.strictObject({
    amount: Decimal.nullable(),
    currency: z.enum(['USD', 'MXN']).nullable(),
    issues: z.array(z.string()),
  }),
  source_model: ScalarSchema,
  quantity_from: QuantitySchema,
  quantity_to: QuantitySchema,
  amount_basis_evidence: ScalarSchema,
  conditions: z.array(Payload),
  authorization_evidence: z.boolean(),
  current: z.literal(false),
  mexico_evidence: z.string().nullable(),
});
export type PriceEvidence = z.infer<typeof PriceEvidenceSchema>;

const CatalogItemData = z.strictObject({
  legacy_id: ScalarSchema,
  legacy_sku: ScalarSchema,
  name: ScalarSchema,
  item_type_hypothesis: z.enum(['PRODUCT', 'SERVICE', 'BUNDLE']).nullable(),
  catalog_status_hypothesis: z.enum(['CANDIDATE', 'PLANNED', 'ACTIVE', 'RETIRED']).nullable(),
  sale_unit_hypothesis: z.string().nullable(),
  category_legacy: ScalarSchema,
  family_evidence: ScalarSchema,
  customer_supplied_evidence: z.boolean().nullable(),
  notes_evidence: ScalarSchema,
  fixed_attribute_evidence: z
    .array(z.strictObject({ name: ScalarSchema, values: z.array(ScalarSchema), record_id: Key }))
    .optional(),
});

const OptionData = z.strictObject({
  item_legacy: ScalarSchema,
  name: ScalarSchema,
  capture_type: ScalarSchema,
  /** null = unknown. Never coerced to false (STEP 05A Q-02). */
  required: z.boolean().nullable(),
  values: z.array(z.strictObject({ label: ScalarSchema, measurement: z.json(), record_id: Key })),
});

const PolicyHypothesis = z.strictObject({
  subtype: z.literal('policy_hypothesis'),
  item_legacy: ScalarSchema,
  raw_option: Payload,
  value_evidence: z.array(Payload),
});

const DecorationData = z.union([
  z.strictObject({
    subtype: z.literal('method_association'),
    item_legacy: ScalarSchema,
    method_legacy: ScalarSchema,
    method_labels: z.array(ScalarSchema),
  }),
  PolicyHypothesis,
]);

const CompositionData = z.union([
  z.strictObject({
    parent_legacy: ScalarSchema,
    child_legacy: ScalarSchema,
    quantity: QuantitySchema,
    role_hypothesis: z.enum(['INCLUDED', 'OPTIONAL']).nullable(),
  }),
  PolicyHypothesis,
]);

const PresentationData = z.strictObject({
  link_legacy: ScalarSchema,
  presentation_legacy: ScalarSchema,
  item_legacy: ScalarSchema,
  commercial_name: ScalarSchema,
  audience_or_use: ScalarSchema,
  channel: ScalarSchema,
  language: ScalarSchema,
  publication_state_evidence: ScalarSchema,
  role: ScalarSchema,
  order: ScalarSchema,
  suggested_quantity: ScalarSchema,
  notes_evidence: ScalarSchema,
});

const candidateBase = {
  candidate_id: Key,
  record_ids: z.array(Key).min(1),
  workflow_state: z.literal('PENDING_REVIEW'),
  publishable: z.literal(false),
  validation_state: z.enum(['VALID', 'WARNING', 'REJECTED']),
  issue_ids: z.array(Key),
  review: z.array(z.string()),
};

export const EnvelopeCandidateSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...candidateBase, kind: z.literal('catalog_item'), data: CatalogItemData }),
  z.strictObject({ ...candidateBase, kind: z.literal('option'), data: OptionData }),
  z.strictObject({ ...candidateBase, kind: z.literal('decoration'), data: DecorationData }),
  z.strictObject({ ...candidateBase, kind: z.literal('composition'), data: CompositionData }),
  z.strictObject({ ...candidateBase, kind: z.literal('price'), data: PriceEvidenceSchema }),
  z.strictObject({ ...candidateBase, kind: z.literal('presentation'), data: PresentationData }),
]);
export type EnvelopeCandidate = z.infer<typeof EnvelopeCandidateSchema>;
export type EnvelopeCandidateKind = EnvelopeCandidate['kind'];

export const HistoricalPriceSchema = z.strictObject({
  record_id: Key,
  condition_record_ids: z.array(Key),
  data: PriceEvidenceSchema.extend({ classification: z.literal('HISTORICAL_EVIDENCE_ONLY') }),
});
export type HistoricalPrice = z.infer<typeof HistoricalPriceSchema>;

export const DuplicateReviewSchema = z.strictObject({
  kind: z.enum(['EXACT_DUPLICATE', 'PROBABLE_DUPLICATE', 'RELATIONSHIP_NOT_DUPLICATE']),
  record_ids: z.tuple([Key, Key]),
  legacy_ids: z.array(ScalarSchema),
  signals: z.array(z.string()),
  recommendation: z.string(),
});
export type DuplicateReview = z.infer<typeof DuplicateReviewSchema>;

export const EnvelopeIssueSchema = z.strictObject({
  issue_id: Key.nullable(),
  code: z.enum(IMPORT_ISSUE_CODES),
  severity: z.enum(ISSUE_SEVERITIES),
  message: z.string(),
  record_id: Key.nullable(),
  origin: z.enum(['PARSER', 'INTERCHANGE']),
  /** Only for issues without a record (header errors); otherwise the record holds the cells. */
  source: z.array(SourceCellSchema).nullable(),
});
export type EnvelopeIssue = z.infer<typeof EnvelopeIssueSchema>;

const Counts = z.record(z.string(), z.number().int().nonnegative());

export const ImportBatchHeaderSchema = z.strictObject({
  source_batch_id: Key,
  source_file: z.string().min(1),
  source_sha256: Sha256,
  source_role: z.enum(['PRIMARY_RC', 'COMPARISON', 'SPECIALIZED_EVIDENCE']),
  /** REAL = catalog workbook run; FIXTURE = controlled DEV/TEST subset. */
  data_class: z.enum(['REAL', 'FIXTURE']),
  fixture_name: z.string().nullable(),
  sheets_inspected: z.number().int().nonnegative(),
  rows_inspected: z.number().int().nonnegative(),
  parser_counts: z.strictObject({
    raw_records: z.number().int().nonnegative(),
    candidates_produced: z.number().int().nonnegative(),
    issue_counts: Counts,
  }),
  record_count: z.number().int().nonnegative(),
  candidate_count: z.number().int().nonnegative(),
  candidate_counts: Counts,
  issue_counts: Counts,
  historical_price_count: z.number().int().nonnegative(),
});

export const ImportEnvelopeSchema = z
  .strictObject({
    contract: z.literal(IMPORT_ENVELOPE_CONTRACT),
    contract_version: z.string().regex(/^1\.\d+\.\d+$/, 'major version 1'),
    producer: z.strictObject({
      exporter_version: z.string().min(1),
      parser_name: z.string().min(1),
      parser_version: z.string().min(1),
    }),
    import_batch: ImportBatchHeaderSchema,
    provenance: z.strictObject({
      workbook: z.strictObject({
        source_file: z.string().min(1),
        sha256: Sha256,
        title: ScalarSchema,
        version: ScalarSchema,
        reader_warnings: z.array(z.string()),
      }),
      /** Parser workbook profile (sheets, formulas, validations); opaque evidence. */
      profile: z.record(z.string(), z.unknown()).nullable(),
    }),
    records: z.array(RawRecordSchema),
    candidates: z.array(EnvelopeCandidateSchema),
    historical_prices: z.array(HistoricalPriceSchema),
    duplicate_reviews: z.array(DuplicateReviewSchema),
    issues: z.array(EnvelopeIssueSchema),
  })
  .superRefine((env, ctx) => {
    const fail = (message: string, path: (string | number)[] = []) =>
      ctx.addIssue({ code: 'custom', message, path });
    const b = env.import_batch;
    if (env.provenance.workbook.sha256 !== b.source_sha256) {
      fail('provenance workbook hash differs from import_batch.source_sha256', ['provenance']);
    }
    const records = new Map<string, RawRecord>();
    env.records.forEach((r, i) => {
      if (records.has(r.record_id)) fail(`duplicate record_id ${r.record_id}`, ['records', i]);
      records.set(r.record_id, r);
      if (r.source.some((c) => c.workbook_sha256 !== b.source_sha256)) {
        fail(`record ${r.record_id} has cells from another workbook`, ['records', i]);
      }
    });
    const issueIds = new Set(env.issues.flatMap((x) => (x.issue_id ? [x.issue_id] : [])));
    env.records.forEach((r, i) => {
      for (const id of r.issue_ids) {
        if (!issueIds.has(id))
          fail(`record ${r.record_id} references unknown issue ${id}`, ['records', i]);
      }
    });
    const candidateIds = new Set<string>();
    const priceRows = new Set<string>();
    env.candidates.forEach((c, i) => {
      if (candidateIds.has(c.candidate_id)) {
        fail(`duplicate candidate_id ${c.candidate_id}`, ['candidates', i]);
      }
      candidateIds.add(c.candidate_id);
      for (const rid of c.record_ids) {
        const r = records.get(rid);
        if (!r)
          fail(`candidate ${c.candidate_id} references unknown record ${rid}`, ['candidates', i]);
        else if (r.synthetic)
          fail(`candidate ${c.candidate_id} uses TEST record ${rid}`, ['candidates', i]);
      }
      for (const id of c.issue_ids) {
        if (!issueIds.has(id))
          fail(`candidate ${c.candidate_id} references unknown issue ${id}`, ['candidates', i]);
      }
      if (c.kind === 'price') {
        c.record_ids.forEach((rid) => priceRows.add(rid));
        if (c.data.classification === 'HISTORICAL_EVIDENCE_ONLY') {
          fail('historical price evidence cannot be a candidate', ['candidates', i]);
        }
      }
    });
    env.historical_prices.forEach((h, i) => {
      for (const rid of [h.record_id, ...h.condition_record_ids]) {
        if (!records.has(rid))
          fail(`historical price references unknown record ${rid}`, ['historical_prices', i]);
      }
      if (priceRows.has(h.record_id)) {
        fail(`historical price ${h.record_id} is also a price candidate`, ['historical_prices', i]);
      }
    });
    env.duplicate_reviews.forEach((d, i) => {
      for (const rid of d.record_ids) {
        if (!records.has(rid))
          fail(`duplicate review references unknown record ${rid}`, ['duplicate_reviews', i]);
      }
    });
    env.issues.forEach((x, i) => {
      if (x.record_id === null) {
        if (!x.source || x.source.length === 0)
          fail('record-less issue needs its cells', ['issues', i]);
      } else if (!records.has(x.record_id)) {
        fail(`issue references unknown record ${x.record_id}`, ['issues', i]);
      } else if (x.source !== null) {
        fail('issue with a record must not repeat its cells', ['issues', i]);
      }
    });
    if (b.record_count !== env.records.length) fail('record_count mismatch', ['import_batch']);
    if (b.candidate_count !== env.candidates.length)
      fail('candidate_count mismatch', ['import_batch']);
    if (b.historical_price_count !== env.historical_prices.length) {
      fail('historical_price_count mismatch', ['import_batch']);
    }
    const perKind: Record<string, number> = {};
    for (const c of env.candidates) perKind[c.kind] = (perKind[c.kind] ?? 0) + 1;
    if (JSON.stringify(sortKeys(perKind)) !== JSON.stringify(sortKeys(b.candidate_counts))) {
      fail('candidate_counts mismatch', ['import_batch']);
    }
    if (b.data_class === 'REAL' && b.parser_counts.raw_records !== env.records.length) {
      fail('REAL envelope must carry every parsed record', ['import_batch']);
    }
    if (b.data_class === 'FIXTURE' && b.fixture_name === null) {
      fail('FIXTURE envelope needs fixture_name', ['import_batch']);
    }
  });
export type ImportEnvelope = z.infer<typeof ImportEnvelopeSchema>;

function sortKeys(o: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
}

export type EnvelopeParseResult =
  | { ok: true; envelope: ImportEnvelope }
  | { ok: false; errors: { path: string; message: string }[] };

/** Validates untrusted JSON. Never throws on bad input; returns structured errors. */
export function parseImportEnvelope(input: unknown): EnvelopeParseResult {
  const r = ImportEnvelopeSchema.safeParse(input);
  if (r.success) return { ok: true, envelope: r.data };
  return {
    ok: false,
    errors: r.error.issues.slice(0, 50).map((i) => ({
      path: i.path.map(String).join('.'),
      message: i.message,
    })),
  };
}
