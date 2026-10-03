import { z } from 'zod';
import {
  CurrencyCodeSchema,
  MarketCodeSchema,
  PriceRequestSchema,
  PriceResultWireSchema,
} from './contracts';

/**
 * CRM-facing API contract, version 1 (STEP 10). Read-only catalog + pricing.
 * Everything here is *CRM-safe*: no cost, provenance, import, owner-decision,
 * draft-price or admin data can be expressed by these schemas. Responses are
 * parsed with these schemas before they leave the server (strict objects), so a
 * leaking field is a server error and a failing test, never a silent exposure.
 */

export const CONTRACT_VERSION = '1';
export const CONTRACT_HEADER = 'X-DTG-Contract-Version';

export const PriceAvailabilitySchema = z.enum(['AUTHORIZED_PRICES', 'QUOTE_ONLY', 'UNAVAILABLE']);
export type PriceAvailability = z.infer<typeof PriceAvailabilitySchema>;

const MarketAvailabilityWire = z
  .object({
    market: MarketCodeSchema,
    is_available: z.boolean(),
    /** Indicative only; `POST /pricing/resolve` is the authority. */
    price_availability: PriceAvailabilitySchema,
    currency: CurrencyCodeSchema.nullable(),
  })
  .strict();

export const ItemSummaryWireSchema = z
  .object({
    id: z.uuid(),
    public_code: z.string().regex(/^DTG-[0-9]{5,}$/),
    canonical_name: z.string().min(1),
    display_name: z.string().min(1),
    item_type: z.enum(['PRODUCT', 'SERVICE']),
    sale_unit: z.string().nullable(),
    description: z.string().nullable(),
    markets: z.array(MarketAvailabilityWire),
  })
  .strict();
export type ItemSummaryWire = z.infer<typeof ItemSummaryWireSchema>;

export const ItemListResponseSchema = z
  .object({
    contract_version: z.literal(CONTRACT_VERSION),
    items: z.array(ItemSummaryWireSchema),
    page: z
      .object({
        limit: z.number().int(),
        offset: z.number().int(),
        total: z.number().int(),
        next_offset: z.number().int().nullable(),
      })
      .strict(),
  })
  .strict();
export type ItemListResponse = z.infer<typeof ItemListResponseSchema>;

const OptionValueWire = z
  .object({
    code: z.string(),
    label: z.string(),
    spec: z.union([
      z.null(),
      z.object({ w: z.number(), h: z.number() }),
      z.object({ value: z.number() }),
    ]),
  })
  .strict();

const OptionWire = z
  .object({
    key: z.string(),
    label: z.string(),
    value_kind: z.enum(['ENUM', 'TEXT', 'BOOLEAN', 'DIMENSIONS', 'QUANTITY', 'LENGTH']),
    unit: z.string().nullable(),
    is_required: z.boolean(),
    selection_mode: z.enum(['SINGLE', 'MULTI']),
    is_distributable: z.boolean(),
    default_value_code: z.string().nullable(),
    values: z.array(OptionValueWire),
  })
  .strict();

export const ItemDetailResponseSchema = z
  .object({
    contract_version: z.literal(CONTRACT_VERSION),
    item: z
      .object({
        id: z.uuid(),
        public_code: z.string(),
        canonical_name: z.string(),
        item_type: z.enum(['PRODUCT', 'SERVICE']),
        status: z.literal('ACTIVE'),
        description: z.string().nullable(),
        sale_unit: z.string().nullable(),
        measurement: z
          .object({ kind: z.enum(['AREA', 'LENGTH']), unit: z.enum(['in', 'ft']) })
          .strict()
          .nullable(),
      })
      .strict(),
    presentations: z.array(
      z
        .object({
          locale: z.enum(['es', 'en']),
          display_name: z.string(),
          occasion: z.string().nullable(),
          short_description: z.string().nullable(),
          is_default: z.boolean(),
        })
        .strict(),
    ),
    options: z.array(OptionWire),
    decoration: z
      .object({
        policy: z.enum(['OPTIONAL', 'REQUIRED']),
        methods: z.array(
          z
            .object({
              key: z.string(),
              name: z.string(),
              allowed_placements: z.array(z.string()).nullable(),
              max_print_size: z.string().nullable(),
            })
            .strict(),
        ),
      })
      .strict()
      .nullable(),
    components: z.array(
      z
        .object({
          role: z.enum(['INCLUDED', 'OPTIONAL']),
          quantity: z.number().int(),
          item: z
            .object({ id: z.uuid(), public_code: z.string(), canonical_name: z.string() })
            .strict(),
        })
        .strict(),
    ),
    markets: z.array(MarketAvailabilityWire),
  })
  .strict();
export type ItemDetailResponse = z.infer<typeof ItemDetailResponseSchema>;

/** `POST /api/v1/pricing/resolve` body: the existing PriceRequest plus an explicit instant. */
export const ResolveEnvelopeSchema = z
  .object({
    as_of: z.iso.datetime({ offset: true }).optional(),
    request: PriceRequestSchema,
  })
  .strict();
export type ResolveEnvelope = z.infer<typeof ResolveEnvelopeSchema>;

export const ErrorResponseSchema = z
  .object({
    error: z
      .object({
        code: z.enum([
          'INVALID_QUERY',
          'INVALID_JSON',
          'INVALID_REQUEST',
          'UNAUTHORIZED',
          'AUTH_NOT_CONFIGURED',
          'ITEM_NOT_FOUND',
          'METHOD_NOT_ALLOWED',
          'INTERNAL',
        ]),
        message: z.string(),
        issues: z.array(z.object({ path: z.string(), message: z.string() }).strict()).optional(),
      })
      .strict(),
  })
  .strict();
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

export const ListQuerySchema = z
  .object({
    q: z.string().trim().max(100).optional(),
    market: MarketCodeSchema.optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    offset: z.coerce.number().int().min(0).max(100000).default(0),
  })
  .strict();

export { PriceRequestSchema, PriceResultWireSchema };
