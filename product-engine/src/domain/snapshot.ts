import type { CatalogItem, Uuid } from './catalog';
import type { CompositionLine } from './composition';
import type { DecorationCapability, DecorationMethod } from './decoration';
import type { ItemMarketPolicy, Market, MarketCode, PriceBook, PricingParameter } from './market';
import type { ItemOption, ItemOptionValue, OptionDefinition, OptionValue } from './options';
import type { PriceDefinition, PriceRule } from './pricing-model';

/**
 * Immutable, persistence-agnostic view of the catalog needed to validate
 * configurations and resolve prices. Built from the database (src/db) or in
 * memory (tests). The domain never knows where it came from.
 */
export interface CatalogSnapshot {
  revisions: { catalog: number; pricing: number };
  items: CatalogItem[];
  optionDefinitions: OptionDefinition[];
  optionValues: OptionValue[];
  itemOptions: ItemOption[];
  itemOptionValues: ItemOptionValue[];
  decorationMethods: DecorationMethod[];
  decorationCapabilities: DecorationCapability[];
  compositionLines: CompositionLine[];
  markets: Market[];
  priceBooks: PriceBook[];
  itemMarketPolicies: ItemMarketPolicy[];
  pricingParameters: PricingParameter[];
  priceDefinitions: PriceDefinition[];
  priceRules: PriceRule[];
}

/** Lookup indexes derived once per resolution. */
export interface SnapshotIndex {
  snapshot: CatalogSnapshot;
  itemById: Map<Uuid, CatalogItem>;
  optionDefById: Map<Uuid, OptionDefinition>;
  optionDefByKey: Map<string, OptionDefinition>;
  optionValueById: Map<Uuid, OptionValue>;
  /** key: `${optionDefinitionId}:${code}` */
  optionValueByCode: Map<string, OptionValue>;
  itemOptionsByItem: Map<Uuid, ItemOption[]>;
  /** key: `${itemId}:${optionDefinitionId}` → allowed value ids */
  allowedValues: Map<string, Set<Uuid>>;
  methodByKey: Map<string, DecorationMethod>;
  methodById: Map<Uuid, DecorationMethod>;
  capabilities: Set<string>;
  marketByCode: Map<MarketCode, Market>;
  bookByMarketId: Map<Uuid, PriceBook>;
  bookById: Map<Uuid, PriceBook>;
  policyByItemMarket: Map<string, ItemMarketPolicy>;
}

function group<T, K>(rows: readonly T[], key: (r: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
  return m;
}

export function indexSnapshot(s: CatalogSnapshot): SnapshotIndex {
  const allowedValues = new Map<string, Set<Uuid>>();
  for (const v of s.itemOptionValues) {
    if (!v.isActive) continue;
    const k = `${v.itemId}:${v.optionDefinitionId}`;
    allowedValues.set(k, (allowedValues.get(k) ?? new Set()).add(v.optionValueId));
  }
  return {
    snapshot: s,
    itemById: new Map(s.items.map((i) => [i.id, i])),
    optionDefById: new Map(s.optionDefinitions.map((d) => [d.id, d])),
    optionDefByKey: new Map(s.optionDefinitions.map((d) => [d.key, d])),
    optionValueById: new Map(s.optionValues.map((v) => [v.id, v])),
    optionValueByCode: new Map(s.optionValues.map((v) => [`${v.optionDefinitionId}:${v.code}`, v])),
    itemOptionsByItem: group(s.itemOptions, (o) => o.itemId),
    allowedValues,
    methodByKey: new Map(s.decorationMethods.map((m) => [m.key, m])),
    methodById: new Map(s.decorationMethods.map((m) => [m.id, m])),
    capabilities: new Set(s.decorationCapabilities.map((c) => `${c.itemId}:${c.methodId}`)),
    marketByCode: new Map(s.markets.map((m) => [m.code, m])),
    bookByMarketId: new Map(s.priceBooks.map((b) => [b.marketId, b])),
    bookById: new Map(s.priceBooks.map((b) => [b.id, b])),
    policyByItemMarket: new Map(s.itemMarketPolicies.map((p) => [`${p.itemId}:${p.marketId}`, p])),
  };
}
