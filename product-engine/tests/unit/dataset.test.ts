import { describe, expect, it } from 'vitest';
import { validateCatalogItem } from '@/domain/catalog';
import { validateComposition } from '@/domain/composition';
import { conditionSignature, validatePriceDefinition } from '@/domain/pricing-model';
import { devSliceDataset } from '../../data/dev-slice';
import { referenceDataset } from '../../data/reference';

describe('seed datasets (ADR-0013)', () => {
  const ref = referenceDataset();
  const slice = devSliceDataset();

  it('reference data: markets, price books, FX, confirmed methods, profiles', () => {
    expect(ref.markets.map((m) => m.code)).toEqual(['USA', 'MX']);
    expect(ref.priceBooks.map((b) => `${b.code}:${b.currency}:${b.mode}`)).toEqual([
      'USA_MASTER:USD:MASTER',
      'MX_DERIVED:MXN:DERIVED',
    ]);
    expect(ref.decorationMethods.map((m) => m.key)).toEqual([
      'DTF',
      'EMBROIDERY',
      'SCREEN_PRINTING',
      'HTV',
    ]);
    expect(ref.pricingParameters).toHaveLength(1);
    expect(ref.items).toHaveLength(0);
  });

  it('dev slice: 16 items, 14 authorized definitions = 131 tariffs (130 matrix breaks + 1 fixed), 2 rules', () => {
    expect(slice.items).toHaveLength(16);
    expect(slice.priceDefinitions).toHaveLength(14);
    const breaks = slice.priceDefinitions.reduce(
      (n, d) => n + ('breaks' in d ? d.breaks.length : 1),
      0,
    );
    expect(breaks).toBe(131);
    expect(slice.priceRules.map((r) => r.code)).toEqual(['size_2xl', 'size_3xl']);
    expect(slice.compositionLines).toHaveLength(3);
    expect(slice.items.filter((i) => i.status === 'ACTIVE')).toHaveLength(12);
    expect(slice.items.filter((i) => i.status === null)).toHaveLength(1);
  });

  it('every item and price definition passes domain invariants', () => {
    for (const i of slice.items) expect(validateCatalogItem(i)).toEqual([]);
    for (const d of slice.priceDefinitions) expect(validatePriceDefinition(d)).toEqual([]);
    expect(validateComposition(slice.compositionLines)).toEqual([]);
  });

  it('no two authorized definitions share item + book + component + conditions', () => {
    const keys = slice.priceDefinitions.map(
      (d) => `${d.itemId}|${d.priceBookId}|${d.component}|${conditionSignature(d.conditions)}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('historical prices exist only as evidence, never as definitions (ADR-0005)', () => {
    const evidence = slice.sourceReferences.filter(
      (r) => r.sourceKind === 'HISTORICAL_PRICE_EVIDENCE',
    );
    expect(evidence).toHaveLength(6);
    const priced = new Set(slice.priceDefinitions.map((d) => d.itemId));
    for (const e of evidence) expect(priced.has(e.entityId)).toBe(false);
  });

  it('contains no synthetic fixture data', () => {
    expect(JSON.stringify([ref, slice])).not.toMatch(/FIXTURE/i);
  });

  it('migration ids are provenance only, never identity', () => {
    for (const i of slice.items) {
      expect(i.publicCode).not.toMatch(/MIG|OWN/);
      expect(JSON.stringify(i)).not.toMatch(/MIG[12F]-|OWN-/);
    }
    expect(slice.sourceReferences.filter((r) => r.sourceKind === 'LEGACY_ID').length).toBe(16); // gorra keeps its merged MIGF-O-004
  });
});
