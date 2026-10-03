import { z } from 'zod';
import { OWNER_DECISIONS, PRICING_DECISION_IDS, PRICING_RELEVANCE } from '@/decisions/reference';
import type { Queryable } from '../client';
import { traceEntity } from '../import/provenance';
import { conditionsFor, type ConditionView } from './pricing';
import {
  analyzeConflictsFor,
  compareRevisions,
  impactPreview,
  lineageOf,
  priceHistory,
  type RevisionDelta,
} from './price-admin';

/** Read models of the pricing admin (STEP 07 §12). No business rule lives here; everything is read or delegated. */

type Row = Record<string, unknown>;
const iso = (v: unknown) =>
  v === null || v === undefined ? null : new Date(String(v)).toISOString();

// ------------------------------------------------------------------ decisions per item (documentation)

/** Pricing decisions that scope to specific items (D-016 is global and shown separately). */
const ITEM_SCOPED_PRICING = PRICING_DECISION_IDS.filter((d) => d !== 'D-016');

function decisionsByLegacy(ids: readonly string[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const d of OWNER_DECISIONS.filter((x) => ids.includes(x.id))) {
    for (const a of d.affected) m.set(a.legacyId, [...(m.get(a.legacyId) ?? []), d.id]);
  }
  return m;
}
const ITEM_DECISIONS = decisionsByLegacy(ITEM_SCOPED_PRICING);

async function legacyIdsOf(db: Queryable, itemIds: string[]): Promise<Map<string, string[]>> {
  if (itemIds.length === 0) return new Map();
  const rows = (
    await db.query(
      `select entity_id, source_locator from source_reference
        where entity_type = 'catalog_item' and source_kind = 'LEGACY_ID' and entity_id = any($1)`,
      [itemIds],
    )
  ).rows as Row[];
  const m = new Map<string, string[]>();
  for (const r of rows)
    m.set(r.entity_id as string, [
      ...(m.get(r.entity_id as string) ?? []),
      r.source_locator as string,
    ]);
  return m;
}

export function decisionsForLegacy(legacy: readonly string[]): string[] {
  return [...new Set(legacy.flatMap((l) => ITEM_DECISIONS.get(l) ?? []))].sort();
}

// ------------------------------------------------------------------ list

export const DefinitionFilters = z.object({
  q: z.string().trim().max(120).optional(),
  itemId: z.uuid().optional(),
  market: z.enum(['USA', 'MX']).optional(),
  status: z.enum(['DRAFT', 'AUTHORIZED', 'SUPERSEDED']).optional(),
  model: z.enum(['FIXED', 'PER_UNIT', 'EXACT_QUANTITY_MATRIX', 'TIERED', 'MEASURED']).optional(),
  component: z.enum(['ITEM', 'DECORATION']).optional(),
  validity: z.enum(['current', 'future', 'expired']).optional(),
  decision: z.enum(['pricing']).optional(),
});
export type DefinitionFilters = z.infer<typeof DefinitionFilters>;

export interface DefinitionListRow {
  id: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  market: string;
  currency: string;
  component: string;
  model: string;
  status: string;
  revision: number;
  validFrom: string;
  validTo: string | null;
  validity: 'current' | 'future' | 'expired' | 'draft';
  breaks: number;
  conditions: string;
  decisions: string[];
}

export async function listDefinitions(
  db: Queryable,
  f: DefinitionFilters,
  asOf: Date,
  page = 1,
  pageSize = 50,
) {
  const where: string[] = ['$1::timestamptz is not null'];
  const params: unknown[] = [asOf.toISOString()];
  const add = (sql: string, v?: unknown) => {
    if (v !== undefined) params.push(v);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (f.q) add(`(i.canonical_name ilike ? or i.public_code ilike ?)`, `%${f.q}%`);
  if (f.itemId) add('d.item_id = ?', f.itemId);
  if (f.market) add('m.code = ?', f.market);
  if (f.status) add('d.status = ?::price_status', f.status);
  if (f.model) add('d.model = ?::price_model', f.model);
  if (f.component) add('d.component = ?::price_component', f.component);
  if (f.validity === 'current')
    where.push(
      "d.status = 'AUTHORIZED' and d.valid_from <= $1 and (d.valid_to is null or d.valid_to > $1)",
    );
  if (f.validity === 'future') where.push("d.status <> 'SUPERSEDED' and d.valid_from > $1");
  if (f.validity === 'expired') where.push('d.valid_to is not null and d.valid_to <= $1');
  if (f.decision === 'pricing') {
    const legacy = [...ITEM_DECISIONS.keys()];
    add(
      `exists (select 1 from source_reference s where s.entity_type = 'catalog_item' and s.entity_id = d.item_id
                and s.source_kind = 'LEGACY_ID' and s.source_locator = any(?))`,
      legacy,
    );
  }
  const sql = where.length ? `where ${where.join(' and ')}` : '';
  const from = `from price_definition d join catalog_item i on i.id = d.item_id
                join price_book b on b.id = d.price_book_id join market m on m.id = b.market_id`;
  const total = Number(
    ((await db.query(`select count(*)::int as n ${from} ${sql}`, params)).rows[0] as Row).n,
  );
  const size = Math.min(Math.max(pageSize, 1), 200);
  const current = Math.max(page, 1);
  const rows = (
    await db.query(
      `select d.id, d.item_id, i.public_code, i.canonical_name, m.code as market, b.currency, d.component, d.model,
              d.status, d.version, d.valid_from, d.valid_to,
              (select count(*)::int from price_break k where k.price_definition_id = d.id) as breaks,
              price_definition_signature(d.id) as sig
         ${from} ${sql}
        order by i.public_code, m.code, d.component, d.lineage_id, d.version desc
        limit ${size} offset ${(current - 1) * size}`,
      params,
    )
  ).rows as Row[];
  const ids = [...new Set(rows.map((r) => r.item_id as string))];
  const legacy = await legacyIdsOf(db, ids);
  const labels = await conditionLabels(
    db,
    rows.map((r) => r.id as string),
  );
  const out: DefinitionListRow[] = rows.map((r) => {
    const from = new Date(r.valid_from as string).getTime();
    const to = r.valid_to ? new Date(r.valid_to as string).getTime() : Infinity;
    const t = asOf.getTime();
    const validity =
      r.status === 'DRAFT' ? 'draft' : from > t ? 'future' : to <= t ? 'expired' : 'current';
    return {
      id: r.id as string,
      itemId: r.item_id as string,
      itemCode: r.public_code as string,
      itemName: r.canonical_name as string,
      market: r.market as string,
      currency: r.currency as string,
      component: r.component as string,
      model: r.model as string,
      status: r.status as string,
      revision: Number(r.version),
      validFrom: iso(r.valid_from)!,
      validTo: iso(r.valid_to),
      validity,
      breaks: Number(r.breaks),
      conditions: labels.get(r.id as string) ?? 'sin condiciones',
      decisions: decisionsForLegacy(legacy.get(r.item_id as string) ?? []),
    };
  });
  return { rows: out, total, page: current, pageSize: size };
}

async function conditionLabels(db: Queryable, ids: string[]): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  if (ids.length === 0) return m;
  const rows = (
    await db.query(
      `select pc.price_definition_id as id, pc.kind, d.key as option_key, v.code as value_code, md.key as method_key
         from price_condition pc left join option_definition d on d.id = pc.option_definition_id
         left join option_value v on v.id = pc.option_value_id left join decoration_method md on md.id = pc.decoration_method_id
        where pc.price_definition_id = any($1) order by d.key, v.code, md.key`,
      [ids],
    )
  ).rows as Row[];
  const parts = new Map<string, string[]>();
  for (const r of rows) {
    const label =
      r.kind === 'OPTION_VALUE'
        ? `${String(r.option_key)}=${String(r.value_code)}`
        : `método ${String(r.method_key)}`;
    parts.set(r.id as string, [...(parts.get(r.id as string) ?? []), label]);
  }
  for (const [id, p] of parts) m.set(id, p.join(' · '));
  return m;
}

// ------------------------------------------------------------------ detail

export interface DefinitionDetail {
  id: string;
  item: { id: string; publicCode: string; name: string; saleUnit: string | null };
  market: string;
  currency: string;
  bookCode: string;
  component: string;
  model: string;
  status: string;
  revision: number;
  lineageId: string;
  validFrom: string;
  validTo: string | null;
  amount: string | null;
  rate: string | null;
  rateUnit: string | null;
  minCharge: string | null;
  minQuantity: number | null;
  maxQuantity: number | null;
  authorizedBy: string | null;
  authorizedAt: string | null;
  supersedesId: string | null;
  supersededById: string | null;
  supersededAt: string | null;
  breaks: { quantity: number; amount: string; amountBasis: string }[];
  conditions: ConditionView[];
  provenance: { sourceKind: string; locator: string }[];
  importTraces: { candidateId: string; lineageKey: string }[];
  lineage: Awaited<ReturnType<typeof lineageOf>>;
  history: Awaited<ReturnType<typeof priceHistory>>;
  /** DRAFT: comparison against the revision it replaces (or the authorized head of the same scope). */
  compareTo: { id: string; revision: number; status: string; delta: RevisionDelta } | null;
  conflicts: Awaited<ReturnType<typeof analyzeConflictsFor>> | null;
  impact: Awaited<ReturnType<typeof impactPreview>> | null;
  /** AUTHORIZED head that can be cloned into the next revision. */
  canClone: boolean;
  existingNextRevision: string | null;
  decisions: { id: string; title: string; frozenBehaviour: string | null }[];
  isCurrentlyEffective: boolean;
}

export async function definitionDetail(
  db: Queryable,
  id: string,
  now: Date,
): Promise<DefinitionDetail | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const d = (
    await db.query(
      `select d.*, i.public_code, i.canonical_name, i.sale_unit, b.code as book, b.currency, m.code as market
         from price_definition d join catalog_item i on i.id = d.item_id
         join price_book b on b.id = d.price_book_id join market m on m.id = b.market_id where d.id = $1`,
      [id],
    )
  ).rows[0] as Row | undefined;
  if (!d) return null;
  const breaks = (
    await db.query(
      'select quantity, amount, amount_basis from price_break where price_definition_id = $1 order by quantity',
      [id],
    )
  ).rows.map((b: Row) => ({
    quantity: Number(b.quantity),
    amount: Number(b.amount).toFixed(2),
    amountBasis: b.amount_basis as string,
  }));
  const provenance = (
    await db.query(
      `select source_kind, source_locator from source_reference
        where entity_type = 'price_definition' and entity_id = $1 order by source_kind, source_locator`,
      [id],
    )
  ).rows.map((s: Row) => ({
    sourceKind: s.source_kind as string,
    locator: s.source_locator as string,
  }));
  const traces = await traceEntity(db, 'price_definition', id);

  const status = d.status as string;
  const nextRev = (await db.query('select id from price_definition where supersedes_id = $1', [id]))
    .rows[0] as Row | undefined;

  // Comparison target: the predecessor; for an authorized definition its own predecessor (if any).
  let compareTo: DefinitionDetail['compareTo'] = null;
  if (d.supersedes_id) {
    const cmp = await compareRevisions(db, d.supersedes_id as string, id);
    const pred = (
      await db.query('select version, status from price_definition where id = $1', [
        d.supersedes_id,
      ])
    ).rows[0] as Row;
    if (cmp.ok)
      compareTo = {
        id: d.supersedes_id as string,
        revision: Number(pred.version),
        status: pred.status as string,
        delta: cmp.delta,
      };
  }

  const asOfForImpact = new Date(
    Math.max(now.getTime(), new Date(d.valid_from as string).getTime()),
  );
  const legacy = (await legacyIdsOf(db, [d.item_id as string])).get(d.item_id as string) ?? [];
  const decisionIds = [...decisionsForLegacy(legacy), 'D-016'];
  const from = new Date(d.valid_from as string).getTime();
  const to = d.valid_to ? new Date(d.valid_to as string).getTime() : Infinity;

  return {
    id,
    item: {
      id: d.item_id as string,
      publicCode: d.public_code as string,
      name: d.canonical_name as string,
      saleUnit: (d.sale_unit as string | null) ?? null,
    },
    market: d.market as string,
    currency: d.currency as string,
    bookCode: d.book as string,
    component: d.component as string,
    model: d.model as string,
    status,
    revision: Number(d.version),
    lineageId: d.lineage_id as string,
    validFrom: iso(d.valid_from)!,
    validTo: iso(d.valid_to),
    amount: d.amount === null ? null : Number(d.amount).toFixed(2),
    rate: d.rate === null ? null : String(d.rate),
    rateUnit: (d.rate_unit as string | null) ?? null,
    minCharge: d.min_charge === null ? null : Number(d.min_charge).toFixed(2),
    minQuantity: d.min_quantity === null ? null : Number(d.min_quantity),
    maxQuantity: d.max_quantity === null ? null : Number(d.max_quantity),
    authorizedBy: (d.authorized_by as string | null) ?? null,
    authorizedAt: iso(d.authorized_at),
    supersedesId: (d.supersedes_id as string | null) ?? null,
    supersededById: (d.superseded_by_id as string | null) ?? null,
    supersededAt: iso(d.superseded_at),
    breaks,
    conditions: await conditionsFor(db, 'price_definition_id', id),
    provenance,
    importTraces: traces.map((t) => ({ candidateId: t.candidateId, lineageKey: t.lineageKey })),
    lineage: await lineageOf(db, id),
    history: await priceHistory(db, id),
    compareTo,
    conflicts: status === 'DRAFT' ? await analyzeConflictsFor(db, id, now) : null,
    impact: status === 'DRAFT' ? await impactPreview(db, id, asOfForImpact) : null,
    canClone: status === 'AUTHORIZED' && !nextRev,
    existingNextRevision: (nextRev?.id as string | undefined) ?? null,
    decisions: decisionIds.map((x) => ({
      id: x,
      title: OWNER_DECISIONS.find((o) => o.id === x)?.title ?? x,
      frozenBehaviour: PRICING_RELEVANCE[x]?.frozenBehaviour ?? null,
    })),
    isCurrentlyEffective: status === 'AUTHORIZED' && from <= now.getTime() && to > now.getTime(),
  };
}

// ------------------------------------------------------------------ item scoped helpers

export async function itemOptionsForEditor(db: Queryable, itemId: string) {
  const options = (
    await db.query(
      `select d.key, d.label, d.value_kind,
              coalesce((select jsonb_agg(jsonb_build_object('code', v.code, 'label', v.label) order by iov.sort, v.code)
                 from item_option_value iov join option_value v on v.id = iov.option_value_id
                where iov.item_id = io.item_id and iov.option_definition_id = io.option_definition_id and iov.is_active), '[]') as values
         from item_option io join option_definition d on d.id = io.option_definition_id
        where io.item_id = $1 order by io.sort, d.key`,
      [itemId],
    )
  ).rows as Row[];
  const methods = (
    await db.query(
      `select m.key, m.name from decoration_capability c join decoration_method m on m.id = c.method_id
        where c.item_id = $1 order by m.key`,
      [itemId],
    )
  ).rows as Row[];
  return {
    options: options
      .filter((o) => (o.values as unknown[]).length > 0)
      .map((o) => ({
        key: o.key as string,
        label: o.label as string,
        values: o.values as { code: string; label: string }[],
      })),
    methods: methods.map((m) => ({ key: m.key as string, name: m.name as string })),
  };
}

export async function itemSummary(db: Queryable, itemId: string) {
  if (!z.uuid().safeParse(itemId).success) return null;
  const r = (
    await db.query(
      'select id, public_code, canonical_name, sale_unit, measurement_spec from catalog_item where id = $1',
      [itemId],
    )
  ).rows[0] as Row | undefined;
  return r
    ? {
        id: r.id as string,
        publicCode: r.public_code as string,
        name: r.canonical_name as string,
        saleUnit: (r.sale_unit as string | null) ?? null,
        hasMeasurement: r.measurement_spec !== null,
      }
    : null;
}

// ------------------------------------------------------------------ policies / parameters

export interface PolicyRow {
  itemId: string;
  itemCode: string;
  itemName: string;
  pricingMode: string;
  factorOverride: string | null;
  isAvailable: boolean;
  defaultFactor: string | null;
}

export async function listPolicies(db: Queryable, q?: string): Promise<PolicyRow[]> {
  const rows = (
    await db.query(
      `select i.id, i.public_code, i.canonical_name, p.pricing_mode, p.factor_override, p.is_available,
              b.default_factor
         from item_market_policy p join catalog_item i on i.id = p.item_id
         join market m on m.id = p.market_id and m.code = 'MX'
         join price_book b on b.market_id = m.id
        where ($1::text is null or i.canonical_name ilike $1 or i.public_code ilike $1)
        order by i.public_code`,
      [q ? `%${q}%` : null],
    )
  ).rows as Row[];
  return rows.map((r) => ({
    itemId: r.id as string,
    itemCode: r.public_code as string,
    itemName: r.canonical_name as string,
    pricingMode: r.pricing_mode as string,
    factorOverride: r.factor_override === null ? null : String(r.factor_override),
    isAvailable: r.is_available as boolean,
    defaultFactor: r.default_factor === null ? null : String(r.default_factor),
  }));
}

export async function mexicoBook(db: Queryable) {
  const r = (
    await db.query(
      `select b.code, b.mode, b.default_factor, s.code as source from price_book b
         join market m on m.id = b.market_id and m.code = 'MX' left join price_book s on s.id = b.source_price_book_id`,
    )
  ).rows[0] as Row | undefined;
  return r
    ? {
        code: r.code as string,
        mode: r.mode as string,
        defaultFactor: r.default_factor === null ? null : Number(r.default_factor).toFixed(2),
        source: (r.source as string | null) ?? null,
      }
    : null;
}

export async function listItemsLite(db: Queryable) {
  return (
    await db.query('select id, public_code, canonical_name from catalog_item order by public_code')
  ).rows.map((r: Row) => ({
    id: r.id as string,
    publicCode: r.public_code as string,
    name: r.canonical_name as string,
  }));
}

export async function listFxParameters(db: Queryable) {
  return (
    await db.query(
      'select id, key, value, valid_from, valid_to from pricing_parameter order by key, valid_from desc',
    )
  ).rows.map((r: Row) => ({
    id: r.id as string,
    key: r.key as string,
    value: String(r.value),
    validFrom: iso(r.valid_from)!,
    validTo: iso(r.valid_to),
  }));
}

export async function parameterHistory(db: Queryable) {
  return (
    await db.query(
      `select revision, action, changed_by, context, reason, changed_at, new_row ->> 'value' as value,
              new_row ->> 'valid_from' as valid_from
         from change_event where table_name = 'pricing_parameter' order by revision desc limit 30`,
    )
  ).rows.map((r: Row) => ({
    revision: Number(r.revision),
    action: r.action as string,
    changedBy: r.changed_by as string,
    context: (r.context as string | null) ?? null,
    reason: (r.reason as string | null) ?? null,
    changedAt: iso(r.changed_at)!,
    value: (r.value as string | null) ?? null,
    validFrom: (r.valid_from as string | null) ?? null,
  }));
}
