import type { CatalogItem, CatalogItemCategory, Category } from '../src/domain/catalog';
import type { CompositionLine } from '../src/domain/composition';
import type { DecorationCapability, DecorationMethod } from '../src/domain/decoration';
import type { ItemMarketPolicy, Market, PriceBook, PricingParameter } from '../src/domain/market';
import type {
  ItemOption,
  ItemOptionValue,
  OptionDefinition,
  OptionValue,
} from '../src/domain/options';
import type { PriceDefinition, PriceRule } from '../src/domain/pricing-model';
import type { DecisionRecord, SourceReference } from '../src/domain/provenance';
import type {
  Presentation,
  PublicationAssignment,
  PublicationProfile,
} from '../src/domain/publication';
import type { CatalogSnapshot } from '../src/domain/snapshot';

/** One dataset shape for both seed layers (reference, dev slice). */
export interface SeedDataset {
  markets: Market[];
  priceBooks: PriceBook[];
  pricingParameters: PricingParameter[];
  decorationMethods: DecorationMethod[];
  publicationProfiles: PublicationProfile[];
  categories: Category[];
  itemCategories: CatalogItemCategory[];
  optionDefinitions: OptionDefinition[];
  optionValues: OptionValue[];
  items: CatalogItem[];
  itemOptions: ItemOption[];
  itemOptionValues: ItemOptionValue[];
  decorationCapabilities: DecorationCapability[];
  compositionLines: CompositionLine[];
  itemMarketPolicies: ItemMarketPolicy[];
  priceDefinitions: PriceDefinition[];
  priceRules: PriceRule[];
  presentations: Presentation[];
  publicationAssignments: PublicationAssignment[];
  sourceReferences: SourceReference[];
  decisionRecords: DecisionRecord[];
}

export function emptyDataset(): SeedDataset {
  return {
    markets: [],
    priceBooks: [],
    pricingParameters: [],
    decorationMethods: [],
    publicationProfiles: [],
    categories: [],
    itemCategories: [],
    optionDefinitions: [],
    optionValues: [],
    items: [],
    itemOptions: [],
    itemOptionValues: [],
    decorationCapabilities: [],
    compositionLines: [],
    itemMarketPolicies: [],
    priceDefinitions: [],
    priceRules: [],
    presentations: [],
    publicationAssignments: [],
    sourceReferences: [],
    decisionRecords: [],
  };
}

export function mergeDatasets(...parts: SeedDataset[]): SeedDataset {
  const out = emptyDataset();
  for (const p of parts) {
    for (const k of Object.keys(out) as (keyof SeedDataset)[]) {
      (out[k] as unknown[]).push(...(p[k] as unknown[]));
    }
  }
  return out;
}

/** In-memory snapshot equivalent to what src/db loads after seeding (revisions excluded). */
export function datasetToSnapshot(d: SeedDataset): CatalogSnapshot {
  return {
    revisions: { catalog: 0, pricing: 0 },
    items: d.items,
    optionDefinitions: d.optionDefinitions,
    optionValues: d.optionValues,
    itemOptions: d.itemOptions,
    itemOptionValues: d.itemOptionValues,
    decorationMethods: d.decorationMethods,
    decorationCapabilities: d.decorationCapabilities,
    compositionLines: d.compositionLines,
    markets: d.markets,
    priceBooks: d.priceBooks,
    itemMarketPolicies: d.itemMarketPolicies,
    pricingParameters: d.pricingParameters,
    priceDefinitions: d.priceDefinitions,
    priceRules: d.priceRules,
  };
}
