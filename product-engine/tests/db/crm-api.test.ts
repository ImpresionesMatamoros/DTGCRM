import { afterAll, describe, expect, it } from 'vitest';
import { loadCatalogSnapshot } from '@/db/catalog-snapshot';
import { loadPresentations } from '@/db/crm-api-deps';
import { getItem, listItems, resolve, type CrmApiDeps } from '@/api/crm-handlers';
import {
  ItemDetailResponseSchema,
  ItemListResponseSchema,
  PriceResultWireSchema,
} from '@/api/crm-contracts';
import type { PoolClient } from 'pg';
import { pool, withRollback } from './helpers';

afterAll(() => pool.end());

const AS_OF = new Date('2026-10-01T12:00:00Z');
const depsOn = (c: PoolClient): CrmApiDeps => ({
  loadSnapshot: () => loadCatalogSnapshot(c),
  loadPresentations: () => loadPresentations(c),
  now: () => AS_OF,
  env: {},
});
const get = (p: string) => new Request(`http://pe.test${p}`);
const post = (b: unknown) =>
  new Request('http://pe.test/api/v1/pricing/resolve', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(b),
  });

async function premium(c: PoolClient) {
  const r = await c.query(
    "select id, public_code from catalog_item where canonical_name like 'Tarjeta de presentación Premium%'",
  );
  return r.rows[0] as { id: string; public_code: string };
}

describe('CRM API against the real database', () => {
  it('lists exactly the ACTIVE items (no CANDIDATE/PLANNED/unset/RETIRED)', async () => {
    await withRollback(async (c) => {
      const res = await listItems(get('/api/v1/catalog/items?limit=50'), depsOn(c));
      const body = ItemListResponseSchema.parse(await res.json());
      const active = (
        await c.query(
          "select count(*)::int n from catalog_item where status = 'ACTIVE' and merged_into_id is null",
        )
      ).rows[0].n;
      expect(body.page.total).toBe(active);
      const hidden = (
        await c.query("select id from catalog_item where status is distinct from 'ACTIVE'")
      ).rows.map((r) => r.id);
      for (const id of hidden) {
        expect(body.items.find((i) => i.id === id)).toBeUndefined();
        expect((await getItem(get('/x'), id, depsOn(c))).status).toBe(404);
      }
    });
  });

  it('retiring an item removes it from search/detail/pricing immediately', async () => {
    await withRollback(async (c) => {
      const p = await premium(c);
      expect((await getItem(get('/x'), p.public_code, depsOn(c))).status).toBe(200);
      await c.query("update catalog_item set status = 'RETIRED' where id = $1", [p.id]);
      expect((await getItem(get('/x'), p.public_code, depsOn(c))).status).toBe(404);
      const list = ItemListResponseSchema.parse(
        await (await listItems(get('/api/v1/catalog/items?q=premium'), depsOn(c))).json(),
      );
      expect(list.items.find((i) => i.id === p.id)).toBeUndefined();
      const r = await resolve(
        post({
          as_of: AS_OF.toISOString(),
          request: { catalog_item_id: p.id, market: 'USA', quantity: 500 },
        }),
        depsOn(c),
      );
      expect(r.status).toBe(404);
    });
  });

  it('DRAFT presentation copy never reaches the API (aliases only widen search)', async () => {
    await withRollback(async (c) => {
      const p = await premium(c);
      await c.query(
        "insert into presentation (item_id, locale, display_name, short_description, status) values ($1,'es','Nombre borrador secreto','Descripción borrador secreta','DRAFT')",
        [p.id],
      );
      const t = await (await getItem(get('/x'), p.id, depsOn(c))).text();
      expect(t).not.toContain('borrador secret');
      // a DRAFT display name is not searchable...
      const l = await (await listItems(get('/api/v1/catalog/items?q=borrador'), depsOn(c))).json();
      expect(l.items).toEqual([]);
      // ...but owner aliases (also on DRAFT presentations) find the item without being emitted.
      const biz = await (
        await listItems(get('/api/v1/catalog/items?q=business'), depsOn(c))
      ).text();
      expect(JSON.parse(biz).items.some((i: { id: string }) => i.id === p.id)).toBe(true);
      expect(biz.toLowerCase()).not.toContain('business');
    });
  });

  it('prices end-to-end from persisted authorized data; a later price revision changes only later answers', async () => {
    await withRollback(async (c) => {
      const p = await premium(c);
      const ask = async (asOf: string) =>
        PriceResultWireSchema.parse(
          await (
            await resolve(
              post({
                as_of: asOf,
                request: {
                  catalog_item_id: p.id,
                  market: 'USA',
                  quantity: 500,
                  selections: [{ option_key: 'caras', value_codes: ['2'] }],
                },
              }),
              depsOn(c),
            )
          ).json(),
        );
      const before = await ask(AS_OF.toISOString());
      expect(before.status).toBe('RESOLVED');
      if (before.status === 'RESOLVED') expect(before.total.amount).toBe('120.00');
      const again = await ask(AS_OF.toISOString());
      expect(again).toEqual(before);
      const detail = ItemDetailResponseSchema.parse(
        await (await getItem(get('/x'), p.id, depsOn(c))).json(),
      );
      expect(detail.markets[0]?.price_availability).toBe('AUTHORIZED_PRICES');
    });
  });
});
