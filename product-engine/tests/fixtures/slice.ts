import {
  devSliceDataset,
  itemId,
  optionDefId,
  optionValueId,
  type ItemKey,
} from '../../data/dev-slice';
import { seedId } from '../../data/ids';
import { REF, referenceDataset } from '../../data/reference';
import { datasetToSnapshot, mergeDatasets } from '../../data/types';
import type { PriceRequest } from '@/domain/configuration';
import type { PriceDefinition, PriceRule } from '@/domain/pricing-model';
import type { CatalogSnapshot } from '@/domain/snapshot';

export { itemId, optionDefId, optionValueId, REF };
export type { ItemKey };

/** Fixed instant for deterministic tests (ADR-0009). */
export const AS_OF = new Date('2026-10-01T12:00:00Z');

export function sliceSnapshot(): CatalogSnapshot {
  return structuredClone(datasetToSnapshot(mergeDatasets(referenceDataset(), devSliceDataset())));
}

export const req = (key: ItemKey, extra: Omit<PriceRequest, 'catalogItemId'>): PriceRequest => ({
  catalogItemId: itemId(key),
  ...extra,
});

// ---------------------------------------------------------------------------
// FIXTURES — synthetic data used ONLY in tests (ADR-0013). Never seeded.
// ---------------------------------------------------------------------------

const fixtureId = (name: string) => seedId(`FIXTURE:${name}`);
const FIXTURE_FROM = '2026-01-01T00:00:00Z';
const authorized = {
  status: 'AUTHORIZED' as const,
  validFrom: FIXTURE_FROM,
  validTo: null,
  version: 1,
  supersedesId: null,
  authorizedBy: 'FIXTURE',
  authorizedAt: FIXTURE_FROM,
};

export function fixtureBaseCamiseta(s: CatalogSnapshot, unitAmount = '10.00'): PriceDefinition {
  const def: PriceDefinition = {
    ...authorized,
    id: fixtureId('base_camiseta'),
    itemId: itemId('camiseta_algodon'),
    priceBookId: REF.bookUSA,
    component: 'ITEM',
    conditions: [],
    model: 'PER_UNIT',
    amount: unitAmount,
    minQuantity: null,
    maxQuantity: null,
  };
  s.priceDefinitions.push(def);
  return def;
}

export function fixtureDecorationPrice(s: CatalogSnapshot, amount: string): PriceDefinition {
  const def: PriceDefinition = {
    ...authorized,
    id: fixtureId('dtf_camiseta'),
    itemId: itemId('camiseta_algodon'),
    priceBookId: REF.bookUSA,
    component: 'DECORATION',
    conditions: [
      {
        id: fixtureId('dtf_camiseta:cond'),
        kind: 'DECORATION_METHOD',
        decorationMethodId: REF.method.DTF,
      },
    ],
    model: 'PER_UNIT',
    amount,
    minQuantity: null,
    maxQuantity: null,
  };
  s.priceDefinitions.push(def);
  return def;
}

/** Manual México price for Premium 2 caras × 500 only (FIXTURE amount). */
export function fixtureManualMx(s: CatalogSnapshot, amount = '1500.00'): void {
  s.itemMarketPolicies.push({
    itemId: itemId('tarjeta_premium'),
    marketId: REF.marketMX,
    pricingMode: 'MANUAL',
    factorOverride: null,
    isAvailable: true,
  });
  s.priceDefinitions.push({
    ...authorized,
    id: fixtureId('mx_manual_premium'),
    itemId: itemId('tarjeta_premium'),
    priceBookId: REF.bookMX,
    component: 'ITEM',
    conditions: [
      {
        id: fixtureId('mx_manual_premium:cond'),
        kind: 'OPTION_VALUE',
        optionDefinitionId: optionDefId('caras'),
        optionValueId: optionValueId('caras', '2'),
      },
    ],
    model: 'EXACT_QUANTITY_MATRIX',
    breaks: [{ quantity: 500, amount, amountBasis: 'TOTAL' }],
  });
}

export function fixtureFactorOverride(s: CatalogSnapshot, key: ItemKey, factor: string): void {
  s.itemMarketPolicies.push({
    itemId: itemId(key),
    marketId: REF.marketMX,
    pricingMode: 'DERIVED',
    factorOverride: factor,
    isAvailable: true,
  });
}

export function fixtureConflictingSizeRule(s: CatalogSnapshot): PriceRule {
  const r: PriceRule = {
    ...authorized,
    id: fixtureId('rule_3xl_b'),
    priceBookId: REF.bookUSA,
    code: 'FIXTURE_size_3xl_b',
    label: 'FIXTURE recargo 3XL alterno',
    kind: 'ADD_PER_UNIT',
    amount: '4.00',
    exclusivityKey: 'size_surcharge',
    conditions: [
      {
        id: fixtureId('rule_3xl_b:cond'),
        kind: 'OPTION_VALUE',
        optionDefinitionId: optionDefId('talla'),
        optionValueId: optionValueId('talla', '3XL'),
      },
    ],
    itemIds: [itemId('camiseta_algodon')],
  };
  s.priceRules.push(r);
  return r;
}

/**
 * PATCH 4 scenario: yard sign with a (FIXTURE) USD price and an ACTIVE stake with
 * its own (FIXTURE) USD price and its own México policy (factor 0.50).
 */
export function fixtureYardSignWithStake(s: CatalogSnapshot): void {
  const stake = s.items.find((i) => i.id === itemId('estaca_yard_sign'));
  if (!stake) throw new Error('stake missing');
  stake.status = 'ACTIVE';
  stake.saleUnit = 'PIECE';
  s.priceDefinitions.push(
    {
      ...authorized,
      id: fixtureId('yard_sign_price'),
      itemId: itemId('yard_sign'),
      priceBookId: REF.bookUSA,
      component: 'ITEM',
      conditions: [],
      model: 'PER_UNIT',
      amount: '20.00',
      minQuantity: null,
      maxQuantity: null,
    },
    {
      ...authorized,
      id: fixtureId('stake_price'),
      itemId: itemId('estaca_yard_sign'),
      priceBookId: REF.bookUSA,
      component: 'ITEM',
      conditions: [],
      model: 'PER_UNIT',
      amount: '2.00',
      minQuantity: null,
      maxQuantity: null,
    },
  );
  fixtureFactorOverride(s, 'estaca_yard_sign', '0.50');
}
