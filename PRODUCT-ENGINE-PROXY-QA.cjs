/* STEP 10 — product-engine-proxy handler: auth, allow-list, timeout, secret hygiene, contract version. Node only. */
const assert = require('assert');
const path = require('path');
const SECRET = 'SECRET-TOKEN-must-never-leak-0001';
const env = { PRODUCT_ENGINE_BASE_URL: 'https://pe.test', PRODUCT_ENGINE_API_TOKEN: SECRET, PRODUCT_ENGINE_TIMEOUT_MS: '300' };
const res = [];
const test = async (n, f) => { try { await f(); res.push(['PASS', n]); } catch (e) { res.push(['FAIL', n, e]); } };
const post = (body, tok = 'good') => new Request('https://fn.test/product-engine-proxy', { method: 'POST', headers: { Authorization: tok ? 'Bearer ' + tok : '', 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
(async () => {
  const { handle } = await import(require('url').pathToFileURL(path.join(__dirname, 'supabase/functions/product-engine-proxy/handler.js')).href);
  const seen = [];
  const okFetch = (v = '1', status = 200, body = { ok: 1 }) => async (url, init) => { seen.push({ url, init }); return new Response(JSON.stringify(body), { status, headers: { 'X-DTG-Contract-Version': v } }); };
  const deps = (f, user = true) => ({ env, fetchImpl: f, verifyUser: async (t) => user && t === 'good' });
  await test('no / invalid JWT → 401 and PE is never called', async () => {
    seen.length = 0;
    assert.equal((await handle(post({ op: 'health' }, ''), deps(okFetch()))).status, 401);
    assert.equal((await handle(post({ op: 'health' }, 'bad'), deps(okFetch()))).status, 401);
    assert.equal(seen.length, 0);
  });
  await test('allow-list: only search/detail/price/health; unknown op, GET and bad shapes are refused', async () => {
    seen.length = 0;
    for (const b of [{ op: 'delete' }, { op: 'search', limit: 999 }, { op: 'search', market: 'EU' }, { op: 'detail', id: '../admin' }, { op: 'price' }, [], 'x']) assert.equal((await handle(post(b), deps(okFetch()))).status, 400, JSON.stringify(b));
    assert.equal((await handle(new Request('https://fn.test/', { method: 'GET' }), deps(okFetch()))).status, 405);
    assert.equal(seen.length, 0);
  });
  await test('forwards only the planned path with the server-held bearer; the browser cannot choose path or headers', async () => {
    seen.length = 0;
    await handle(post({ op: 'search', q: 'business', market: 'USA', limit: 8, path: '/admin', headers: { Authorization: 'x' } }), deps(okFetch()));
    assert.equal(seen[0].url, 'https://pe.test/api/v1/catalog/items?q=business&market=USA&limit=8');
    assert.equal(seen[0].init.headers.Authorization, 'Bearer ' + SECRET);
    await handle(post({ op: 'price', request: { a: 1 } }), deps(okFetch()));
    assert.equal(seen[1].url, 'https://pe.test/api/v1/pricing/resolve'); assert.equal(seen[1].init.method, 'POST');
  });
  await test('the secret never appears in any response (success, PE error, timeout)', async () => {
    const outs = [await handle(post({ op: 'search' }), deps(okFetch())), await handle(post({ op: 'search' }), deps(okFetch('1', 500, { error: SECRET }))), await handle(post({ op: 'search' }), deps(async (u, i) => new Promise((_, rej) => i.signal.addEventListener('abort', () => rej(new Error(SECRET))))))];
    for (const o of outs) { const t = await o.text(); assert(!t.includes(SECRET)); for (const [, v] of o.headers) assert(!String(v).includes(SECRET)); }
  });
  await test('timeout → 503 PE_UNAVAILABLE; PE 5xx → 503; non-JSON → 503', async () => {
    const t0 = Date.now();
    const r = await handle(post({ op: 'search' }), deps((u, i) => new Promise((_, rej) => i.signal.addEventListener('abort', () => rej(new Error('aborted'))))));
    assert.equal(r.status, 503); assert.equal((await r.json()).error.code, 'PE_UNAVAILABLE'); assert(Date.now() - t0 < 2000);
    assert.equal((await handle(post({ op: 'search' }), deps(okFetch('1', 502, {})))).status, 503);
    assert.equal((await handle(post({ op: 'search' }), deps(async () => new Response('<html>', { status: 200 })))).status, 503);
  });
  await test('PE rejecting our token (401/403) is a configuration problem, not a user problem → 503 PE_NOT_CONFIGURED', async () => {
    const r = await handle(post({ op: 'search' }), deps(okFetch('1', 401, { error: {} })));
    assert.equal(r.status, 503); assert.equal((await r.json()).error.code, 'PE_NOT_CONFIGURED');
  });
  await test('contract version mismatch → 503 PE_CONTRACT_MISMATCH (health excluded)', async () => {
    const r = await handle(post({ op: 'search' }), deps(okFetch('2')));
    assert.equal(r.status, 503); assert.equal((await r.json()).error.code, 'PE_CONTRACT_MISMATCH');
    assert.equal((await handle(post({ op: 'health' }), deps(okFetch('2')))).status, 200);
  });
  await test('business statuses and 4xx pass through untouched (404 item, 400 invalid request)', async () => {
    const r = await handle(post({ op: 'detail', id: 'DTG-99999' }), deps(okFetch('1', 404, { error: { code: 'ITEM_NOT_FOUND' } })));
    assert.equal(r.status, 404); assert.equal((await r.json()).error.code, 'ITEM_NOT_FOUND');
  });
  await test('missing / insecure configuration → 503 PE_NOT_CONFIGURED (http only allowed for localhost)', async () => {
    for (const e of [{}, { ...env, PRODUCT_ENGINE_BASE_URL: 'http://pe.example.com' }, { ...env, PRODUCT_ENGINE_API_TOKEN: '' }]) {
      const r = await handle(post({ op: 'search' }), { env: e, fetchImpl: okFetch(), verifyUser: async () => true }); assert.equal(r.status, 503); assert.equal((await r.json()).error.code, 'PE_NOT_CONFIGURED');
    }
    assert.equal((await handle(post({ op: 'health' }), { env: { ...env, PRODUCT_ENGINE_BASE_URL: 'http://localhost:3910' }, fetchImpl: okFetch(), verifyUser: async () => true })).status, 200);
  });
  let f = 0; for (const r of res) { if (r[0] === 'FAIL') { f++; console.log('FAIL — ' + r[1] + '\n      ' + (r[2].stack || r[2]).split('\n').slice(0, 3).join('\n      ')); } else console.log('PASS — ' + r[1]); }
  console.log((f ? 'FAIL' : 'PASS') + ' PRODUCT-ENGINE-PROXY-QA: ' + (res.length - f) + '/' + res.length); process.exit(f ? 1 : 0);
})();
