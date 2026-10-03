import { describe, expect, it } from 'vitest';
import { devSliceDataset } from '../../data/dev-slice';
import { referenceDataset } from '../../data/reference';
import { mergeDatasets } from '../../data/types';
import { getItem, listItems, resolve, type CrmApiDeps } from '@/api/crm-handlers';
import {
  ErrorResponseSchema,
  ItemDetailResponseSchema,
  ItemListResponseSchema,
  CONTRACT_HEADER,
  PriceResultWireSchema,
} from '@/api/crm-contracts';
import { authorize } from '@/api/http';
import { AS_OF, itemId, sliceSnapshot } from '../fixtures/slice';

const dataset = mergeDatasets(referenceDataset(), devSliceDataset());

function deps(env: Record<string, string | undefined> = {}): CrmApiDeps {
  const snapshot = sliceSnapshot();
  return {
    loadSnapshot: async () => snapshot,
    loadPresentations: async () => structuredClone(dataset.presentations),
    now: () => AS_OF,
    env,
  };
}

const get = (path: string, headers: Record<string, string> = {}) =>
  new Request(`http://pe.test${path}`, { headers });
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('http://pe.test/api/v1/pricing/resolve', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const FORBIDDEN_KEYS = [
  'description_internal',
  'descriptionInternal',
  'cost',
  'provenance',
  'authorized_by',
  'authorizedBy',
  'staging',
  'candidate_disposition',
  'merged_into_id',
  'legacy_ids',
];
const keysDeep = (v: unknown, acc = new Set<string>()): Set<string> => {
  if (Array.isArray(v)) v.forEach((x) => keysDeep(x, acc));
  else if (v && typeof v === 'object')
    for (const [k, x] of Object.entries(v)) {
      acc.add(k);
      keysDeep(x, acc);
    }
  return acc;
};

describe('CRM API v1 — catalog list/search', () => {
  it('returns ACTIVE items only, with the contract header and no-store', async () => {
    const res = await listItems(get('/api/v1/catalog/items?limit=50'), deps());
    expect(res.status).toBe(200);
    expect(res.headers.get(CONTRACT_HEADER)).toBe('1');
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = ItemListResponseSchema.parse(await res.json());
    const names = body.items.map((i) => i.canonical_name);
    expect(names).toContain('Tarjeta de presentación Premium / Gloss');
    // CANDIDATE items of the dev slice must never appear.
    const candidates = sliceSnapshot().items.filter((i) => i.status !== 'ACTIVE');
    expect(candidates.length).toBeGreaterThan(0);
    for (const c of candidates) expect(body.items.find((i) => i.id === c.id)).toBeUndefined();
    expect(body.page.total).toBe(sliceSnapshot().items.filter((i) => i.status === 'ACTIVE').length);
  });

  it('A: searching "business" is accent/case-insensitive over names, aliases and presentations', async () => {
    const q = async (s: string) =>
      ItemListResponseSchema.parse(
        await (
          await listItems(get(`/api/v1/catalog/items?q=${encodeURIComponent(s)}`), deps())
        ).json(),
      );
    const byName = await q('presentacion premium');
    expect(byName.items.map((i) => i.public_code)).toContain(
      sliceSnapshot().items.find((i) => i.id === itemId('tarjeta_premium'))!.publicCode,
    );
    const byCode = await q(
      sliceSnapshot().items.find((i) => i.id === itemId('flyers'))!.publicCode,
    );
    expect(byCode.items[0]?.id).toBe(itemId('flyers'));
    expect((await q('zzzz-no-existe')).items).toEqual([]);
    // English search vocabulary (aliases of DRAFT presentations still widen search, are never emitted).
    const biz = await q('business');
    expect(biz.items.map((i) => i.canonical_name)).toEqual(
      expect.arrayContaining([
        'Tarjeta de presentación Tradicional',
        'Tarjeta de presentación Premium / Gloss',
      ]),
    );
    expect(JSON.stringify(biz)).not.toContain('business');
    expect((await q('BUSINESS   Card')).items.length).toBe(biz.items.length);
  });

  it('paginates deterministically and validates parameters', async () => {
    const page = async (qs: string) => listItems(get(`/api/v1/catalog/items?${qs}`), deps());
    const p1 = ItemListResponseSchema.parse(await (await page('limit=3&offset=0')).json());
    const p2 = ItemListResponseSchema.parse(await (await page('limit=3&offset=3')).json());
    expect(p1.items).toHaveLength(3);
    expect(p1.page.next_offset).toBe(3);
    expect(p2.items.every((i) => !p1.items.some((j) => j.id === i.id))).toBe(true);
    const again = ItemListResponseSchema.parse(await (await page('limit=3&offset=0')).json());
    expect(again.items.map((i) => i.id)).toEqual(p1.items.map((i) => i.id));
    const last = ItemListResponseSchema.parse(
      await (await page(`limit=50&offset=${p1.page.total - 1}`)).json(),
    );
    expect(last.page.next_offset).toBeNull();
    for (const bad of [
      'limit=0',
      'limit=51',
      'limit=abc',
      'offset=-1',
      'market=EU',
      'foo=bar',
      'limit=1&limit=2',
      `q=${'x'.repeat(101)}`,
    ]) {
      const r = await page(bad);
      expect(r.status, bad).toBe(400);
      expect(ErrorResponseSchema.parse(await r.json()).error.code).toBe('INVALID_QUERY');
    }
  });

  it('market filter excludes items unavailable in that market', async () => {
    const d = deps();
    const s = await d.loadSnapshot();
    const mx = s.markets.find((m) => m.code === 'MX')!;
    const target = itemId('gorra');
    s.itemMarketPolicies.push({
      itemId: target,
      marketId: mx.id,
      pricingMode: 'INHERIT',
      factorOverride: null,
      isAvailable: false,
    });
    const body = ItemListResponseSchema.parse(
      await (await listItems(get('/api/v1/catalog/items?market=MX&limit=50'), d)).json(),
    );
    expect(body.items.find((i) => i.id === target)).toBeUndefined();
    const usa = ItemListResponseSchema.parse(
      await (await listItems(get('/api/v1/catalog/items?market=USA&limit=50'), d)).json(),
    );
    expect(usa.items.find((i) => i.id === target)).toBeDefined();
  });
});

describe('CRM API v1 — detail', () => {
  it('by id and by public code; exposes selectable options only', async () => {
    const s = sliceSnapshot();
    const item = s.items.find((i) => i.id === itemId('tarjeta_premium'))!;
    for (const key of [item.id, item.publicCode, item.publicCode.toLowerCase()]) {
      const res = await getItem(get(`/api/v1/catalog/items/${key}`), key, deps());
      expect(res.status, key).toBe(200);
      const body = ItemDetailResponseSchema.parse(await res.json());
      expect(body.item.public_code).toBe(item.publicCode);
      const caras = body.options.find((o) => o.key === 'caras')!;
      expect(caras.is_required).toBe(true);
      expect(caras.values.map((v) => v.code)).toEqual(['1', '2']);
      expect(body.decoration).toBeNull();
      expect(body.markets.map((m) => m.market)).toEqual(['USA', 'MX']);
      expect(body.markets[0]).toMatchObject({
        is_available: true,
        price_availability: 'AUTHORIZED_PRICES',
        currency: 'USD',
      });
    }
  });

  it('CANDIDATE / unknown / malformed → 404 indistinguishable', async () => {
    const s = sliceSnapshot();
    const cand = s.items.find((i) => i.status === 'CANDIDATE')!;
    for (const k of [
      cand.id,
      cand.publicCode,
      '00000000-0000-4000-8000-000000000000',
      'DTG-99999',
      'x',
      '../etc',
    ]) {
      const r = await getItem(get(`/api/v1/catalog/items/${k}`), k, deps());
      expect(r.status, k).toBe(404);
      expect(ErrorResponseSchema.parse(await r.json()).error).toEqual({
        code: 'ITEM_NOT_FOUND',
        message: 'Item not found',
      });
    }
  });

  it('decoration is shown only for decoratable items', async () => {
    const s = sliceSnapshot();
    const cam = s.items.find((i) => i.id === itemId('camiseta_algodon'))!;
    const body = ItemDetailResponseSchema.parse(
      await (await getItem(get('/x'), cam.id, deps())).json(),
    );
    expect(cam.decorationPolicy).not.toBe('NONE');
    if (body.decoration) expect(body.decoration.methods.length).toBeGreaterThan(0);
  });

  it('never leaks internal fields (list + detail + pricing)', async () => {
    const s = sliceSnapshot();
    const internal = s.items.find((i) => i.descriptionInternal);
    const seen = new Set<string>();
    const lists = await (await listItems(get('/api/v1/catalog/items?limit=50'), deps())).text();
    keysDeep(JSON.parse(lists), seen);
    for (const i of s.items.filter((x) => x.status === 'ACTIVE')) {
      const t = await (await getItem(get('/x'), i.id, deps())).text();
      keysDeep(JSON.parse(t), seen);
      if (i.descriptionInternal) expect(t).not.toContain(i.descriptionInternal);
    }
    for (const k of FORBIDDEN_KEYS) expect(seen.has(k), k).toBe(false);
    if (internal) expect(lists).not.toContain(internal.descriptionInternal!);
  });
});

describe('CRM API v1 — pricing/resolve', () => {
  const premium = (quantity: number, caras = '2') => ({
    as_of: AS_OF.toISOString(),
    request: {
      catalog_item_id: itemId('tarjeta_premium'),
      market: 'USA',
      quantity,
      selections: [{ option_key: 'caras', value_codes: [caras] }],
    },
  });
  const call = async (b: unknown, d = deps()) => {
    const r = await resolve(post(b), d);
    return { status: r.status, body: await r.json() };
  };

  it('B: Premium Business Card, 500, 2 sides → 120.00 USD (RESOLVED)', async () => {
    const { status, body } = await call(premium(500));
    expect(status).toBe(200);
    const w = PriceResultWireSchema.parse(body);
    expect(w.status).toBe('RESOLVED');
    if (w.status === 'RESOLVED') expect(w.total).toEqual({ amount: '120.00', currency: 'USD' });
    expect(w.effective_at).toBe(AS_OF.toISOString());
  });

  it('D: 750 cards → QUOTE_ONLY (HTTP 200, no price invented)', async () => {
    const { status, body } = await call(premium(750));
    expect(status).toBe(200);
    const w = PriceResultWireSchema.parse(body);
    expect(w.status).toBe('QUOTE_ONLY');
    expect(JSON.stringify(body)).not.toContain('"total"');
  });

  it('Flyer 1000 two sides half-letter → 400.00 USD; magnets 1 pair → 65.00; 2 pairs → QUOTE_ONLY', async () => {
    const flyer = await call({
      as_of: AS_OF.toISOString(),
      request: {
        catalog_item_id: itemId('flyers'),
        market: 'USA',
        quantity: 1000,
        selections: [
          { option_key: 'papel', value_codes: ['Premium'] },
          { option_key: 'caras', value_codes: ['2'] },
          { option_key: 'tamano_papel', value_codes: ['Media carta'] },
        ],
      },
    });
    const fw = PriceResultWireSchema.parse(flyer.body);
    expect(fw.status).toBe('RESOLVED');
    if (fw.status === 'RESOLVED') expect(fw.total.amount).toBe('400.00');
    const mag = (q: number) =>
      call({
        as_of: AS_OF.toISOString(),
        request: { catalog_item_id: itemId('imanes_par'), market: 'USA', quantity: q },
      });
    const m1 = PriceResultWireSchema.parse((await mag(1)).body);
    expect(m1.status === 'RESOLVED' && m1.total.amount).toBe('65.00');
    expect(PriceResultWireSchema.parse((await mag(2)).body).status).toBe('QUOTE_ONLY');
  });

  it('INVALID is a 200 business answer with actionable errors', async () => {
    const { status, body } = await call({
      as_of: AS_OF.toISOString(),
      request: {
        catalog_item_id: itemId('tarjeta_premium'),
        market: 'USA',
        quantity: 500,
        selections: [{ option_key: 'caras', value_codes: ['9'] }],
      },
    });
    expect(status).toBe(200);
    const w = PriceResultWireSchema.parse(body);
    expect(w.status).toBe('INVALID');
    if (w.status === 'INVALID') expect(w.errors.length).toBeGreaterThan(0);
  });

  it('is deterministic for a fixed as_of and honours as_of validity windows', async () => {
    const a = await call(premium(500));
    const b = await call(premium(500));
    expect(a.body).toEqual(b.body);
    const old = await call({ ...premium(500), as_of: '2020-01-01T00:00:00Z' });
    const w = PriceResultWireSchema.parse(old.body);
    expect(w.status).not.toBe('RESOLVED'); // no authorized price existed in 2020
    expect(w.effective_at).toBe('2020-01-01T00:00:00.000Z');
  });

  it('omitted as_of uses the server clock and echoes it', async () => {
    const { as_of: _drop, ...rest } = premium(500);
    void _drop;
    const w = PriceResultWireSchema.parse((await call(rest)).body);
    expect(w.effective_at).toBe(AS_OF.toISOString());
  });

  it('rejects malformed bodies and non-visible items', async () => {
    const bad = await resolve(post('{not json'), deps());
    expect(bad.status).toBe(400);
    expect(ErrorResponseSchema.parse(await bad.json()).error.code).toBe('INVALID_JSON');
    for (const b of [
      {},
      { request: {} },
      { ...premium(500), extra: 1 },
      { ...premium(0) },
      { ...premium(500), as_of: 'yesterday' },
    ]) {
      const r = await call(b);
      expect(r.status, JSON.stringify(b).slice(0, 60)).toBe(400);
      expect(r.body.error.code).toBe('INVALID_REQUEST');
    }
    const s = sliceSnapshot();
    const cand = s.items.find((i) => i.status === 'CANDIDATE')!;
    const r = await call({
      as_of: AS_OF.toISOString(),
      request: { catalog_item_id: cand.id, market: 'USA', quantity: 1 },
    });
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('ITEM_NOT_FOUND');
  });

  it('internal failures are 500 INTERNAL without leaking details', async () => {
    const d = {
      ...deps(),
      loadSnapshot: async () => {
        throw new Error('secret connection string');
      },
    };
    const orig = console.error;
    console.error = () => {};
    const r = await resolve(post(premium(500)), d);
    console.error = orig;
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain('secret');
  });
});

describe('CRM API v1 — auth policy', () => {
  const TOKEN = 'a-sufficiently-long-token';
  it('no tokens configured: open outside production, 503 in production', async () => {
    expect(authorize(get('/x'), { NODE_ENV: 'development' })).toBeNull();
    const r = authorize(get('/x'), { NODE_ENV: 'production' })!;
    expect(r.status).toBe(503);
    expect((await r.json()).error.code).toBe('AUTH_NOT_CONFIGURED');
    const l = await listItems(get('/api/v1/catalog/items'), deps({ NODE_ENV: 'production' }));
    expect(l.status).toBe(503);
  });
  it('with tokens: missing/wrong → 401, correct → 200 on every endpoint', async () => {
    const env = {
      PRODUCT_ENGINE_API_TOKENS: `${TOKEN}, another-long-token-123`,
      NODE_ENV: 'production',
    };
    for (const h of [
      {} as Record<string, string>,
      { authorization: 'Bearer nope' },
      { authorization: 'Basic abc' },
      { authorization: `Bearer ${TOKEN}x` },
    ]) {
      expect((await listItems(get('/api/v1/catalog/items', h), deps(env))).status).toBe(401);
      expect((await getItem(get('/x', h), 'DTG-00001', deps(env))).status).toBe(401);
      expect((await resolve(post({}, h), deps(env))).status).toBe(401);
    }
    const ok = { authorization: `Bearer ${TOKEN}` };
    expect((await listItems(get('/api/v1/catalog/items', ok), deps(env))).status).toBe(200);
    const second = { authorization: 'Bearer another-long-token-123' };
    expect((await listItems(get('/api/v1/catalog/items', second), deps(env))).status).toBe(200);
  });
  it('tokens shorter than 16 chars are ignored (cannot configure a weak secret)', async () => {
    const env = { PRODUCT_ENGINE_API_TOKENS: 'short', NODE_ENV: 'production' };
    expect(
      (await listItems(get('/api/v1/catalog/items', { authorization: 'Bearer short' }), deps(env)))
        .status,
    ).toBe(503);
  });
});
