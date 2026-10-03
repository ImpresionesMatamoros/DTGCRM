import { SALE_UNITS, type SaleUnit } from '../domain/catalog';
import type {
  EnvelopeCandidate,
  EnvelopeIssue,
  HistoricalPrice,
  ImportEnvelope,
  RawRecord,
  SourceCell,
} from './contract';
import { canonicalJson, sha256Hex, stableKey } from './keys';
import {
  AMOUNT_BASIS_BY_SOURCE,
  DECORATION_METHOD_SUGGESTION,
  LOCALE_BY_SOURCE,
  lookupKey,
} from './mappings';
import type {
  CandidateKind,
  PriceConditionProposal,
  PriceObservation,
  PriceProposal,
  Proposal,
} from './proposal';

/**
 * Pure transformation ImportEnvelope → rows to persist in staging. No database,
 * no clock. The same envelope always yields the same plan (deterministic keys).
 */

export type SourceRole =
  'PRIMARY' | 'REFERENCE' | 'VALUE' | 'CONDITION' | 'OBSERVATION' | 'ATTRIBUTE';

export interface PlannedRecord {
  recordKey: string;
  recordType: string;
  legacyId: string | null;
  synthetic: boolean;
  rawPayload: RawRecord['raw_payload'];
  normalizedPayload: RawRecord['normalized_payload'];
  sourceCells: SourceCell[];
  evidenceClass: 'HISTORICAL_PRICE' | null;
  evidence: (HistoricalPrice['data'] & { conditionRecordKeys: string[] }) | null;
}

export interface PlannedCandidate {
  candidateKey: string;
  kind: CandidateKind;
  lineageKey: string;
  parserCandidateKeys: string[];
  proposal: Proposal;
  payloadSha256: string;
  parserValidationState: 'VALID' | 'WARNING' | 'REJECTED';
  sources: { recordKey: string; role: SourceRole }[];
}

export interface PlannedIssue {
  issueKey: string;
  code: string;
  severity: 'ERROR' | 'WARNING' | 'INFO';
  origin: 'PARSER' | 'INTERCHANGE' | 'STAGING';
  message: string;
  recordKey: string | null;
  detail: Record<string, unknown> | null;
  sourceCells: SourceCell[] | null;
  occurrences: number;
}

export interface StagingPlan {
  envelopeSha256: string;
  records: PlannedRecord[];
  candidates: PlannedCandidate[];
  issues: PlannedIssue[];
}

const str = (v: unknown): string | null =>
  v === null || v === undefined ? null : typeof v === 'string' ? v : String(v);

const KIND: Record<EnvelopeCandidate['kind'], CandidateKind> = {
  catalog_item: 'CATALOG_ITEM',
  option: 'OPTION',
  decoration: 'DECORATION',
  composition: 'COMPOSITION',
  price: 'PRICE',
  presentation: 'PRESENTATION',
};

export function planStaging(envelope: ImportEnvelope): StagingPlan {
  const index = new Map(envelope.records.map((r) => [r.record_id, r]));
  const legacyOf = (key: string) => str(index.get(key)?.legacy_id ?? null);

  const historical = new Map(envelope.historical_prices.map((h) => [h.record_id, h]));
  const records: PlannedRecord[] = envelope.records.map((r) => {
    const h = historical.get(r.record_id);
    return {
      recordKey: r.record_id,
      recordType: r.record_type,
      legacyId: str(r.legacy_id),
      synthetic: r.synthetic,
      rawPayload: r.raw_payload,
      normalizedPayload: r.normalized_payload,
      sourceCells: r.source,
      evidenceClass: h ? 'HISTORICAL_PRICE' : null,
      evidence: h ? { ...h.data, conditionRecordKeys: h.condition_record_ids } : null,
    };
  });

  const candidates: PlannedCandidate[] = [];
  const prices: Extract<EnvelopeCandidate, { kind: 'price' }>[] = [];
  for (const c of envelope.candidates) {
    if (c.kind === 'price') prices.push(c);
    else candidates.push(single(c, index, legacyOf));
  }
  candidates.push(...groupPrices(prices, index));
  candidates.sort(
    (a, b) =>
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
      a.lineageKey.localeCompare(b.lineageKey) ||
      a.candidateKey.localeCompare(b.candidateKey),
  );

  return {
    envelopeSha256: sha256Hex(canonicalJson(envelope)),
    records,
    candidates,
    issues: planIssues(envelope),
  };
}

const KIND_ORDER: CandidateKind[] = [
  'CATALOG_ITEM',
  'OPTION',
  'DECORATION',
  'COMPOSITION',
  'PRICE',
  'PRESENTATION',
];

function roleOf(kind: CandidateKind, position: number, record: RawRecord | undefined): SourceRole {
  const type = record?.record_type;
  if (kind === 'PRICE' && type === 'PRECIOS') return 'OBSERVATION';
  if (position === 0) return 'PRIMARY';
  if (type === 'CONDICIONES_PRECIO') return 'CONDITION';
  if (
    kind === 'CATALOG_ITEM' &&
    (type === 'OPCIONES_OFERTA' || type === 'LISTAS') &&
    position > 1
  ) {
    return 'ATTRIBUTE';
  }
  if (kind === 'OPTION' && type === 'LISTAS') return 'VALUE';
  return 'REFERENCE';
}

function sourcesOf(kind: CandidateKind, recordIds: string[], index: Map<string, RawRecord>) {
  const seen = new Set<string>();
  const out: { recordKey: string; role: SourceRole }[] = [];
  recordIds.forEach((rid, i) => {
    if (seen.has(rid)) return;
    seen.add(rid);
    out.push({ recordKey: rid, role: roleOf(kind, i, index.get(rid)) });
  });
  return out;
}

function finish(
  kind: CandidateKind,
  candidateKey: string,
  lineageKey: string,
  proposal: Proposal,
  parserKeys: string[],
  state: PlannedCandidate['parserValidationState'],
  recordIds: string[],
  index: Map<string, RawRecord>,
): PlannedCandidate {
  return {
    candidateKey,
    kind,
    lineageKey,
    parserCandidateKeys: parserKeys,
    proposal,
    payloadSha256: sha256Hex(canonicalJson(proposal)),
    parserValidationState: state,
    sources: sourcesOf(kind, recordIds, index),
  };
}

function single(
  c: Exclude<EnvelopeCandidate, { kind: 'price' }>,
  index: Map<string, RawRecord>,
  legacyOf: (k: string) => string | null,
): PlannedCandidate {
  const kind = KIND[c.kind];
  const primaryLegacy = legacyOf(c.record_ids[0]!) ?? c.candidate_id;
  let proposal: Proposal;
  let lineage: string;
  switch (c.kind) {
    case 'catalog_item': {
      const d = c.data;
      const unit = d.sale_unit_hypothesis;
      const legacyId = str(d.legacy_id) ?? primaryLegacy;
      proposal = {
        kind: 'CATALOG_ITEM',
        legacyId,
        legacySku: str(d.legacy_sku),
        name: str(d.name),
        itemType: d.item_type_hypothesis === 'BUNDLE' ? null : d.item_type_hypothesis,
        itemTypeEvidence: d.item_type_hypothesis,
        status: d.catalog_status_hypothesis,
        saleUnit:
          unit !== null && (SALE_UNITS as readonly string[]).includes(unit)
            ? (unit as SaleUnit)
            : null,
        customerSuppliedEvidence: d.customer_supplied_evidence,
        categoryLegacy: str(d.category_legacy),
        familyEvidence: str(d.family_evidence),
        notesEvidence: str(d.notes_evidence),
        fixedAttributes: (d.fixed_attribute_evidence ?? []).map((a) => ({
          optionLegacyId: legacyOf(a.record_id),
          name: str(a.name),
          values: a.values.map(str),
          recordKey: a.record_id,
        })),
      };
      lineage = `CATALOG_ITEM:${legacyId}`;
      break;
    }
    case 'option': {
      const d = c.data;
      proposal = {
        kind: 'OPTION',
        optionLegacyId: primaryLegacy,
        itemLegacyId: str(d.item_legacy) ?? '',
        name: str(d.name),
        captureType: str(d.capture_type),
        required: d.required,
        values: d.values.map((v) => ({
          recordKey: v.record_id,
          label: str(v.label),
          measurement: v.measurement,
        })),
      };
      lineage = `OPTION:${primaryLegacy}`;
      break;
    }
    case 'decoration': {
      const d = c.data;
      if ('method_legacy' in d) {
        const labels = d.method_labels.map(str);
        proposal = {
          kind: 'DECORATION',
          subtype: 'METHOD_ASSOCIATION',
          associationLegacyId: primaryLegacy,
          itemLegacyId: str(d.item_legacy) ?? '',
          methodLegacyId: str(d.method_legacy),
          methodLabels: labels,
          suggestedMethodKey:
            labels.length === 1
              ? (DECORATION_METHOD_SUGGESTION[lookupKey(labels[0])] ?? null)
              : null,
        };
      } else {
        proposal = {
          kind: 'DECORATION',
          subtype: 'POLICY',
          optionLegacyId: primaryLegacy,
          itemLegacyId: str(d.item_legacy) ?? '',
          valueLabels: d.value_evidence.map((v) => str(v.Etiqueta)),
          decorationPolicy: 'OPTIONAL',
        };
      }
      lineage = `DECORATION:${primaryLegacy}`;
      break;
    }
    case 'composition': {
      const d = c.data;
      if ('parent_legacy' in d) {
        proposal = {
          kind: 'COMPOSITION',
          subtype: 'RELATION',
          componentLegacyId: primaryLegacy,
          parentLegacyId: str(d.parent_legacy),
          childLegacyId: str(d.child_legacy),
          quantity: d.quantity.kind === 'EXACT' ? d.quantity.value : null,
          role: d.role_hypothesis,
        };
      } else {
        proposal = {
          kind: 'COMPOSITION',
          subtype: 'POLICY',
          optionLegacyId: primaryLegacy,
          itemLegacyId: str(d.item_legacy) ?? '',
          valueLabels: d.value_evidence.map((v) => str(v.Etiqueta)),
        };
      }
      lineage = `COMPOSITION:${primaryLegacy}`;
      break;
    }
    case 'presentation': {
      const d = c.data;
      const language = str(d.language);
      proposal = {
        kind: 'PRESENTATION',
        linkLegacyId: str(d.link_legacy) ?? primaryLegacy,
        presentationLegacyId: str(d.presentation_legacy),
        itemLegacyId: str(d.item_legacy),
        displayName: str(d.commercial_name),
        occasion: str(d.audience_or_use),
        channel: str(d.channel),
        languageEvidence: language,
        locale: language === null ? null : (LOCALE_BY_SOURCE[lookupKey(language)] ?? null),
        publicationStateEvidence: str(d.publication_state_evidence),
        role: str(d.role),
        order: typeof d.order === 'number' ? d.order : null,
      };
      lineage = `PRESENTATION:${primaryLegacy}`;
      break;
    }
  }
  return finish(
    kind,
    c.candidate_id,
    lineage,
    proposal,
    [c.candidate_id],
    c.validation_state,
    c.record_ids,
    index,
  );
}

// ---------------------------------------------------------------- prices

type PriceCandidate = Extract<EnvelopeCandidate, { kind: 'price' }>;

const WORST = ['VALID', 'WARNING', 'REJECTED'] as const;

/**
 * Groups price observations into PriceDefinition hypotheses: item × currency ×
 * model × basis × exact condition set (option, attribute, operator, value, unit).
 * Quantity is not part of the key — it becomes the break. Nothing is
 * interpolated, merged by name or dropped.
 */
export function groupPrices(
  prices: PriceCandidate[],
  index: Map<string, RawRecord>,
): PlannedCandidate[] {
  const groups = new Map<
    string,
    { signature: unknown[]; members: PriceCandidate[]; conditions: PriceConditionProposal[] }
  >();
  for (const c of prices) {
    const d = c.data;
    const conditions = conditionProposals(c, index);
    const conditionKey = conditions
      .map((x) => [x.optionLegacyId, x.attribute, x.operator, x.value, x.unit])
      .sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b)));
    const model = d.classification;
    const signature = [
      str(d.item_legacy),
      d.money.currency,
      model,
      str(d.amount_basis_evidence),
      conditionKey,
    ];
    const k = canonicalJson(signature);
    const g = groups.get(k) ?? { signature, members: [], conditions };
    g.members.push(c);
    groups.set(k, g);
  }
  const out: PlannedCandidate[] = [];
  for (const g of groups.values()) {
    const first = g.members[0]!.data;
    const observations: PriceObservation[] = g.members
      .map((m) => {
        const q = m.data.quantity_from;
        const exact =
          q.kind === 'EXACT' &&
          m.data.quantity_to.kind === 'EXACT' &&
          m.data.quantity_to.value === q.value
            ? q.value
            : null;
        const cls = m.data.classification;
        return {
          parserCandidateKey: m.candidate_id,
          priceLegacyId: str(m.data.price_legacy) ?? m.candidate_id,
          recordKey: m.record_ids[0]!,
          quantity: exact,
          amount:
            m.data.money.amount !== null && !m.data.money.amount.startsWith('-')
              ? m.data.money.amount
              : null,
          classification: cls === 'HISTORICAL_EVIDENCE_ONLY' ? 'UNKNOWN_REVIEW_REQUIRED' : cls,
          authorizationEvidence: m.data.authorization_evidence,
        } satisfies PriceObservation;
      })
      .sort(
        (a, b) =>
          (a.quantity ?? Infinity) - (b.quantity ?? Infinity) ||
          a.priceLegacyId.localeCompare(b.priceLegacyId),
      );
    const model =
      first.classification === 'EXACT_QUANTITY_MATRIX' || first.classification === 'FIXED'
        ? first.classification
        : null;
    const basisEvidence = str(first.amount_basis_evidence);
    const currency = first.money.currency;
    const proposal: PriceProposal = {
      kind: 'PRICE',
      itemLegacyId: str(first.item_legacy) ?? '',
      currency,
      market: currency === 'USD' ? 'USA' : currency === 'MXN' ? 'MX' : null,
      model,
      sourceModel: str(first.source_model),
      amountBasisEvidence: basisEvidence,
      amountBasis:
        basisEvidence === null ? null : (AMOUNT_BASIS_BY_SOURCE[lookupKey(basisEvidence)] ?? null),
      mexicoEvidence: first.mexico_evidence,
      conditions: g.conditions,
      observations,
    };
    const conditionLabel = g.conditions
      .map((x) => `${x.optionLegacyId ?? x.attribute}=${x.value}`)
      .sort()
      .join('&');
    const lineage = `PRICE:${proposal.itemLegacyId}|${currency ?? '?'}|${model ?? first.classification}|${basisEvidence ?? '?'}|${conditionLabel}`;
    const recordIds = g.members.flatMap((m) => m.record_ids);
    const state = g.members.reduce<PlannedCandidate['parserValidationState']>(
      (w, m) => (WORST.indexOf(m.validation_state) > WORST.indexOf(w) ? m.validation_state : w),
      'VALID',
    );
    out.push(
      finish(
        'PRICE',
        stableKey('PRICE', g.signature),
        lineage,
        proposal,
        g.members.map((m) => m.candidate_id),
        state,
        recordIds,
        index,
      ),
    );
  }
  return out;
}

function conditionProposals(
  c: PriceCandidate,
  index: Map<string, RawRecord>,
): PriceConditionProposal[] {
  const byLegacy = new Map<string, string>();
  for (const rid of c.record_ids) {
    const r = index.get(rid);
    if (r?.record_type === 'CONDICIONES_PRECIO' && r.legacy_id !== null)
      byLegacy.set(String(r.legacy_id), rid);
  }
  return c.data.conditions
    .map((x) => {
      const legacy = str(x['Condición_ID']);
      const recordKey = legacy === null ? undefined : byLegacy.get(legacy);
      if (!recordKey) throw new Error(`price ${c.candidate_id}: condition ${legacy} has no record`);
      return {
        conditionLegacyId: legacy,
        optionLegacyId: str(x['Opción_ID']),
        attribute: str(x['Atributo_controlado']),
        operator: str(x['Operador']),
        value: str(x['Valor']),
        unit: str(x['Unidad']),
        recordKey,
      };
    })
    .sort((a, b) => (a.conditionLegacyId ?? '').localeCompare(b.conditionLegacyId ?? ''));
}

// ---------------------------------------------------------------- issues

function planIssues(envelope: ImportEnvelope): PlannedIssue[] {
  const out = new Map<string, PlannedIssue>();
  const add = (i: PlannedIssue) => {
    const prev = out.get(i.issueKey);
    if (prev) prev.occurrences += 1;
    else out.set(i.issueKey, i);
  };
  for (const i of envelope.issues) add(fromEnvelope(i));
  for (const d of envelope.duplicate_reviews) {
    add({
      issueKey: stableKey('DUPLICATE_REVIEW', d.kind, d.record_ids),
      code: 'IMPORT_DUPLICATE_REVIEW',
      severity: d.kind === 'RELATIONSHIP_NOT_DUPLICATE' ? 'INFO' : 'WARNING',
      origin: 'STAGING',
      message: `${d.kind}: ${d.legacy_ids.map(String).join(' / ')} — ${d.recommendation}`,
      recordKey: d.record_ids[0],
      detail: {
        kind: d.kind,
        recordKeys: d.record_ids,
        legacyIds: d.legacy_ids,
        signals: d.signals,
        recommendation: d.recommendation,
        autoMerge: false,
      },
      sourceCells: null,
      occurrences: 1,
    });
  }
  return [...out.values()];
}

function fromEnvelope(i: EnvelopeIssue): PlannedIssue {
  return {
    issueKey: i.issue_id ?? stableKey('RECORDLESS', i.code, i.message, i.source),
    code: i.code,
    severity: i.severity,
    origin: i.origin,
    message: i.message,
    recordKey: i.record_id,
    detail: null,
    sourceCells: i.record_id === null ? i.source : null,
    occurrences: 1,
  };
}
