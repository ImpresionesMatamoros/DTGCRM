/** STEP 05A wire contracts. These are not Product Engine domain/persistence contracts. */
export type Scalar = string | number | boolean | null;
export type Json = Scalar | Json[] | { [key: string]: Json };
export interface SourceCell {
  source_file: string;
  workbook_sha256: string;
  source_sheet: string;
  source_row: number;
  source_column: number;
  source_cell: string;
  raw_value: Scalar;
  normalized_value: Scalar;
  data_type: string;
  formula: string | null;
  cached_value: Scalar;
  number_format: string;
}
export interface RawRecord {
  record_id: string;
  batch_id: string;
  record_type: string;
  legacy_id: Scalar;
  synthetic: boolean;
  raw_payload: Record<string, Scalar>;
  normalized_payload: Record<string, Scalar>;
  source: SourceCell[];
  issues: string[];
}
export interface Issue {
  issue_id?: string; // header-level errors have no record ID
  code: string;
  severity: 'ERROR' | 'WARNING' | 'INFO';
  message: string;
  record_id: string | null;
  source: SourceCell[];
}
export type Quantity = {kind: 'EXACT'; value: number}
  | {kind: 'RANGE'; min: number; max: number}
  | {kind: 'MINIMUM'; min: number}
  | {kind: 'UNKNOWN' | 'AMBIGUOUS'; value: null};
export interface MoneyEvidence { amount: string | null; currency: 'USD' | 'MXN' | null; issues: string[] }
export interface CatalogItemHypothesis {
  legacy_id: Scalar; legacy_sku: Scalar; name: Scalar;
  item_type_hypothesis: 'PRODUCT' | 'SERVICE' | 'BUNDLE' | null;
  // STEP 03 hypothesis only. Resolve prompt/domain disagreement with STEP 04.
  catalog_status_hypothesis: 'CANDIDATE' | 'PLANNED' | 'ACTIVE' | 'RETIRED' | null;
  sale_unit_hypothesis: string | null; category_legacy: Scalar; family_evidence: Scalar;
  customer_supplied_evidence: boolean | null; notes_evidence: Scalar;
  fixed_attribute_evidence?: {name: Scalar; values: Scalar[]; record_id: string}[];
}
export interface PriceEvidence {
  item_legacy: Scalar; price_legacy: Scalar;
  classification: 'FIXED' | 'EXACT_QUANTITY_MATRIX' | 'DERIVED'
    | 'HISTORICAL_EVIDENCE_ONLY' | 'UNKNOWN_REVIEW_REQUIRED';
  money: MoneyEvidence; source_model: Scalar; quantity_from: Quantity; quantity_to: Quantity;
  amount_basis_evidence: Scalar; conditions: Record<string, Scalar>[];
  authorization_evidence: boolean; current: false; mexico_evidence: string | null;
}
export interface OptionHypothesis {
  item_legacy: Scalar; name: Scalar; capture_type: Scalar; required: boolean | null;
  values: {label: Scalar; measurement: Json; record_id: string}[];
}
export type DecorationHypothesis = {
  subtype: 'method_association'; item_legacy: Scalar; method_legacy: Scalar; method_labels: Scalar[];
} | {subtype: 'policy_hypothesis'; item_legacy: Scalar; raw_option: Record<string, Scalar>; value_evidence: Record<string, Scalar>[]};
export type CompositionHypothesis = {
  parent_legacy: Scalar; child_legacy: Scalar; quantity: Quantity; role_hypothesis: 'INCLUDED' | 'OPTIONAL' | null;
} | {subtype: 'policy_hypothesis'; item_legacy: Scalar; raw_option: Record<string, Scalar>; value_evidence: Record<string, Scalar>[]};
export interface CandidateBase {
  candidate_id: string; record_ids: string[]; source: SourceCell[];
  workflow_state: 'PENDING_REVIEW'; publishable: false;
  validation_state: 'VALID' | 'WARNING' | 'REJECTED'; issue_ids: string[]; review: string[];
}
export type Candidate = CandidateBase & (
  {kind: 'catalog_item'; data: CatalogItemHypothesis}
  | {kind: 'price'; data: PriceEvidence}
  | {kind: 'option'; data: OptionHypothesis}
  | {kind: 'decoration'; data: DecorationHypothesis}
  | {kind: 'composition'; data: CompositionHypothesis});
export interface Batch {
  batch_id: string; parser_version: string; source_file: string; source_sha256: string;
  source_role: 'PRIMARY_RC' | 'COMPARISON' | 'SPECIALIZED_EVIDENCE';
  sheets_inspected: number; rows_inspected: number; raw_records: number;
  candidates_produced: number; issue_counts: Partial<Record<Issue['severity'], number>>;
}
export interface ExecutionMetadata { started_at: string; ended_at: string; batch_ids: string[] }
export interface HistoricalPrice { record_id: string; data: PriceEvidence; source: SourceCell[] }
