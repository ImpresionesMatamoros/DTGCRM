import type { Proposal } from '@/import/proposal';
import type { QCandidate, QualityInput } from '@/quality/types';

let n = 0;
const uid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const key24 = (i: number) => i.toString(16).padStart(24, '0');

export const resetIds = () => {
  n = 0;
};

const base = (
  kind: QCandidate['kind'],
  lineage: string,
  proposal: Proposal,
  over: Partial<QCandidate> = {},
): QCandidate => ({
  id: uid(),
  kind,
  lineageKey: lineage,
  reviewStatus: 'WARNING',
  proposal,
  resolution: null,
  blockingReasons: [],
  parserValidationState: 'WARNING',
  batch: { id: 'b1', sourceFile: 'wb.xlsx', dataClass: 'REAL', sourceRole: 'PRIMARY_RC' },
  provenance: { records: 1, recordsWithCell: 1 },
  issueCodes: [],
  ...over,
});

export const item = (
  legacyId: string,
  over: Partial<Extract<Proposal, { kind: 'CATALOG_ITEM' }>> = {},
  cand: Partial<QCandidate> = {},
): QCandidate =>
  base(
    'CATALOG_ITEM',
    `item:${legacyId}`,
    {
      kind: 'CATALOG_ITEM',
      legacyId,
      legacySku: null,
      name: `Item ${legacyId}`,
      itemType: 'PRODUCT',
      itemTypeEvidence: 'PRODUCT',
      status: null,
      saleUnit: null,
      customerSuppliedEvidence: null,
      categoryLegacy: 'MIG1-CAT-001',
      familyEvidence: null,
      notesEvidence: null,
      fixedAttributes: [],
      ...over,
    },
    cand,
  );

/** An item whose every resolution field is decided. */
export const resolvedItem = (legacyId: string, cand: Partial<QCandidate> = {}) =>
  item(
    legacyId,
    { status: 'ACTIVE', saleUnit: 'PIECE' },
    {
      resolution: { decorationPolicy: 'NONE', categoryKey: 'impresos_papel' },
      ...cand,
    },
  );

export const option = (
  itemLegacyId: string,
  name = 'tamano',
  over: Partial<Extract<Proposal, { kind: 'OPTION' }>> = {},
  cand: Partial<QCandidate> = {},
) =>
  base(
    'OPTION',
    `opt:${itemLegacyId}:${name}:${n}`,
    {
      kind: 'OPTION',
      optionLegacyId: `${itemLegacyId}-OPT-${n}`,
      itemLegacyId,
      name,
      captureType: null,
      required: null,
      values: [{ recordKey: key24(1), label: 'A', measurement: null }],
      ...over,
    },
    cand,
  );

export const price = (
  itemLegacyId: string,
  over: Partial<Extract<Proposal, { kind: 'PRICE' }>> = {},
  cand: Partial<QCandidate> = {},
) =>
  base(
    'PRICE',
    `price:${itemLegacyId}:${n}`,
    {
      kind: 'PRICE',
      itemLegacyId,
      currency: 'USD',
      market: 'USA',
      model: 'EXACT_QUANTITY_MATRIX',
      sourceModel: null,
      amountBasisEvidence: null,
      amountBasis: 'TOTAL',
      mexicoEvidence: null,
      conditions: [],
      observations: [
        {
          parserCandidateKey: key24(2),
          priceLegacyId: `${itemLegacyId}-P-1`,
          recordKey: key24(3),
          quantity: 100,
          amount: '25',
          classification: 'EXACT_QUANTITY_MATRIX',
          authorizationEvidence: true,
        },
      ],
      ...over,
    },
    cand,
  );

export const decoration = (
  itemLegacyId: string,
  assoc: string,
  methodLegacyId: string | null = 'M-1',
  cand: Partial<QCandidate> = {},
) =>
  base(
    'DECORATION',
    `dec:${assoc}`,
    {
      kind: 'DECORATION',
      subtype: 'METHOD_ASSOCIATION',
      associationLegacyId: assoc,
      itemLegacyId,
      methodLegacyId,
      methodLabels: ['DTF'],
      suggestedMethodKey: null,
    },
    cand,
  );

export const relation = (
  parent: string | null,
  child: string | null,
  cand: Partial<QCandidate> = {},
) =>
  base(
    'COMPOSITION',
    `comp:${parent}:${child}:${n}`,
    {
      kind: 'COMPOSITION',
      subtype: 'RELATION',
      componentLegacyId: `C-${n}`,
      parentLegacyId: parent,
      childLegacyId: child,
      quantity: 1,
      role: 'INCLUDED',
    },
    cand,
  );

export const presentation = (
  itemLegacyId: string | null,
  name = 'Pres',
  cand: Partial<QCandidate> = {},
) =>
  base(
    'PRESENTATION',
    `pres:${itemLegacyId}:${name}:${n}`,
    {
      kind: 'PRESENTATION',
      linkLegacyId: `L-${n}`,
      presentationLegacyId: null,
      itemLegacyId,
      displayName: name,
      occasion: null,
      channel: null,
      languageEvidence: null,
      locale: null,
      publicationStateEvidence: null,
      role: null,
      order: null,
    },
    cand,
  );

export const input = (
  candidates: QCandidate[],
  over: Partial<QualityInput> = {},
): QualityInput => ({
  asOf: '2026-10-01T00:00:00.000Z',
  batches: [],
  candidates,
  categoryKeys: ['impresos_papel', 'banderas_displays'],
  decorationMethodKeys: ['DTF', 'SCREEN'],
  optionDefinitionKeys: ['tamano_papel'],
  decisionAnswers: [],
  categoryMappings: [],
  duplicateMarks: [],
  duplicateSignals: [],
  historicalPriceLegacyIds: [],
  historicalCountByItemLegacy: {},
  domainItems: [],
  domainDefinitions: [],
  publicationEnabledFor: ['FIXTURE'],
  ...over,
});
