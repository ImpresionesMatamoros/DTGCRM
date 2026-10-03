import type { CatalogItem } from '../domain/catalog';
import { effectiveMarketMode, isEffective, type MarketCode } from '../domain/market';
import type { Presentation } from '../domain/publication';
import type { CatalogSnapshot } from '../domain/snapshot';
import { indexSnapshot } from '../domain/snapshot';
import type { ItemDetailResponse, ItemSummaryWire, PriceAvailability } from './crm-contracts';

/**
 * Pure projection of the domain snapshot into the CRM-safe wire shapes.
 * It reads ONLY the fields that are allowed to leave the Product Engine; internal
 * description, price definitions, provenance and unpublished items are not reachable.
 */

/** Only ACTIVE, non-merged items are ever offered to the CRM. */
export const isCrmVisible = (i: CatalogItem): boolean =>
  i.status === 'ACTIVE' && i.mergedIntoId === null;

export const normalizeText = (v: string): string =>
  v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

export interface CrmCatalogInput {
  snapshot: CatalogSnapshot;
  /** All presentations: only READY ones are emitted; any status may widen search matching. */
  presentations: readonly Presentation[];
  asOf: Date;
}

const readyFor = (input: CrmCatalogInput, itemId: string) =>
  input.presentations.filter((p) => p.itemId === itemId && p.status === 'READY');
/**
 * Search vocabulary: READY display names plus aliases of ANY status. Aliases are owner search
 * synonyms ("business card"); they only widen matching and are never emitted. DRAFT display
 * names are unfinished copy and are not searchable.
 */
function searchTerms(
  input: CrmCatalogInput,
  itemId: string,
): { display: string[]; aliases: string[] } {
  const own = input.presentations.filter((p) => p.itemId === itemId);
  return {
    display: own.filter((p) => p.status === 'READY').map((p) => normalizeText(p.displayName)),
    aliases: own.flatMap((p) => p.aliases.map(normalizeText)),
  };
}

function defaultPresentation(item: CatalogItem, input: CrmCatalogInput): Presentation | undefined {
  const own = readyFor(input, item.id);
  return (
    own.find((p) => p.locale === 'es' && p.isDefault) ??
    own.find((p) => p.isDefault) ??
    own.find((p) => p.locale === 'es') ??
    own[0]
  );
}

function hasAuthorizedPrice(input: CrmCatalogInput, itemId: string, bookId: string): boolean {
  return input.snapshot.priceDefinitions.some(
    (d) =>
      d.itemId === itemId &&
      d.priceBookId === bookId &&
      d.status === 'AUTHORIZED' &&
      isEffective(d.validFrom, d.validTo, input.asOf),
  );
}

type MarketInfo = ItemSummaryWire['markets'][number];

/** Indicative only. The pricing endpoint is the authority. */
export function marketInfo(
  input: CrmCatalogInput,
  item: CatalogItem,
  market: MarketCode,
): MarketInfo {
  const idx = indexSnapshot(input.snapshot);
  const m = idx.marketByCode.get(market);
  const book = m ? idx.bookByMarketId.get(m.id) : undefined;
  const none = (a: PriceAvailability, avail: boolean, cur: MarketInfo['currency']): MarketInfo => ({
    market,
    is_available: avail,
    price_availability: a,
    currency: cur,
  });
  if (!m || !book) return none('UNAVAILABLE', false, null);
  const policy = idx.policyByItemMarket.get(`${item.id}:${m.id}`);
  if (policy && !policy.isAvailable) return none('UNAVAILABLE', false, book.currency);
  const mode = effectiveMarketMode(book, policy);
  if (mode.mode === 'QUOTE_ONLY' || mode.mode === 'MISCONFIGURED') {
    return none('QUOTE_ONLY', true, book.currency);
  }
  const lookupBook = mode.mode === 'DERIVED' ? mode.priceBook.sourcePriceBookId : book.id;
  const ids = [
    item.id,
    ...input.snapshot.compositionLines
      .filter((l) => l.parentItemId === item.id && l.role === 'INCLUDED')
      .map((l) => l.childItemId),
  ];
  const priced = ids.some((id) => hasAuthorizedPrice(input, id, lookupBook));
  return none(priced ? 'AUTHORIZED_PRICES' : 'QUOTE_ONLY', true, book.currency);
}

const MARKETS: MarketCode[] = ['USA', 'MX'];
const marketsFor = (input: CrmCatalogInput, item: CatalogItem): MarketInfo[] =>
  MARKETS.map((m) => marketInfo(input, item, m));

export function toSummary(input: CrmCatalogInput, item: CatalogItem): ItemSummaryWire {
  const p = defaultPresentation(item, input);
  return {
    id: item.id,
    public_code: item.publicCode,
    canonical_name: item.canonicalName,
    display_name: p?.displayName ?? item.canonicalName,
    item_type: item.kind,
    sale_unit: item.saleUnit,
    description: p?.shortDescription ?? null,
    markets: marketsFor(input, item),
  };
}

export interface ListParams {
  q?: string | undefined;
  market?: MarketCode | undefined;
  limit: number;
  offset: number;
}

export function searchItems(input: CrmCatalogInput, params: ListParams) {
  const idx = indexSnapshot(input.snapshot);
  const tokens = params.q ? normalizeText(params.q).split(' ').filter(Boolean) : [];
  const scored: { item: CatalogItem; rank: number }[] = [];
  for (const item of input.snapshot.items) {
    if (!isCrmVisible(item)) continue;
    if (params.market) {
      const m = idx.marketByCode.get(params.market);
      const pol = m ? idx.policyByItemMarket.get(`${item.id}:${m.id}`) : undefined;
      if (!m || (pol && !pol.isAvailable)) continue;
    }
    const { display, aliases } = searchTerms(input, item.id);
    const code = normalizeText(item.publicCode);
    const name = normalizeText(item.canonicalName);
    let rank = 0;
    if (tokens.length) {
      const q = tokens.join(' ');
      const hay = [code, name, ...display, ...aliases];
      if (!tokens.every((t) => hay.some((h) => h.includes(t)))) continue;
      rank =
        code === q
          ? 0
          : code.startsWith(q)
            ? 1
            : name.startsWith(q) || display.some((d) => d.startsWith(q))
              ? 2
              : tokens.every((t) => name.includes(t))
                ? 3
                : 4;
    }
    scored.push({ item, rank });
  }
  scored.sort(
    (a, b) =>
      a.rank - b.rank ||
      a.item.canonicalName.localeCompare(b.item.canonicalName, 'es') ||
      a.item.publicCode.localeCompare(b.item.publicCode),
  );
  const total = scored.length;
  const slice = scored.slice(params.offset, params.offset + params.limit);
  const next = params.offset + slice.length;
  return {
    items: slice.map((s) => toSummary(input, s.item)),
    page: {
      limit: params.limit,
      offset: params.offset,
      total,
      next_offset: next < total ? next : null,
    },
  };
}

export function findVisibleItem(
  snapshot: CatalogSnapshot,
  idOrCode: string,
): CatalogItem | undefined {
  const key = idOrCode.trim();
  const found = snapshot.items.find(
    (i) => i.id === key.toLowerCase() || i.publicCode === key.toUpperCase(),
  );
  return found && isCrmVisible(found) ? found : undefined;
}

export function toDetail(
  input: CrmCatalogInput,
  item: CatalogItem,
): Omit<ItemDetailResponse, 'contract_version'> {
  const s = input.snapshot;
  const idx = indexSnapshot(s);
  const p = defaultPresentation(item, input);

  const options = (idx.itemOptionsByItem.get(item.id) ?? [])
    .flatMap((io) => {
      const def = idx.optionDefById.get(io.optionDefinitionId);
      return def && def.scope === 'ITEM' ? [{ io, def }] : [];
    })
    .sort((a, b) => a.io.sort - b.io.sort || a.def.key.localeCompare(b.def.key))
    .map(({ io, def }) => {
      const allowed = s.itemOptionValues
        .filter((v) => v.itemId === item.id && v.optionDefinitionId === def.id && v.isActive)
        .sort((a, b) => a.sort - b.sort);
      const values = allowed.flatMap((v) => {
        const ov = idx.optionValueById.get(v.optionValueId);
        return ov && ov.isActive ? [{ code: ov.code, label: ov.label, spec: ov.spec }] : [];
      });
      const dflt = io.defaultValueId ? idx.optionValueById.get(io.defaultValueId) : undefined;
      return {
        key: def.key,
        label: def.label,
        value_kind: def.valueKind,
        unit: def.unit,
        is_required: io.isRequired,
        selection_mode: io.selectionMode,
        is_distributable: io.isDistributable,
        default_value_code: dflt?.code ?? null,
        values,
      };
    });

  let decoration: Omit<ItemDetailResponse, 'contract_version'>['decoration'] = null;
  if (item.decorationPolicy !== 'NONE') {
    const methods = s.decorationCapabilities
      .filter((c) => c.itemId === item.id)
      .flatMap((c) => {
        const m = idx.methodById.get(c.methodId);
        if (!m || !m.isActive) return [];
        return [
          {
            key: m.key,
            name: m.name,
            allowed_placements: c.constraints?.allowedPlacements ?? null,
            max_print_size: c.constraints?.maxPrintSize ?? null,
          },
        ];
      })
      .sort((a, b) => a.key.localeCompare(b.key));
    if (methods.length) decoration = { policy: item.decorationPolicy, methods };
  }

  const components = s.compositionLines
    .filter((l) => l.parentItemId === item.id)
    .sort((a, b) => a.sort - b.sort)
    .flatMap((l) => {
      const child = idx.itemById.get(l.childItemId);
      if (!child || !isCrmVisible(child)) return [];
      return [
        {
          role: l.role,
          quantity: l.quantity,
          item: {
            id: child.id,
            public_code: child.publicCode,
            canonical_name: child.canonicalName,
          },
        },
      ];
    });

  return {
    item: {
      id: item.id,
      public_code: item.publicCode,
      canonical_name: item.canonicalName,
      item_type: item.kind,
      status: 'ACTIVE',
      description: p?.shortDescription ?? null,
      sale_unit: item.saleUnit,
      measurement: item.measurementSpec,
    },
    presentations: readyFor(input, item.id)
      .sort((a, b) => a.locale.localeCompare(b.locale) || Number(b.isDefault) - Number(a.isDefault))
      .map((x) => ({
        locale: x.locale,
        display_name: x.displayName,
        occasion: x.occasion,
        short_description: x.shortDescription,
        is_default: x.isDefault,
      })),
    options,
    decoration,
    components,
    markets: marketsFor(input, item),
  };
}
