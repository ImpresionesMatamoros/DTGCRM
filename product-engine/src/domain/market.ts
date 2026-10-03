import type { Uuid } from './catalog';
import type { CurrencyCode } from '../shared/money';

export type MarketCode = 'USA' | 'MX';

export interface Market {
  id: Uuid;
  code: MarketCode;
  name: string;
  defaultCurrency: CurrencyCode;
}

/** A market's price context. USA is the master; México derives from it by default. */
export type PriceBook =
  | {
      id: Uuid;
      code: string;
      marketId: Uuid;
      currency: CurrencyCode;
      mode: 'MASTER';
      sourcePriceBookId: null;
      defaultFactor: null;
    }
  | {
      id: Uuid;
      code: string;
      marketId: Uuid;
      currency: CurrencyCode;
      mode: 'DERIVED';
      sourcePriceBookId: Uuid;
      /** Decimal string, e.g. "0.70" (BR-029). */
      defaultFactor: string;
    };

export type PricingMode = 'INHERIT' | 'DERIVED' | 'MANUAL' | 'QUOTE_ONLY';

/** Persistent per-item market policy (ADR-0003 + addendum). Absence = INHERIT, available. */
export interface ItemMarketPolicy {
  itemId: Uuid;
  marketId: Uuid;
  pricingMode: PricingMode;
  /** Decimal string; only meaningful with INHERIT/DERIVED. */
  factorOverride: string | null;
  isAvailable: boolean;
}

/** Versioned by validity (e.g. usd_mxn_fx = 16.5, BR-030). */
export interface PricingParameter {
  id: Uuid;
  key: string;
  value: string;
  validFrom: string;
  validTo: string | null;
}

export function fxParameterKey(from: CurrencyCode, to: CurrencyCode): string {
  return `${from.toLowerCase()}_${to.toLowerCase()}_fx`;
}

/** Half-open validity window [from, to). ISO-8601 strings; `asOf` is always explicit. */
export function isEffective(validFrom: string, validTo: string | null, asOf: Date): boolean {
  const t = asOf.getTime();
  if (Date.parse(validFrom) > t) return false;
  return validTo === null || Date.parse(validTo) > t;
}

export type EffectiveMarketMode =
  | { mode: 'MASTER'; priceBook: PriceBook }
  | { mode: 'MANUAL'; priceBook: PriceBook }
  | {
      mode: 'DERIVED';
      priceBook: Extract<PriceBook, { mode: 'DERIVED' }>;
      factor: string;
      factorSource: 'DEFAULT' | 'ITEM';
    }
  | { mode: 'QUOTE_ONLY'; priceBook: PriceBook }
  | { mode: 'MISCONFIGURED'; priceBook: PriceBook; detail: string };

/**
 * Resolves how an item is priced in a market. Evaluated per CatalogItem,
 * also for optional components (ADR-0010).
 */
export function effectiveMarketMode(
  priceBook: PriceBook,
  policy: ItemMarketPolicy | undefined,
): EffectiveMarketMode {
  const requested = policy?.pricingMode ?? 'INHERIT';
  if (requested === 'QUOTE_ONLY') return { mode: 'QUOTE_ONLY', priceBook };
  if (requested === 'MANUAL') {
    return { mode: priceBook.mode === 'MASTER' ? 'MASTER' : 'MANUAL', priceBook };
  }
  if (priceBook.mode === 'MASTER') {
    if (requested === 'DERIVED') {
      return { mode: 'MISCONFIGURED', priceBook, detail: 'DERIVED policy on a MASTER price book' };
    }
    return { mode: 'MASTER', priceBook };
  }
  const override = policy?.factorOverride ?? null;
  return {
    mode: 'DERIVED',
    priceBook,
    factor: override ?? priceBook.defaultFactor,
    factorSource: override !== null ? 'ITEM' : 'DEFAULT',
  };
}
