import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authorizePriceRevision, createDraftPriceDefinition } from '@/db/admin/price-admin';
import { setActorContext } from '@/db/admin/tx';
import './helpers'; // loads .env.local

/**
 * Two real connections racing to authorize conflicting prices. This needs COMMITTED data, so it runs in
 * a throw-away database built from the migrations (never in the shared development database).
 */
const base = new URL(process.env.DATABASE_URL!);
const dbName = `dtg_race_${process.pid}_${Date.now()}`;
const urlFor = (db: string) => {
  const u = new URL(base.toString());
  u.pathname = `/${db}`;
  return u.toString();
};
const NOW = new Date('2026-10-01T12:00:00Z');
const ctx = { actor: 'race@test', now: NOW };

let admin: Client;
let item: string;
const drafts: string[] = [];
const open: Client[] = [];

async function client() {
  const c = new Client({ connectionString: urlFor(dbName) });
  await c.connect();
  open.push(c);
  return c;
}

beforeAll(async () => {
  admin = new Client({ connectionString: urlFor(process.env.DATABASE_ADMIN_DB ?? 'postgres') });
  await admin.connect();
  await admin.query(`create database ${dbName}`);
  const c = await client();
  const dir = path.resolve(import.meta.dirname, '../../supabase/migrations');
  for (const f of readdirSync(dir)
    .filter((x) => x.endsWith('.sql'))
    .sort()) {
    await c.query(readFileSync(path.join(dir, f), 'utf8'));
  }
  const m = (
    await c.query(
      "insert into market (code, name, default_currency) values ('USA','USA','USD') returning id",
    )
  ).rows[0].id;
  await c.query(
    "insert into price_book (code, market_id, currency, mode) values ('USA_MASTER', $1, 'USD', 'MASTER')",
    [m],
  );
  item = (
    await c.query(
      "insert into catalog_item (kind, canonical_name, sale_unit) values ('PRODUCT', 'Race item', 'PIECE') returning id",
    )
  ).rows[0].id;
  await setActorContext(c, 'race@test', 'setup');
  for (let i = 0; i < 2; i++) {
    const r = await createDraftPriceDefinition(
      c,
      {
        itemId: item,
        market: 'USA',
        model: 'PER_UNIT',
        amount: String(10 + i),
        validFrom: '2026-09-01T00:00:00Z',
      },
      ctx,
    );
    if (!r.ok) throw new Error(JSON.stringify(r));
    drafts.push(r.definitionId);
  }
});

afterAll(async () => {
  for (const c of open) await c.end().catch(() => undefined);
  await admin.query(`drop database if exists ${dbName} with (force)`);
  await admin.end();
});

const authorizedCount = async (c: Client) =>
  Number(
    (await c.query("select count(*)::int as n from price_definition where status = 'AUTHORIZED'"))
      .rows[0].n,
  );

describe('concurrent authorization of conflicting prices', () => {
  it('service path: the second authorization waits for the first, then fails on committed data', async () => {
    const c1 = await client();
    const c2 = await client();
    await c1.query('begin');
    await c2.query('begin');
    await setActorContext(c1, 'a@test', 'race');
    await setActorContext(c2, 'b@test', 'race');
    const first = await authorizePriceRevision(c1, drafts[0]!, ctx);
    expect(first.ok).toBe(true);
    let settled = false;
    const second = authorizePriceRevision(c2, drafts[1]!, ctx).then((r) => {
      settled = true;
      return r;
    });
    await new Promise((r) => setTimeout(r, 400));
    expect(settled).toBe(false); // blocked on the scope lock while c1 is uncommitted
    await c1.query('commit');
    const r2 = await second;
    expect(r2.ok).toBe(false);
    expect(JSON.stringify(r2)).toMatch(/IDENTICAL_SCOPE|AUTHORIZATION/);
    await c2.query('rollback');
    expect(await authorizedCount(await client())).toBe(1);
  });

  it('database path: even raw SQL cannot produce two overlapping authorized revisions', async () => {
    // reset: a fresh pair of drafts of another scope (different amounts)
    const c0 = await client();
    await setActorContext(c0, 'race@test', 'setup');
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const r = await createDraftPriceDefinition(
        c0,
        {
          itemId: item,
          market: 'USA',
          model: 'PER_UNIT',
          amount: String(20 + i),
          validFrom: '2027-01-01T00:00:00Z',
          minQuantity: 1 + i * 0,
        },
        ctx,
      );
      if (!r.ok) throw new Error(JSON.stringify(r));
      ids.push(r.definitionId);
    }
    // First revision of that scope window is the one authorized above (open-ended from 2026-09-01):
    // both new drafts overlap it, so each raw authorization must fail.
    const c1 = await client();
    await c1.query('begin');
    await expect(
      c1.query(
        "update price_definition set status='AUTHORIZED', authorized_by='sql', authorized_at=now() where id=$1",
        [ids[0]],
      ),
    ).rejects.toThrow(/already covers the same scope/);
    await c1.query('rollback');
    expect(await authorizedCount(await client())).toBe(1);
  });
});
