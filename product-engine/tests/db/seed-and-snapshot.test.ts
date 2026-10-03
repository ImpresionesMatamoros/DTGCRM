import { afterAll, describe, expect, it } from 'vitest';
import { devSliceDataset, itemId } from '../../data/dev-slice';
import { referenceDataset, REF } from '../../data/reference';
import { datasetToSnapshot, mergeDatasets } from '../../data/types';
import { loadCatalogSnapshot } from '@/db/catalog-snapshot';
import { resolvePrice } from '@/pricing/resolve';
import type { PriceResult } from '@/pricing/result';
import { pool, withRollback } from './helpers';

afterAll(() => pool.end());

const AS_OF = new Date('2026-10-01T12:00:00Z');
const total = (r: PriceResult) =>
  r.status === 'RESOLVED' ? `${r.total.amount.toFixed(2)} ${r.total.currency}` : r.status;
const count = async (sql: string) => Number((await pool.query(sql)).rows[0].n);

describe('seed (ADR-0013)', () => {
  it('loads the expected reference + dev slice volumes', async () => {
    expect(await count('select count(*) n from market')).toBe(2);
    expect(
      await count(
        "select count(*) n from decoration_method where key in ('DTF','EMBROIDERY','SCREEN_PRINTING','HTV')",
      ),
    ).toBe(4);
    expect(await count('select count(*) n from catalog_item')).toBe(16);
    expect(await count("select count(*) n from price_definition where status = 'AUTHORIZED'")).toBe(
      14,
    );
    expect(await count('select count(*) n from price_break')).toBe(130);
    expect(await count("select count(*) n from price_rule where status = 'AUTHORIZED'")).toBe(2);
    expect(await count('select count(*) n from price_rule_assignment')).toBe(4);
    expect(await count('select count(*) n from composition_line')).toBe(3);
  });

  it('historical prices are evidence only; no fixture data was seeded', async () => {
    expect(
      await count(
        "select count(*) n from source_reference where source_kind = 'HISTORICAL_PRICE_EVIDENCE'",
      ),
    ).toBe(6);
    expect(
      await count(
        `select count(*) n from price_definition where item_id in (select entity_id from source_reference where source_kind = 'HISTORICAL_PRICE_EVIDENCE')`,
      ),
    ).toBe(0);
    const dump = (
      await pool.query("select string_agg(t::text, ' ') s from (select * from price_definition) t")
    ).rows[0].s as string;
    expect(dump).not.toMatch(/FIXTURE/i);
  });

  it('publication outputs are queries over one catalog, never copies', async () => {
    const members = async (key: string) =>
      (
        await pool.query('select item_id from v_publication_membership where profile_key = $1', [
          key,
        ])
      ).rows.map((r) => r.item_id as string);
    const crm = await members('crm_internal');
    expect(crm).toHaveLength(12);
    expect(crm).not.toContain(itemId('invitacion_evento')); // unset status
    expect(crm).not.toContain(itemId('dtf_transfer')); // CANDIDATE
    for (const key of ['crm_internal', 'catalog_general', 'price_list_usa']) {
      expect(await members(key)).toContain(itemId('tarjeta_premium'));
    }
    expect(
      await count(
        "select count(*) n from catalog_item where canonical_name like 'Tarjeta de presentación Premium%'",
      ),
    ).toBe(1);
  });

  it('an unset-status item is never published even if explicitly assigned', () =>
    withRollback(async (c) => {
      await c.query('insert into publication_assignment (profile_id, item_id) values ($1, $2)', [
        REF.profile.catalog,
        itemId('invitacion_evento'),
      ]);
      const n = (
        await c.query('select count(*) n from v_publication_membership where item_id = $1', [
          itemId('invitacion_evento'),
        ])
      ).rows[0].n;
      expect(Number(n)).toBe(0);
    }));
});

describe('database round trip: DB snapshot ≡ in-memory dataset', () => {
  it('loads a snapshot equal to the typed dataset (identities, options, prices, rules)', async () => {
    const db = await loadCatalogSnapshot(pool);
    const mem = datasetToSnapshot(mergeDatasets(referenceDataset(), devSliceDataset()));
    const norm = (s: typeof db) =>
      JSON.parse(
        JSON.stringify({ ...s, revisions: null }, (_k, v) =>
          typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) ? new Date(v).toISOString() : v,
        ),
      );
    const sortById = <T extends Record<string, unknown>>(a: T[]) =>
      [...a].sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)));
    const a = norm(db);
    const b = norm(mem);
    for (const k of Object.keys(b)) {
      if (Array.isArray(b[k])) {
        const clean = (arr: Record<string, unknown>[]) =>
          sortById(
            arr.map((x) => ({
              ...x,
              ...('conditions' in x
                ? { conditions: sortById(x.conditions as Record<string, unknown>[]) }
                : {}),
              ...('itemIds' in x ? { itemIds: [...(x.itemIds as string[])].sort() } : {}),
            })),
          );
        expect(clean(a[k]), k).toEqual(clean(b[k]));
      }
    }
    expect(db.revisions.catalog).toBeGreaterThan(0);
    expect(db.revisions.pricing).toBeGreaterThan(0);
  });

  it('the vertical slice prices identically from the database', async () => {
    const s = await loadCatalogSnapshot(pool);
    const r = (key: Parameters<typeof itemId>[0], extra: object) =>
      resolvePrice({ catalogItemId: itemId(key), ...extra } as never, s, AS_OF);
    expect(
      total(
        r('tarjeta_premium', {
          market: 'USA',
          quantity: 500,
          selections: [{ optionKey: 'caras', valueCodes: ['2'] }],
        }),
      ),
    ).toBe('120.00 USD');
    expect(
      total(
        r('flyers', {
          market: 'USA',
          quantity: 1000,
          selections: [
            { optionKey: 'papel', valueCodes: ['Premium'] },
            { optionKey: 'caras', valueCodes: ['2'] },
            { optionKey: 'tamano_papel', valueCodes: ['Media carta'] },
          ],
        }),
      ),
    ).toBe('400.00 USD');
    expect(
      total(
        r('tarjeta_premium', {
          market: 'MX',
          quantity: 500,
          selections: [{ optionKey: 'caras', valueCodes: ['2'] }],
        }),
      ),
    ).toBe('1386.00 MXN');
    const q = r('tarjeta_premium', {
      market: 'USA',
      quantity: 750,
      selections: [{ optionKey: 'caras', valueCodes: ['2'] }],
    });
    expect(q.status === 'QUOTE_ONLY' && q.reasonCode).toBe('QUANTITY_NOT_IN_MATRIX');
    const shirt = r('camiseta_algodon', {
      market: 'USA',
      quantity: 12,
      distribution: [
        { selections: [{ optionKey: 'talla', valueCodes: ['L'] }], quantity: 9 },
        { selections: [{ optionKey: 'talla', valueCodes: ['3XL'] }], quantity: 3 },
      ],
    });
    expect(shirt.status).toBe('QUOTE_ONLY');
    if (shirt.status === 'QUOTE_ONLY')
      expect(shirt.knownAdjustments[0]?.amount?.amount.toFixed(2)).toBe('9.00');
    const res = r('tarjeta_premium', {
      market: 'USA',
      quantity: 500,
      selections: [{ optionKey: 'caras', valueCodes: ['2'] }],
    });
    expect(res.revisions.pricing).toBe(s.revisions.pricing);
  });

  it('persisted per-item market policies drive component pricing independently (PATCH 4 + 5)', () =>
    withRollback(async (c) => {
      // FIXTURE prices inside a rolled-back transaction: never persisted.
      await c.query(
        "update catalog_item set status = 'ACTIVE', sale_unit = 'PIECE' where id = $1",
        [itemId('estaca_yard_sign')],
      );
      for (const [item, amount] of [
        [itemId('yard_sign'), '20.00'],
        [itemId('estaca_yard_sign'), '2.00'],
      ] as const) {
        const id = (
          await c.query(
            "insert into price_definition (item_id, price_book_id, model, amount, valid_from) values ($1, $2, 'PER_UNIT', $3, '2026-01-01') returning id",
            [item, REF.bookUSA, amount],
          )
        ).rows[0].id;
        await c.query(
          "update price_definition set status = 'AUTHORIZED', authorized_by = 'FIXTURE', authorized_at = now() where id = $1",
          [id],
        );
      }
      await c.query(
        "insert into item_market_policy (item_id, market_id, pricing_mode, factor_override) values ($1, $2, 'DERIVED', 0.50)",
        [itemId('estaca_yard_sign'), REF.marketMX],
      );
      const s = await loadCatalogSnapshot(c);
      const r = resolvePrice(
        {
          catalogItemId: itemId('yard_sign'),
          market: 'MX',
          quantity: 1,
          optionalComponents: [{ catalogItemId: itemId('estaca_yard_sign') }],
        },
        s,
        AS_OF,
      );
      expect(total(r)).toBe('247.50 MXN');
      if (r.status === 'RESOLVED') {
        expect(r.policy).toMatchObject({ factor: '0.70', factorSource: 'DEFAULT' });
        expect(r.components[0]?.result.policy).toMatchObject({
          factor: '0.50',
          factorSource: 'ITEM',
        });
      }
    }));
});
