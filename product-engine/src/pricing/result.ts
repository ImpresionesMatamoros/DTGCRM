import type { Uuid } from '../domain/catalog';
import type { ConfigurationError } from '../domain/configuration';
import type { MarketCode } from '../domain/market';
import type { CurrencyCode, Money } from '../shared/money';

/** Explicit, explainable pricing outcome (PRICING-ENGINE-CONTRACT, ADR-0008). */

export type PricingBasis = 'MASTER' | 'DERIVED' | 'MANUAL' | 'POLICY_QUOTE_ONLY';

export interface PolicyApplied {
  market: MarketCode;
  priceBookCode: string;
  basis: PricingBasis;
  /** DERIVED only: market factor and where it came from. */
  factor?: string;
  factorSource?: 'DEFAULT' | 'ITEM';
}

export type BreakdownKind =
  | 'BASE'
  | 'DECORATION'
  | 'RULE'
  | 'COMPONENT_INCLUDED'
  | 'COMPONENT_OPTIONAL'
  | 'MARKET_DERIVATION';

export interface BreakdownLine {
  kind: BreakdownKind;
  label: string;
  quantity: number;
  /** null only for COMPONENT_INCLUDED (priced inside the parent). */
  amount: Money | null;
  source: {
    catalogItemId?: Uuid;
    priceDefinitionId?: Uuid;
    priceDefinitionVersion?: number;
    breakQuantity?: number;
    ruleId?: Uuid;
    ruleCode?: string;
    ruleVersion?: number;
    basis?: PricingBasis;
  };
}

export interface Derivation {
  sourcePriceBookCode: string;
  sourceTotal: Money;
  factor: string;
  factorSource: 'DEFAULT' | 'ITEM';
  fx: string;
  fxParameterId: Uuid;
  rounding: 'HALF_UP_2';
  derivedTotal: Money;
}

export interface AppliedRule {
  ruleId: Uuid;
  code: string;
  version: number;
}

interface ResultCommon {
  catalogItemId: Uuid;
  market: MarketCode;
  quantity: number;
  /** Currency of the market's price book; null only if the market itself is unknown. */
  currency: CurrencyCode | null;
  policy: PolicyApplied | null;
  /** The instant used to select validity windows (ADR-0009). */
  effectiveAt: string;
  revisions: { catalog: number; pricing: number };
  explanation: string[];
}

export interface ResolvedComponent {
  catalogItemId: Uuid;
  quantity: number;
  result: ResolvedResult;
}

export interface ResolvedResult extends ResultCommon {
  status: 'RESOLVED';
  currency: CurrencyCode;
  total: Money;
  breakdown: BreakdownLine[];
  rulesApplied: AppliedRule[];
  derivation: Derivation | null;
  components: ResolvedComponent[];
}

export type QuoteOnlyReason =
  | 'MARKET_POLICY_QUOTE_ONLY'
  | 'NO_SALE_UNIT'
  | 'NO_AUTHORIZED_BASE_PRICE'
  | 'QUANTITY_NOT_IN_MATRIX'
  | 'FIXED_PRICE_QUANTITY_NOT_AUTHORIZED'
  | 'BELOW_MIN_QUANTITY'
  | 'ABOVE_MAX_QUANTITY'
  | 'NO_AUTHORIZED_DECORATION_PRICE'
  | 'RULE_REQUIRES_QUOTE'
  | 'MANUAL_MX_PRICE_MISSING'
  | 'RULE_NOT_DEFINED_FOR_MARKET'
  | 'FX_PARAMETER_MISSING'
  | 'COMPONENT_NOT_PRICED';

export interface QuoteOnlyResult extends ResultCommon {
  status: 'QUOTE_ONLY';
  reasonCode: QuoteOnlyReason;
  detail: string | null;
  /** Lines that are known (e.g. base found, decoration missing). Informative, no total. */
  knownLines: BreakdownLine[];
  /** Rules that would apply (e.g. 3 × 3XL = +9 USD). Informative, never summed. */
  knownAdjustments: BreakdownLine[];
}

export interface InvalidResult extends ResultCommon {
  status: 'INVALID';
  errors: ConfigurationError[];
}

export type AmbiguousReason =
  | 'BASE_DEFINITION_OVERLAP'
  | 'DECORATION_DEFINITION_OVERLAP'
  | 'RULE_CONFLICT'
  | 'FX_PARAMETER_OVERLAP'
  | 'POLICY_MISCONFIGURED'
  | 'DEFINITION_MISCONFIGURED';

/** A catalog data defect. The CRM treats it as quote-only and reports it. */
export interface AmbiguousResult extends ResultCommon {
  status: 'AMBIGUOUS';
  reasonCode: AmbiguousReason;
  conflictingIds: Uuid[];
  detail: string | null;
}

export type PriceResult = ResolvedResult | QuoteOnlyResult | InvalidResult | AmbiguousResult;
