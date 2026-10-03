import { z } from 'zod';
import type { PriceRequest } from '../domain/configuration';
import type { BreakdownLine, PriceResult } from '../pricing/result';
import { CURRENCY_CODES, formatAmount, type Money } from '../shared/money';

/**
 * Wire contract v1 (CRM-INTEGRATION-CONTRACT / PRICING-ENGINE-CONTRACT).
 * snake_case on the wire, camelCase in the domain. Amounts travel as decimal
 * strings together with their currency (ADR-0008). No transport yet (STEP 05).
 */

export const CurrencyCodeSchema = z.enum(CURRENCY_CODES);
export const MarketCodeSchema = z.enum(['USA', 'MX']);

export const MoneyWireSchema = z
  .object({
    amount: z.string().regex(/^-?\d+\.\d{2}$/, 'decimal string with 2 decimals'),
    currency: CurrencyCodeSchema,
  })
  .strict();
export type MoneyWire = z.infer<typeof MoneyWireSchema>;

const OptionSelectionWire = z
  .object({
    option_key: z.string().min(1),
    value_codes: z.array(z.string().min(1)).min(1).optional(),
    text: z.string().optional(),
    boolean: z.boolean().optional(),
  })
  .strict();

const PositiveInt = z.number().int().positive();

export const PriceRequestSchema = z
  .object({
    catalog_item_id: z.uuid(),
    market: MarketCodeSchema,
    quantity: PositiveInt,
    selections: z.array(OptionSelectionWire).optional(),
    distribution: z
      .array(z.object({ selections: z.array(OptionSelectionWire), quantity: PositiveInt }).strict())
      .optional(),
    measurements: z
      .object({
        width: z.number().positive().optional(),
        height: z.number().positive().optional(),
        length: z.number().positive().optional(),
        unit: z.enum(['in', 'ft']),
      })
      .strict()
      .optional(),
    decorations: z
      .array(
        z
          .object({
            method_key: z.string().min(1),
            placement_code: z.string().optional(),
            print_size_code: z.string().optional(),
          })
          .strict(),
      )
      .optional(),
    optional_components: z
      .array(z.object({ catalog_item_id: z.uuid(), quantity: PositiveInt.optional() }).strict())
      .optional(),
  })
  .strict();
export type PriceRequestWire = z.infer<typeof PriceRequestSchema>;

const toSelection = (s: z.infer<typeof OptionSelectionWire>) => ({
  optionKey: s.option_key,
  ...(s.value_codes ? { valueCodes: s.value_codes } : {}),
  ...(s.text !== undefined ? { text: s.text } : {}),
  ...(s.boolean !== undefined ? { boolean: s.boolean } : {}),
});

/** Parses untrusted input into the domain request. Throws ZodError on invalid shape. */
export function parsePriceRequest(input: unknown): PriceRequest {
  const w = PriceRequestSchema.parse(input);
  return {
    catalogItemId: w.catalog_item_id,
    market: w.market,
    quantity: w.quantity,
    ...(w.selections ? { selections: w.selections.map(toSelection) } : {}),
    ...(w.distribution
      ? {
          distribution: w.distribution.map((r) => ({
            quantity: r.quantity,
            selections: r.selections.map(toSelection),
          })),
        }
      : {}),
    ...(w.measurements ? { measurements: w.measurements } : {}),
    ...(w.decorations
      ? {
          decorations: w.decorations.map((d) => ({
            methodKey: d.method_key,
            ...(d.placement_code ? { placementCode: d.placement_code } : {}),
            ...(d.print_size_code ? { printSizeCode: d.print_size_code } : {}),
          })),
        }
      : {}),
    ...(w.optional_components
      ? {
          optionalComponents: w.optional_components.map((c) => ({
            catalogItemId: c.catalog_item_id,
            ...(c.quantity ? { quantity: c.quantity } : {}),
          })),
        }
      : {}),
  };
}

// ------------------------------------------------------------------ result (wire)

export function moneyToWire(m: Money): MoneyWire {
  return { amount: formatAmount(m), currency: m.currency };
}

const BreakdownLineWire = z.object({
  kind: z.enum([
    'BASE',
    'DECORATION',
    'RULE',
    'COMPONENT_INCLUDED',
    'COMPONENT_OPTIONAL',
    'MARKET_DERIVATION',
  ]),
  label: z.string(),
  quantity: z.number(),
  amount: MoneyWireSchema.nullable(),
  source: z.record(z.string(), z.union([z.string(), z.number()])),
});

const CommonWire = {
  catalog_item_id: z.uuid(),
  market: MarketCodeSchema,
  quantity: z.number(),
  currency: CurrencyCodeSchema.nullable(),
  policy: z
    .object({
      market: MarketCodeSchema,
      price_book_code: z.string(),
      basis: z.enum(['MASTER', 'DERIVED', 'MANUAL', 'POLICY_QUOTE_ONLY']),
      factor: z.string().optional(),
      factor_source: z.enum(['DEFAULT', 'ITEM']).optional(),
    })
    .nullable(),
  effective_at: z.iso.datetime(),
  catalog_revision: z.number().int(),
  pricing_revision: z.number().int(),
  explanation: z.array(z.string()),
};

export const PriceResultWireSchema = z.discriminatedUnion('status', [
  z.object({
    ...CommonWire,
    status: z.literal('RESOLVED'),
    total: MoneyWireSchema,
    breakdown: z.array(BreakdownLineWire),
    rules_applied: z.array(z.object({ rule_id: z.uuid(), code: z.string(), version: z.number() })),
    derivation: z
      .object({
        source_price_book_code: z.string(),
        source_total: MoneyWireSchema,
        factor: z.string(),
        factor_source: z.enum(['DEFAULT', 'ITEM']),
        fx: z.string(),
        fx_parameter_id: z.uuid(),
        rounding: z.literal('HALF_UP_2'),
        derived_total: MoneyWireSchema,
      })
      .nullable(),
    components: z.array(
      z.object({ catalog_item_id: z.uuid(), quantity: z.number(), total: MoneyWireSchema }),
    ),
  }),
  z.object({
    ...CommonWire,
    status: z.literal('QUOTE_ONLY'),
    reason_code: z.string(),
    detail: z.string().nullable(),
    known_lines: z.array(BreakdownLineWire),
    known_adjustments: z.array(BreakdownLineWire),
  }),
  z.object({
    ...CommonWire,
    status: z.literal('INVALID'),
    errors: z.array(
      z.object({ code: z.string(), path: z.string(), detail: z.string().optional() }),
    ),
  }),
  z.object({
    ...CommonWire,
    status: z.literal('AMBIGUOUS'),
    reason_code: z.string(),
    conflicting_ids: z.array(z.string()),
    detail: z.string().nullable(),
  }),
]);
export type PriceResultWire = z.infer<typeof PriceResultWireSchema>;

const snake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

function lineToWire(l: BreakdownLine) {
  const source: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(l.source)) if (v !== undefined) source[snake(k)] = v;
  return {
    kind: l.kind,
    label: l.label,
    quantity: l.quantity,
    amount: l.amount ? moneyToWire(l.amount) : null,
    source,
  };
}

/** Serializes a domain result; the output is validated against the wire schema. */
export function priceResultToWire(r: PriceResult): PriceResultWire {
  const common = {
    catalog_item_id: r.catalogItemId,
    market: r.market,
    quantity: r.quantity,
    currency: r.currency,
    policy: r.policy
      ? {
          market: r.policy.market,
          price_book_code: r.policy.priceBookCode,
          basis: r.policy.basis,
          ...(r.policy.factor !== undefined ? { factor: r.policy.factor } : {}),
          ...(r.policy.factorSource !== undefined ? { factor_source: r.policy.factorSource } : {}),
        }
      : null,
    effective_at: r.effectiveAt,
    catalog_revision: r.revisions.catalog,
    pricing_revision: r.revisions.pricing,
    explanation: r.explanation,
  };
  let wire: unknown;
  switch (r.status) {
    case 'RESOLVED':
      wire = {
        ...common,
        status: r.status,
        total: moneyToWire(r.total),
        breakdown: r.breakdown.map(lineToWire),
        rules_applied: r.rulesApplied.map((a) => ({
          rule_id: a.ruleId,
          code: a.code,
          version: a.version,
        })),
        derivation: r.derivation
          ? {
              source_price_book_code: r.derivation.sourcePriceBookCode,
              source_total: moneyToWire(r.derivation.sourceTotal),
              factor: r.derivation.factor,
              factor_source: r.derivation.factorSource,
              fx: r.derivation.fx,
              fx_parameter_id: r.derivation.fxParameterId,
              rounding: r.derivation.rounding,
              derived_total: moneyToWire(r.derivation.derivedTotal),
            }
          : null,
        components: r.components.map((c) => ({
          catalog_item_id: c.catalogItemId,
          quantity: c.quantity,
          total: moneyToWire(c.result.total),
        })),
      };
      break;
    case 'QUOTE_ONLY':
      wire = {
        ...common,
        status: r.status,
        reason_code: r.reasonCode,
        detail: r.detail,
        known_lines: r.knownLines.map(lineToWire),
        known_adjustments: r.knownAdjustments.map(lineToWire),
      };
      break;
    case 'INVALID':
      wire = { ...common, status: r.status, errors: r.errors };
      break;
    case 'AMBIGUOUS':
      wire = {
        ...common,
        status: r.status,
        reason_code: r.reasonCode,
        conflicting_ids: r.conflictingIds,
        detail: r.detail,
      };
      break;
  }
  return PriceResultWireSchema.parse(wire);
}
