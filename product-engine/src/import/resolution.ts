import { z } from 'zod';
import {
  CATALOG_STATUSES,
  CUSTOMER_SUPPLIED_ITEM,
  DECORATION_POLICIES,
  SALE_UNITS,
} from '../domain/catalog';
import type { CandidateKind } from './proposal';

/**
 * Human resolution attached to an approval. It fills what the source leaves
 * unknown and chooses the publication target. Every field is explicit: the
 * adapter never fills a gap with a default.
 */

const Target = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('CREATE') }),
  z.strictObject({ mode: z.literal('LINK_EXISTING'), entityId: z.uuid() }),
]);
export type ResolutionTarget = z.infer<typeof Target>;

export const CatalogItemResolutionSchema = z.strictObject({
  target: Target.optional(),
  itemType: z.enum(['PRODUCT', 'SERVICE']).optional(),
  canonicalName: z.string().trim().min(1).optional(),
  status: z.enum(CATALOG_STATUSES).optional(),
  saleUnit: z.enum(SALE_UNITS).nullable().optional(),
  decorationPolicy: z.enum(DECORATION_POLICIES).optional(),
  customerSuppliedItem: z.enum(CUSTOMER_SUPPLIED_ITEM).optional(),
  /**
   * Product Engine category (existing `category.key`), primary. Optional: the
   * legacy category stays as evidence and is never mapped automatically.
   */
  categoryKey: z
    .string()
    .regex(/^[a-z][a-z0-9_]*$/)
    .optional(),
});

const ValueChoice = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('EXISTING'), code: z.string().min(1) }),
  z.strictObject({
    mode: z.literal('CREATE'),
    code: z.string().trim().min(1),
    label: z.string().trim().min(1),
    spec: z
      .union([
        z.strictObject({ w: z.number().positive(), h: z.number().positive() }),
        z.strictObject({ value: z.number().positive() }),
      ])
      .nullable(),
  }),
  z.strictObject({ mode: z.literal('EXCLUDE'), reason: z.string().min(1) }),
]);

export const OptionResolutionSchema = z.strictObject({
  definition: z.discriminatedUnion('mode', [
    z.strictObject({ mode: z.literal('EXISTING'), key: z.string().min(1) }),
    z.strictObject({
      mode: z.literal('CREATE'),
      key: z.string().regex(/^[a-z][a-z0-9_]*$/),
      label: z.string().trim().min(1),
      valueKind: z.enum(['ENUM', 'DIMENSIONS', 'QUANTITY', 'LENGTH', 'TEXT', 'BOOLEAN']),
      unit: z.enum(['in', 'ft', 'oz']).nullable(),
      scope: z.enum(['ITEM', 'DECORATION']),
    }),
  ]),
  isRequired: z.boolean().optional(),
  selectionMode: z.enum(['SINGLE', 'MULTI']),
  isDistributable: z.boolean(),
  sort: z.number().int().optional(),
  /** Keyed by the LISTAS record key of each source value. */
  values: z.record(z.string().regex(/^[0-9a-f]{24}$/), ValueChoice),
});

export const DecorationResolutionSchema = z.strictObject({
  methodKey: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]*$/)
    .optional(),
  decorationPolicy: z.enum(DECORATION_POLICIES).optional(),
});

export const CompositionResolutionSchema = z.strictObject({
  childLegacyId: z.string().min(1).optional(),
  role: z.enum(['INCLUDED', 'OPTIONAL']).optional(),
  quantity: z.number().int().positive().optional(),
});

export const PriceResolutionSchema = z.strictObject({
  target: Target.optional(),
  /** When the definition takes effect in Product Engine. Never defaulted to "now". */
  validFrom: z.iso.datetime({ offset: true }).optional(),
  maxQuantity: z.number().int().positive().optional(),
  amountBasis: z.enum(['TOTAL', 'UNIT']).optional(),
});

export const PresentationResolutionSchema = z.strictObject({
  target: Target.optional(),
  locale: z.enum(['es', 'en']).optional(),
  isDefault: z.boolean().optional(),
  displayName: z.string().trim().min(1).optional(),
});

export type CatalogItemResolution = z.infer<typeof CatalogItemResolutionSchema>;
export type OptionResolution = z.infer<typeof OptionResolutionSchema>;
export type DecorationResolution = z.infer<typeof DecorationResolutionSchema>;
export type CompositionResolution = z.infer<typeof CompositionResolutionSchema>;
export type PriceResolution = z.infer<typeof PriceResolutionSchema>;
export type PresentationResolution = z.infer<typeof PresentationResolutionSchema>;

export const RESOLUTION_SCHEMAS = {
  CATALOG_ITEM: CatalogItemResolutionSchema,
  OPTION: OptionResolutionSchema,
  DECORATION: DecorationResolutionSchema,
  COMPOSITION: CompositionResolutionSchema,
  PRICE: PriceResolutionSchema,
  PRESENTATION: PresentationResolutionSchema,
} as const satisfies Record<CandidateKind, z.ZodType>;

export type ResolutionFor<K extends CandidateKind> = z.infer<(typeof RESOLUTION_SCHEMAS)[K]>;

export type ResolutionParse =
  | { ok: true; resolution: Record<string, unknown> }
  | { ok: false; errors: { path: string; message: string }[] };

export function parseResolution(kind: CandidateKind, input: unknown): ResolutionParse {
  const r = RESOLUTION_SCHEMAS[kind].safeParse(input ?? {});
  if (r.success) return { ok: true, resolution: r.data as Record<string, unknown> };
  return {
    ok: false,
    errors: r.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })),
  };
}

/**
 * Draft (partial) resolution saved during review, before approval. Every field
 * present is validated with its real schema; absent fields stay unresolved.
 * Approval still goes through `parseResolution` (complete, strict).
 */
export function parseDraftResolution(kind: CandidateKind, input: unknown): ResolutionParse {
  const r = RESOLUTION_SCHEMAS[kind].partial().safeParse(input ?? {});
  if (r.success) return { ok: true, resolution: r.data as Record<string, unknown> };
  return {
    ok: false,
    errors: r.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })),
  };
}
