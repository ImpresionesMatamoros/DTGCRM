import { describe, expect, it } from 'vitest';
import {
  includedChildrenOf,
  optionalChildrenOf,
  validateComposition,
  type CompositionLine,
} from '@/domain/composition';
import { effectiveMarketMode, isEffective, type PriceBook } from '@/domain/market';
import { itemId, REF, sliceSnapshot } from '../fixtures/slice';

const line = (id: string, parent: string, child: string, quantity = 1): CompositionLine => ({
  id,
  parentItemId: parent,
  childItemId: child,
  quantity,
  role: 'INCLUDED',
  sort: 1,
  note: null,
});

describe('composition', () => {
  it('slice: X-Banner complete includes stand + graphic; yard sign has an optional stake', () => {
    const s = sliceSnapshot();
    expect(validateComposition(s.compositionLines)).toEqual([]);
    expect(
      includedChildrenOf(itemId('xbanner_completo'), s.compositionLines).map((l) => l.childItemId),
    ).toEqual([itemId('xbanner_estructura'), itemId('xbanner_grafica')]);
    expect(
      optionalChildrenOf(itemId('yard_sign'), s.compositionLines).map((l) => l.childItemId),
    ).toEqual([itemId('estaca_yard_sign')]);
    // Components are CatalogItems themselves: no parallel master.
    const ids = new Set(s.items.map((i) => i.id));
    expect(s.compositionLines.every((l) => ids.has(l.childItemId) && ids.has(l.parentItemId))).toBe(
      true,
    );
  });

  it('rejects self-reference, duplicates, cycles and depth > 2', () => {
    expect(validateComposition([line('1', 'a', 'a')]).map((i) => i.code)).toContain(
      'SELF_REFERENCE',
    );
    expect(
      validateComposition([line('1', 'a', 'b'), line('2', 'a', 'b')]).map((i) => i.code),
    ).toContain('DUPLICATE_PAIR');
    expect(
      validateComposition([line('1', 'a', 'b'), line('2', 'b', 'a')]).map((i) => i.code),
    ).toContain('CYCLE');
    expect(
      validateComposition([line('1', 'a', 'b'), line('2', 'b', 'c'), line('3', 'c', 'd')]).map(
        (i) => i.code,
      ),
    ).toContain('TOO_DEEP');
    expect(validateComposition([line('1', 'a', 'b', 0)]).map((i) => i.code)).toContain(
      'NON_POSITIVE_QUANTITY',
    );
  });
});

describe('market policy', () => {
  const s = sliceSnapshot();
  const usa = s.priceBooks.find((b) => b.id === REF.bookUSA) as PriceBook;
  const mx = s.priceBooks.find((b) => b.id === REF.bookMX) as PriceBook;
  const policy = (
    pricingMode: 'INHERIT' | 'DERIVED' | 'MANUAL' | 'QUOTE_ONLY',
    factorOverride: string | null = null,
  ) => ({
    itemId: 'i',
    marketId: REF.marketMX,
    pricingMode,
    factorOverride,
    isAvailable: true,
  });

  it('México derives by default with factor 0.70', () => {
    expect(effectiveMarketMode(mx, undefined)).toMatchObject({
      mode: 'DERIVED',
      factor: '0.70',
      factorSource: 'DEFAULT',
    });
    expect(effectiveMarketMode(mx, policy('INHERIT', '0.50'))).toMatchObject({
      mode: 'DERIVED',
      factor: '0.50',
      factorSource: 'ITEM',
    });
    expect(effectiveMarketMode(mx, policy('MANUAL')).mode).toBe('MANUAL');
    expect(effectiveMarketMode(mx, policy('QUOTE_ONLY')).mode).toBe('QUOTE_ONLY');
  });

  it('USA is the master; a DERIVED policy there is a configuration defect', () => {
    expect(effectiveMarketMode(usa, undefined).mode).toBe('MASTER');
    expect(effectiveMarketMode(usa, policy('MANUAL')).mode).toBe('MASTER');
    expect(effectiveMarketMode(usa, policy('DERIVED')).mode).toBe('MISCONFIGURED');
  });

  it('validity windows are half-open and use the given instant', () => {
    const t = new Date('2026-09-15T00:00:00Z');
    expect(isEffective('2026-09-15T00:00:00Z', null, t)).toBe(true);
    expect(isEffective('2026-09-15T00:00:00Z', '2026-09-15T00:00:00Z', t)).toBe(false);
    expect(isEffective('2026-09-16T00:00:00Z', null, t)).toBe(false);
  });
});
