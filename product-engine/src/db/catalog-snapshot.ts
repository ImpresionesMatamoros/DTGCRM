import Decimal from 'decimal.js';
import type { CatalogItem, CatalogStatus, MeasurementSpec } from '@/domain/catalog';
import type { CompositionLine } from '@/domain/composition';
import type { DecorationCapability, DecorationMethod } from '@/domain/decoration';
import type { ItemMarketPolicy, Market, PriceBook, PricingParameter } from '@/domain/market';
import type { ItemOption, ItemOptionValue, OptionDefinition, OptionValue } from '@/domain/options';
import type { PriceCondition, PriceDefinition, PriceRule } from '@/domain/pricing-model';
import type { CatalogSnapshot } from '@/domain/snapshot';
import type { Queryable } from './client';

/**
 * Loads the persistence-agnostic CatalogSnapshot used by the pure domain.
 * Only AUTHORIZED/SUPERSEDED price data is loaded; drafts never reach pricing.
 */

type Row = Record<string, unknown>;

const iso = (v: unknown): string =>
  v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();
const isoOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : iso(v));
/** Canonical decimal string with at least `minDp` decimals ('0.7000' → '0.70'). */
export const canonicalDecimal = (v: unknown, minDp = 2): string => {
  const d = new Decimal(String(v));
  return d.toFixed(Math.max(d.decimalPlaces(), minDp));
};
const decOrNull = (v: unknown): string | null =>
  v === null || v === undefined ? null : canonicalDecimal(v);
const s = (v: unknown) => v as string;
const n = (v: unknown) => Number(v);

async function rows(db: Queryable, sql: string): Promise<Row[]> {
  return (await db.query(sql)).rows as Row[];
}

function mapCondition(r: Row): PriceCondition {
  return r.kind === 'OPTION_VALUE'
    ? {
        id: s(r.id),
        kind: 'OPTION_VALUE',
        optionDefinitionId: s(r.option_definition_id),
        optionValueId: s(r.option_value_id),
      }
    : { id: s(r.id), kind: 'DECORATION_METHOD', decorationMethodId: s(r.decoration_method_id) };
}

function toDefinition(r: Row, conditions: Row[], breaks: Row[]): PriceDefinition {
  const condFor = (field: 'price_definition_id' | 'price_rule_id', id: string) =>
    conditions.filter((c) => c[field] === id).map(mapCondition);

  const common = {
    id: s(r.id),
    itemId: s(r.item_id),
    priceBookId: s(r.price_book_id),
    component: r.component as PriceDefinition['component'],
    status: r.status as PriceDefinition['status'],
    validFrom: iso(r.valid_from),
    validTo: isoOrNull(r.valid_to),
    version: n(r.version),
    supersedesId: (r.supersedes_id as string | null) ?? null,
    authorizedBy: (r.authorized_by as string | null) ?? null,
    authorizedAt: isoOrNull(r.authorized_at),
    conditions: condFor('price_definition_id', s(r.id)),
  };
  switch (r.model) {
    case 'FIXED':
      return {
        ...common,
        model: 'FIXED',
        amount: canonicalDecimal(r.amount),
        maxQuantity: n(r.max_quantity),
      };
    case 'PER_UNIT':
      return {
        ...common,
        model: 'PER_UNIT',
        amount: canonicalDecimal(r.amount),
        minQuantity: r.min_quantity === null ? null : n(r.min_quantity),
        maxQuantity: r.max_quantity === null ? null : n(r.max_quantity),
      };
    case 'MEASURED':
      return {
        ...common,
        model: 'MEASURED',
        rate: canonicalDecimal(r.rate),
        rateUnit: r.rate_unit as 'SQ_FT' | 'LINEAR_FT',
        minCharge: decOrNull(r.min_charge),
      };
    default:
      return {
        ...common,
        model: r.model as 'EXACT_QUANTITY_MATRIX' | 'TIERED',
        breaks: breaks
          .filter((b) => b.price_definition_id === r.id)
          .map((b) => ({
            quantity: n(b.quantity),
            amount: canonicalDecimal(b.amount),
            amountBasis: b.amount_basis as 'TOTAL' | 'UNIT',
          })),
      };
  }
}

/** Any status (including DRAFT) by id. Used by the pricing admin; never by normal resolution. */
export async function loadPriceDefinitionsByIds(
  db: Queryable,
  ids: readonly string[],
): Promise<PriceDefinition[]> {
  if (ids.length === 0) return [];
  const defs = (
    await db.query('select * from price_definition where id = any($1) order by id', [ids])
  ).rows as Row[];
  const conds = (
    await db.query(
      'select * from price_condition where price_definition_id = any($1) order by id',
      [ids],
    )
  ).rows as Row[];
  const brks = (
    await db.query(
      'select * from price_break where price_definition_id = any($1) order by quantity',
      [ids],
    )
  ).rows as Row[];
  return defs.map((r) => toDefinition(r, conds, brks));
}

/** AUTHORIZED + SUPERSEDED definitions of one scope (what the resolver could match). */
export async function loadLiveDefinitionsInScope(
  db: Queryable,
  scope: { itemId: string; priceBookId: string; component: string },
): Promise<PriceDefinition[]> {
  const ids = (
    await db.query(
      `select id from price_definition where item_id = $1 and price_book_id = $2 and component = $3
          and status in ('AUTHORIZED', 'SUPERSEDED')`,
      [scope.itemId, scope.priceBookId, scope.component],
    )
  ).rows.map((r: Row) => r.id as string);
  return loadPriceDefinitionsByIds(db, ids);
}

export async function loadCatalogSnapshot(db: Queryable): Promise<CatalogSnapshot> {
  const [rev] = await rows(db, 'select catalog_revision, pricing_revision from v_revisions');

  const items: CatalogItem[] = (
    await rows(db, 'select * from catalog_item order by public_code')
  ).map((r) => {
    const base = {
      id: s(r.id),
      publicCode: s(r.public_code),
      canonicalName: s(r.canonical_name),
      status: (r.status as CatalogStatus | null) ?? null,
      saleUnit: (r.sale_unit as CatalogItem['saleUnit']) ?? null,
      measurementSpec: (r.measurement_spec as MeasurementSpec | null) ?? null,
      decorationPolicy: r.decoration_policy as CatalogItem['decorationPolicy'],
      descriptionInternal: (r.description_internal as string | null) ?? null,
      mergedIntoId: (r.merged_into_id as string | null) ?? null,
    };
    return r.kind === 'SERVICE'
      ? {
          ...base,
          kind: 'SERVICE',
          customerSuppliedItem: r.customer_supplied_item as
            'NOT_APPLICABLE' | 'ALLOWED' | 'REQUIRED',
        }
      : { ...base, kind: 'PRODUCT', customerSuppliedItem: 'NOT_APPLICABLE' };
  });

  const optionDefinitions = (await rows(db, 'select * from option_definition order by key')).map(
    (r) =>
      ({
        id: s(r.id),
        key: s(r.key),
        label: s(r.label),
        scope: r.scope,
        valueKind: r.value_kind,
        unit: r.unit ?? null,
      }) as OptionDefinition,
  );
  const optionValues: OptionValue[] = (
    await rows(db, 'select * from option_value order by option_definition_id, sort, code')
  ).map((r) => ({
    id: s(r.id),
    optionDefinitionId: s(r.option_definition_id),
    code: s(r.code),
    label: s(r.label),
    spec: (r.spec as OptionValue['spec']) ?? null,
    sort: n(r.sort),
    isActive: Boolean(r.is_active),
  }));
  const itemOptions: ItemOption[] = (
    await rows(db, 'select * from item_option order by item_id, sort')
  ).map((r) => ({
    itemId: s(r.item_id),
    optionDefinitionId: s(r.option_definition_id),
    isRequired: Boolean(r.is_required),
    selectionMode: r.selection_mode as ItemOption['selectionMode'],
    isDistributable: Boolean(r.is_distributable),
    sort: n(r.sort),
    defaultValueId: (r.default_value_id as string | null) ?? null,
  }));
  const itemOptionValues: ItemOptionValue[] = (
    await rows(db, 'select * from item_option_value order by item_id, option_definition_id, sort')
  ).map((r) => ({
    itemId: s(r.item_id),
    optionDefinitionId: s(r.option_definition_id),
    optionValueId: s(r.option_value_id),
    sort: n(r.sort),
    isActive: Boolean(r.is_active),
  }));
  const decorationMethods: DecorationMethod[] = (
    await rows(db, 'select * from decoration_method order by key')
  ).map((r) => ({
    id: s(r.id),
    key: s(r.key),
    name: s(r.name),
    isActive: Boolean(r.is_active),
  }));
  const decorationCapabilities: DecorationCapability[] = (
    await rows(db, 'select * from decoration_capability order by item_id, method_id')
  ).map((r) => ({
    itemId: s(r.item_id),
    methodId: s(r.method_id),
    constraints: (r.constraints as DecorationCapability['constraints']) ?? null,
    note: (r.note as string | null) ?? null,
  }));
  const compositionLines: CompositionLine[] = (
    await rows(db, 'select * from composition_line order by parent_item_id, sort')
  ).map((r) => ({
    id: s(r.id),
    parentItemId: s(r.parent_item_id),
    childItemId: s(r.child_item_id),
    quantity: n(r.quantity),
    role: r.role as CompositionLine['role'],
    sort: n(r.sort),
    note: (r.note as string | null) ?? null,
  }));
  const markets: Market[] = (await rows(db, 'select * from market order by code')).map((r) => ({
    id: s(r.id),
    code: r.code as Market['code'],
    name: s(r.name),
    defaultCurrency: r.default_currency as Market['defaultCurrency'],
  }));
  const priceBooks: PriceBook[] = (await rows(db, 'select * from price_book order by code')).map(
    (r) =>
      r.mode === 'DERIVED'
        ? {
            id: s(r.id),
            code: s(r.code),
            marketId: s(r.market_id),
            currency: r.currency as PriceBook['currency'],
            mode: 'DERIVED',
            sourcePriceBookId: s(r.source_price_book_id),
            defaultFactor: canonicalDecimal(r.default_factor),
          }
        : {
            id: s(r.id),
            code: s(r.code),
            marketId: s(r.market_id),
            currency: r.currency as PriceBook['currency'],
            mode: 'MASTER',
            sourcePriceBookId: null,
            defaultFactor: null,
          },
  );
  const itemMarketPolicies: ItemMarketPolicy[] = (
    await rows(db, 'select * from item_market_policy order by item_id, market_id')
  ).map((r) => ({
    itemId: s(r.item_id),
    marketId: s(r.market_id),
    pricingMode: r.pricing_mode as ItemMarketPolicy['pricingMode'],
    factorOverride: decOrNull(r.factor_override),
    isAvailable: Boolean(r.is_available),
  }));
  const pricingParameters: PricingParameter[] = (
    await rows(db, 'select * from pricing_parameter order by key, valid_from')
  ).map((r) => ({
    id: s(r.id),
    key: s(r.key),
    value: canonicalDecimal(r.value),
    validFrom: iso(r.valid_from),
    validTo: isoOrNull(r.valid_to),
  }));

  const conditions = await rows(db, 'select * from price_condition order by id');
  const condFor = (field: 'price_definition_id' | 'price_rule_id', id: string) =>
    conditions.filter((c) => c[field] === id).map(mapCondition);
  const breaks = await rows(db, 'select * from price_break order by price_definition_id, quantity');

  const priceDefinitions: PriceDefinition[] = (
    await rows(
      db,
      "select * from price_definition where status in ('AUTHORIZED', 'SUPERSEDED') order by item_id, id",
    )
  ).map((r) => toDefinition(r, conditions, breaks));

  const assignments = await rows(db, 'select * from price_rule_assignment order by item_id');
  const priceRules: PriceRule[] = (
    await rows(
      db,
      "select * from price_rule where status in ('AUTHORIZED', 'SUPERSEDED') order by code, version",
    )
  ).map((r) => ({
    id: s(r.id),
    priceBookId: s(r.price_book_id),
    code: s(r.code),
    label: s(r.label),
    kind: r.kind as PriceRule['kind'],
    amount: decOrNull(r.amount),
    exclusivityKey: (r.exclusivity_key as string | null) ?? null,
    status: r.status as PriceRule['status'],
    validFrom: iso(r.valid_from),
    validTo: isoOrNull(r.valid_to),
    version: n(r.version),
    supersedesId: (r.supersedes_id as string | null) ?? null,
    authorizedBy: (r.authorized_by as string | null) ?? null,
    authorizedAt: isoOrNull(r.authorized_at),
    conditions: condFor('price_rule_id', s(r.id)),
    itemIds: assignments.filter((a) => a.price_rule_id === r.id).map((a) => s(a.item_id)),
  }));

  return {
    revisions: { catalog: n(rev?.catalog_revision ?? 0), pricing: n(rev?.pricing_revision ?? 0) },
    items,
    optionDefinitions,
    optionValues,
    itemOptions,
    itemOptionValues,
    decorationMethods,
    decorationCapabilities,
    compositionLines,
    markets,
    priceBooks,
    itemMarketPolicies,
    pricingParameters,
    priceDefinitions,
    priceRules,
  };
}
