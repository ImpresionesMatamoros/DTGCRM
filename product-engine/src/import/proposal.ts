import { z } from 'zod';
import { CATALOG_STATUSES, SALE_UNITS } from '../domain/catalog';

/**
 * Staging proposals: the bridge's typed reading of a STEP 05A hypothesis. They
 * live in `import_candidate.proposal` (JSONB) and are parsed back with these
 * schemas. `null` always means "not known from the source" — never a default.
 */

export const CANDIDATE_KINDS = [
  'CATALOG_ITEM',
  'PRICE',
  'OPTION',
  'DECORATION',
  'COMPOSITION',
  'PRESENTATION',
] as const;
export type CandidateKind = (typeof CANDIDATE_KINDS)[number];

const Text = z.string().nullable();
const Key = z.string().regex(/^[0-9a-f]{24}$/);

export const CatalogItemProposalSchema = z.strictObject({
  kind: z.literal('CATALOG_ITEM'),
  legacyId: z.string(),
  legacySku: Text,
  name: Text,
  /** PRODUCT/SERVICE from `Clase`; null when blank or unmapped. BUNDLE is not implemented. */
  itemType: z.enum(['PRODUCT', 'SERVICE']).nullable(),
  itemTypeEvidence: z.enum(['PRODUCT', 'SERVICE', 'BUNDLE']).nullable(),
  status: z.enum(CATALOG_STATUSES).nullable(),
  saleUnit: z.enum(SALE_UNITS).nullable(),
  customerSuppliedEvidence: z.boolean().nullable(),
  categoryLegacy: Text,
  familyEvidence: Text,
  notesEvidence: Text,
  /** Single-value attributes (not options): pair of magnets, sign size… */
  fixedAttributes: z.array(
    z.strictObject({
      optionLegacyId: Text,
      name: Text,
      values: z.array(Text),
      recordKey: Key,
    }),
  ),
});

export const OptionProposalSchema = z.strictObject({
  kind: z.literal('OPTION'),
  optionLegacyId: z.string(),
  itemLegacyId: z.string(),
  name: Text,
  captureType: Text,
  /** `Obligatoria`; null = unknown (never false by default). */
  required: z.boolean().nullable(),
  values: z.array(z.strictObject({ recordKey: Key, label: Text, measurement: z.json() })),
});

export const DecorationProposalSchema = z.discriminatedUnion('subtype', [
  z.strictObject({
    kind: z.literal('DECORATION'),
    subtype: z.literal('METHOD_ASSOCIATION'),
    associationLegacyId: z.string(),
    itemLegacyId: z.string(),
    methodLegacyId: Text,
    methodLabels: z.array(Text),
    /** Suggestion only (mappings.ts); publishing needs an explicit methodKey. */
    suggestedMethodKey: Text,
  }),
  z.strictObject({
    kind: z.literal('DECORATION'),
    subtype: z.literal('POLICY'),
    optionLegacyId: z.string(),
    itemLegacyId: z.string(),
    valueLabels: z.array(Text),
    /** Blank/Personalizada ⇒ OPTIONAL (ADR-0004). */
    decorationPolicy: z.enum(['OPTIONAL']),
  }),
]);

export const CompositionProposalSchema = z.discriminatedUnion('subtype', [
  z.strictObject({
    kind: z.literal('COMPOSITION'),
    subtype: z.literal('RELATION'),
    componentLegacyId: z.string(),
    parentLegacyId: Text,
    childLegacyId: Text,
    quantity: z.number().int().positive().nullable(),
    role: z.enum(['INCLUDED', 'OPTIONAL']).nullable(),
  }),
  z.strictObject({
    kind: z.literal('COMPOSITION'),
    subtype: z.literal('POLICY'),
    optionLegacyId: z.string(),
    itemLegacyId: z.string(),
    valueLabels: z.array(Text),
  }),
]);

export const PriceConditionProposalSchema = z.strictObject({
  conditionLegacyId: Text,
  optionLegacyId: Text,
  attribute: Text,
  operator: Text,
  value: Text,
  unit: Text,
  recordKey: Key,
});
export type PriceConditionProposal = z.infer<typeof PriceConditionProposalSchema>;

export const PriceObservationSchema = z.strictObject({
  parserCandidateKey: Key,
  priceLegacyId: z.string(),
  recordKey: Key,
  /** Exact quantity of the break; null for a FIXED price whose quantity the source omits. */
  quantity: z.number().int().positive().nullable(),
  amount: z
    .string()
    .regex(/^\d+(\.\d+)?$/)
    .nullable(),
  classification: z.enum(['FIXED', 'EXACT_QUANTITY_MATRIX', 'DERIVED', 'UNKNOWN_REVIEW_REQUIRED']),
  authorizationEvidence: z.boolean(),
});
export type PriceObservation = z.infer<typeof PriceObservationSchema>;

/** One PriceDefinition hypothesis = item × currency × model × basis × condition set. */
export const PriceProposalSchema = z.strictObject({
  kind: z.literal('PRICE'),
  itemLegacyId: z.string(),
  currency: z.enum(['USD', 'MXN']).nullable(),
  /** USD ⇒ USA master book. MXN evidence never becomes a price automatically. */
  market: z.enum(['USA', 'MX']).nullable(),
  model: z.enum(['EXACT_QUANTITY_MATRIX', 'FIXED']).nullable(),
  sourceModel: Text,
  amountBasisEvidence: Text,
  amountBasis: z.enum(['TOTAL', 'UNIT']).nullable(),
  mexicoEvidence: Text,
  conditions: z.array(PriceConditionProposalSchema),
  observations: z.array(PriceObservationSchema).min(1),
});

export const PresentationProposalSchema = z.strictObject({
  kind: z.literal('PRESENTATION'),
  linkLegacyId: z.string(),
  presentationLegacyId: Text,
  itemLegacyId: Text,
  displayName: Text,
  occasion: Text,
  channel: Text,
  languageEvidence: Text,
  locale: z.enum(['es', 'en']).nullable(),
  publicationStateEvidence: Text,
  role: Text,
  order: z.number().nullable(),
});

export const ProposalSchema = z.union([
  CatalogItemProposalSchema,
  OptionProposalSchema,
  DecorationProposalSchema,
  CompositionProposalSchema,
  PriceProposalSchema,
  PresentationProposalSchema,
]);

export type CatalogItemProposal = z.infer<typeof CatalogItemProposalSchema>;
export type OptionProposal = z.infer<typeof OptionProposalSchema>;
export type DecorationProposal = z.infer<typeof DecorationProposalSchema>;
export type CompositionProposal = z.infer<typeof CompositionProposalSchema>;
export type PriceProposal = z.infer<typeof PriceProposalSchema>;
export type PresentationProposal = z.infer<typeof PresentationProposalSchema>;
export type Proposal = z.infer<typeof ProposalSchema>;
