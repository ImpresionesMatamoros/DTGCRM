import { describe, expect, it } from 'vitest';
import {
  addMoney,
  convertMoney,
  formatAmount,
  money,
  MoneyError,
  roundMoney,
  sumMoney,
  type Money,
} from '@/shared/money';

describe('Money (ADR-0008)', () => {
  it('cannot exist without a currency', () => {
    // @ts-expect-error currency is mandatory at the type level
    expect(() => money(120)).toThrow(MoneyError);
    // @ts-expect-error only USD | MXN are valid
    expect(() => money(120, 'EUR')).toThrow(MoneyError);
    // @ts-expect-error a bare number is not Money
    const bare: Money = { amount: 120 };
    expect(bare).toBeDefined();
  });

  it('rejects non-finite or malformed amounts', () => {
    expect(() => money('abc', 'USD')).toThrow(MoneyError);
    expect(() => money(Infinity, 'USD')).toThrow(MoneyError);
  });

  it('never adds different currencies', () => {
    expect(() => addMoney(money(1, 'USD'), money(1, 'MXN'))).toThrow(/Currency mismatch/);
    expect(formatAmount(sumMoney([money('0.10', 'USD'), money('0.20', 'USD')], 'USD'))).toBe(
      '0.30',
    );
  });

  it('converts explicitly and rounds half-up to cents', () => {
    const mxn = roundMoney(convertMoney(money(120, 'USD'), 'MXN', ['0.70', '16.5']));
    expect(mxn.currency).toBe('MXN');
    expect(formatAmount(mxn)).toBe('1386.00');
    expect(formatAmount(roundMoney(money('2.345', 'USD')))).toBe('2.35');
  });

  it('is immutable', () => {
    const m = money(1, 'USD');
    expect(Object.isFrozen(m)).toBe(true);
  });
});
