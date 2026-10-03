import type { CatalogItem, Uuid } from './catalog';
import { optionalChildrenOf } from './composition';
import type { DecorationSelection } from './decoration';
import type { LengthUnit } from './catalog';
import type { MarketCode } from './market';
import type { SnapshotIndex } from './snapshot';

/** Runtime configuration (ConfiguredItem, STEP 02 §10) — a value object, never persisted here. */
export interface OptionSelection {
  optionKey: string;
  /** ENUM-like options: one code (SINGLE) or several (MULTI). */
  valueCodes?: string[];
  text?: string;
  boolean?: boolean;
}

export interface DistributionRow {
  selections: OptionSelection[];
  quantity: number;
}

export interface Measurements {
  width?: number;
  height?: number;
  length?: number;
  unit: LengthUnit;
}

export interface PriceRequest {
  catalogItemId: Uuid;
  market: MarketCode;
  /** In the item's sale unit; the quantity basis for volume pricing. */
  quantity: number;
  selections?: OptionSelection[];
  /** ADR-0001: rows vary only distributable options; quantities sum to `quantity`. */
  distribution?: DistributionRow[];
  measurements?: Measurements;
  decorations?: DecorationSelection[];
  optionalComponents?: { catalogItemId: Uuid; quantity?: number }[];
}

export type ConfigurationErrorCode =
  | 'UNKNOWN_ITEM'
  | 'ITEM_NOT_ACTIVE'
  | 'UNKNOWN_MARKET'
  | 'ITEM_NOT_AVAILABLE_IN_MARKET'
  | 'INVALID_QUANTITY'
  | 'OPTION_NOT_ALLOWED'
  | 'MISSING_OPTION'
  | 'INVALID_VALUE'
  | 'TOO_MANY_VALUES'
  | 'DUPLICATE_OPTION'
  | 'OPTION_NOT_DISTRIBUTABLE'
  | 'DISTRIBUTION_QTY_MISMATCH'
  | 'MEASUREMENT_REQUIRED'
  | 'MEASUREMENT_NOT_ALLOWED'
  | 'DECORATION_NOT_ALLOWED'
  | 'DECORATION_REQUIRED'
  | 'UNKNOWN_METHOD'
  | 'METHOD_NOT_COMPATIBLE'
  | 'OPTIONAL_COMPONENT_NOT_ALLOWED'
  | 'OPTIONAL_COMPONENT_NOT_ACTIVE';

export interface ConfigurationError {
  code: ConfigurationErrorCode;
  path: string;
  detail?: string;
}

/** Resolved selections of one quantity row: option definition id → selected value ids. */
export interface ResolvedRow {
  quantity: number;
  values: Map<Uuid, Set<Uuid>>;
}

export interface ValidConfiguration {
  item: CatalogItem;
  marketId: Uuid;
  quantity: number;
  /** Common selections (apply to the whole line). */
  common: Map<Uuid, Set<Uuid>>;
  /** One row per distribution row, or a single row = whole line. */
  rows: ResolvedRow[];
  decorationMethodIds: Uuid[];
  measurements: Measurements | null;
  optionalComponents: { item: CatalogItem; quantity: number }[];
}

export type ConfigurationResult =
  { ok: true; config: ValidConfiguration } | { ok: false; errors: ConfigurationError[] };

const isPositiveInt = (n: number) => Number.isInteger(n) && n > 0;

export function validateConfiguration(req: PriceRequest, ix: SnapshotIndex): ConfigurationResult {
  const errors: ConfigurationError[] = [];
  const err = (code: ConfigurationErrorCode, path: string, detail?: string) =>
    errors.push(detail === undefined ? { code, path } : { code, path, detail });

  const item = ix.itemById.get(req.catalogItemId);
  if (!item) return { ok: false, errors: [{ code: 'UNKNOWN_ITEM', path: 'catalogItemId' }] };
  if (item.status !== 'ACTIVE') {
    err('ITEM_NOT_ACTIVE', 'catalogItemId', item.status ?? 'UNSET');
  }
  const market = ix.marketByCode.get(req.market);
  if (!market) {
    err('UNKNOWN_MARKET', 'market');
  } else {
    const policy = ix.policyByItemMarket.get(`${item.id}:${market.id}`);
    if (policy && !policy.isAvailable) err('ITEM_NOT_AVAILABLE_IN_MARKET', 'market');
  }
  if (!isPositiveInt(req.quantity)) err('INVALID_QUANTITY', 'quantity');

  // ---- options
  const itemOptions = ix.itemOptionsByItem.get(item.id) ?? [];
  const optByDef = new Map(itemOptions.map((o) => [o.optionDefinitionId, o]));

  const resolveSelections = (
    sels: readonly OptionSelection[],
    path: string,
    distributableOnly: boolean,
  ): Map<Uuid, Set<Uuid>> => {
    const out = new Map<Uuid, Set<Uuid>>();
    sels.forEach((s, i) => {
      const p = `${path}[${i}]`;
      const def = ix.optionDefByKey.get(s.optionKey);
      const io = def ? optByDef.get(def.id) : undefined;
      if (!def || !io) return err('OPTION_NOT_ALLOWED', p, s.optionKey);
      if (out.has(def.id)) return err('DUPLICATE_OPTION', p, s.optionKey);
      if (distributableOnly && !io.isDistributable) {
        return err('OPTION_NOT_DISTRIBUTABLE', p, s.optionKey);
      }
      out.set(def.id, new Set()); // present, even if its values are invalid (no cascading MISSING)
      if (def.valueKind === 'TEXT') {
        if (typeof s.text !== 'string' || s.text.trim() === '')
          err('INVALID_VALUE', p, s.optionKey);
        return;
      }
      if (def.valueKind === 'BOOLEAN') {
        if (typeof s.boolean !== 'boolean') err('INVALID_VALUE', p, s.optionKey);
        return;
      }
      const codes = s.valueCodes ?? [];
      if (codes.length === 0) return err('INVALID_VALUE', p, s.optionKey);
      if (io.selectionMode === 'SINGLE' && codes.length > 1) {
        return err('TOO_MANY_VALUES', p, s.optionKey);
      }
      const allowed = ix.allowedValues.get(`${item.id}:${def.id}`) ?? new Set<Uuid>();
      const ids = new Set<Uuid>();
      for (const code of codes) {
        const v = ix.optionValueByCode.get(`${def.id}:${code}`);
        if (!v || !v.isActive || !allowed.has(v.id)) {
          err('INVALID_VALUE', p, `${s.optionKey}=${code}`);
          continue;
        }
        ids.add(v.id);
      }
      out.set(def.id, ids);
    });
    return out;
  };

  const common = resolveSelections(req.selections ?? [], 'selections', false);
  const rows: ResolvedRow[] = [];
  if (req.distribution && req.distribution.length > 0) {
    let sum = 0;
    req.distribution.forEach((row, i) => {
      if (!isPositiveInt(row.quantity)) err('INVALID_QUANTITY', `distribution[${i}].quantity`);
      sum += row.quantity;
      const values = resolveSelections(row.selections, `distribution[${i}].selections`, true);
      for (const defId of values.keys()) {
        if (common.has(defId)) {
          err('DUPLICATE_OPTION', `distribution[${i}]`, ix.optionDefById.get(defId)?.key);
        }
      }
      rows.push({ quantity: row.quantity, values: new Map([...common, ...values]) });
    });
    if (sum !== req.quantity)
      err('DISTRIBUTION_QTY_MISMATCH', 'distribution', `${sum}≠${req.quantity}`);
  } else {
    rows.push({ quantity: req.quantity, values: common });
  }
  for (const io of itemOptions.filter((o) => o.isRequired)) {
    const key = ix.optionDefById.get(io.optionDefinitionId)?.key ?? io.optionDefinitionId;
    rows.forEach((r, i) => {
      if (!r.values.has(io.optionDefinitionId)) {
        err('MISSING_OPTION', rows.length > 1 ? `distribution[${i}]` : 'selections', key);
      }
    });
  }

  // ---- measurements
  let measurements: Measurements | null = null;
  if (item.measurementSpec) {
    const m = req.measurements;
    const spec = item.measurementSpec;
    const ok =
      m !== undefined &&
      (spec.kind === 'AREA' ? (m.width ?? 0) > 0 && (m.height ?? 0) > 0 : (m.length ?? 0) > 0);
    if (!ok) err('MEASUREMENT_REQUIRED', 'measurements', spec.kind);
    else measurements = m;
  } else if (req.measurements) {
    err('MEASUREMENT_NOT_ALLOWED', 'measurements');
  }

  // ---- decoration ("blank" = no selections, ADR-0004)
  const decorations = [...(req.decorations ?? [])];
  const decorationMethodIds: Uuid[] = [];
  if (item.decorationPolicy === 'NONE' && decorations.length > 0) {
    err('DECORATION_NOT_ALLOWED', 'decorations');
    decorations.length = 0;
  }
  if (item.decorationPolicy === 'REQUIRED' && decorations.length === 0) {
    err('DECORATION_REQUIRED', 'decorations');
  }
  decorations.forEach((d, i) => {
    const method = ix.methodByKey.get(d.methodKey);
    if (!method || !method.isActive) return err('UNKNOWN_METHOD', `decorations[${i}]`, d.methodKey);
    if (!ix.capabilities.has(`${item.id}:${method.id}`)) {
      return err('METHOD_NOT_COMPATIBLE', `decorations[${i}]`, d.methodKey);
    }
    decorationMethodIds.push(method.id);
  });

  // ---- optional components
  const optionalLines = optionalChildrenOf(item.id, ix.snapshot.compositionLines);
  const optionalComponents: ValidConfiguration['optionalComponents'] = [];
  (req.optionalComponents ?? []).forEach((c, i) => {
    const line = optionalLines.find((l) => l.childItemId === c.catalogItemId);
    const child = ix.itemById.get(c.catalogItemId);
    if (!line || !child) return err('OPTIONAL_COMPONENT_NOT_ALLOWED', `optionalComponents[${i}]`);
    if (child.status !== 'ACTIVE') {
      return err('OPTIONAL_COMPONENT_NOT_ACTIVE', `optionalComponents[${i}]`, child.publicCode);
    }
    const qty = c.quantity ?? line.quantity * req.quantity;
    if (!isPositiveInt(qty)) return err('INVALID_QUANTITY', `optionalComponents[${i}].quantity`);
    optionalComponents.push({ item: child, quantity: qty });
  });

  if (errors.length > 0 || !market) return { ok: false, errors };
  return {
    ok: true,
    config: {
      item,
      marketId: market.id,
      quantity: req.quantity,
      common,
      rows,
      decorationMethodIds,
      measurements,
      optionalComponents,
    },
  };
}

/** Options that influence price for an item (derived, never stored). */
export function priceAffectingOptionIds(itemId: Uuid, ix: SnapshotIndex): Set<Uuid> {
  const ids = new Set<Uuid>();
  const s = ix.snapshot;
  for (const d of s.priceDefinitions.filter((d) => d.itemId === itemId)) {
    for (const c of d.conditions) if (c.kind === 'OPTION_VALUE') ids.add(c.optionDefinitionId);
  }
  for (const r of s.priceRules.filter((r) => r.itemIds.includes(itemId))) {
    for (const c of r.conditions) if (c.kind === 'OPTION_VALUE') ids.add(c.optionDefinitionId);
  }
  return ids;
}
