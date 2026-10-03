import type { PoolClient } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { itemId } from '../../data/dev-slice';
import {
  authorizePriceHandler,
  cloneToDraftHandler,
  createPriceDraftHandler,
  updatePriceDraftHandler,
} from '@/admin/handlers';
import type { Actor } from '@/admin/permissions';
import {
  analyzeConflictsFor,
  authorizePriceRevision,
  cloneAuthorizedToDraft,
  compareRevisions,
  createDraftPriceDefinition,
  createFxParameterRevision,
  impactPreview,
  lineageOf,
  priceHistory,
  setItemMarketPolicy,
  simulateDraft,
  updateDraftPriceDefinition,
} from '@/db/admin/price-admin';
import { loadCatalogSnapshot } from '@/db/catalog-snapshot';
import { setActorContext } from '@/db/admin/tx';
import { resolvePrice } from '@/pricing/resolve';
import { ACTOR, must, rollbackRunner } from './admin-helpers';
import { expectDbError, pool, withRollback } from './helpers';

afterAll(() => pool.end());

const NOW = new Date('2026-10-01T12:00:00Z');
const AUTHORIZER: Actor = { name: 'auth@test', source: 'env', role: 'local_price_authorizer' };
const ctx = (extra: { reason?: string; now?: Date } = {}) => ({
  actor: 'martin@test',
  now: extra.now ?? NOW,
  reason: extra.reason,
});

const CARD = itemId('tarjeta_premium');
const CARD_2 = { optionKey: 'caras', valueCodes: ['2'] };

async function live(
  c: PoolClient,
  qty: number,
  asOf: Date,
  market: 'USA' | 'MX' = 'USA',
  item: string = CARD,
  selections: { optionKey: string; valueCodes: string[] }[] = [CARD_2],
) {
  return resolvePrice(
    { catalogItemId: item, market, quantity: qty, selections },
    await loadCatalogSnapshot(c),
    asOf,
  );
}
const total = (r: Awaited<ReturnType<typeof live>>) =>
  r.status === 'RESOLVED' ? `${r.total.amount.toFixed(2)} ${r.total.currency}` : r.status;

/** The authorized caras=2 matrix of the Premium card (real STEP 05 data). */
async function cardHead(c: PoolClient) {
  return (
    await c.query(
      `select d.id from price_definition d where d.item_id = $1 and d.status = 'AUTHORIZED'
          and exists (select 1 from price_condition pc join option_value v on v.id = pc.option_value_id
                       where pc.price_definition_id = d.id and v.code = '2')`,
      [CARD],
    )
  ).rows[0].id as string;
}

async function cloneAndEdit(c: PoolClient, validFrom: string, amount500 = '130.00') {
  const head = await cardHead(c);
  const clone = must(await cloneAuthorizedToDraft(c, head, ctx(), { validFrom }));
  const breaks = (
    await c.query(
      'select quantity, amount, amount_basis from price_break where price_definition_id = $1 order by quantity',
      [clone.definitionId],
    )
  ).rows.map((b) => ({
    quantity: Number(b.quantity),
    amount: b.quantity === 500 ? amount500 : Number(b.amount).toFixed(2),
    amountBasis: b.amount_basis as 'TOTAL' | 'UNIT',
  }));
  must(
    await updateDraftPriceDefinition(
      c,
      {
        definitionId: clone.definitionId,
        validFrom,
        conditions: [{ kind: 'OPTION_VALUE', optionKey: 'caras', valueCode: '2' }],
        breaks,
      },
      ctx(),
    ),
  );
  return { head, draft: clone.definitionId };
}

describe('price lifecycle — draft → authorized → superseded', () => {
  it('clone creates DRAFT rev 2 in the same lineage and never mutates the authorized revision', () =>
    withRollback(async (c) => {
      await setActorContext(c, 'martin@test', 'test');
      const head = await cardHead(c);
      const before = (await c.query('select * from price_definition where id = $1', [head]))
        .rows[0];
      const { draft } = await cloneAndEdit(c, '2026-11-01T00:00:00Z');
      const after = (await c.query('select * from price_definition where id = $1', [head])).rows[0];
      expect(after).toEqual(before);
      const d = (await c.query('select * from price_definition where id = $1', [draft])).rows[0];
      expect(d).toMatchObject({
        status: 'DRAFT',
        version: 2,
        supersedes_id: head,
        lineage_id: before.lineage_id,
      });
      expect((await lineageOf(c, draft)).map((l) => [l.version, l.status])).toEqual([
        [1, 'AUTHORIZED'],
        [2, 'DRAFT'],
      ]);
    }));

  it('drafts are invisible to normal resolution; draft simulation is explicit and isolated', () =>
    withRollback(async (c) => {
      await setActorContext(c, 'martin@test', 'test');
      const { draft } = await cloneAndEdit(c, '2026-11-01T00:00:00Z');
      const asOf = new Date('2026-11-02T00:00:00Z');
      expect(total(await live(c, 500, asOf))).toBe('120.00 USD'); // normal resolver: authorized only
      const sim = must(
        await simulateDraft(c, draft, { market: 'USA', quantity: 500, selections: [CARD_2] }, asOf),
      );
      expect(sim.draft.status === 'RESOLVED' && sim.draft.total.amount.toFixed(2)).toBe('130.00');
      expect(sim.current.status === 'RESOLVED' && sim.current.total.amount.toFixed(2)).toBe(
        '120.00',
      );
      // before the draft's own validFrom the draft simulation still answers with the current price
      const early = must(
        await simulateDraft(c, draft, { market: 'USA', quantity: 500, selections: [CARD_2] }, NOW),
      );
      expect(early.draft.status === 'RESOLVED' && early.draft.total.amount.toFixed(2)).toBe(
        '120.00',
      );
    }));

  it('an authorized revision cannot be edited through the service nor by direct SQL', () =>
    withRollback(async (c) => {
      await setActorContext(c, 'martin@test', 'test');
      const head = await cardHead(c);
      const r = await updateDraftPriceDefinition(
        c,
        { definitionId: head, validFrom: '2026-09-15T00:00:00Z', conditions: [], breaks: [] },
        ctx(),
      );
      expect(r).toMatchObject({ ok: false, errors: [{ code: 'NOT_DRAFT' }] });
      await expectDbError(
        c,
        "update price_definition set valid_from = valid_from + interval '1 day' where id = $1",
        [head],
        /immutable/,
      );
      await expectDbError(
        c,
        'update price_break set amount = 1 where price_definition_id = $1',
        [head],
        /immutable/,
      );
      await expectDbError(
        c,
        'delete from price_definition where id = $1',
        [head],
        /cannot be deleted/,
      );
    }));

  it('authorize: predecessor becomes SUPERSEDED, interval closed at the successor start; history replays', () =>
    withRollback(async (c) => {
      await setActorContext(c, 'auth@test', 'test');
      const { head, draft } = await cloneAndEdit(c, '2026-11-01T00:00:00Z');
      const r = must(
        await authorizePriceRevision(c, draft, ctx({ reason: 'Nueva lista noviembre' })),
      );
      expect(r).toMatchObject({ supersededId: head, revision: 2 });

      const h = (await c.query('select * from price_definition where id = $1', [head])).rows[0];
      expect(h.status).toBe('SUPERSEDED');
      expect(new Date(h.valid_to).toISOString()).toBe('2026-11-01T00:00:00.000Z');
      expect(h.superseded_by_id).toBe(draft);
      const d = (await c.query('select * from price_definition where id = $1', [draft])).rows[0];
      expect(d).toMatchObject({ status: 'AUTHORIZED', authorized_by: 'martin@test' });
      expect(new Date(d.authorized_at).toISOString()).toBe(NOW.toISOString());

      // past / current / future resolution
      expect(total(await live(c, 500, new Date('2026-09-20T00:00:00Z')))).toBe('120.00 USD'); // history (superseded rev 1)
      expect(total(await live(c, 500, NOW))).toBe('120.00 USD'); // today: future revision does not leak
      expect(total(await live(c, 500, new Date('2026-10-31T23:59:59Z')))).toBe('120.00 USD');
      expect(total(await live(c, 500, new Date('2026-11-01T00:00:00Z')))).toBe('130.00 USD'); // [from, to)
      expect(total(await live(c, 500, new Date('2027-06-01T00:00:00Z')))).toBe('130.00 USD'); // open-ended
      // before any revision existed
      expect((await live(c, 500, new Date('2026-09-01T00:00:00Z'))).status).toBe('QUOTE_ONLY');
      // Mexico derives from whichever USA revision is effective
      expect(total(await live(c, 500, new Date('2026-12-01T00:00:00Z'), 'MX'))).toBe('1501.50 MXN'); // 130 × .70 × 16.5
    }));

  it('audit trail: who, when, why — authorization and supersession are explicit events', () =>
    withRollback(async (c) => {
      await setActorContext(c, 'auth@test', 'admin:price.authorize');
      const { head, draft } = await cloneAndEdit(c, '2026-11-01T00:00:00Z');
      await c.query("select set_config('dtg.reason', '', true)");
      must(await authorizePriceRevision(c, draft, ctx({ reason: 'Lista de noviembre' })));
      const events = await priceHistory(c, draft);
      const auth = events.find((e) => e.summary === 'DRAFT → AUTHORIZED');
      expect(auth).toMatchObject({
        changedBy: 'auth@test',
        context: 'admin:price.authorize',
        reason: 'Lista de noviembre',
      });
      const sup = await priceHistory(c, head);
      expect(sup.find((e) => e.summary === 'AUTHORIZED → SUPERSEDED')).toMatchObject({
        changedBy: 'auth@test',
        reason: 'Lista de noviembre',
      });
      // before/after sufficient to reconstruct: the change_event carries both rows
      const raw = (
        await c.query(
          `select old_row ->> 'status' as o, new_row ->> 'status' as n from change_event
            where table_name = 'price_definition' and entity_key = $1 and action = 'UPDATE' order by revision desc limit 1`,
          [head],
        )
      ).rows[0];
      expect(raw).toEqual({ o: 'AUTHORIZED', n: 'SUPERSEDED' });
    }));

  it('a superseded revision is history: it cannot be cloned, reopened or extended', () =>
    withRollback(async (c) => {
      await setActorContext(c, 'auth@test', 'test');
      const { head, draft } = await cloneAndEdit(c, '2026-11-01T00:00:00Z');
      must(await authorizePriceRevision(c, draft, ctx()));
      expect(await cloneAuthorizedToDraft(c, head, ctx())).toMatchObject({
        ok: false,
        errors: [{ code: 'NOT_AUTHORIZED_HEAD' }],
      });
      await expectDbError(
        c,
        "update price_definition set valid_to = '2027-01-01' where id = $1",
        [head],
        /already closed/,
      );
      await expectDbError(
        c,
        "update price_definition set status = 'AUTHORIZED' where id = $1",
        [head],
        /immutable/,
      );
      // the head can be cloned again for revision 3
      const rev3 = must(
        await cloneAuthorizedToDraft(c, draft, ctx({ now: new Date('2026-12-01T00:00:00Z') })),
      );
      const row = (
        await c.query('select version, lineage_id from price_definition where id = $1', [
          rev3.definitionId,
        ])
      ).rows[0];
      expect(Number(row.version)).toBe(3);
      expect((await lineageOf(c, rev3.definitionId)).map((l) => l.version)).toEqual([1, 2, 3]);
    }));

  it('a second draft of the same revision is refused', () =>
    withRollback(async (c) => {
      await setActorContext(c, 'martin@test', 'test');
      const { head } = await cloneAndEdit(c, '2026-11-01T00:00:00Z');
      expect(await cloneAuthorizedToDraft(c, head, ctx())).toMatchObject({
        ok: false,
        errors: [{ code: 'DRAFT_ALREADY_EXISTS' }],
      });
    }));

  it('retroactive supersession is blocked (it would rewrite what a past asOf returns)', () =>
    withRollback(async (c) => {
      await setActorContext(c, 'auth@test', 'test');
      const { draft } = await cloneAndEdit(c, '2026-09-20T00:00:00Z');
      const r = await authorizePriceRevision(c, draft, ctx());
      expect(r).toMatchObject({ ok: false, errors: [{ code: 'AUTHORIZATION_BLOCKED' }] });
      const blocking = (r as { errors: { detail: { kind: string }[] }[] }).errors[0]!.detail;
      expect(blocking.map((b) => b.kind)).toContain('RETROACTIVE_SUPERSESSION');
    }));

  it('impact preview and revision comparison show the delta per quantity', () =>
    withRollback(async (c) => {
      await setActorContext(c, 'martin@test', 'test');
      const { head, draft } = await cloneAndEdit(c, '2026-11-01T00:00:00Z');
      const imp = must(await impactPreview(c, draft, new Date('2026-11-02T00:00:00Z')));
      expect(imp.market).toBe('USA');
      expect(imp.rows.find((r) => r.quantity === 500)).toMatchObject({
        current: '120.00',
        draft: '130.00',
        delta: '10.00',
        mxDraft: '1501.50',
      });
      expect(imp.rows.find((r) => r.quantity === 100)!.delta).toBe('0.00');
      const cmp = must(await compareRevisions(c, head, draft));
      expect(cmp.delta.breaks).toEqual([
        { quantity: 500, from: '120.00', to: '130.00', delta: '10.00' },
      ]);
      expect(cmp.delta.fields.map((f) => f.field)).toEqual(['validFrom']);
      expect(cmp.delta.conditions).toEqual({ added: [], removed: [] });
    }));
});

describe('authorization boundary (capability, D-016 stays open)', () => {
  it('only the controlled dev authorizer may authorize; the normal dev actor is FORBIDDEN', () =>
    withRollback(async (c) => {
      const tx = rollbackRunner(c);
      await setActorContext(c, 'x', 'test');
      const { draft } = await cloneAndEdit(c, '2026-11-01T00:00:00Z');
      expect(await authorizePriceHandler(tx, ACTOR, { definitionId: draft }, NOW)).toMatchObject({
        ok: false,
        errors: [{ code: 'FORBIDDEN' }],
      });
      expect(await authorizePriceHandler(tx, null, { definitionId: draft }, NOW)).toMatchObject({
        ok: false,
        errors: [{ code: 'ACTOR_REQUIRED' }],
      });
      expect(
        (await c.query('select status from price_definition where id = $1', [draft])).rows[0]
          .status,
      ).toBe('DRAFT');
      const ok = await authorizePriceHandler(
        tx,
        AUTHORIZER,
        { definitionId: draft, reason: 'ok' },
        NOW,
      );
      expect(ok).toMatchObject({ ok: true, revision: 2 });
      // handlers validate input like a direct POST would
      expect(
        await authorizePriceHandler(tx, AUTHORIZER, { definitionId: 'nope' }, NOW),
      ).toMatchObject({
        ok: false,
        errors: [{ code: 'INVALID_INPUT' }],
      });
    }));

  it('editing handlers need price.edit and refuse authorized rows', () =>
    withRollback(async (c) => {
      const tx = rollbackRunner(c);
      const head = await cardHead(c);
      expect(await cloneToDraftHandler(tx, null, { definitionId: head }, NOW)).toMatchObject({
        ok: false,
      });
      const cl = must(
        await cloneToDraftHandler(
          tx,
          ACTOR,
          { definitionId: head, validFrom: '2026-11-01T00:00:00Z' },
          NOW,
        ),
      );
      expect(
        await updatePriceDraftHandler(
          tx,
          ACTOR,
          { definitionId: head, validFrom: '2026-11-01T00:00:00Z', conditions: [], breaks: [] },
          NOW,
        ),
      ).toMatchObject({ ok: false, errors: [{ code: 'NOT_DRAFT' }] });
      expect(cl.definitionId).toBeTruthy();
      const bad = await createPriceDraftHandler(
        tx,
        ACTOR,
        {
          itemId: CARD,
          market: 'USA',
          model: 'EXACT_QUANTITY_MATRIX',
          validFrom: '2026-11-01T00:00:00Z',
          surprise: 1,
        },
        NOW,
      );
      expect(bad).toMatchObject({ ok: false, errors: [{ code: 'INVALID_INPUT' }] });
    }));
});

describe('overlap / ambiguity protection', () => {
  const baseDraft = (over: Record<string, unknown>) => ({
    itemId: CARD,
    market: 'USA',
    model: 'EXACT_QUANTITY_MATRIX',
    validFrom: '2026-09-15T00:00:00Z',
    conditions: [{ kind: 'OPTION_VALUE', optionKey: 'caras', valueCode: '2' }],
    breaks: [{ quantity: 100, amount: '49.00', amountBasis: 'TOTAL' }],
    ...over,
  });
  const analyze = async (c: PoolClient, over: Record<string, unknown>) => {
    const d = must(await createDraftPriceDefinition(c, baseDraft(over), ctx()));
    const a = await analyzeConflictsFor(c, d.definitionId, NOW);
    if (!a.ok) throw new Error(JSON.stringify(a));
    return { id: d.definitionId, report: a.report };
  };

  it('same item + market + conditions + overlapping interval → IDENTICAL_SCOPE blocks, DB agrees', () =>
    withRollback(async (c) => {
      await setActorContext(c, 'auth@test', 'test');
      const { id, report } = await analyze(c, {});
      expect(report.canAuthorize).toBe(false);
      expect(report.blocking.map((b) => b.kind)).toEqual(['IDENTICAL_SCOPE']);
      const r = await authorizePriceRevision(c, id, ctx());
      expect(r).toMatchObject({ ok: false, errors: [{ code: 'AUTHORIZATION_BLOCKED' }] });
      await expectDbError(
        c,
        "update price_definition set status = 'AUTHORIZED', authorized_by = 'x', authorized_at = now() where id = $1",
        [id],
        /already covers the same scope/,
      );
    }));

  it('equal specificity with compatible (different) conditions → SPECIFICITY_TIE blocks', () =>
    withRollback(async (c) => {
      await setActorContext(c, 'auth@test', 'test');
      const { report } = await analyze(c, {
        conditions: [{ kind: 'DECORATION_METHOD', methodKey: 'DTF' }],
      });
      // ties with both caras=1 and caras=2 matrices (a DTF-only definition could match either)
      expect(report.blocking.map((b) => b.kind)).toEqual(['SPECIFICITY_TIE', 'SPECIFICITY_TIE']);
      expect(report.blocking[0]!.message).toContain('AMBIGUOUS');
    }));

  it('more specific vs less specific → allowed, reported as PRECEDENCE (resolver picks the specific one)', () =>
    withRollback(async (c) => {
      await setActorContext(c, 'auth@test', 'test');
      const { id, report } = await analyze(c, {
        conditions: [
          { kind: 'OPTION_VALUE', optionKey: 'caras', valueCode: '2' },
          { kind: 'DECORATION_METHOD', methodKey: 'DTF' },
        ],
      });
      expect(report.blocking).toEqual([]);
      expect(report.info.map((i) => i.kind)).toEqual(['PRECEDENCE']);
      must(await authorizePriceRevision(c, id, ctx()));
    }));

  it('disjoint option values never conflict', () =>
    withRollback(async (c) => {
      await setActorContext(c, 'auth@test', 'test');
      const { report } = await analyze(c, {
        conditions: [{ kind: 'OPTION_VALUE', optionKey: 'caras', valueCode: '1' }],
      });
      // caras=1 exists too (identical to that one), but never to caras=2
      expect(report.blocking.map((b) => b.kind)).toEqual(['IDENTICAL_SCOPE']);
      expect(report.blocking).toHaveLength(1);
    }));

  it('non-overlapping revisions of the same scope are allowed', () =>
    withRollback(async (c) => {
      await setActorContext(c, 'auth@test', 'test');
      const { id, report } = await analyze(c, {
        validFrom: '2026-01-01T00:00:00Z',
        validTo: '2026-09-15T00:00:00Z',
      });
      expect(report.canAuthorize).toBe(true);
      must(await authorizePriceRevision(c, id, ctx()));
      // history before 2026-09-15 now resolves; nothing changes after it
      expect(total(await live(c, 100, new Date('2026-06-01T00:00:00Z')))).toBe('49.00 USD');
      expect(total(await live(c, 100, NOW))).not.toBe('49.00 USD');
    }));

  it('duplicate exact quantity breaks are rejected (service and database)', () =>
    withRollback(async (c) => {
      await setActorContext(c, 'martin@test', 'test');
      const dup = await createDraftPriceDefinition(
        c,
        baseDraft({
          breaks: [
            { quantity: 100, amount: '50.00' },
            { quantity: 100, amount: '60.00' },
          ],
        }),
        ctx(),
      );
      expect(dup).toMatchObject({ ok: false, errors: [{ code: 'DUPLICATE_BREAK_QUANTITY' }] });
      const d = must(
        await createDraftPriceDefinition(
          c,
          baseDraft({ validFrom: '2026-01-01T00:00:00Z', validTo: '2026-02-01T00:00:00Z' }),
          ctx(),
        ),
      );
      await expectDbError(
        c,
        'insert into price_break (price_definition_id, quantity, amount) values ($1, 100, 1)',
        [d.definitionId],
        /duplicate key|unique/,
      );
    }));

  it('AMBIGUOUS stays the final safety net if bad data is forced in (resolver)', () =>
    withRollback(async (c) => {
      await setActorContext(c, 'auth@test', 'test');
      const d = must(
        await createDraftPriceDefinition(
          c,
          baseDraft({
            conditions: [
              { kind: 'OPTION_VALUE', optionKey: 'caras', valueCode: '1' },
              { kind: 'OPTION_VALUE', optionKey: 'caras', valueCode: '2' },
            ],
          }),
          ctx(),
        ),
      );
      // Bypass the service analysis (as a manual SQL accident would) and authorize directly.
      await c.query(
        "update price_definition set status = 'AUTHORIZED', authorized_by = 'sql', authorized_at = now() where id = $1",
        [d.definitionId],
      );
      const r = await resolvePrice(
        {
          catalogItemId: CARD,
          market: 'USA',
          quantity: 100,
          selections: [CARD_2],
        },
        await loadCatalogSnapshot(c),
        NOW,
      );
      expect(r.status).toBe('AMBIGUOUS');
    }));
});

describe('market policy and FX administration', () => {
  it('per-item factor override changes only that item; INHERIT returns to the default', () =>
    withRollback(async (c) => {
      await setActorContext(c, 'martin@test', 'test');
      expect(total(await live(c, 500, NOW, 'MX'))).toBe('1386.00 MXN'); // 120 × 0.70 × 16.5 (provisional)
      must(
        await setItemMarketPolicy(
          c,
          { itemId: CARD, market: 'MX', pricingMode: 'DERIVED', factorOverride: '0.5' },
          ctx(),
        ),
      );
      expect(total(await live(c, 500, NOW, 'MX'))).toBe('990.00 MXN');
      expect(
        total(
          await live(c, 500, NOW, 'MX', itemId('flyers'), [
            { optionKey: 'caras', valueCodes: ['2'] },
            { optionKey: 'papel', valueCodes: ['Premium'] },
            { optionKey: 'tamano_papel', valueCodes: ['Media carta'] },
          ]),
        ),
      ).not.toBe('990.00 MXN');
      must(
        await setItemMarketPolicy(c, { itemId: CARD, market: 'MX', pricingMode: 'INHERIT' }, ctx()),
      );
      expect(total(await live(c, 500, NOW, 'MX'))).toBe('1386.00 MXN');
    }));

  it('MANUAL Mexico is strict; QUOTE_ONLY is honoured; invalid combinations are refused', () =>
    withRollback(async (c) => {
      await setActorContext(c, 'martin@test', 'test');
      must(
        await setItemMarketPolicy(c, { itemId: CARD, market: 'MX', pricingMode: 'MANUAL' }, ctx()),
      );
      const r = await live(c, 500, NOW, 'MX');
      expect(r.status === 'QUOTE_ONLY' && r.reasonCode).toBe('MANUAL_MX_PRICE_MISSING');
      must(
        await setItemMarketPolicy(
          c,
          { itemId: CARD, market: 'MX', pricingMode: 'QUOTE_ONLY' },
          ctx(),
        ),
      );
      expect((await live(c, 500, NOW, 'MX')).status).toBe('QUOTE_ONLY');
      expect(
        await setItemMarketPolicy(
          c,
          { itemId: CARD, market: 'MX', pricingMode: 'MANUAL', factorOverride: '0.5' },
          ctx(),
        ),
      ).toMatchObject({
        ok: false,
        errors: [{ code: 'FACTOR_NOT_ALLOWED' }],
      });
      expect(
        await setItemMarketPolicy(
          c,
          { itemId: CARD, market: 'USA', pricingMode: 'DERIVED' },
          ctx(),
        ),
      ).toMatchObject({
        ok: false,
        errors: [{ code: 'DERIVED_NEEDS_DERIVED_BOOK' }],
      });
      expect(
        await setItemMarketPolicy(
          c,
          { itemId: CARD, market: 'MX', pricingMode: 'DERIVED', factorOverride: '0' },
          ctx(),
        ),
      ).toMatchObject({ ok: false });
    }));

  it('effective-dated FX: a future revision never changes today; retroactive revisions are refused', () =>
    withRollback(async (c) => {
      await setActorContext(c, 'martin@test', 'test');
      must(
        await createFxParameterRevision(
          c,
          {
            key: 'usd_mxn_fx',
            value: '17.5',
            validFrom: '2026-12-01T00:00:00Z',
            reason: 'cierre de mes',
          },
          ctx(),
        ),
      );
      expect(total(await live(c, 500, NOW, 'MX'))).toBe('1386.00 MXN');
      expect(total(await live(c, 500, new Date('2026-12-01T00:00:00Z'), 'MX'))).toBe('1470.00 MXN'); // 120 × .7 × 17.5
      expect(
        await createFxParameterRevision(
          c,
          { key: 'usd_mxn_fx', value: '18', validFrom: '2026-09-01T00:00:00Z' },
          ctx(),
        ),
      ).toMatchObject({
        ok: false,
        errors: [{ code: 'RETROACTIVE_PARAMETER' }],
      });
      expect(
        await createFxParameterRevision(
          c,
          { key: 'usd_mxn_fx', value: '18', validFrom: '2026-11-15T00:00:00Z' },
          ctx(),
        ),
      ).toMatchObject({
        ok: false,
        errors: [{ code: 'NOT_AFTER_LATEST' }],
      });
      const audit = (
        await c.query(
          "select reason from change_event where table_name = 'pricing_parameter' order by revision desc limit 1",
        )
      ).rows[0];
      expect(audit.reason).toBe('cierre de mes');
    }));
});
