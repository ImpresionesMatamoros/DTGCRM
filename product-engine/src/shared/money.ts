import Decimal from 'decimal.js';

/**
 * Money always carries its currency (ADR-0008). There is no way to build a
 * Money without one, and arithmetic across currencies is rejected.
 */
export const CURRENCY_CODES = ['USD', 'MXN'] as const;
export type CurrencyCode = (typeof CURRENCY_CODES)[number];

export type Money = Readonly<{ amount: Decimal; currency: CurrencyCode }>;

// Independent Decimal constructor: global config changes elsewhere cannot leak in.
export const Dec = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type DecimalInput = Decimal.Value;

export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === 'string' && (CURRENCY_CODES as readonly string[]).includes(value);
}

export class MoneyError extends Error {
  override name = 'MoneyError';
}

export function toDecimal(value: DecimalInput): Decimal {
  let d: Decimal;
  try {
    d = new Dec(value);
  } catch {
    throw new MoneyError(`Invalid decimal amount: ${String(value)}`);
  }
  if (!d.isFinite()) throw new MoneyError(`Amount must be finite: ${String(value)}`);
  return d;
}

export function money(amount: DecimalInput, currency: CurrencyCode): Money {
  if (!isCurrencyCode(currency)) {
    throw new MoneyError(`Money requires an explicit currency (got ${String(currency)})`);
  }
  return Object.freeze({ amount: toDecimal(amount), currency });
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new MoneyError(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  }
}

export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amount.plus(b.amount), a.currency);
}

export function sumMoney(items: readonly Money[], currency: CurrencyCode): Money {
  return items.reduce<Money>((acc, m) => addMoney(acc, m), money(0, currency));
}

export function multiplyMoney(m: Money, factor: DecimalInput): Money {
  return money(m.amount.times(toDecimal(factor)), m.currency);
}

/** Rounds half-up to `dp` decimals (default 2). */
export function roundMoney(m: Money, dp = 2): Money {
  return money(m.amount.toDecimalPlaces(dp, Decimal.ROUND_HALF_UP), m.currency);
}

/**
 * Explicit currency conversion. The caller states every factor that participates,
 * so the derivation can be reported (e.g. USD × market factor × FX → MXN).
 */
export function convertMoney(
  source: Money,
  target: CurrencyCode,
  factors: readonly DecimalInput[],
): Money {
  const amount = factors.reduce<Decimal>((acc, f) => acc.times(toDecimal(f)), source.amount);
  return money(amount, target);
}

export function moneyEquals(a: Money, b: Money): boolean {
  return a.currency === b.currency && a.amount.equals(b.amount);
}

/** Wire format: decimal string with 2 decimals + currency (never a JS number). */
export function formatAmount(m: Money, dp = 2): string {
  return m.amount.toFixed(dp);
}
