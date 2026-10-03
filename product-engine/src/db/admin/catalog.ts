import { z } from 'zod';
import {
  canChangeStatus,
  CATALOG_ITEM_KINDS,
  CATALOG_STATUSES,
  CUSTOMER_SUPPLIED_ITEM,
  DECORATION_POLICIES,
  SALE_UNITS,
  validateCatalogItem,
  type CatalogItem,
} from '@/domain/catalog';
import type { Queryable } from '../client';
import { traceEntity, type CandidateTrace } from '../import/provenance';

/**
 * Basic catalog admin (STEP 06 §18–21). Minimal creation and safe edits of a
 * CatalogItem. Identity (id, public_code) and kind are never editable; status
 * never returns to unset; pricing is not edited here. Every write is audited
 * by change_event with the application actor (0014).
 */

type Row = Record<string, unknown>;
const iso = (v: unknown) =>
  v === null || v === undefined ? null : new Date(String(v)).toISOString();

export interface CatalogFilters {
  q?: string;
  kind?: 'PRODUCT' | 'SERVICE';
  /** A catalog status, or UNSET for items without one. */
  status?: (typeof CATALOG_STATUSES)[number] | 'UNSET';
  categoryKey?: string | 'NONE';
  decorationPolicy?: (typeof DECORATION_POLICIES)[number];
}

export interface CatalogRow {
  id: string;
  publicCode: string;
  kind: string;
  name: string;
  status: string | null;
  saleUnit: string | null;
  decorationPolicy: string;
  category: string | null;
  legacyIds: string[];
  priceDefinitions: number;
  updatedAt: string;
}

export async function searchCatalog(
  db: Queryable,
  f: CatalogFilters,
  page = 1,
  pageSize = 50,
): Promise<{ rows: CatalogRow[]; total: number; page: number; pageSize: number }> {
  const where: string[] = [];
  const params: unknown[] = [];
  const p = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  if (f.q?.trim()) {
    const like = p(`%${f.q.trim()}%`);
    where.push(`(i.canonical_name ilike ${like} or i.public_code ilike ${like}
      or exists (select 1 from source_reference s where s.entity_type = 'catalog_item' and s.entity_id = i.id
                  and s.source_kind = 'LEGACY_ID' and s.source_locator ilike ${like}))`);
  }
  if (f.kind) where.push(`i.kind = ${p(f.kind)}::catalog_item_kind`);
  if (f.status === 'UNSET') where.push('i.status is null');
  else if (f.status) where.push(`i.status = ${p(f.status)}::catalog_status`);
  if (f.decorationPolicy)
    where.push(`i.decoration_policy = ${p(f.decorationPolicy)}::decoration_policy`);
  if (f.categoryKey === 'NONE') where.push('pc.category_id is null');
  else if (f.categoryKey) where.push(`c.key = ${p(f.categoryKey)}`);
  const sql = where.length ? `where ${where.join(' and ')}` : '';
  const from = `from catalog_item i
    left join catalog_item_category pc on pc.item_id = i.id and pc.is_primary
    left join category c on c.id = pc.category_id`;
  const total = (await db.query(`select count(*)::int as n ${from} ${sql}`, params)).rows[0]
    .n as number;
  const size = Math.min(Math.max(pageSize, 1), 200);
  const current = Math.max(page, 1);
  const rows = (
    await db.query(
      `select i.*, c.name as category,
              coalesce((select array_agg(s.source_locator order by s.source_locator) from source_reference s
                 where s.entity_type = 'catalog_item' and s.entity_id = i.id and s.source_kind = 'LEGACY_ID'), '{}') as legacy_ids,
              (select count(*)::int from price_definition d where d.item_id = i.id) as price_definitions
         ${from} ${sql} order by i.public_code limit ${size} offset ${(current - 1) * size}`,
      params,
    )
  ).rows.map((r: Row) => ({
    id: r.id as string,
    publicCode: r.public_code as string,
    kind: r.kind as string,
    name: r.canonical_name as string,
    status: (r.status as string | null) ?? null,
    saleUnit: (r.sale_unit as string | null) ?? null,
    decorationPolicy: r.decoration_policy as string,
    category: (r.category as string | null) ?? null,
    legacyIds: r.legacy_ids as string[],
    priceDefinitions: r.price_definitions as number,
    updatedAt: iso(r.updated_at)!,
  }));
  return { rows, total, page: current, pageSize: size };
}

export async function listCategories(db: Queryable) {
  return (
    await db.query('select id, key, name, is_active from category order by sort, name')
  ).rows.map((r: Row) => ({
    id: r.id as string,
    key: r.key as string,
    name: r.name as string,
    isActive: r.is_active as boolean,
  }));
}

export interface CatalogItemDetail {
  item: {
    id: string;
    publicCode: string;
    kind: string;
    name: string;
    status: string | null;
    saleUnit: string | null;
    decorationPolicy: string;
    customerSuppliedItem: string;
    descriptionInternal: string | null;
    mergedIntoId: string | null;
    createdAt: string;
    updatedAt: string;
  };
  categories: { key: string; name: string; isPrimary: boolean }[];
  options: {
    key: string;
    label: string;
    valueKind: string;
    unit: string | null;
    isRequired: boolean;
    selectionMode: string;
    isDistributable: boolean;
    values: { code: string; label: string; isActive: boolean }[];
  }[];
  capabilities: { methodKey: string; methodName: string; note: string | null }[];
  methods: { key: string; name: string }[];
  composition: {
    asParent: {
      id: string;
      childId: string;
      childCode: string;
      childName: string;
      quantity: number;
      role: string;
    }[];
    asChild: {
      id: string;
      parentId: string;
      parentCode: string;
      parentName: string;
      quantity: number;
      role: string;
    }[];
  };
  presentations: {
    id: string;
    locale: string;
    occasion: string | null;
    displayName: string;
    isDefault: boolean;
    status: string;
  }[];
  pricing: { book: string; model: string; status: string; n: number }[];
  marketPolicies: {
    market: string;
    pricingMode: string;
    factorOverride: string | null;
    isAvailable: boolean;
  }[];
  provenance: {
    sourceKind: string;
    locator: string;
    field: string | null;
    payload: unknown;
    capturedAt: string;
  }[];
  importTraces: CandidateTrace[];
  history: {
    revision: string;
    table: string;
    action: string;
    changedBy: string;
    context: string | null;
    changedAt: string;
    changes: { field: string; from: unknown; to: unknown }[];
  }[];
}

const HISTORY_FIELDS = [
  'canonical_name',
  'status',
  'sale_unit',
  'decoration_policy',
  'customer_supplied_item',
  'description_internal',
  'kind',
  'public_code',
  'category_id',
  'is_primary',
];

export async function catalogItemDetail(
  db: Queryable,
  id: string,
): Promise<CatalogItemDetail | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const i = (await db.query('select * from catalog_item where id = $1', [id])).rows[0] as
    Row | undefined;
  if (!i) return null;
  const categories = (
    await db.query(
      `select c.key, c.name, ic.is_primary from catalog_item_category ic join category c on c.id = ic.category_id
        where ic.item_id = $1 order by ic.is_primary desc, c.name`,
      [id],
    )
  ).rows.map((r: Row) => ({
    key: r.key as string,
    name: r.name as string,
    isPrimary: r.is_primary as boolean,
  }));
  const options = (
    await db.query(
      `select d.key, d.label, d.value_kind, d.unit, io.is_required, io.selection_mode, io.is_distributable,
              coalesce((select jsonb_agg(jsonb_build_object('code', v.code, 'label', v.label, 'isActive', iov.is_active)
                          order by iov.sort, v.code)
                          from item_option_value iov join option_value v on v.id = iov.option_value_id
                         where iov.item_id = io.item_id and iov.option_definition_id = io.option_definition_id), '[]') as values
         from item_option io join option_definition d on d.id = io.option_definition_id
        where io.item_id = $1 order by io.sort, d.key`,
      [id],
    )
  ).rows.map((r: Row) => ({
    key: r.key as string,
    label: r.label as string,
    valueKind: r.value_kind as string,
    unit: (r.unit as string | null) ?? null,
    isRequired: r.is_required as boolean,
    selectionMode: r.selection_mode as string,
    isDistributable: r.is_distributable as boolean,
    values: r.values as { code: string; label: string; isActive: boolean }[],
  }));
  const capabilities = (
    await db.query(
      `select m.key, m.name, dc.note from decoration_capability dc join decoration_method m on m.id = dc.method_id
        where dc.item_id = $1 order by m.key`,
      [id],
    )
  ).rows.map((r: Row) => ({
    methodKey: r.key as string,
    methodName: r.name as string,
    note: (r.note as string | null) ?? null,
  }));
  const methods = (
    await db.query('select key, name from decoration_method where is_active order by key')
  ).rows as { key: string; name: string }[];
  const asParent = (
    await db.query(
      `select l.id, l.child_item_id, c.public_code, c.canonical_name, l.quantity, l.role
         from composition_line l join catalog_item c on c.id = l.child_item_id
        where l.parent_item_id = $1 order by l.sort, c.public_code`,
      [id],
    )
  ).rows.map((r: Row) => ({
    id: r.id as string,
    childId: r.child_item_id as string,
    childCode: r.public_code as string,
    childName: r.canonical_name as string,
    quantity: Number(r.quantity),
    role: r.role as string,
  }));
  const asChild = (
    await db.query(
      `select l.id, l.parent_item_id, p.public_code, p.canonical_name, l.quantity, l.role
         from composition_line l join catalog_item p on p.id = l.parent_item_id
        where l.child_item_id = $1 order by p.public_code`,
      [id],
    )
  ).rows.map((r: Row) => ({
    id: r.id as string,
    parentId: r.parent_item_id as string,
    parentCode: r.public_code as string,
    parentName: r.canonical_name as string,
    quantity: Number(r.quantity),
    role: r.role as string,
  }));
  const presentations = (
    await db.query(
      'select * from presentation where item_id = $1 order by locale, is_default desc, display_name',
      [id],
    )
  ).rows.map((r: Row) => ({
    id: r.id as string,
    locale: r.locale as string,
    occasion: (r.occasion as string | null) ?? null,
    displayName: r.display_name as string,
    isDefault: r.is_default as boolean,
    status: r.status as string,
  }));
  const pricing = (
    await db.query(
      `select b.code as book, d.model, d.status, count(*)::int as n
         from price_definition d join price_book b on b.id = d.price_book_id
        where d.item_id = $1 group by 1, 2, 3 order by 1, 2, 3`,
      [id],
    )
  ).rows as { book: string; model: string; status: string; n: number }[];
  const marketPolicies = (
    await db.query(
      `select m.code, p.pricing_mode, p.factor_override, p.is_available
         from item_market_policy p join market m on m.id = p.market_id where p.item_id = $1 order by m.code`,
      [id],
    )
  ).rows.map((r: Row) => ({
    market: r.code as string,
    pricingMode: r.pricing_mode as string,
    factorOverride: (r.factor_override as string | null) ?? null,
    isAvailable: r.is_available as boolean,
  }));
  const provenance = (
    await db.query(
      `select source_kind, source_locator, field, payload, captured_at from source_reference
        where entity_type = 'catalog_item' and entity_id = $1 order by source_kind, source_locator`,
      [id],
    )
  ).rows.map((r: Row) => ({
    sourceKind: r.source_kind as string,
    locator: r.source_locator as string,
    field: (r.field as string | null) ?? null,
    payload: r.payload ?? null,
    capturedAt: iso(r.captured_at)!,
  }));
  const history = (
    await db.query(
      `select revision, table_name, action, changed_by, context, changed_at, old_row, new_row from change_event
        where (table_name = 'catalog_item' and entity_key = $1)
           or (table_name = 'catalog_item_category' and coalesce(new_row, old_row) ->> 'item_id' = $1)
        order by revision desc limit 100`,
      [id],
    )
  ).rows.map((r: Row) => {
    const oldRow = (r.old_row as Row | null) ?? {};
    const newRow = (r.new_row as Row | null) ?? {};
    const changes = HISTORY_FIELDS.filter(
      (f) =>
        (f in oldRow || f in newRow) && JSON.stringify(oldRow[f]) !== JSON.stringify(newRow[f]),
    ).map((f) => ({ field: f, from: oldRow[f] ?? null, to: newRow[f] ?? null }));
    return {
      revision: String(r.revision),
      table: r.table_name as string,
      action: r.action as string,
      changedBy: r.changed_by as string,
      context: (r.context as string | null) ?? null,
      changedAt: iso(r.changed_at)!,
      changes,
    };
  });
  return {
    item: {
      id: i.id as string,
      publicCode: i.public_code as string,
      kind: i.kind as string,
      name: i.canonical_name as string,
      status: (i.status as string | null) ?? null,
      saleUnit: (i.sale_unit as string | null) ?? null,
      decorationPolicy: i.decoration_policy as string,
      customerSuppliedItem: i.customer_supplied_item as string,
      descriptionInternal: (i.description_internal as string | null) ?? null,
      mergedIntoId: (i.merged_into_id as string | null) ?? null,
      createdAt: iso(i.created_at)!,
      updatedAt: iso(i.updated_at)!,
    },
    categories,
    options,
    capabilities,
    methods,
    composition: { asParent, asChild },
    presentations,
    pricing,
    marketPolicies,
    provenance,
    importTraces: await traceEntity(db, 'catalog_item', id),
    history,
  };
}

// ---------------------------------------------------------------- mutations

const Name = z.string().trim().min(1, 'name is required').max(200);
const CategoryKey = z.string().regex(/^[a-z][a-z0-9_]*$/);

/**
 * Minimal creation. Status and decoration policy must be chosen explicitly
 * (no silent database default); a SERVICE must say whether it works on
 * customer-supplied items. Category, description and sale unit are optional.
 */
export const CreateCatalogItemInput = z.strictObject({
  name: Name,
  kind: z.enum(CATALOG_ITEM_KINDS),
  status: z.enum(CATALOG_STATUSES),
  decorationPolicy: z.enum(DECORATION_POLICIES),
  customerSuppliedItem: z.enum(CUSTOMER_SUPPLIED_ITEM).optional(),
  saleUnit: z.enum(SALE_UNITS).nullable().optional(),
  categoryKey: CategoryKey.nullable().optional(),
  descriptionInternal: z.string().trim().max(2000).nullable().optional(),
});
export type CreateCatalogItemInput = z.infer<typeof CreateCatalogItemInput>;

/** Safe fields only. id, public_code and kind are not part of the schema (strict). */
export const UpdateCatalogItemInput = z.strictObject({
  name: Name.optional(),
  status: z.enum(CATALOG_STATUSES).optional(),
  saleUnit: z.enum(SALE_UNITS).nullable().optional(),
  decorationPolicy: z.enum(DECORATION_POLICIES).optional(),
  customerSuppliedItem: z.enum(CUSTOMER_SUPPLIED_ITEM).optional(),
  descriptionInternal: z.string().trim().max(2000).nullable().optional(),
  categoryKey: CategoryKey.nullable().optional(),
});
export type UpdateCatalogItemInput = z.infer<typeof UpdateCatalogItemInput>;

export type CatalogError = { code: string; message: string; field?: string };
export type CatalogResult<T> = ({ ok: true } & T) | { ok: false; errors: CatalogError[] };

function zodErrors(e: z.ZodError): CatalogError[] {
  return e.issues.map((i) => ({
    code: 'INVALID_INPUT',
    field: i.path.map(String).join('.') || undefined,
    message: i.message,
  }));
}

async function categoryId(db: Queryable, key: string): Promise<string | null> {
  return (
    ((await db.query('select id from category where key = $1 and is_active', [key])).rows[0]?.id as
      string | undefined) ?? null
  );
}

function domainIssues(item: CatalogItem): CatalogError[] {
  return validateCatalogItem(item).map((code) => ({ code, message: code }));
}

export async function createCatalogItem(
  db: Queryable,
  raw: unknown,
): Promise<CatalogResult<{ id: string; publicCode: string }>> {
  const parsed = CreateCatalogItemInput.safeParse(raw);
  if (!parsed.success) return { ok: false, errors: zodErrors(parsed.error) };
  const v = parsed.data;
  if (v.kind === 'SERVICE' && !v.customerSuppliedItem)
    return {
      ok: false,
      errors: [
        {
          code: 'CUSTOMER_SUPPLIED_REQUIRED',
          field: 'customerSuppliedItem',
          message: 'a SERVICE must state ALLOWED, REQUIRED or NOT_APPLICABLE explicitly',
        },
      ],
    };
  const customerSupplied = v.kind === 'SERVICE' ? v.customerSuppliedItem! : 'NOT_APPLICABLE';
  if (v.kind === 'PRODUCT' && v.customerSuppliedItem && v.customerSuppliedItem !== 'NOT_APPLICABLE')
    return {
      ok: false,
      errors: [
        {
          code: 'CUSTOMER_SUPPLIED_ONLY_FOR_SERVICE',
          field: 'customerSuppliedItem',
          message: 'customer supplied item applies only to SERVICE',
        },
      ],
    };
  const issues = domainIssues({
    id: '00000000-0000-0000-0000-000000000000',
    publicCode: 'DTG-00000',
    kind: v.kind,
    canonicalName: v.name,
    status: v.status,
    saleUnit: v.saleUnit ?? null,
    measurementSpec: null,
    decorationPolicy: v.decorationPolicy,
    customerSuppliedItem: customerSupplied,
    descriptionInternal: v.descriptionInternal ?? null,
    mergedIntoId: null,
  } as CatalogItem).filter((i) => i.code !== 'INVALID_PUBLIC_CODE');
  if (issues.length) return { ok: false, errors: issues };
  let catId: string | null = null;
  if (v.categoryKey) {
    catId = await categoryId(db, v.categoryKey);
    if (!catId)
      return {
        ok: false,
        errors: [
          {
            code: 'CATEGORY_NOT_FOUND',
            field: 'categoryKey',
            message: `category ${v.categoryKey} not found`,
          },
        ],
      };
  }
  const row = (
    await db.query(
      `insert into catalog_item (kind, canonical_name, status, sale_unit, decoration_policy, customer_supplied_item, description_internal)
       values ($1, $2, $3, $4, $5, $6, $7) returning id, public_code`,
      [
        v.kind,
        v.name,
        v.status,
        v.saleUnit ?? null,
        v.decorationPolicy,
        customerSupplied,
        v.descriptionInternal?.trim() || null,
      ],
    )
  ).rows[0] as { id: string; public_code: string };
  if (catId) {
    await db.query(
      'insert into catalog_item_category (item_id, category_id, is_primary) values ($1, $2, true)',
      [row.id, catId],
    );
  }
  return { ok: true, id: row.id, publicCode: row.public_code };
}

export async function updateCatalogItem(
  db: Queryable,
  id: string,
  raw: unknown,
): Promise<CatalogResult<{ changed: string[] }>> {
  if (!z.uuid().safeParse(id).success)
    return { ok: false, errors: [{ code: 'NOT_FOUND', message: 'catalog item not found' }] };
  const parsed = UpdateCatalogItemInput.safeParse(raw);
  if (!parsed.success) return { ok: false, errors: zodErrors(parsed.error) };
  const v = parsed.data;
  const cur = (await db.query('select * from catalog_item where id = $1 for update', [id]))
    .rows[0] as Row | undefined;
  if (!cur)
    return { ok: false, errors: [{ code: 'NOT_FOUND', message: 'catalog item not found' }] };
  const kind = cur.kind as 'PRODUCT' | 'SERVICE';
  const next = {
    canonicalName: v.name ?? (cur.canonical_name as string),
    status: v.status ?? (cur.status as CatalogItem['status']) ?? null,
    saleUnit:
      v.saleUnit !== undefined ? v.saleUnit : ((cur.sale_unit as CatalogItem['saleUnit']) ?? null),
    decorationPolicy:
      v.decorationPolicy ?? (cur.decoration_policy as CatalogItem['decorationPolicy']),
    customerSuppliedItem:
      v.customerSuppliedItem ?? (cur.customer_supplied_item as CatalogItem['customerSuppliedItem']),
    descriptionInternal:
      v.descriptionInternal !== undefined
        ? v.descriptionInternal?.trim() || null
        : ((cur.description_internal as string | null) ?? null),
  };
  const errors: CatalogError[] = [];
  if (!canChangeStatus((cur.status as CatalogItem['status']) ?? null, next.status))
    errors.push({
      code: 'STATUS_CANNOT_RETURN_TO_UNSET',
      field: 'status',
      message: 'status cannot return to unset',
    });
  errors.push(
    ...domainIssues({
      id,
      publicCode: cur.public_code as string,
      kind,
      measurementSpec: null,
      mergedIntoId: (cur.merged_into_id as string | null) ?? null,
      ...next,
    } as CatalogItem),
  );
  if (next.decorationPolicy === 'NONE' && cur.decoration_policy !== 'NONE') {
    const caps = (
      await db.query('select count(*)::int as n from decoration_capability where item_id = $1', [
        id,
      ])
    ).rows[0].n as number;
    if (caps > 0)
      errors.push({
        code: 'DECORATION_CAPABILITIES_EXIST',
        field: 'decorationPolicy',
        message: `the item has ${caps} decoration capabilities; NONE would contradict them`,
      });
  }
  let catId: string | null | undefined;
  if (v.categoryKey !== undefined) {
    catId = v.categoryKey === null ? null : await categoryId(db, v.categoryKey);
    if (v.categoryKey !== null && !catId)
      errors.push({
        code: 'CATEGORY_NOT_FOUND',
        field: 'categoryKey',
        message: `category ${v.categoryKey} not found`,
      });
  }
  if (errors.length) return { ok: false, errors };

  const changed: string[] = [];
  const cols: [string, string, unknown, unknown][] = [
    ['name', 'canonical_name', next.canonicalName, cur.canonical_name],
    ['status', 'status', next.status, cur.status ?? null],
    ['saleUnit', 'sale_unit', next.saleUnit, cur.sale_unit ?? null],
    ['decorationPolicy', 'decoration_policy', next.decorationPolicy, cur.decoration_policy],
    [
      'customerSuppliedItem',
      'customer_supplied_item',
      next.customerSuppliedItem,
      cur.customer_supplied_item,
    ],
    [
      'descriptionInternal',
      'description_internal',
      next.descriptionInternal,
      cur.description_internal ?? null,
    ],
  ];
  const sets: string[] = [];
  const params: unknown[] = [id];
  for (const [label, col, value, old] of cols) {
    if (value !== old) {
      params.push(value);
      sets.push(`${col} = $${params.length}`);
      changed.push(label);
    }
  }
  if (sets.length)
    await db.query(`update catalog_item set ${sets.join(', ')} where id = $1`, params);
  if (catId !== undefined) {
    const current = (
      await db.query(
        'select category_id from catalog_item_category where item_id = $1 and is_primary',
        [id],
      )
    ).rows[0]?.category_id as string | undefined;
    if ((current ?? null) !== catId) {
      if (current)
        await db.query(
          'delete from catalog_item_category where item_id = $1 and category_id = $2',
          [id, current],
        );
      if (catId) {
        await db.query(
          `insert into catalog_item_category (item_id, category_id, is_primary) values ($1, $2, true)
           on conflict (item_id, category_id) do update set is_primary = true`,
          [id, catId],
        );
      }
      changed.push('category');
    }
  }
  if (!changed.length)
    return { ok: false, errors: [{ code: 'NOTHING_CHANGED', message: 'nothing changed' }] };
  return { ok: true, changed };
}
