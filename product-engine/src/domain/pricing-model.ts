import type { SaleUnit, Uuid } from './catalog';

/**
 * Master price data (STEP 03 §7, ADR-0005/0006). Only AUTHORIZED definitions
 * inside their validity window are ever resolved. Historical/unauthorized prices
 * do not exist here: they live in provenance evidence.
 * DERIVED and QUOTE_ONLY are market/policy behaviour, not rows.
 */

export type PriceStatus = 'DRAFT' | 'AUTHORIZED' | 'SUPERSEDED';
export type PriceComponent = 'ITEM' | 'DECORATION';
export type AmountBasis = 'TOTAL' | 'UNIT';

export type PriceCondition =
  | { id: Uuid; kind: 'OPTION_VALUE'; optionDefinitionId: Uuid; optionValueId: Uuid }
  | { id: Uuid; kind: 'DECORATION_METHOD'; decorationMethodId: Uuid };

export interface PriceBreak {
  quantity: number;
  /** Decimal string in the price book currency. */
  amount: string;
  amountBasis: AmountBasis;
}

interface PriceDefinitionBase {
  id: Uuid;
  itemId: Uuid;
  priceBookId: Uuid;
  component: PriceComponent;
  status: PriceStatus;
  validFrom: string;
  validTo: string | null;
  version: number;
  supersedesId: Uuid | null;
  authorizedBy: string | null;
  authorizedAt: string | null;
  /** AND across options, IN within the same option (fixed semantics). */
  conditions: PriceCondition[];
}

export type PriceDefinition =
  | (PriceDefinitionBase & { model: 'FIXED'; amount: string; maxQuantity: number })
  | (PriceDefinitionBase & {
      model: 'PER_UNIT';
      amount: string;
      minQuantity: number | null;
      maxQuantity: number | null;
    })
  | (PriceDefinitionBase & { model: 'EXACT_QUANTITY_MATRIX'; breaks: PriceBreak[] })
  | (PriceDefinitionBase & { model: 'TIERED'; breaks: PriceBreak[] })
  | (PriceDefinitionBase & {
      model: 'MEASURED';
      rate: string;
      rateUnit: Extract<SaleUnit, 'SQ_FT' | 'LINEAR_FT'>;
      minCharge: string | null;
    });

export type PriceModel = PriceDefinition['model'];

export type RuleKind = 'ADD_PER_UNIT' | 'ADD_FIXED' | 'REQUIRE_QUOTE';

export interface PriceRule {
  id: Uuid;
  priceBookId: Uuid;
  /** Same code across price books = same business rule in another market. */
  code: string;
  label: string;
  kind: RuleKind;
  amount: string | null;
  /** Rules sharing a key are mutually exclusive; conflicting amounts ⇒ AMBIGUOUS. */
  exclusivityKey: string | null;
  status: PriceStatus;
  validFrom: string;
  validTo: string | null;
  version: number;
  supersedesId: Uuid | null;
  authorizedBy: string | null;
  authorizedAt: string | null;
  conditions: PriceCondition[];
  /** Explicit per-item scope (never by category). */
  itemIds: Uuid[];
}

export interface PriceRuleAssignment {
  ruleId: Uuid;
  itemId: Uuid;
}

export type PriceDefinitionIssue =
  | 'AUTHORIZED_REQUIRES_AUTHORIZER'
  | 'MATRIX_REQUIRES_BREAKS'
  | 'DUPLICATE_BREAK_QUANTITY'
  | 'NON_POSITIVE_QUANTITY'
  | 'NEGATIVE_AMOUNT'
  | 'INVALID_VALIDITY';

export function validatePriceDefinition(def: PriceDefinition): PriceDefinitionIssue[] {
  const issues: PriceDefinitionIssue[] = [];
  if (def.status === 'AUTHORIZED' && (!def.authorizedBy || !def.authorizedAt)) {
    issues.push('AUTHORIZED_REQUIRES_AUTHORIZER');
  }
  if (def.validTo !== null && Date.parse(def.validTo) <= Date.parse(def.validFrom)) {
    issues.push('INVALID_VALIDITY');
  }
  if (def.model === 'EXACT_QUANTITY_MATRIX' || def.model === 'TIERED') {
    if (def.breaks.length === 0) issues.push('MATRIX_REQUIRES_BREAKS');
    const qs = def.breaks.map((b) => b.quantity);
    if (new Set(qs).size !== qs.length) issues.push('DUPLICATE_BREAK_QUANTITY');
    if (qs.some((q) => !Number.isInteger(q) || q <= 0)) issues.push('NON_POSITIVE_QUANTITY');
    if (def.breaks.some((b) => Number(b.amount) < 0)) issues.push('NEGATIVE_AMOUNT');
  }
  return issues;
}

/** Canonical key of a condition set, used to detect overlapping definitions. */
export function conditionSignature(conditions: readonly PriceCondition[]): string {
  return conditions
    .map((c) =>
      c.kind === 'OPTION_VALUE'
        ? `opt:${c.optionDefinitionId}=${c.optionValueId}`
        : `dec:${c.decorationMethodId}`,
    )
    .sort()
    .join('|');
}
