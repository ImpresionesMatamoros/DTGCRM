import { afterAll, describe, expect, it } from 'vitest';
import { itemId, optionDefId, optionValueId } from '../../data/dev-slice';
import { REF } from '../../data/reference';
import { expectDbError, pool, withRollback } from './helpers';

afterAll(() => pool.end());

const newItem = async (c: import('pg').PoolClient, extra = '') =>
  (
    await c.query(
      `insert into catalog_item (kind, canonical_name${extra ? ', ' + extra.split('=')[0] : ''}) values ('PRODUCT', 'Prueba'${extra ? ', ' + extra.split('=')[1] : ''}) returning id, public_code, status`,
    )
  ).rows[0];

describe('catalog_item invariants', () => {
  it('assigns DTG-NNNNN public codes from the sequence and keeps them immutable', () =>
    withRollback(async (c) => {
      const row = await newItem(c);
      expect(row.public_code).toMatch(/^DTG-\d{5}$/);
      expect(Number(row.public_code.slice(4))).toBeGreaterThan(16);
      await expectDbError(
        c,
        'update catalog_item set public_code = $2 where id = $1',
        [row.id, 'DTG-99999'],
        /immutable/,
      );
      await expectDbError(
        c,
        "insert into catalog_item (kind, canonical_name, public_code) values ('PRODUCT', 'x', 'TXT-00001')",
        [],
        /public_code_check|check constraint/,
      );
    }));

  it('status can be assigned once from unset and never returns to unset', () =>
    withRollback(async (c) => {
      const row = await newItem(c);
      expect(row.status).toBeNull();
      await c.query("update catalog_item set status = 'ACTIVE' where id = $1", [row.id]);
      await expectDbError(
        c,
        'update catalog_item set status = null where id = $1',
        [row.id],
        /cannot return to unset/,
      );
    }));

  it('customer-supplied item only for services; merges only into another RETIRED item', () =>
    withRollback(async (c) => {
      await expectDbError(
        c,
        "insert into catalog_item (kind, canonical_name, customer_supplied_item) values ('PRODUCT', 'x', 'REQUIRED')",
        [],
        /customer_supplied_only_for_service/,
      );
      const a = await newItem(c);
      await expectDbError(
        c,
        'update catalog_item set merged_into_id = $2 where id = $1',
        [a.id, itemId('gorra')],
        /merge_requires_retired/,
      );
    }));
});

describe('options, decoration, composition', () => {
  it('an item may only enable values that belong to the option definition', () =>
    withRollback(async (c) => {
      await expectDbError(
        c,
        'insert into item_option_value (item_id, option_definition_id, option_value_id) values ($1, $2, $3)',
        [itemId('camiseta_algodon'), optionDefId('talla'), optionValueId('caras', '2')],
        /foreign key/,
      );
    }));

  it('distributable options must be single ENUM; TEXT options have no values', () =>
    withRollback(async (c) => {
      await expectDbError(
        c,
        'update item_option set is_distributable = true where item_id = $1 and option_definition_id = $2',
        [itemId('camiseta_algodon'), optionDefId('color')],
        /only ENUM/,
      );
      await expectDbError(
        c,
        "insert into option_value (option_definition_id, code, label) values ($1, 'Rojo', 'Rojo')",
        [optionDefId('color')],
        /no enumerated values/,
      );
    }));

  it('items without decoration cannot get decoration capabilities', () =>
    withRollback(async (c) => {
      await expectDbError(
        c,
        'insert into decoration_capability (item_id, method_id) values ($1, $2)',
        [itemId('tarjeta_premium'), REF.method.DTF],
        /policy NONE/,
      );
    }));

  it('composition rejects cycles, self-links and depth > 2', () =>
    withRollback(async (c) => {
      await expectDbError(
        c,
        "insert into composition_line (parent_item_id, child_item_id, quantity, role) values ($1, $1, 1, 'INCLUDED')",
        [itemId('gorra')],
        /check constraint|cycle/,
      );
      await expectDbError(
        c,
        "insert into composition_line (parent_item_id, child_item_id, quantity, role) values ($1, $2, 1, 'INCLUDED')",
        [itemId('xbanner_grafica'), itemId('xbanner_completo')],
        /cycle/,
      );
      await c.query(
        "insert into composition_line (parent_item_id, child_item_id, quantity, role) values ($1, $2, 1, 'INCLUDED')",
        [itemId('xbanner_grafica'), itemId('gorra')],
      );
      await expectDbError(
        c,
        "insert into composition_line (parent_item_id, child_item_id, quantity, role) values ($1, $2, 1, 'INCLUDED')",
        [itemId('gorra'), itemId('flyers')],
        /deeper than 2/,
      );
    }));
});

describe('pricing invariants', () => {
  const draft = async (c: import('pg').PoolClient, item: string, fields: string, values: string) =>
    (
      await c.query(
        `insert into price_definition (item_id, price_book_id, valid_from, ${fields}) values ($1, $2, '2026-01-01', ${values}) returning id`,
        [item, REF.bookUSA],
      )
    ).rows[0].id as string;

  it('model-specific shape is enforced (e.g. FIXED needs amount and max quantity)', () =>
    withRollback(async (c) => {
      await expectDbError(
        c,
        "insert into price_definition (item_id, price_book_id, valid_from, model) values ($1, $2, '2026-01-01', 'FIXED')",
        [itemId('gorra'), REF.bookUSA],
        /check constraint/,
      );
      await expectDbError(
        c,
        "insert into price_definition (item_id, price_book_id, valid_from, model, amount) values ($1, $2, '2026-01-01', 'EXACT_QUANTITY_MATRIX', 10)",
        [itemId('gorra'), REF.bookUSA],
        /check constraint/,
      );
    }));

  it('AUTHORIZED definitions are immutable, their breaks frozen, and they cannot be deleted', () =>
    withRollback(async (c) => {
      const id = (
        await c.query('select id from price_definition where item_id = $1 limit 1', [
          itemId('tarjeta_premium'),
        ])
      ).rows[0].id;
      await expectDbError(
        c,
        'update price_definition set valid_from = now() where id = $1',
        [id],
        /immutable/,
      );
      await expectDbError(
        c,
        'update price_break set amount = 1 where price_definition_id = $1',
        [id],
        /immutable/,
      );
      await expectDbError(
        c,
        'insert into price_break (price_definition_id, quantity, amount) values ($1, 750, 1)',
        [id],
        /immutable/,
      );
      await expectDbError(
        c,
        'delete from price_definition where id = $1',
        [id],
        /cannot be deleted/,
      );
      await c.query(
        "update price_definition set status = 'SUPERSEDED', valid_to = '2027-01-01' where id = $1",
        [id],
      );
    }));

  it('authorization requires a sale unit, breaks for matrices, and no identical overlapping definition', () =>
    withRollback(async (c) => {
      const noUnit = await draft(
        c,
        itemId('xbanner_estructura'),
        'model, amount',
        "'PER_UNIT', 10",
      );
      await expectDbError(
        c,
        "update price_definition set status = 'AUTHORIZED', authorized_by = 't', authorized_at = now() where id = $1",
        [noUnit],
        /no sale unit/,
      );
      const emptyMatrix = await draft(c, itemId('gorra'), 'model', "'EXACT_QUANTITY_MATRIX'");
      await expectDbError(
        c,
        "update price_definition set status = 'AUTHORIZED', authorized_by = 't', authorized_at = now() where id = $1",
        [emptyMatrix],
        /need price breaks/,
      );
      const dup = await draft(
        c,
        itemId('imanes_par'),
        'model, amount, max_quantity',
        "'FIXED', 70, 1",
      );
      await expectDbError(
        c,
        "update price_definition set status = 'AUTHORIZED', authorized_by = 't', authorized_at = now() where id = $1",
        [dup],
        /already covers/,
      );
      const noAuthorizer = await draft(c, itemId('gorra'), 'model, amount', "'PER_UNIT', 10");
      await expectDbError(
        c,
        "update price_definition set status = 'AUTHORIZED' where id = $1",
        [noAuthorizer],
        /check constraint/,
      );
    }));

  it('rules: REQUIRE_QUOTE has no amount, others must have one; authorized rules are immutable', () =>
    withRollback(async (c) => {
      await expectDbError(
        c,
        "insert into price_rule (price_book_id, code, label, kind, valid_from) values ($1, 'x', 'x', 'ADD_PER_UNIT', now())",
        [REF.bookUSA],
        /check constraint/,
      );
      await expectDbError(
        c,
        "update price_rule set amount = 5 where code = 'size_3xl'",
        [],
        /immutable/,
      );
    }));

  it('ItemMarketPolicy is persistent: MX · DERIVED · 0.50 and MX · MANUAL (PATCH 5)', () =>
    withRollback(async (c) => {
      await c.query(
        "insert into item_market_policy (item_id, market_id, pricing_mode, factor_override) values ($1, $2, 'DERIVED', 0.50)",
        [itemId('estaca_yard_sign'), REF.marketMX],
      );
      await c.query(
        "insert into item_market_policy (item_id, market_id, pricing_mode) values ($1, $2, 'MANUAL')",
        [itemId('tarjeta_premium'), REF.marketMX],
      );
      const rows = (
        await c.query(
          'select pricing_mode, factor_override from item_market_policy order by pricing_mode',
        )
      ).rows;
      expect(rows).toEqual([
        { pricing_mode: 'DERIVED', factor_override: '0.5000' },
        { pricing_mode: 'MANUAL', factor_override: null },
      ]);
      await expectDbError(
        c,
        "insert into item_market_policy (item_id, market_id, pricing_mode, factor_override) values ($1, $2, 'MANUAL', 0.5)",
        [itemId('gorra'), REF.marketMX],
        /check constraint/,
      );
      await expectDbError(
        c,
        "insert into item_market_policy (item_id, market_id, pricing_mode) values ($1, $2, 'DERIVED')",
        [itemId('gorra'), REF.marketUSA],
        /requires a DERIVED price book/,
      );
    }));

  it('FX parameters cannot overlap in time', () =>
    withRollback(async (c) => {
      await expectDbError(
        c,
        "insert into pricing_parameter (key, value, valid_from) values ('usd_mxn_fx', 18, '2026-10-01')",
        [],
        /exclu/,
      );
      await c.query(
        "update pricing_parameter set valid_to = '2026-10-01' where key = 'usd_mxn_fx'",
      );
      await c.query(
        "insert into pricing_parameter (key, value, valid_from) values ('usd_mxn_fx', 18, '2026-10-01')",
      );
    }));
});

describe('provenance and audit', () => {
  it('change_event is append-only and revisions only grow', () =>
    withRollback(async (c) => {
      const before = (await c.query('select catalog_revision from v_revisions')).rows[0]
        .catalog_revision;
      await c.query(
        "update catalog_item set canonical_name = 'Gorra personalizada' where id = $1",
        [itemId('gorra')],
      );
      const after = (await c.query('select catalog_revision from v_revisions')).rows[0]
        .catalog_revision;
      expect(BigInt(after)).toBeGreaterThan(BigInt(before));
      await expectDbError(c, 'delete from change_event', [], /append-only/);
    }));
});
