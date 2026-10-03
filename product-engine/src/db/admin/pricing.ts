import { z } from 'zod';
import type { PriceRequest } from '@/domain/configuration';
import { resolvePrice } from '@/pricing/resolve';
import { overlayDraft } from '@/pricing/overlay';
import type { BreakdownLine, PriceResult } from '@/pricing/result';
import { formatAmount } from '@/shared/money';
import type { Queryable } from '../client';
import { loadCatalogSnapshot, loadPriceDefinitionsByIds } from '../catalog-snapshot';
import { traceEntity, type CandidateTrace } from '../import/provenance';

/**
 * Pricing viewer (STEP 06 §25–28). Read-only. Every price and every Mexico
 * figure shown comes from the database or from `resolvePrice` (the pure
 * pricing domain) — nothing is recalculated in the UI. Historical prices are
 * returned separately and are never part of a price definition.
 */

type Row = Record<string, unknown>;
const iso = (v: unknown) =>
  v === null || v === undefined ? null : new Date(String(v)).toISOString();

export interface PricedItemRow {
  id: string;
  publicCode: string;
  name: string;
  status: string | null;
  saleUnit: string | null;
  definitions: number;
  authorized: number;
  draft: number;
  historical: number;
}

export async function listPricedItems(
  db: Queryable,
  f: { q?: string; withPrices?: boolean },
  page = 1,
  pageSize = 50,
): Promise<{ rows: PricedItemRow[]; total: number; page: number; pageSize: number }> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.q?.trim()) {
    params.push(`%${f.q.trim()}%`);
    where.push(`(i.canonical_name ilike $1 or i.public_code ilike $1)`);
  }
  if (f.withPrices) where.push('exists (select 1 from price_definition d where d.item_id = i.id)');
  const sql = where.length ? `where ${where.join(' and ')}` : '';
  const total = (await db.query(`select count(*)::int as n from catalog_item i ${sql}`, params))
    .rows[0].n as number;
  const size = Math.min(Math.max(pageSize, 1), 200);
  const current = Math.max(page, 1);
  const rows = (
    await db.query(
      `select i.id, i.public_code, i.canonical_name, i.status, i.sale_unit,
              (select count(*)::int from price_definition d where d.item_id = i.id) as definitions,
              (select count(*)::int from price_definition d where d.item_id = i.id and d.status = 'AUTHORIZED') as authorized,
              (select count(*)::int from price_definition d where d.item_id = i.id and d.status = 'DRAFT') as draft,
              (select count(*)::int from source_reference s where s.entity_type = 'catalog_item' and s.entity_id = i.id
                  and s.source_kind = 'HISTORICAL_PRICE_EVIDENCE') as historical
         from catalog_item i ${sql} order by i.public_code limit ${size} offset ${(current - 1) * size}`,
      params,
    )
  ).rows.map((r: Row) => ({
    id: r.id as string,
    publicCode: r.public_code as string,
    name: r.canonical_name as string,
    status: (r.status as string | null) ?? null,
    saleUnit: (r.sale_unit as string | null) ?? null,
    definitions: r.definitions as number,
    authorized: r.authorized as number,
    draft: r.draft as number,
    historical: r.historical as number,
  }));
  return { rows, total, page: current, pageSize: size };
}

export interface ConditionView {
  kind: string;
  optionKey: string | null;
  optionLabel: string | null;
  valueCode: string | null;
  valueLabel: string | null;
  methodKey: string | null;
}

export interface DefinitionView {
  id: string;
  book: string;
  market: string;
  currency: string;
  component: string;
  model: string;
  status: string;
  validFrom: string;
  validTo: string | null;
  version: number;
  authorizedBy: string | null;
  authorizedAt: string | null;
  amount: string | null;
  rate: string | null;
  rateUnit: string | null;
  minCharge: string | null;
  minQuantity: number | null;
  maxQuantity: number | null;
  breaks: { quantity: number; amount: string; amountBasis: string }[];
  conditions: ConditionView[];
  provenance: { sourceKind: string; locator: string; payload: unknown }[];
  importTraces: CandidateTrace[];
  /** Mexico derivation of this USA definition, one row per quantity, through resolvePrice. */
  mexico: MexicoRow[];
}

export interface MexicoRow {
  quantity: number;
  status: PriceResult['status'];
  /** RESOLVED: the domain's derivation; otherwise the reason. */
  usaTotal: string | null;
  factor: string | null;
  factorSource: string | null;
  fx: string | null;
  fxParameterId: string | null;
  rounding: string | null;
  mxTotal: string | null;
  basis: string | null;
  reason: string | null;
}

export interface ItemPricing {
  asOf: string;
  item: {
    id: string;
    publicCode: string;
    name: string;
    status: string | null;
    saleUnit: string | null;
    kind: string;
  };
  definitions: DefinitionView[];
  rules: {
    id: string;
    book: string;
    code: string;
    label: string;
    kind: string;
    amount: string | null;
    status: string;
    validFrom: string;
    conditions: ConditionView[];
  }[];
  market: {
    books: {
      code: string;
      market: string;
      currency: string;
      mode: string;
      defaultFactor: string | null;
      source: string | null;
    }[];
    policies: {
      market: string;
      pricingMode: string;
      factorOverride: string | null;
      isAvailable: boolean;
    }[];
    fx: { id: string; value: string; validFrom: string; validTo: string | null } | null;
  };
  historical: {
    origin: 'DOMAIN' | 'STAGING';
    locator: string;
    amount: string | null;
    currency: string | null;
    condition: string | null;
    note: string | null;
  }[];
  options: {
    key: string;
    label: string;
    valueKind: string;
    isRequired: boolean;
    isDistributable: boolean;
    values: { code: string; label: string }[];
  }[];
  decorationMethods: { key: string; name: string }[];
  hasMeasurement: boolean;
}

export async function conditionsFor(
  db: Queryable,
  column: 'price_definition_id' | 'price_rule_id',
  id: string,
) {
  return (
    await db.query(
      `select pc.kind, d.key as option_key, d.label as option_label, v.code as value_code, v.label as value_label,
              m.key as method_key
         from price_condition pc
         left join option_definition d on d.id = pc.option_definition_id
         left join option_value v on v.id = pc.option_value_id
         left join decoration_method m on m.id = pc.decoration_method_id
        where pc.${column} = $1 order by d.key, v.code, m.key`,
      [id],
    )
  ).rows.map((c: Row) => ({
    kind: c.kind as string,
    optionKey: (c.option_key as string | null) ?? null,
    optionLabel: (c.option_label as string | null) ?? null,
    valueCode: (c.value_code as string | null) ?? null,
    valueLabel: (c.value_label as string | null) ?? null,
    methodKey: (c.method_key as string | null) ?? null,
  }));
}

function mexicoRow(quantity: number, r: PriceResult): MexicoRow {
  if (r.status === 'RESOLVED') {
    const d = r.derivation;
    return {
      quantity,
      status: r.status,
      usaTotal: d ? formatAmount(d.sourceTotal) : null,
      factor: d?.factor ?? null,
      factorSource: d?.factorSource ?? null,
      fx: d?.fx ?? null,
      fxParameterId: d?.fxParameterId ?? null,
      rounding: d?.rounding ?? null,
      mxTotal: formatAmount(r.total),
      basis: r.policy?.basis ?? null,
      reason: d ? null : `basis ${r.policy?.basis ?? '?'} (no derivation)`,
    };
  }
  const reason =
    r.status === 'QUOTE_ONLY'
      ? `${r.reasonCode}${r.detail ? `: ${r.detail}` : ''}`
      : r.status === 'INVALID'
        ? r.errors.map((e) => `${e.code} ${e.path}`).join('; ')
        : `${r.reasonCode}${r.detail ? `: ${r.detail}` : ''}`;
  return {
    quantity,
    status: r.status,
    usaTotal: null,
    factor: null,
    factorSource: null,
    fx: null,
    fxParameterId: null,
    rounding: null,
    mxTotal: null,
    basis: r.policy?.basis ?? null,
    reason,
  };
}

export async function itemPricing(
  db: Queryable,
  itemId: string,
  asOf: Date,
): Promise<ItemPricing | null> {
  if (!z.uuid().safeParse(itemId).success) return null;
  const i = (await db.query('select * from catalog_item where id = $1', [itemId])).rows[0] as
    Row | undefined;
  if (!i) return null;
  const snapshot = await loadCatalogSnapshot(db);

  const defs = (
    await db.query(
      `select d.*, b.code as book, b.currency, m.code as market
         from price_definition d join price_book b on b.id = d.price_book_id join market m on m.id = b.market_id
        where d.item_id = $1 order by b.code, d.status, d.model, d.valid_from, d.id`,
      [itemId],
    )
  ).rows as Row[];
  const definitions: DefinitionView[] = [];
  for (const d of defs) {
    const breaks = (
      await db.query(
        'select quantity, amount, amount_basis from price_break where price_definition_id = $1 order by quantity',
        [d.id],
      )
    ).rows.map((b: Row) => ({
      quantity: Number(b.quantity),
      amount: Number(b.amount).toFixed(2),
      amountBasis: b.amount_basis as string,
    }));
    const conditions = await conditionsFor(db, 'price_definition_id', d.id as string);
    const provenance = (
      await db.query(
        `select source_kind, source_locator, payload from source_reference
          where entity_type = 'price_definition' and entity_id = $1 order by source_kind, source_locator`,
        [d.id],
      )
    ).rows.map((s: Row) => ({
      sourceKind: s.source_kind as string,
      locator: s.source_locator as string,
      payload: s.payload ?? null,
    }));

    // Mexico: resolve the same configuration in MX through the pricing domain.
    let mexico: MexicoRow[] = [];
    if (d.market === 'USA' && d.status === 'AUTHORIZED' && d.component === 'ITEM') {
      const selections = new Map<string, string[]>();
      for (const c of conditions) {
        if (c.kind !== 'OPTION_VALUE' || !c.optionKey || !c.valueCode) continue;
        // IN within one option: the first value is enough to hit the definition.
        if (!selections.has(c.optionKey)) selections.set(c.optionKey, [c.valueCode]);
      }
      const quantities =
        d.model === 'FIXED' ? [Number(d.max_quantity)] : breaks.map((b) => b.quantity);
      mexico = quantities.map((quantity) => {
        const request: PriceRequest = {
          catalogItemId: itemId,
          market: 'MX',
          quantity,
          selections: [...selections].map(([optionKey, valueCodes]) => ({ optionKey, valueCodes })),
        };
        return mexicoRow(quantity, resolvePrice(request, snapshot, asOf));
      });
    }

    definitions.push({
      id: d.id as string,
      book: d.book as string,
      market: d.market as string,
      currency: d.currency as string,
      component: d.component as string,
      model: d.model as string,
      status: d.status as string,
      validFrom: iso(d.valid_from)!,
      validTo: iso(d.valid_to),
      version: Number(d.version),
      authorizedBy: (d.authorized_by as string | null) ?? null,
      authorizedAt: iso(d.authorized_at),
      amount: d.amount === null ? null : Number(d.amount).toFixed(2),
      rate: (d.rate as string | null) ?? null,
      rateUnit: (d.rate_unit as string | null) ?? null,
      minCharge: (d.min_charge as string | null) ?? null,
      minQuantity: d.min_quantity === null ? null : Number(d.min_quantity),
      maxQuantity: d.max_quantity === null ? null : Number(d.max_quantity),
      breaks,
      conditions,
      provenance,
      importTraces: await traceEntity(db, 'price_definition', d.id as string),
      mexico,
    });
  }

  const rules = [];
  for (const r of (
    await db.query(
      `select r.*, b.code as book from price_rule r join price_rule_assignment a on a.price_rule_id = r.id
         join price_book b on b.id = r.price_book_id where a.item_id = $1 order by r.code, b.code, r.version`,
      [itemId],
    )
  ).rows as Row[]) {
    rules.push({
      id: r.id as string,
      book: r.book as string,
      code: r.code as string,
      label: r.label as string,
      kind: r.kind as string,
      amount: r.amount === null ? null : Number(r.amount).toFixed(2),
      status: r.status as string,
      validFrom: iso(r.valid_from)!,
      conditions: await conditionsFor(db, 'price_rule_id', r.id as string),
    });
  }

  const books = (
    await db.query(
      `select b.code, m.code as market, b.currency, b.mode, b.default_factor, s.code as source
         from price_book b join market m on m.id = b.market_id left join price_book s on s.id = b.source_price_book_id
        order by m.code desc`,
    )
  ).rows.map((b: Row) => ({
    code: b.code as string,
    market: b.market as string,
    currency: b.currency as string,
    mode: b.mode as string,
    defaultFactor: b.default_factor === null ? null : Number(b.default_factor).toFixed(2),
    source: (b.source as string | null) ?? null,
  }));
  const policies = (
    await db.query(
      `select m.code, p.pricing_mode, p.factor_override, p.is_available from item_market_policy p
         join market m on m.id = p.market_id where p.item_id = $1 order by m.code`,
      [itemId],
    )
  ).rows.map((p: Row) => ({
    market: p.code as string,
    pricingMode: p.pricing_mode as string,
    factorOverride: p.factor_override === null ? null : String(p.factor_override),
    isAvailable: p.is_available as boolean,
  }));
  const fxRow = (
    await db.query(
      `select id, value, valid_from, valid_to from pricing_parameter
        where key = 'usd_mxn_fx' and valid_from <= $1 and (valid_to is null or valid_to > $1)
        order by valid_from desc limit 1`,
      [asOf.toISOString()],
    )
  ).rows[0] as Row | undefined;

  const legacyIds = (
    await db.query(
      `select source_locator from source_reference where entity_type = 'catalog_item' and entity_id = $1
          and source_kind = 'LEGACY_ID'`,
      [itemId],
    )
  ).rows.map((r: Row) => r.source_locator as string);
  const historical = [
    ...(
      await db.query(
        `select source_locator, payload from source_reference
          where entity_type = 'catalog_item' and entity_id = $1 and source_kind = 'HISTORICAL_PRICE_EVIDENCE'
          order by source_locator`,
        [itemId],
      )
    ).rows.map((h: Row) => {
      const p = (h.payload as Row | null) ?? {};
      return {
        origin: 'DOMAIN' as const,
        locator: h.source_locator as string,
        amount: (p.amount as string | undefined) ?? null,
        currency: (p.currency as string | undefined) ?? null,
        condition:
          (p.condition as string | undefined) ??
          (Array.isArray(p.conditions) ? JSON.stringify(p.conditions) : null),
        note: (p.status as string | undefined) ?? null,
      };
    }),
    ...(legacyIds.length
      ? (
          await db.query(
            `select r.id, r.evidence, b.source_file, r.source_cells -> 0 ->> 'source_sheet' as sheet,
                    r.source_cells -> 0 ->> 'source_row' as row
               from import_record r join import_batch b on b.id = r.batch_id
              where r.evidence_class = 'HISTORICAL_PRICE' and r.evidence ->> 'item_legacy' = any($1)
              order by b.source_file, r.record_key`,
            [legacyIds],
          )
        ).rows.map((h: Row) => {
          const e = h.evidence as {
            money?: { amount?: string; currency?: string };
            conditions?: unknown;
            notes?: string;
          };
          return {
            origin: 'STAGING' as const,
            locator: `${String(h.source_file)}!${String(h.sheet)}!fila ${String(h.row)}`,
            amount: e.money?.amount ?? null,
            currency: e.money?.currency ?? null,
            condition: e.conditions ? JSON.stringify(e.conditions) : null,
            note: 'staging · evidencia histórica',
          };
        })
      : []),
  ];

  const options = (
    await db.query(
      `select d.key, d.label, d.value_kind, io.is_required, io.is_distributable,
              coalesce((select jsonb_agg(jsonb_build_object('code', v.code, 'label', v.label) order by iov.sort, v.code)
                 from item_option_value iov join option_value v on v.id = iov.option_value_id
                where iov.item_id = io.item_id and iov.option_definition_id = io.option_definition_id and iov.is_active), '[]') as values
         from item_option io join option_definition d on d.id = io.option_definition_id
        where io.item_id = $1 order by io.sort, d.key`,
      [itemId],
    )
  ).rows.map((o: Row) => ({
    key: o.key as string,
    label: o.label as string,
    valueKind: o.value_kind as string,
    isRequired: o.is_required as boolean,
    isDistributable: o.is_distributable as boolean,
    values: o.values as { code: string; label: string }[],
  }));
  const decorationMethods = (
    await db.query(
      `select m.key, m.name from decoration_capability c join decoration_method m on m.id = c.method_id
        where c.item_id = $1 order by m.key`,
      [itemId],
    )
  ).rows.map((m: Row) => ({ key: m.key as string, name: m.name as string }));

  return {
    asOf: asOf.toISOString(),
    item: {
      id: i.id as string,
      publicCode: i.public_code as string,
      name: i.canonical_name as string,
      status: (i.status as string | null) ?? null,
      saleUnit: (i.sale_unit as string | null) ?? null,
      kind: i.kind as string,
    },
    definitions,
    rules,
    market: {
      books,
      policies,
      fx: fxRow
        ? {
            id: fxRow.id as string,
            value: Number(fxRow.value).toFixed(2),
            validFrom: iso(fxRow.valid_from)!,
            validTo: iso(fxRow.valid_to),
          }
        : null,
    },
    historical,
    options,
    decorationMethods,
    hasMeasurement: i.measurement_spec !== null && i.measurement_spec !== undefined,
  };
}

// ---------------------------------------------------------------- simulator

const Opt = z.strictObject({
  optionKey: z.string().regex(/^[a-z][a-z0-9_]*$/),
  valueCodes: z.array(z.string().min(1)).min(1).max(20),
});

export const SimulateInput = z.strictObject({
  itemId: z.uuid(),
  market: z.enum(['USA', 'MX']),
  quantity: z.number().int().positive().max(1_000_000),
  selections: z.array(Opt).max(30),
  /** ADR-0001: rows vary only distributable options; they must sum to `quantity`. */
  distribution: z
    .array(
      z.strictObject({ selections: z.array(Opt).max(10), quantity: z.number().int().positive() }),
    )
    .max(40)
    .optional(),
  decorations: z
    .array(z.strictObject({ methodKey: z.string().min(1).max(60) }))
    .max(10)
    .optional(),
  measurements: z
    .strictObject({
      width: z.number().positive().optional(),
      height: z.number().positive().optional(),
      length: z.number().positive().optional(),
      unit: z.enum(['in', 'ft']),
    })
    .optional(),
  optionalComponents: z
    .array(
      z.strictObject({ catalogItemId: z.uuid(), quantity: z.number().int().positive().optional() }),
    )
    .max(10)
    .optional(),
  /** Explicit instant (ISO). Absent: the application-boundary clock handed to the handler. */
  asOf: z.iso.datetime({ offset: true }).optional(),
  /** Explicit DRAFT simulation: resolves against an isolated overlay; live quoting never reads drafts. */
  draftId: z.uuid().optional(),
});

export interface TraceLine {
  kind: string;
  label: string;
  quantity: number;
  amount: string | null;
  definitionId: string | null;
  definitionRevision: number | null;
  breakQuantity: number | null;
  ruleCode: string | null;
  ruleVersion: number | null;
}

export interface SimulationView {
  status: PriceResult['status'];
  reasonCode: string | null;
  currency: string | null;
  total: string | null;
  basis: string | null;
  explanation: string[];
  lines: TraceLine[];
  rulesApplied: { code: string; version: number; ruleId: string }[];
  policy: {
    market: string;
    priceBook: string;
    basis: string;
    factor: string | null;
    factorSource: string | null;
  } | null;
  derivation: MexicoRow | null;
  /** Derived market only: source (USA) price book and total before conversion. */
  sourcePriceBook: string | null;
  components: { catalogItemId: string; status: string; total: string | null }[];
  conflictingIds: string[];
  errors: { code: string; path: string }[];
  reason: string | null;
  asOf: string;
  effectiveAt: string;
  revisions: { catalog: number; pricing: number };
}

const lineOf = (l: BreakdownLine): TraceLine => ({
  kind: l.kind,
  label: l.label,
  quantity: l.quantity,
  amount: l.amount ? formatAmount(l.amount) : null,
  definitionId: l.source.priceDefinitionId ?? null,
  definitionRevision: l.source.priceDefinitionVersion ?? null,
  breakQuantity: l.source.breakQuantity ?? null,
  ruleCode: l.source.ruleCode ?? null,
  ruleVersion: l.source.ruleVersion ?? null,
});

/** Pure projection of a PriceResult for the Admin (no pricing logic: everything comes from the domain). */
export function describeResult(r: PriceResult, quantity: number, asOf: Date): SimulationView {
  const row = mexicoRow(quantity, r);
  const resolved = r.status === 'RESOLVED' ? r : null;
  return {
    status: r.status,
    reasonCode: r.status === 'QUOTE_ONLY' || r.status === 'AMBIGUOUS' ? r.reasonCode : null,
    currency: r.currency,
    total: resolved ? formatAmount(resolved.total) : null,
    basis: r.policy?.basis ?? null,
    explanation: r.explanation,
    lines: resolved
      ? resolved.breakdown.map(lineOf)
      : r.status === 'QUOTE_ONLY'
        ? [...r.knownLines, ...r.knownAdjustments].map(lineOf)
        : [],
    rulesApplied: resolved
      ? resolved.rulesApplied.map((a) => ({ code: a.code, version: a.version, ruleId: a.ruleId }))
      : [],
    policy: r.policy
      ? {
          market: r.policy.market,
          priceBook: r.policy.priceBookCode,
          basis: r.policy.basis,
          factor: r.policy.factor ?? null,
          factorSource: r.policy.factorSource ?? null,
        }
      : null,
    derivation: resolved && resolved.derivation ? row : null,
    sourcePriceBook: resolved?.derivation?.sourcePriceBookCode ?? null,
    components: resolved
      ? resolved.components.map((c) => ({
          catalogItemId: c.catalogItemId,
          status: c.result.status,
          total: formatAmount(c.result.total),
        }))
      : [],
    conflictingIds: r.status === 'AMBIGUOUS' ? r.conflictingIds : [],
    errors: r.status === 'INVALID' ? r.errors.map((e) => ({ code: e.code, path: e.path })) : [],
    reason: row.reason,
    asOf: asOf.toISOString(),
    effectiveAt: r.effectiveAt,
    revisions: r.revisions,
  };
}

/** Runs the pricing domain for one configuration (read-only). `defaultAsOf` is the boundary clock. */
export async function simulatePrice(db: Queryable, raw: unknown, defaultAsOf: Date) {
  const parsed = SimulateInput.safeParse(raw);
  if (!parsed.success)
    return {
      ok: false as const,
      errors: parsed.error.issues.map((i) => ({ code: 'INVALID_INPUT', message: i.message })),
    };
  const v = parsed.data;
  const asOf = v.asOf ? new Date(v.asOf) : defaultAsOf;
  const request: PriceRequest = {
    catalogItemId: v.itemId,
    market: v.market,
    quantity: v.quantity,
    selections: v.selections,
    ...(v.distribution ? { distribution: v.distribution } : {}),
    ...(v.decorations ? { decorations: v.decorations } : {}),
    ...(v.measurements ? { measurements: v.measurements } : {}),
    ...(v.optionalComponents ? { optionalComponents: v.optionalComponents } : {}),
  };
  const snapshot = await loadCatalogSnapshot(db);
  const current = describeResult(resolvePrice(request, snapshot, asOf), v.quantity, asOf);
  if (!v.draftId)
    return { ok: true as const, result: current, current: null, simulatedDraft: false };
  const [draft] = await loadPriceDefinitionsByIds(db, [v.draftId]);
  if (!draft || draft.status !== 'DRAFT')
    return {
      ok: false as const,
      errors: [{ code: 'NOT_DRAFT', message: 'Sólo se simula un borrador existente.' }],
    };
  const simulated = describeResult(
    resolvePrice(request, overlayDraft(snapshot, draft), asOf),
    v.quantity,
    asOf,
  );
  return { ok: true as const, result: simulated, current, simulatedDraft: true };
}

// ---------------------------------------------------------------- historical

export interface HistoricalRow {
  origin: 'STAGING' | 'DOMAIN';
  itemLegacy: string | null;
  itemName: string | null;
  itemId: string | null;
  priceLegacy: string | null;
  amount: string | null;
  currency: string | null;
  conditions: string | null;
  sourceFile: string | null;
  sheet: string | null;
  row: number | null;
  note: string | null;
}

export async function listHistorical(db: Queryable): Promise<HistoricalRow[]> {
  const staging = (
    await db.query(
      `select r.evidence, r.normalized_payload ->> 'Notas' as notes, b.source_file,
              r.source_cells -> 0 ->> 'source_sheet' as sheet, (r.source_cells -> 0 ->> 'source_row')::int as row,
              ci.proposal ->> 'name' as item_name
         from import_record r join import_batch b on b.id = r.batch_id
         left join import_candidate ci on ci.batch_id = r.batch_id and ci.kind = 'CATALOG_ITEM'
               and ci.proposal ->> 'legacyId' = r.evidence ->> 'item_legacy'
        where r.evidence_class = 'HISTORICAL_PRICE'
        order by b.source_file, r.evidence ->> 'item_legacy', r.evidence ->> 'price_legacy'`,
    )
  ).rows.map((r: Row) => {
    const e = r.evidence as {
      item_legacy?: unknown;
      price_legacy?: unknown;
      money?: { amount?: string | null; currency?: string | null };
      conditions?: unknown;
    };
    return {
      origin: 'STAGING' as const,
      itemLegacy: e.item_legacy === undefined ? null : String(e.item_legacy),
      itemName: (r.item_name as string | null) ?? null,
      itemId: null,
      priceLegacy: e.price_legacy === undefined ? null : String(e.price_legacy),
      amount: e.money?.amount ?? null,
      currency: e.money?.currency ?? null,
      conditions: e.conditions ? JSON.stringify(e.conditions) : null,
      sourceFile: r.source_file as string,
      sheet: (r.sheet as string | null) ?? null,
      row: (r.row as number | null) ?? null,
      note: (r.notes as string | null) ?? null,
    };
  });
  const domain = (
    await db.query(
      `select s.source_locator, s.payload, i.id, i.public_code, i.canonical_name
         from source_reference s join catalog_item i on i.id = s.entity_id
        where s.source_kind = 'HISTORICAL_PRICE_EVIDENCE' and s.entity_type = 'catalog_item'
        order by i.public_code, s.source_locator`,
    )
  ).rows.map((r: Row) => {
    const p = (r.payload as Row | null) ?? {};
    return {
      origin: 'DOMAIN' as const,
      itemLegacy: null,
      itemName: `${String(r.public_code)} · ${String(r.canonical_name)}`,
      itemId: r.id as string,
      priceLegacy: null,
      amount: (p.amount as string | undefined) ?? null,
      currency: (p.currency as string | undefined) ?? null,
      conditions:
        (p.condition as string | undefined) ?? (p.conditions ? JSON.stringify(p.conditions) : null),
      sourceFile: r.source_locator as string,
      sheet: null,
      row: null,
      note: (p.status as string | undefined) ?? null,
    };
  });
  return [...domain, ...staging];
}
