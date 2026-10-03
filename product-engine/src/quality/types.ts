import type { CandidateKind, Proposal } from '../import/proposal';

/**
 * Data-quality model (STEP 08, ADR-0018). Everything under src/quality is PURE: no database, no clock,
 * no React. The same QualityInput always yields the same findings and the same readiness, in the same
 * order. Findings are never stored — they are recomputed (a few thousand candidates is cheap).
 *
 * Quality never "improves a number": a missing value stays missing, an open owner decision stays open,
 * and nothing here defaults, infers or writes.
 */

export const SEVERITIES = ['BLOCKER', 'WARNING', 'INFO'] as const;
/** BLOCKER = this object cannot be considered ready for publication/migration (not "the engine is broken"). */
export type Severity = (typeof SEVERITIES)[number];

export const REMEDIATIONS = [
  'BULK_RESOLVABLE',
  'MANUAL_REVIEW',
  'OWNER_DECISION_REQUIRED',
  'SOURCE_FIX',
] as const;
export type Remediation = (typeof REMEDIATIONS)[number];

/** Where a finding is counted on the dashboard. */
export const AREAS = [
  'CATALOG_ITEM',
  'OPTION',
  'DECORATION',
  'COMPOSITION',
  'PRICING',
  'PRESENTATION',
  'CATEGORY',
  'PROVENANCE',
  'IMPORT',
] as const;
export type Area = (typeof AREAS)[number];

/** Which readiness dimension a rule feeds. */
export type Dimension = 'REVIEW' | 'DOMAIN' | 'PRICING';

export type Draft = Record<string, unknown>;

export interface QCandidate {
  id: string;
  kind: CandidateKind;
  lineageKey: string;
  reviewStatus: string;
  proposal: Proposal;
  resolution: Draft | null;
  blockingReasons: string[];
  parserValidationState: 'VALID' | 'WARNING' | 'REJECTED';
  batch: {
    id: string;
    sourceFile: string;
    dataClass: 'REAL' | 'FIXTURE';
    sourceRole: string;
  };
  /** Provenance chain facts (candidate → record → workbook → sheet/row/cell). */
  provenance: { records: number; recordsWithCell: number };
  issueCodes: string[];
}

export interface DecisionAnswerFact {
  id: string;
  decisionId: string;
  summary: string;
  actor: string;
  answeredAt: string;
  /**
   * Which items the answer settles: `ALL` for a GLOBAL_POLICY decision, otherwise only the legacy ids the
   * answer lists (assignments or `covers`). An item the answer does not list stays OPEN for that decision.
   */
  coverage: 'ALL' | string[];
}

export interface DomainItemFact {
  id: string;
  publicCode: string;
  legacyId: string | null;
  saleUnit: string | null;
  /** The item has LEGACY_ID / source evidence OR an audit event naming an actor. */
  traceable: boolean;
  marketPolicies: { market: string; status: string }[];
}

export interface DomainDefinitionFact {
  id: string;
  itemId: string;
  legacyId: string | null;
  status: 'DRAFT' | 'AUTHORIZED' | 'SUPERSEDED';
  currency: string;
  model: string;
  validFrom: string;
  validTo: string | null;
  breakQuantities: number[];
  /** source_reference kinds attached to the definition itself. */
  sourceKinds: string[];
  /** other live definitions this one overlaps (price_definition_find_clash). */
  clashesWith: string[];
}

export interface DuplicateSignal {
  kind: 'PROBABLE_DUPLICATE' | 'RELATIONSHIP_NOT_DUPLICATE';
  legacyIds: [string, string];
  signals: string[];
}

export interface QualityInput {
  /** Explicit evaluation instant (ISO). The engine never reads a clock. */
  asOf: string;
  /** Import batches the candidates come from (for report metadata). */
  batches: {
    id: string;
    sourceFile: string;
    sourceSha256: string;
    dataClass: 'REAL' | 'FIXTURE';
    sourceRole: string;
    candidates: number;
  }[];
  candidates: QCandidate[];
  categoryKeys: string[];
  decorationMethodKeys: string[];
  optionDefinitionKeys: string[];
  /** Latest answer per decision. Absent = OPEN. */
  decisionAnswers: DecisionAnswerFact[];
  /** Current source category → Product Engine category mappings. */
  categoryMappings: { sourceCategory: string; categoryKey: string }[];
  /** Duplicate pair marks (key = sorted legacy ids joined by '|'). */
  duplicateMarks: { pairKey: string; mark: 'DISTINCT' | 'REVIEWED' }[];
  duplicateSignals: DuplicateSignal[];
  /** price_legacy ids that the importer classified as HISTORICAL evidence only. */
  historicalPriceLegacyIds: string[];
  historicalCountByItemLegacy: Record<string, number>;
  domainItems: DomainItemFact[];
  domainDefinitions: DomainDefinitionFact[];
  /** Data classes whose candidates may be published (PUBLICATION_ENABLED_FOR). */
  publicationEnabledFor: ('REAL' | 'FIXTURE')[];
}

export interface Hit {
  candidate: QCandidate | null;
  /** Distinguishes several hits of one rule on one candidate. */
  subject: string;
  message: string;
  evidence: Record<string, unknown>;
  /** For findings that are not about a candidate (domain objects). */
  itemLegacyId?: string | null;
  itemName?: string | null;
}

export interface RuleContext {
  input: QualityInput;
  candidates: readonly QCandidate[];
  byKind(kind: CandidateKind): readonly QCandidate[];
  itemByLegacy(legacy: string | null | undefined): QCandidate | null;
  /** Fields still open on the candidate (src/import unresolvedFields). */
  openFields(c: QCandidate): readonly string[];
  /** Legacy id of the catalog item a candidate belongs to. */
  ownerLegacy(c: QCandidate): string | null;
  /** Effective value: draft resolution first, then what the source said (undefined = unknown). */
  effective(c: QCandidate, field: string): unknown;
  /** Normalized `a|b` key for a pair of legacy ids. */
  pairKey(a: string, b: string): string;
  /**
   * True while no recorded answer settles the decision — for this item when `legacy` is given
   * (a partial answer leaves the unlisted items open).
   */
  decisionOpen(id: string, legacy?: string | null): boolean;
  /** True if the item (by legacy id) is in the decision's affected list. */
  decisionAffects(id: string, legacy: string | null | undefined): boolean;
}

export interface DataQualityRule {
  /** Stable code `DQ-<AREA>-NNN` (ADR-0018). Never reused for a different meaning. */
  code: string;
  /** Bump (and document) when the semantics change substantially. */
  version: number;
  scope: CandidateKind | 'PRICING' | 'PROVENANCE' | 'DOMAIN';
  area: Area;
  dimension: Dimension;
  severity: Severity;
  title: string;
  description: string;
  remediation: Remediation;
  /** Owner decisions that bear on this rule. Linked per candidate only if it is in the decision's affected list. */
  decisionTopics: readonly string[];
  /** The bulk field that resolves it (when BULK_RESOLVABLE). */
  bulk?: { kind: CandidateKind; field: string };
  evaluate(ctx: RuleContext): Hit[];
}

export interface DecisionRef {
  id: string;
  status: 'OPEN' | 'ANSWERED';
  answeredBy?: string;
  summary?: string;
}

export interface DataQualityFinding {
  /** Stable across re-staging: rule + candidate lineage + subject. */
  key: string;
  ruleCode: string;
  ruleVersion: number;
  scope: DataQualityRule['scope'];
  area: Area;
  dimension: Dimension;
  severity: Severity;
  title: string;
  message: string;
  remediation: Remediation;
  bulk: { kind: CandidateKind; field: string } | null;
  candidateId: string | null;
  candidateKind: CandidateKind | null;
  reviewStatus: string | null;
  itemLegacyId: string | null;
  itemName: string | null;
  /** Product Engine category key if resolved, else the source category code. */
  category: string | null;
  workbook: string | null;
  decisions: DecisionRef[];
  evidence: Record<string, unknown>;
}

export type ReadinessState = 'READY' | 'BLOCKED' | 'NEEDS_RESOLUTION' | 'QUOTE_ONLY' | 'DRAFT_ONLY';

export interface ReadinessReason {
  kind: 'DEFECT' | 'OWNER_DECISION' | 'BARRIER' | 'DEPENDENCY' | 'STATE';
  code: string;
  label: string;
  decisionIds?: string[];
}

export interface DimensionReadiness {
  state: ReadinessState;
  reasons: ReadinessReason[];
}

export interface ItemReadiness {
  candidateId: string;
  legacyId: string;
  name: string | null;
  category: string | null;
  reviewStatus: string;
  review: DimensionReadiness;
  domain: DimensionReadiness;
  pricing: DimensionReadiness;
  publication: DimensionReadiness;
  /** Open owner decisions affecting this item. */
  openDecisions: string[];
  findingCount: number;
  /** Ignoring the platform barrier (REAL publication disabled), would publication be READY? */
  readyIgnoringBarrier: boolean;
  dataClass: 'REAL' | 'FIXTURE';
}
