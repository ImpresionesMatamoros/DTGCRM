import { z } from 'zod';
import type { PriceRequest } from '@/domain/configuration';
import type { PriceDefinition } from '@/domain/pricing-model';
import {
  analyzeAuthorizationConflicts,
  type Conflict,
  type ConflictReport,
} from '@/pricing/conflicts';
import { overlayDraft } from '@/pricing/overlay';
import { resolvePrice } from '@/pricing/resolve';
import type { PriceResult } from '@/pricing/result';
import { formatAmount } from '@/shared/money';
import type { Queryable } from '../client';
import {
  loadCatalogSnapshot,
  loadLiveDefinitionsInScope,
  loadPriceDefinitionsByIds,
} from '../catalog-snapshot';

/**
 * Pricing administration services (STEP 07 §28). Server-side only; every function expects to run
 * inside an audited admin transaction (`dtg.actor` / `dtg.context` set, see tx.ts) and takes the
 * application-boundary clock as an argument: the pricing domain still never reads time (ADR-0009).
 *
 * Lifecycle: DRAFT → (authorize) → AUTHORIZED → (a later authorized revision) → SUPERSEDED.
 * Authorized rows are never edited: `cloneAuthorizedToDraft` creates the next revision.
 */

type Row = Record<string, unknown>;
export interface PriceError {
  code: string;
  message: string;
  field?: string;
  detail?: unknown;
}
export type Fail = { ok: false; errors: PriceError[] };
const fail = (code: string, message: string, field?: string, detail?: unknown): Fail => ({
  ok: false,
  errors: [{ code, message, field, detail }],
});

export interface Ctx {
  actor: string;
  /** Application-boundary instant (authorization time, retroactivity check). */
  now: Date;
  reason?: string | null;
}

async function setReason(db: Queryable, reason: string | null | undefined) {
  await db.query("select set_config('dtg.reason', $1, true)", [reason?.trim() || '']);
}

// ---------------------------------------------------------------- input

const Decimal2 = z.string().regex(/^\d{1,10}(\.\d{1,2})?$/, 'monto con hasta 2 decimales');
const Condition = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('OPTION_VALUE'),
    optionKey: z.string().regex(/^[a-z][a-z0-9_]*$/),
    valueCode: z.string().min(1).max(80),
  }),
  z.strictObject({ kind: z.literal('DECORATION_METHOD'), methodKey: z.string().min(1).max(80) }),
]);
const Break = z.strictObject({
  quantity: z.number().int().positive().max(10_000_000),
  amount: Decimal2,
  amountBasis: z.enum(['TOTAL', 'UNIT']).default('TOTAL'),
});
const Iso = z.iso.datetime({ offset: true });

const DraftFields = {
  validFrom: Iso,
  validTo: Iso.nullable().optional(),
  amount: Decimal2.nullable().optional(),
  rate: z
    .string()
    .regex(/^\d{1,8}(\.\d{1,4})?$/)
    .nullable()
    .optional(),
  rateUnit: z.enum(['SQ_FT', 'LINEAR_FT']).nullable().optional(),
  minCharge: Decimal2.nullable().optional(),
  minQuantity: z.number().int().positive().nullable().optional(),
  maxQuantity: z.number().int().positive().nullable().optional(),
  conditions: z.array(Condition).max(20).default([]),
  breaks: z.array(Break).max(200).default([]),
  reason: z.string().trim().max(500).optional().nullable(),
};

export const CreateDraftInput = z.strictObject({
  itemId: z.uuid(),
  market: z.enum(['USA', 'MX']),
  component: z.enum(['ITEM', 'DECORATION']).default('ITEM'),
  model: z.enum(['FIXED', 'PER_UNIT', 'EXACT_QUANTITY_MATRIX', 'TIERED', 'MEASURED']),
  ...DraftFields,
});
export const UpdateDraftInput = z.strictObject({ definitionId: z.uuid(), ...DraftFields });
export type CreateDraftInput = z.infer<typeof CreateDraftInput>;
export type UpdateDraftInput = z.infer<typeof UpdateDraftInput>;

// ---------------------------------------------------------------- helpers

async function bookFor(
  db: Queryable,
  market: string,
): Promise<{ id: string; currency: string } | null> {
  const r = (
    await db.query(
      'select b.id, b.currency from price_book b join market m on m.id = b.market_id where m.code = $1',
      [market],
    )
  ).rows[0] as Row | undefined;
  return r ? { id: r.id as string, currency: r.currency as string } : null;
}

type ResolvedCondition =
  | { kind: 'OPTION_VALUE'; optionDefinitionId: string; optionValueId: string }
  | { kind: 'DECORATION_METHOD'; decorationMethodId: string };

async function resolveConditions(
  db: Queryable,
  itemId: string,
  conditions: z.infer<typeof Condition>[],
): Promise<{ ok: true; rows: ResolvedCondition[] } | Fail> {
  const out: ResolvedCondition[] = [];
  const seen = new Set<string>();
  for (const [i, c] of conditions.entries()) {
    const field = `conditions.${i}`;
    if (c.kind === 'OPTION_VALUE') {
      const r = (
        await db.query(
          `select d.id as def_id, v.id as value_id
             from item_option io
             join option_definition d on d.id = io.option_definition_id and d.key = $2
             join item_option_value iov on iov.item_id = io.item_id and iov.option_definition_id = d.id
             join option_value v on v.id = iov.option_value_id and v.code = $3
            where io.item_id = $1`,
          [itemId, c.optionKey, c.valueCode],
        )
      ).rows[0] as Row | undefined;
      if (!r)
        return fail(
          'CONDITION_NOT_IN_ITEM',
          `La opción ${c.optionKey}=${c.valueCode} no pertenece al artículo.`,
          field,
        );
      const key = `o:${r.def_id}:${r.value_id}`;
      if (seen.has(key)) return fail('DUPLICATE_CONDITION', 'Condición repetida.', field);
      seen.add(key);
      out.push({
        kind: 'OPTION_VALUE',
        optionDefinitionId: r.def_id as string,
        optionValueId: r.value_id as string,
      });
    } else {
      const r = (await db.query('select id from decoration_method where key = $1', [c.methodKey]))
        .rows[0] as Row | undefined;
      if (!r) return fail('UNKNOWN_METHOD', `Método ${c.methodKey} desconocido.`, field);
      const key = `m:${r.id}`;
      if (seen.has(key)) return fail('DUPLICATE_CONDITION', 'Condición repetida.', field);
      seen.add(key);
      out.push({ kind: 'DECORATION_METHOD', decorationMethodId: r.id as string });
    }
  }
  return { ok: true, rows: out };
}

function checkModelShape(
  v: Pick<
    CreateDraftInput,
    'model' | 'amount' | 'rate' | 'rateUnit' | 'maxQuantity' | 'breaks' | 'validFrom' | 'validTo'
  >,
): Fail | null {
  if (v.validTo && Date.parse(v.validTo) <= Date.parse(v.validFrom))
    return fail('INVALID_VALIDITY', 'validTo debe ser posterior a validFrom.', 'validTo');
  const qs = v.breaks.map((b) => b.quantity);
  if (new Set(qs).size !== qs.length)
    return fail('DUPLICATE_BREAK_QUANTITY', 'Cantidad repetida en la matriz.', 'breaks');
  switch (v.model) {
    case 'FIXED':
      if (v.amount == null || v.maxQuantity == null)
        return fail(
          'FIXED_NEEDS_AMOUNT_AND_MAX',
          'Precio fijo: monto y cantidad máxima.',
          'amount',
        );
      if (v.breaks.length)
        return fail('BREAKS_NOT_ALLOWED', 'Un precio fijo no lleva cortes.', 'breaks');
      break;
    case 'PER_UNIT':
      if (v.amount == null) return fail('AMOUNT_REQUIRED', 'Falta el monto por unidad.', 'amount');
      if (v.breaks.length)
        return fail('BREAKS_NOT_ALLOWED', 'Por unidad no lleva cortes.', 'breaks');
      break;
    case 'MEASURED':
      if (v.rate == null || v.rateUnit == null)
        return fail('RATE_REQUIRED', 'Falta tarifa y unidad.', 'rate');
      if (v.amount != null || v.breaks.length)
        return fail('SHAPE_NOT_ALLOWED', 'MEASURED sólo lleva tarifa.', 'amount');
      break;
    default:
      if (v.amount != null || v.rate != null)
        return fail(
          'SHAPE_NOT_ALLOWED',
          'Matriz/escalonado: los montos van en los cortes.',
          'amount',
        );
  }
  return null;
}

async function replaceChildren(
  db: Queryable,
  id: string,
  conditions: ResolvedCondition[],
  breaks: CreateDraftInput['breaks'],
) {
  await db.query('delete from price_break where price_definition_id = $1', [id]);
  await db.query('delete from price_condition where price_definition_id = $1', [id]);
  for (const c of conditions) {
    await db.query(
      `insert into price_condition (price_definition_id, kind, option_definition_id, option_value_id, decoration_method_id)
       values ($1, $2, $3, $4, $5)`,
      [
        id,
        c.kind,
        c.kind === 'OPTION_VALUE' ? c.optionDefinitionId : null,
        c.kind === 'OPTION_VALUE' ? c.optionValueId : null,
        c.kind === 'DECORATION_METHOD' ? c.decorationMethodId : null,
      ],
    );
  }
  for (const b of breaks) {
    await db.query(
      'insert into price_break (price_definition_id, quantity, amount, amount_basis) values ($1, $2, $3, $4)',
      [id, b.quantity, b.amount, b.amountBasis],
    );
  }
}

// ---------------------------------------------------------------- create / update / clone / delete

export async function createDraftPriceDefinition(db: Queryable, raw: unknown, ctx: Ctx) {
  const p = CreateDraftInput.safeParse(raw);
  if (!p.success) return zodFail(p.error);
  const v = p.data;
  const shape = checkModelShape(v);
  if (shape) return shape;
  const item = (await db.query('select 1 from catalog_item where id = $1', [v.itemId])).rows[0];
  if (!item) return fail('ITEM_NOT_FOUND', 'Artículo inexistente.', 'itemId');
  const book = await bookFor(db, v.market);
  if (!book) return fail('BOOK_NOT_FOUND', `Sin price book para ${v.market}.`, 'market');
  const conds = await resolveConditions(db, v.itemId, v.conditions);
  if (!conds.ok) return conds;
  await setReason(db, v.reason ?? ctx.reason);
  const id = (
    await db.query(
      `insert into price_definition (item_id, price_book_id, component, model, amount, rate, rate_unit,
          min_charge, min_quantity, max_quantity, status, valid_from, valid_to)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'DRAFT', $11, $12) returning id`,
      [
        v.itemId,
        book.id,
        v.component,
        v.model,
        v.amount ?? null,
        v.rate ?? null,
        v.rateUnit ?? null,
        v.minCharge ?? null,
        v.minQuantity ?? null,
        v.maxQuantity ?? null,
        v.validFrom,
        v.validTo ?? null,
      ],
    )
  ).rows[0].id as string;
  await replaceChildren(db, id, conds.rows, v.breaks);
  return { ok: true as const, definitionId: id };
}

async function loadOne(db: Queryable, id: string) {
  const row = (await db.query('select * from price_definition where id = $1 for update', [id]))
    .rows[0] as Row | undefined;
  return row ?? null;
}

export async function updateDraftPriceDefinition(db: Queryable, raw: unknown, ctx: Ctx) {
  const p = UpdateDraftInput.safeParse(raw);
  if (!p.success) return zodFail(p.error);
  const v = p.data;
  const row = await loadOne(db, v.definitionId);
  if (!row) return fail('NOT_FOUND', 'Definición inexistente.');
  if (row.status !== 'DRAFT')
    return fail(
      'NOT_DRAFT',
      `La definición está ${String(row.status)} y es inmutable. Crea una nueva revisión (borrador).`,
    );
  const shape = checkModelShape({ ...v, model: row.model as CreateDraftInput['model'] });
  if (shape) return shape;
  const conds = await resolveConditions(db, row.item_id as string, v.conditions);
  if (!conds.ok) return conds;
  if (row.supersedes_id) {
    const pred = (
      await db.query('select valid_from from price_definition where id = $1', [row.supersedes_id])
    ).rows[0] as Row;
    if (Date.parse(v.validFrom) <= new Date(pred.valid_from as string).getTime())
      return fail(
        'PREDECESSOR_WINDOW',
        'La revisión debe empezar después de la anterior.',
        'validFrom',
      );
  }
  await setReason(db, v.reason ?? ctx.reason);
  await db.query(
    `update price_definition set amount = $2, rate = $3, rate_unit = $4, min_charge = $5,
            min_quantity = $6, max_quantity = $7, valid_from = $8, valid_to = $9 where id = $1`,
    [
      v.definitionId,
      v.amount ?? null,
      v.rate ?? null,
      v.rateUnit ?? null,
      v.minCharge ?? null,
      v.minQuantity ?? null,
      v.maxQuantity ?? null,
      v.validFrom,
      v.validTo ?? null,
    ],
  );
  await replaceChildren(db, v.definitionId, conds.rows, v.breaks);
  return { ok: true as const, definitionId: v.definitionId };
}

export async function deleteDraftPriceDefinition(db: Queryable, id: string, ctx: Ctx) {
  const row = await loadOne(db, id);
  if (!row) return fail('NOT_FOUND', 'Definición inexistente.');
  if (row.status !== 'DRAFT')
    return fail('NOT_DRAFT', 'Sólo se eliminan borradores; lo demás es historia.');
  await setReason(db, ctx.reason);
  await db.query('delete from price_definition where id = $1', [id]);
  return { ok: true as const };
}

/** "Create new draft revision": copies an AUTHORIZED head into DRAFT revision n+1. Never mutates the source. */
export async function cloneAuthorizedToDraft(
  db: Queryable,
  sourceId: string,
  ctx: Ctx,
  opts: { validFrom?: string } = {},
) {
  const src = await loadOne(db, sourceId);
  if (!src) return fail('NOT_FOUND', 'Definición inexistente.');
  if (src.status !== 'AUTHORIZED')
    return fail(
      'NOT_AUTHORIZED_HEAD',
      'Sólo se clona una revisión AUTHORIZED vigente (no borradores ni sustituidas).',
    );
  const existing = (
    await db.query('select id from price_definition where supersedes_id = $1', [sourceId])
  ).rows[0] as Row | undefined;
  if (existing)
    return fail(
      'DRAFT_ALREADY_EXISTS',
      'Ya existe una revisión siguiente para esta definición.',
      undefined,
      {
        definitionId: existing.id,
      },
    );
  const srcFrom = new Date(src.valid_from as string).getTime();
  // Whole minutes (the admin edits validity with minute precision) and strictly after the source start.
  const defaultFrom = new Date(
    Math.ceil(Math.max(ctx.now.getTime(), srcFrom + 60_000) / 60_000) * 60_000,
  ).toISOString();
  const validFrom = opts.validFrom ?? defaultFrom;
  await setReason(db, ctx.reason);
  const id = (
    await db.query(
      `insert into price_definition (item_id, price_book_id, component, model, amount, rate, rate_unit,
          min_charge, min_quantity, max_quantity, status, valid_from, valid_to, version, supersedes_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'DRAFT', $11, null, $12, $13) returning id`,
      [
        src.item_id,
        src.price_book_id,
        src.component,
        src.model,
        src.amount,
        src.rate,
        src.rate_unit,
        src.min_charge,
        src.min_quantity,
        src.max_quantity,
        validFrom,
        Number(src.version) + 1,
        sourceId,
      ],
    )
  ).rows[0].id as string;
  await db.query(
    `insert into price_condition (price_definition_id, kind, option_definition_id, option_value_id, decoration_method_id)
     select $1, kind, option_definition_id, option_value_id, decoration_method_id
       from price_condition where price_definition_id = $2`,
    [id, sourceId],
  );
  await db.query(
    `insert into price_break (price_definition_id, quantity, amount, amount_basis)
     select $1, quantity, amount, amount_basis from price_break where price_definition_id = $2`,
    [id, sourceId],
  );
  return { ok: true as const, definitionId: id };
}

// ---------------------------------------------------------------- conflicts / authorize

export async function analyzeConflictsFor(
  db: Queryable,
  definitionId: string,
  now: Date,
): Promise<({ ok: true; report: ConflictReport; definition: PriceDefinition } & object) | Fail> {
  const [def] = await loadPriceDefinitionsByIds(db, [definitionId]);
  if (!def) return fail('NOT_FOUND', 'Definición inexistente.');
  if (def.status !== 'DRAFT') return fail('NOT_DRAFT', 'Sólo se analiza un borrador.');
  const set = await loadLiveDefinitionsInScope(db, def);
  return { ok: true, report: analyzeAuthorizationConflicts(def, set, { now }), definition: def };
}

/**
 * Authorizes a draft revision and, in the same transaction, supersedes its predecessor (closing the
 * predecessor's interval at the new `valid_from`). Concurrent authorizations of the same scope are
 * serialised by the guard's advisory lock; the loser re-checks against committed data and fails.
 */
export async function authorizePriceRevision(db: Queryable, definitionId: string, ctx: Ctx) {
  const row = await loadOne(db, definitionId);
  if (!row) return fail('NOT_FOUND', 'Definición inexistente.');
  if (row.status !== 'DRAFT')
    return fail('NOT_DRAFT', `La definición ya está ${String(row.status)}.`);
  // Take the scope lock BEFORE analysing, so the analysis sees every committed competitor.
  await db.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
    `price:${String(row.item_id)}:${String(row.price_book_id)}:${String(row.component)}`,
  ]);
  const analysis = await analyzeConflictsFor(db, definitionId, ctx.now);
  if (!analysis.ok) return analysis;
  if (!analysis.report.canAuthorize) {
    return {
      ok: false as const,
      errors: [
        {
          code: 'AUTHORIZATION_BLOCKED',
          message: 'Hay conflictos que impiden autorizar.',
          detail: analysis.report.blocking,
        },
      ],
    };
  }
  const def = analysis.definition;
  await setReason(db, ctx.reason);
  await db.query('savepoint authorize_revision');
  try {
    await db.query(
      `update price_definition set status = 'AUTHORIZED', authorized_by = $2, authorized_at = $3 where id = $1`,
      [definitionId, ctx.actor, ctx.now.toISOString()],
    );
    if (def.supersedesId) {
      await db.query(
        `update price_definition
            set status = 'SUPERSEDED', valid_to = $2, superseded_by_id = $3, superseded_at = $4
          where id = $1 and status = 'AUTHORIZED'`,
        [def.supersedesId, def.validFrom, definitionId, ctx.now.toISOString()],
      );
    }
  } catch (e) {
    // The database invariants are the last line of defence (e.g. a concurrent winner).
    await db.query('rollback to savepoint authorize_revision');
    return fail('AUTHORIZATION_REJECTED_BY_DATABASE', (e as Error).message);
  }
  return {
    ok: true as const,
    definitionId,
    supersededId: def.supersedesId,
    revision: def.version,
    info: analysis.report.info,
  };
}

// ---------------------------------------------------------------- simulation / comparison

export interface SimulationInput {
  market: 'USA' | 'MX';
  quantity: number;
  selections: { optionKey: string; valueCodes: string[] }[];
}

async function draftWorld(db: Queryable, draftId: string) {
  const [draft] = await loadPriceDefinitionsByIds(db, [draftId]);
  if (!draft) return null;
  const snapshot = await loadCatalogSnapshot(db);
  return { draft, snapshot, overlay: overlayDraft(snapshot, draft) };
}

/** Explicit draft simulation: resolves against the overlay; the live snapshot is never changed. */
export async function simulateDraft(
  db: Queryable,
  draftId: string,
  input: SimulationInput,
  asOf: Date,
) {
  const w = await draftWorld(db, draftId);
  if (!w) return fail('NOT_FOUND', 'Definición inexistente.');
  if (w.draft.status !== 'DRAFT') return fail('NOT_DRAFT', 'Sólo se simula un borrador.');
  const request: PriceRequest = {
    catalogItemId: w.draft.itemId,
    market: input.market,
    quantity: input.quantity,
    selections: input.selections,
  };
  return {
    ok: true as const,
    draft: resolvePrice(request, w.overlay, asOf),
    current: resolvePrice(request, w.snapshot, asOf),
  };
}

export interface ImpactRow {
  quantity: number;
  current: string | null;
  draft: string | null;
  delta: string | null;
  currentStatus: PriceResult['status'];
  draftStatus: PriceResult['status'];
  /** Mexico under the CURRENT provisional parameters, for the draft (preview only). */
  mxDraft: string | null;
  mxStatus: PriceResult['status'] | null;
}

const totalOf = (r: PriceResult) => (r.status === 'RESOLVED' ? formatAmount(r.total) : null);

/** Qty / current / draft / delta for every quantity of a matrix (or the single fixed quantity). */
export async function impactPreview(db: Queryable, draftId: string, asOf: Date) {
  const w = await draftWorld(db, draftId);
  if (!w) return fail('NOT_FOUND', 'Definición inexistente.');
  const { draft } = w;
  const condRows = (
    await db.query(
      `select d.key as option_key, v.code as value_code from price_condition pc
         join option_definition d on d.id = pc.option_definition_id
         join option_value v on v.id = pc.option_value_id
        where pc.price_definition_id = $1 and pc.kind = 'OPTION_VALUE' order by d.key, v.code`,
      [draftId],
    )
  ).rows as Row[];
  const selections = new Map<string, string[]>();
  for (const c of condRows) {
    if (!selections.has(c.option_key as string))
      selections.set(c.option_key as string, [c.value_code as string]);
  }
  const sel = [...selections].map(([optionKey, valueCodes]) => ({ optionKey, valueCodes }));
  const book = w.snapshot.priceBooks.find((b) => b.id === draft.priceBookId);
  const market = (w.snapshot.markets.find((m) => m.id === book?.marketId)?.code ?? 'USA') as
    'USA' | 'MX';

  const quantities = new Set<number>();
  if ('breaks' in draft) draft.breaks.forEach((b) => quantities.add(b.quantity));
  // Quantities of the revision being replaced, so removed rows show as "now → quote only".
  const live = w.snapshot.priceDefinitions.find((d) => d.id === draft.supersedesId);
  if (live && 'breaks' in live) live.breaks.forEach((b) => quantities.add(b.quantity));
  if (draft.model === 'FIXED') quantities.add(draft.maxQuantity);
  if (draft.model === 'PER_UNIT') quantities.add(draft.minQuantity ?? 1);

  const rows: ImpactRow[] = [];
  for (const quantity of [...quantities].sort((a, b) => a - b)) {
    const req: PriceRequest = { catalogItemId: draft.itemId, market, quantity, selections: sel };
    const cur = resolvePrice(req, w.snapshot, asOf);
    const dra = resolvePrice(req, w.overlay, asOf);
    const c = totalOf(cur);
    const d = totalOf(dra);
    let mxDraft: string | null = null;
    let mxStatus: PriceResult['status'] | null = null;
    if (market === 'USA') {
      const mx = resolvePrice({ ...req, market: 'MX' }, w.overlay, asOf);
      mxStatus = mx.status;
      mxDraft = totalOf(mx);
    }
    rows.push({
      quantity,
      current: c,
      draft: d,
      delta: c !== null && d !== null ? (Number(d) - Number(c)).toFixed(2) : null,
      currentStatus: cur.status,
      draftStatus: dra.status,
      mxDraft,
      mxStatus,
    });
  }
  return { ok: true as const, asOf: asOf.toISOString(), market, rows };
}

export interface RevisionDelta {
  fields: { field: string; from: string | null; to: string | null }[];
  conditions: { added: string[]; removed: string[] };
  breaks: { quantity: number; from: string | null; to: string | null; delta: string | null }[];
}

const label = (r: Row) =>
  r.kind === 'OPTION_VALUE'
    ? `${String(r.option_key)}=${String(r.value_code)}`
    : `método:${String(r.method_key)}`;

async function snapshotOf(db: Queryable, id: string) {
  const d = (await db.query('select * from price_definition where id = $1', [id])).rows[0] as
    Row | undefined;
  if (!d) return null;
  const conditions = (
    await db.query(
      `select pc.kind, od.key as option_key, v.code as value_code, m.key as method_key
         from price_condition pc left join option_definition od on od.id = pc.option_definition_id
         left join option_value v on v.id = pc.option_value_id
         left join decoration_method m on m.id = pc.decoration_method_id
        where pc.price_definition_id = $1`,
      [id],
    )
  ).rows.map(label);
  const breaks = (
    await db.query('select quantity, amount from price_break where price_definition_id = $1', [id])
  ).rows as Row[];
  return { d, conditions, breaks };
}

const f2 = (v: unknown) => (v === null || v === undefined ? null : Number(v).toFixed(2));
const isoOrNull = (v: unknown) =>
  v === null || v === undefined ? null : new Date(v as string).toISOString();

/** Meaningful delta between two revisions (no generic diff engine). */
export async function compareRevisions(db: Queryable, fromId: string, toId: string) {
  const a = await snapshotOf(db, fromId);
  const b = await snapshotOf(db, toId);
  if (!a || !b) return fail('NOT_FOUND', 'Definición inexistente.');
  const fields: RevisionDelta['fields'] = [];
  const cmp = (field: string, x: string | null, y: string | null) => {
    if (x !== y) fields.push({ field, from: x, to: y });
  };
  cmp('model', String(a.d.model), String(b.d.model));
  cmp('amount', f2(a.d.amount), f2(b.d.amount));
  cmp(
    'rate',
    a.d.rate === null ? null : String(a.d.rate),
    b.d.rate === null ? null : String(b.d.rate),
  );
  cmp('minCharge', f2(a.d.min_charge), f2(b.d.min_charge));
  cmp(
    'minQuantity',
    a.d.min_quantity === null ? null : String(a.d.min_quantity),
    b.d.min_quantity === null ? null : String(b.d.min_quantity),
  );
  cmp(
    'maxQuantity',
    a.d.max_quantity === null ? null : String(a.d.max_quantity),
    b.d.max_quantity === null ? null : String(b.d.max_quantity),
  );
  cmp('validFrom', isoOrNull(a.d.valid_from), isoOrNull(b.d.valid_from));
  cmp('validTo', isoOrNull(a.d.valid_to), isoOrNull(b.d.valid_to));
  const ca = new Set(a.conditions);
  const cb = new Set(b.conditions);
  const qs = new Set([...a.breaks, ...b.breaks].map((x) => Number(x.quantity)));
  const amountAt = (list: Row[], q: number) => {
    const hit = list.find((x) => Number(x.quantity) === q);
    return hit ? f2(hit.amount) : null;
  };
  const breaks = [...qs]
    .sort((x, y) => x - y)
    .map((quantity) => {
      const from = amountAt(a.breaks, quantity);
      const to = amountAt(b.breaks, quantity);
      return {
        quantity,
        from,
        to,
        delta: from !== null && to !== null ? (Number(to) - Number(from)).toFixed(2) : null,
      };
    })
    .filter((r) => r.from !== r.to);
  const delta: RevisionDelta = {
    fields,
    conditions: {
      added: [...cb].filter((x) => !ca.has(x)).sort(),
      removed: [...ca].filter((x) => !cb.has(x)).sort(),
    },
    breaks,
  };
  return { ok: true as const, delta };
}

// ---------------------------------------------------------------- lineage / history

export interface LineageEntry {
  id: string;
  version: number;
  status: string;
  validFrom: string;
  validTo: string | null;
  authorizedBy: string | null;
  authorizedAt: string | null;
  supersedesId: string | null;
  supersededById: string | null;
  supersededAt: string | null;
}

export async function lineageOf(db: Queryable, definitionId: string): Promise<LineageEntry[]> {
  const rows = (
    await db.query(
      `select * from price_definition where lineage_id = (select lineage_id from price_definition where id = $1)
        order by version`,
      [definitionId],
    )
  ).rows as Row[];
  return rows.map((r) => ({
    id: r.id as string,
    version: Number(r.version),
    status: r.status as string,
    validFrom: isoOrNull(r.valid_from)!,
    validTo: isoOrNull(r.valid_to),
    authorizedBy: (r.authorized_by as string | null) ?? null,
    authorizedAt: isoOrNull(r.authorized_at),
    supersedesId: (r.supersedes_id as string | null) ?? null,
    supersededById: (r.superseded_by_id as string | null) ?? null,
    supersededAt: isoOrNull(r.superseded_at),
  }));
}

export interface HistoryEvent {
  revision: number;
  table: string;
  action: string;
  changedBy: string;
  context: string | null;
  reason: string | null;
  changedAt: string;
  summary: string;
}

/** change_event rows of the definition and its breaks/conditions, newest first. */
export async function priceHistory(db: Queryable, definitionId: string): Promise<HistoryEvent[]> {
  const rows = (
    await db.query(
      `select revision, table_name, action, changed_by, context, reason, changed_at, old_row, new_row
         from change_event
        where scope = 'PRICING'
          and ((table_name = 'price_definition' and entity_key = $1)
            or (table_name in ('price_break', 'price_condition')
                and coalesce(new_row, old_row) ->> 'price_definition_id' = $1))
        order by revision desc limit 200`,
      [definitionId],
    )
  ).rows as Row[];
  return rows.map((r) => {
    const o = (r.old_row as Row | null) ?? {};
    const n = (r.new_row as Row | null) ?? {};
    let summary = `${String(r.action)} ${String(r.table_name)}`;
    if (r.table_name === 'price_definition' && r.action === 'UPDATE' && o.status !== n.status) {
      summary = `${String(o.status)} → ${String(n.status)}`;
    } else if (r.table_name === 'price_definition' && r.action === 'INSERT') {
      summary = `borrador creado (rev. ${String(n.version)})`;
    } else if (r.table_name === 'price_break') {
      summary =
        r.action === 'DELETE'
          ? `corte ${String(o.quantity)} eliminado`
          : `corte ${String(n.quantity)} = ${f2(n.amount)}`;
    }
    return {
      revision: Number(r.revision),
      table: r.table_name as string,
      action: r.action as string,
      changedBy: r.changed_by as string,
      context: (r.context as string | null) ?? null,
      reason: (r.reason as string | null) ?? null,
      changedAt: isoOrNull(r.changed_at)!,
      summary,
    };
  });
}

// ---------------------------------------------------------------- market policy

export const SetPolicyInput = z.strictObject({
  itemId: z.uuid(),
  market: z.enum(['USA', 'MX']),
  pricingMode: z.enum(['INHERIT', 'DERIVED', 'MANUAL', 'QUOTE_ONLY']),
  factorOverride: z
    .string()
    .regex(/^\d{1,4}(\.\d{1,4})?$/)
    .nullable()
    .optional(),
  isAvailable: z.boolean().default(true),
  reason: z.string().trim().max(500).optional().nullable(),
});

export async function setItemMarketPolicy(db: Queryable, raw: unknown, ctx: Ctx) {
  const p = SetPolicyInput.safeParse(raw);
  if (!p.success) return zodFail(p.error);
  const v = p.data;
  const factor = v.factorOverride ?? null;
  if (factor !== null && !(Number(factor) > 0))
    return fail('INVALID_FACTOR', 'El factor debe ser mayor que 0.', 'factorOverride');
  if (factor !== null && !['INHERIT', 'DERIVED'].includes(v.pricingMode))
    return fail(
      'FACTOR_NOT_ALLOWED',
      'Sólo INHERIT/DERIVED admiten factor propio.',
      'factorOverride',
    );
  const m = (await db.query('select id from market where code = $1', [v.market])).rows[0] as
    Row | undefined;
  if (!m) return fail('MARKET_NOT_FOUND', 'Mercado inexistente.');
  if (!(await db.query('select 1 from catalog_item where id = $1', [v.itemId])).rows[0])
    return fail('ITEM_NOT_FOUND', 'Artículo inexistente.', 'itemId');
  const book = (await db.query('select mode from price_book where market_id = $1', [m.id]))
    .rows[0] as Row;
  if (v.pricingMode === 'DERIVED' && book.mode !== 'DERIVED')
    return fail(
      'DERIVED_NEEDS_DERIVED_BOOK',
      `El mercado ${v.market} no deriva de otro price book.`,
      'pricingMode',
    );
  const before = (
    await db.query('select * from item_market_policy where item_id = $1 and market_id = $2', [
      v.itemId,
      m.id,
    ])
  ).rows[0] as Row | undefined;
  await setReason(db, v.reason ?? ctx.reason);
  await db.query(
    `insert into item_market_policy (item_id, market_id, pricing_mode, factor_override, is_available)
     values ($1, $2, $3, $4, $5)
     on conflict (item_id, market_id) do update
        set pricing_mode = excluded.pricing_mode, factor_override = excluded.factor_override,
            is_available = excluded.is_available`,
    [v.itemId, m.id, v.pricingMode, factor, v.isAvailable],
  );
  return {
    ok: true as const,
    before: before
      ? {
          pricingMode: before.pricing_mode as string,
          factorOverride: before.factor_override as string | null,
        }
      : null,
  };
}

// ---------------------------------------------------------------- FX / parameters

export const FxRevisionInput = z.strictObject({
  key: z.literal('usd_mxn_fx'),
  value: z.string().regex(/^\d{1,4}(\.\d{1,6})?$/),
  validFrom: Iso,
  reason: z.string().trim().max(500).optional().nullable(),
});

/**
 * New effective-dated FX revision. It can only be appended after the latest revision and never
 * in the past: the open revision is closed at the new `valid_from`; nothing already effective changes.
 */
export async function createFxParameterRevision(db: Queryable, raw: unknown, ctx: Ctx) {
  const p = FxRevisionInput.safeParse(raw);
  if (!p.success) return zodFail(p.error);
  const v = p.data;
  if (!(Number(v.value) > 0))
    return fail('INVALID_VALUE', 'El valor debe ser mayor que 0.', 'value');
  if (Date.parse(v.validFrom) < ctx.now.getTime())
    return fail(
      'RETROACTIVE_PARAMETER',
      'Una revisión de FX no puede empezar en el pasado.',
      'validFrom',
    );
  const last = (
    await db.query(
      'select id, valid_from, valid_to from pricing_parameter where key = $1 order by valid_from desc limit 1 for update',
      [v.key],
    )
  ).rows[0] as Row | undefined;
  if (last) {
    if (Date.parse(v.validFrom) <= new Date(last.valid_from as string).getTime())
      return fail(
        'NOT_AFTER_LATEST',
        'Debe empezar después de la revisión más reciente.',
        'validFrom',
      );
    if (last.valid_to !== null && last.valid_to !== undefined)
      return fail('LATEST_ALREADY_CLOSED', 'La última revisión ya está cerrada.', 'validFrom');
  }
  await setReason(db, v.reason ?? ctx.reason);
  if (last) {
    await db.query('update pricing_parameter set valid_to = $2 where id = $1', [
      last.id,
      v.validFrom,
    ]);
  }
  const id = (
    await db.query(
      'insert into pricing_parameter (key, value, valid_from) values ($1, $2, $3) returning id',
      [v.key, v.value, v.validFrom],
    )
  ).rows[0].id as string;
  return { ok: true as const, parameterId: id };
}

// ---------------------------------------------------------------- misc

function zodFail(e: z.ZodError): Fail {
  return {
    ok: false,
    errors: e.issues.map((i) => ({
      code: 'INVALID_INPUT',
      field: i.path.map(String).join('.') || undefined,
      message: i.message,
    })),
  };
}

export type { Conflict, ConflictReport };
