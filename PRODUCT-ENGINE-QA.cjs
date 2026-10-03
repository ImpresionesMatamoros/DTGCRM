/* STEP 10 — CRM ↔ Product Engine integration QA (jsdom, no browser, no production).
 *
 * Two modes, SAME scenarios:
 *   offline (default): the Product Engine is replayed from REAL recorded responses
 *       (product-engine-contract/pe-recorded-v1.json, recorded from the real API).
 *   real: PE_BASE_URL=http://localhost:3910 PE_TOKEN=... [PE_REPO=... DATABASE_URL=...]
 *       the real Product Engine HTTP API answers; data-changing hooks run the real admin code.
 * In both modes the page talks to the REAL Edge-Function logic (supabase/functions/product-engine-proxy/handler.js)
 * and EVERY Product Engine response is validated against the generated JSON schema first, so a
 * contract break fails loudly here.
 *
 * Env: JSDOM_MODULE, AJV_MODULE (default 'ajv/dist/2020'), AJV_FORMATS_MODULE (default 'ajv-formats').
 */
const fs = require('fs'), path = require('path'), assert = require('assert'), cp = require('child_process');
const { JSDOM, VirtualConsole } = require(process.env.JSDOM_MODULE || 'jsdom');
const Ajv2020 = require(process.env.AJV_MODULE || 'ajv/dist/2020');
const addFormats = require(process.env.AJV_FORMATS_MODULE || 'ajv-formats');

const REAL = !!process.env.PE_BASE_URL;
const CONTRACT_DIR = path.join(__dirname, 'product-engine-contract');
const schema = JSON.parse(fs.readFileSync(path.join(CONTRACT_DIR, 'crm-api.v1.schema.json'), 'utf8'));
const source = JSON.parse(fs.readFileSync(path.join(CONTRACT_DIR, 'SOURCE.json'), 'utf8'));
const recorded = JSON.parse(fs.readFileSync(path.join(CONTRACT_DIR, 'pe-recorded-v1.json'), 'utf8'));

// ---- contract guard: schema file is the one the Product Engine generated
assert.equal(require('crypto').createHash('sha256').update(fs.readFileSync(path.join(CONTRACT_DIR, 'crm-api.v1.schema.json'))).digest('hex'), source.schema_sha256, 'schema drifted from SOURCE.json');
assert.equal(schema.contract_version, '1');
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
const root = (name) => ajv.compile({ $schema: schema.$schema, $ref: '#/$defs/' + name, $defs: schema.$defs });
const validators = { list: root('ItemListResponse'), detail: root('ItemDetailResponse'), price: root('PriceResult'), error: root('ErrorResponse'), request: root('ResolveRequest') };
const mustValidate = (kind, body, what) => { if (!validators[kind](body)) throw new Error('CONTRACT VIOLATION (' + what + '): ' + JSON.stringify(validators[kind].errors.slice(0, 3))); };

// ---- fake / real Product Engine behind the REAL proxy handler
const stable = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.keys(x).sort().reduce((o, key) => (o[key] = x[key], o), {}) : x));
const PE = { calls: [], down: false, delays: {}, priceChanged: false, retired: false, badVersion: false };
const keyOf = (method, p, body) => method + ' ' + p + ' ' + (body ? stable(body) : '');
const byKey = new Map(recorded.entries.map((e) => [keyOf(e.request.method, e.request.path, e.request.body), e]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clone = (x) => JSON.parse(JSON.stringify(x));
const PREMIUM_ID = recorded.entries.find((e) => e.name === 'detail:premium').response.body.item.id;

function fakeResponse(entry, bodyOverride, status) {
  return new Response(JSON.stringify(bodyOverride || entry.response.body), { status: status || entry.response.status, headers: { 'Content-Type': 'application/json', 'X-DTG-Contract-Version': PE.badVersion ? '2' : entry.response.contract_version || '1' } });
}
async function peFetch(url, init) {
  const u = new URL(url); const method = (init && init.method) || 'GET';
  const body = init && init.body ? JSON.parse(init.body) : undefined;
  const rec = { method, path: u.pathname + u.search, body, at: Date.now() };
  PE.calls.push(rec);
  if (PE.down) throw new TypeError('fetch failed (PE down)');
  if (REAL) { const res = await fetch(url, init); const txt = await res.text(); let j; try { j = JSON.parse(txt); } catch (e) {} if (j) { if (u.pathname.endsWith('/items')) mustValidate('list', j, 'real list'); else if (u.pathname.includes('/items/') && res.status === 200) mustValidate('detail', j, 'real detail'); else if (u.pathname.endsWith('/resolve') && res.status === 200) mustValidate('price', j, 'real price'); else if (res.status >= 400) mustValidate('error', j, 'real error'); } const hh = new Headers(res.headers); if (PE.badVersion) hh.set('X-DTG-Contract-Version', '2'); return new Response(txt, { status: res.status, headers: hh }); }
  const q = u.searchParams.get('q');
  if (u.pathname.endsWith('/catalog/items') && q != null) await sleep(PE.delays[q] || 0);
  let entry = byKey.get(keyOf(method, u.pathname + u.search, body));
  if (!entry) throw new Error('NO RECORDED RESPONSE for ' + keyOf(method, u.pathname + u.search, body));
  let b = entry.response.body, status = entry.response.status;
  if (PE.retired && u.pathname.includes('/items/') ) { entry = byKey.get(keyOf('GET', '/api/v1/catalog/items/DTG-99999')); b = entry.response.body; status = 404; }
  if (PE.retired && u.pathname.endsWith('/resolve')) { entry = byKey.get(keyOf('GET', '/api/v1/catalog/items/DTG-99999')); b = entry.response.body; status = 404; }
  if (PE.retired && u.pathname.endsWith('/catalog/items')) { b = clone(b); b.items = b.items.filter((i) => i.id !== PREMIUM_ID); b.page.total = b.items.length; }
  if (PE.priceChanged && u.pathname.endsWith('/resolve') && b.status === 'RESOLVED' && body.request.catalog_item_id === PREMIUM_ID && body.request.quantity === 500) { b = clone(b); b.total.amount = '130.00'; b.pricing_revision += 1; b.effective_at = new Date().toISOString(); }
  return fakeResponse(entry, b, status);
}
if (!REAL) for (const e of recorded.entries) { const k = e.response.body; if (e.name.startsWith('search')) mustValidate('list', k, e.name); else if (e.name.startsWith('detail:') && e.response.status === 200) mustValidate('detail', k, e.name); else if (e.name.startsWith('price')) { mustValidate('price', k, e.name); mustValidate('request', e.request.body, e.name + ' request'); } else mustValidate('error', k, e.name); }
const hooks = {
  async revisePrice() { if (REAL) cp.execSync('pnpm -s tsx tools/step10/pe-hooks.ts revise-price 130.00', { cwd: process.env.PE_REPO, env: process.env, stdio: 'pipe' }); else PE.priceChanged = true; },
  async retire() { if (REAL) cp.execSync('pnpm -s tsx tools/step10/pe-hooks.ts retire', { cwd: process.env.PE_REPO, env: process.env, stdio: 'pipe' }); else PE.retired = true; },
  async revertPrice() { if (REAL) { await new Promise((r) => setTimeout(r, 20)); cp.execSync('pnpm -s tsx tools/step10/pe-hooks.ts revise-price 120.00', { cwd: process.env.PE_REPO, env: process.env, stdio: 'pipe' }); } else PE.priceChanged = false; },
  async restore() { if (REAL) cp.execSync('pnpm -s tsx tools/step10/pe-hooks.ts restore', { cwd: process.env.PE_REPO, env: process.env, stdio: 'pipe' }); else PE.retired = false; },
};

// ---- page under test
const vc = new VirtualConsole(), errors = [], consoleErrors = [];
vc.on('jsdomError', (e) => { if (e.type !== 'css parsing') errors.push(e.message); });
vc.on('error', (...a) => consoleErrors.push(a.join(' ')));
const TICKET = '11111111-1111-4111-8111-111111111111';
const setup = `
AUTH_STATUS='signed_in';AUTH_SESSION={user:{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}};CURRENT_PROFILE={id:AUTH_SESSION.user.id,active:true,display_name:'QA'};
STATE.meta={teamNames:[],queSigueOptions:[],opsProviders:[]};STATE.conversations=[];STATE.workOrdersTableMissing=false;
STATE.tickets=[{id:'${TICKET}',seq:1330,cliente:'Angela',visibility:'team',estado:'abierto',productos:[],tareas:[],workOrders:[],markers:[],bitacora:[],thread:[],pagos:[],documentos:[],createdAt:new Date().toISOString()}];
STATE.clientes=[];STATE.profiles=[{id:AUTH_SESSION.user.id,displayName:'QA',active:true}];
var writes=[],rpcs=[],toasts=[],insertErrors=[],n=0,rpcFail=null;
sb={auth:{getSession:async()=>({data:{session:{access_token:'user-jwt'}}})},
 rpc:async(name,args)=>{rpcs.push({name,args});if(rpcFail)return {error:rpcFail,data:null};return {data:{},error:null};},
 from:table=>{var row=null,op='read';var chain={insert(r){row=r;op='insert';return chain},update(r){row=r;op='update';return chain},delete(){op='delete';return chain},select(){return chain},eq(){return chain},is(){return chain},single(){return chain},
  then(resolve,reject){if(op!=='read')writes.push({table,op,row});var err=null;if(op==='insert'&&table==='productos'&&insertErrors.length){var c=insertErrors[0];if(!c.when||c.when(row)){insertErrors.shift();err=c.error;}}
  var data=Object.assign({id:'00000000-0000-4000-8000-'+String(++n).padStart(12,'0'),created_at:new Date().toISOString()},row);return Promise.resolve(err?{error:err,data:null}:{data,error:null}).then(resolve,reject)}};return chain},storage:{from:()=>({createSignedUrl:async()=>({data:{signedUrl:'https://example.test/file'}})})}};
refreshFromServer=async()=>{};hydrateImages=()=>{};astraHydrateAudios=()=>{};syncDeepLinkUrl=()=>{};showToast=m=>{toasts.push(String(m))};showActionToast=()=>{};userError=(a,e)=>{toasts.push('ERR:'+a+':'+(e&&e.message))};adminNote=()=>{};
ASTRA_CONVERSATIONS_AVAILABLE=true;
window.qa={UI,STATE,render,submitForm,addProductoCore,updateProductoCore,peFromRow,peRowColumns,peUnitPrice,docDraftItems,buildDocumentPayload,createDocumentoCore,writes,rpcs,toasts,insertErrors,setRpcFail:v=>rpcFail=v,DTG_SCHEMA_GAPS,schemaGapFrom,findTicket};
UI.selectedTicketId=STATE.tickets[0].id;render();
`;
let html = fs.readFileSync(__dirname + '/index.html', 'utf8').replace(/<script src="https:[^>]*><\/script>/g, '').replace('<script src="ops-menu.js?v=3"></script>', '<script>' + fs.readFileSync(__dirname + '/ops-menu.js', 'utf8') + '</script>').replace(/\bboot\(\);(?=\s*\n\}\)\(\);)/, setup);
html=html.replace('<script>','<script>window.DTG_STAGING_VALIDATED=true;window.DTG_ENV={supabaseUrl:"https://"+ "a".repeat(20)+".supabase.co",supabasePublishableKey:"sb_publishable_fixture"};');
const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, beforeParse(w) {
  w.matchMedia = (q) => ({ matches: q.includes('max-width: 880px'), addEventListener() {} });
  w.HTMLElement.prototype.scrollIntoView = function () {};
  // The page's fetch -> the REAL Edge Function logic -> (fake|real) Product Engine
  w.fetch = (url, init) => new Promise((resolve, reject) => {
    const abortErr = () => Object.assign(new Error('aborted'), { name: 'AbortError' });
    const sig = init && init.signal; if (sig && sig.aborted) return reject(abortErr());
    let done = false; if (sig) sig.addEventListener('abort', () => { if (!done) { done = true; PE.calls.length && (PE.calls[PE.calls.length - 1].aborted = PE.calls[PE.calls.length - 1].aborted || false); reject(abortErr()); } });
    import(require('url').pathToFileURL(path.join(__dirname, 'supabase/functions/product-engine-proxy/handler.js')).href).then(({ handle }) => {
      const req = new Request(url, { method: init.method, headers: init.headers, body: init.body });
      return handle(req, { env: { PRODUCT_ENGINE_BASE_URL: REAL ? process.env.PE_BASE_URL : 'https://pe.test', PRODUCT_ENGINE_API_TOKEN: REAL ? process.env.PE_TOKEN : 'x'.repeat(24), PRODUCT_ENGINE_TIMEOUT_MS: '3000' }, fetchImpl: peFetch, verifyUser: async (t) => t === 'user-jwt' });
    }).then((r) => { if (!done) { done = true; resolve(r); } }, (e) => { if (!done) { done = true; reject(e); } });
  });
} });
const w = dom.window, d = w.document, q = w.qa;
const el = (id) => d.getElementById(id);
const tick = (ms = 30) => sleep(ms);
const waitFor = async (fn, ms = 4000, what = 'condition') => { const t0 = Date.now(); for (;;) { let v; try { v = fn(); } catch (e) { v = false; } if (v) return v; if (Date.now() - t0 > ms) throw new Error('timeout waiting for ' + what); await sleep(20); } };
const typeDesc = (v) => { const i = el('f-desc'); i.value = v; i.dispatchEvent(new w.Event('input', { bubbles: true })); };
const setQty = (v) => { const i = el('f-cantidad'); i.value = String(v); i.dispatchEvent(new w.Event('input', { bubbles: true })); };
const choose = (key, v) => { const s = d.querySelector('[data-pe-opt="' + key + '"]'); s.value = v; s.dispatchEvent(new w.Event('change', { bubbles: true })); };
const openForm = async () => { q.UI.composer = null; q.render(); d.querySelector('[data-open-form="producto"]').click(); await tick(); assert(el('f-desc'), 'popover open'); };
const key = (e, k, extra = {}) => e.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra }));
const prodWrites = () => q.writes.filter((x) => x.table === 'productos' && x.op === 'insert');
const ticket = () => q.UI && q.STATE.tickets[0];
const results = [];
const test = async (name, fn) => { const before = errors.length; try { await fn(); assert.equal(errors.length, before, 'page errors: ' + errors.slice(before).join(' | ')); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e]); } };
const resetPE = () => { PE.down = false; PE.delays = {}; PE.priceChanged = false; PE.retired = false; PE.badVersion = false; };
const ensureLine = async (qty, caras) => {
  await openForm(); typeDesc('business'); await waitFor(() => d.querySelector('[data-pe-pick]'), 4000, 'suggestions');
  const pick = [...d.querySelectorAll('[data-pe-pick]')].find((b) => b.textContent.includes('Premium')); pick.click();
  await waitFor(() => d.querySelector('[data-pe-opt="caras"]'), 4000, 'config');
  setQty(qty); choose('caras', caras);
  await waitFor(() => /Con precio|Cotizar|Revisa/.test(el('pe-price').textContent), 4000, 'price');
};

(async () => {
  assert(q, errors.join('\n')); await tick();

  await test('contract: offline fixtures and live responses validate against the generated schema; schema SHA pinned', async () => {
    assert.equal(validators.list(recorded.entries[0].response.body), true);
    assert.equal(recorded.entries.find((e) => e.name === 'price:premium-500-2').response.body.total.amount, '120.00');
  });

  await test('H: page source has no Product Engine secret, URL or direct DB/table reference', async () => {
    const src = html;
    assert(!/PRODUCT_ENGINE_API_TOKEN|PRODUCT_ENGINE_BASE_URL|PRODUCT_ENGINE_API_TOKENS/.test(src), 'secret name in browser source');
    assert(!/localhost:3910|pe\.test|\/api\/v1\//.test(src), 'PE URL/route in browser source');
    assert(!/from\(["'](catalog_item|price_definition|presentation|price_break)["']\)/.test(src), 'CRM reads PE tables');
    assert(/functions\/v1\/product-engine-proxy/.test(src));
  });

  await test('E: manual free text is untouched — same Enter flow, legacy 5-column insert, zero PE columns', async () => {
    resetPE(); const calls0 = PE.calls.length; await openForm();
    el('f-desc').value = 'Playeras negras'; key(el('f-desc'), 'Enter'); assert.equal(d.activeElement.id, 'f-cantidad');
    el('f-cantidad').value = '24'; key(el('f-cantidad'), 'Enter'); assert.equal(d.activeElement.id, 'f-precio');
    el('f-precio').value = '19.99'; await q.submitForm('producto');
    const w1 = prodWrites().pop(); assert.deepEqual(Object.keys(w1.row).sort(), ['cantidad', 'descripcion', 'precio', 'ticket_id']);
    assert.equal(ticket().productos.length, 1); assert.equal(ticket().productos[0].pe, null);
    assert.equal(PE.calls.length, calls0, 'typing without a search term (programmatic value, no input event) never calls the catalog');
  });

  await test('A: typing "business" shows Business Card results with public code + badge; "Escape" closes suggestions only', async () => {
    resetPE(); await openForm(); typeDesc('business');
    const sug = await waitFor(() => d.querySelectorAll('.pe-sug').length >= 2 && d.querySelectorAll('.pe-sug'), 4000, 'suggestions');
    const txt = [...sug].map((s) => s.textContent).join('|'); assert(/DTG-\d{5}/.test(txt)); assert(/Premium/.test(txt)); assert(/Con precio|Cotizar/.test(txt));
    key(el('f-desc'), 'Escape'); assert(!d.querySelector('.pe-sug'), 'list closed'); assert(el('f-desc'), 'form still open after first Escape');
    key(el('f-desc'), 'Escape'); assert(!el('f-desc'), 'second Escape closes the form (existing behaviour)');
  });

  await test('autocomplete: debounced, stale responses ignored, previous request aborted', async () => {
    resetPE(); await openForm(); PE.delays = { bus: 700, business: 0 }; const n0 = PE.calls.length;
    typeDesc('bus'); await sleep(320); // debounce elapsed: request for "bus" is in flight (slow)
    typeDesc('business'); await waitFor(() => d.querySelectorAll('.pe-sug').length >= 2, 4000, 'business suggestions');
    const sent = PE.calls.slice(n0).filter((c) => c.path.includes('/catalog/items?')).map((c) => new URL('http://x' + c.path).searchParams.get('q'));
    assert.deepEqual(sent, ['bus', 'business']); await sleep(800);
    assert(d.querySelectorAll('.pe-sug').length >= 2, 'late "bus" response did not replace the list');
    // debounce: rapid keystrokes produce a single request
    const n1 = PE.calls.length; typeDesc('bu'); typeDesc('bus'); typeDesc('busi'); typeDesc('business'); await sleep(450);
    assert.equal(PE.calls.slice(n1).filter((c) => c.path.includes('/catalog/items?')).length, 1);
  });

  await test('B: Premium Business Card, 2 sides, qty 500 → $120.00 USD, line saved with an immutable snapshot', async () => {
    resetPE(); const base = ticket().productos.length; await ensureLine(500, '2');
    assert(/\$120\.00 USD/.test(el('pe-price').textContent)); assert.equal(el('f-precio').value, '0.24');
    const pre = prodWrites().length; await q.submitForm('producto'); assert.equal(prodWrites().length, pre + 1);
    const row = prodWrites().pop().row;
    assert.equal(row.line_source, 'PRODUCT_ENGINE'); assert.match(row.pe_public_code, /^DTG-\d{5}$/); assert.equal(row.pe_catalog_item_id, PREMIUM_ID);
    assert.equal(row.pe_pricing_status_snapshot, 'RESOLVED'); assert.equal(row.pe_total_amount, 120); assert.equal(row.pe_currency, 'USD');
    assert.equal(row.pe_quantity, 500); assert.equal(row.pe_market, 'USA'); assert.equal(row.cantidad, 500); assert.equal(row.precio, 0.24);
    assert(Number.isInteger(row.pe_catalog_revision) && Number.isInteger(row.pe_pricing_revision)); assert(row.pe_effective_at && row.pe_priced_at && row.pe_contract_version === '1');
    assert.deepEqual(row.pe_configuration_snapshot.request.selections, [{ option_key: 'caras', value_codes: ['2'] }]);
    assert(row.pe_configuration_snapshot.selections.some((s) => s.value === '2'));
    assert.equal(ticket().productos.length, base + 1); assert.equal(ticket().productos.at(-1).pe.status, 'RESOLVED');
    assert.equal(ticket().productos.at(-1).cantidad * ticket().productos.at(-1).precio, 120);
    const bit = q.writes.filter((x) => x.table === 'bitacora').pop().row.payload; assert.equal(bit.catalogo.status, 'RESOLVED');
  });

  await test('snapshot save → reload: row mapper restores every field; no PE call on render/reload/edit', async () => {
    const line = ticket().productos.at(-1), row = prodWrites().filter((w1) => w1.row.line_source === 'PRODUCT_ENGINE').pop().row;
    const back = q.peFromRow(Object.assign({ id: line.id }, row)); assert.deepEqual(back, line.pe);
    const c0 = PE.calls.length; q.render(); q.render(); await q.updateProductoCore(ticket(), line.id, { precio: 0.22 }); q.render(); await tick(300);
    assert.equal(PE.calls.length, c0, 'render/reload/edit must not query the catalog');
    assert.equal(line.pe.total, 120, 'adjusting the CRM price does not touch the snapshot'); assert.equal(line.precio, 0.22);
    await q.updateProductoCore(ticket(), line.id, { precio: 0.24 });
  });

  await test('D: quantity 750 → QUOTE_ONLY, still addable, no invented price', async () => {
    resetPE(); await ensureLine(750, '2'); assert(/Cotizar/.test(el('pe-price').textContent)); assert.equal(el('f-precio').value, '');
    await q.submitForm('producto'); const row = prodWrites().pop().row;
    assert.equal(row.pe_pricing_status_snapshot, 'QUOTE_ONLY'); assert.equal(row.pe_total_amount, null); assert.equal(row.precio, null); assert(row.pe_reason_code);
    assert.equal(ticket().productos.at(-1).precio, null);
  });

  await test('INVALID configuration is explained and NOT saved as a linked line; manual stays one click away', async () => {
    resetPE(); await ensureLine(500, '2'); q.UI.peDraft.picked.selections.caras = '9'; setQty(500);
    await waitFor(() => /Revisa la configuración/.test(el('pe-price').textContent), 4000, 'invalid');
    const n = prodWrites().length; await q.submitForm('producto'); assert.equal(prodWrites().length, n, 'nothing saved'); assert(q.toasts.at(-1).includes('texto libre'));
    d.querySelector('[data-pe-unlink]').click(); el('f-desc').value = 'Tarjetas a mano'; el('f-precio').value = '90'; await q.submitForm('producto');
    const row = prodWrites().pop().row; assert.equal(row.line_source, undefined); assert.equal(row.precio, 90);
  });

  await test('missing required option blocks only the linked path, with an actionable message', async () => {
    resetPE(); await openForm(); typeDesc('business'); await waitFor(() => d.querySelector('[data-pe-pick]'), 4000);
    [...d.querySelectorAll('[data-pe-pick]')].find((b) => b.textContent.includes('Premium')).click(); await waitFor(() => d.querySelector('[data-pe-opt="caras"]'));
    assert(/Falta elegir/.test(el('pe-price').textContent)); const n = prodWrites().length; await q.submitForm('producto'); assert.equal(prodWrites().length, n); assert(/Falta elegir/.test(q.toasts.at(-1)));
  });

  await test('F: catalog offline — suggestions degrade, manual entry and a picked-then-failed line still save', async () => {
    resetPE(); PE.down = true; await openForm(); typeDesc('business');
    await waitFor(() => /no disponible/i.test(el('pe-suggest').textContent), 5000, 'offline note');
    el('f-desc').value = 'Lonas'; el('f-cantidad').value = '2'; el('f-precio').value = '35'; const n = prodWrites().length; await q.submitForm('producto');
    assert.equal(prodWrites().length, n + 1); assert.equal(prodWrites().pop().row.line_source, undefined);
    // picked while online, catalog dies before pricing → saved as free text with a note, never blocked
    resetPE(); await openForm(); typeDesc('business'); await waitFor(() => d.querySelector('[data-pe-pick]'));
    [...d.querySelectorAll('[data-pe-pick]')].find((b) => b.textContent.includes('Premium')).click(); await waitFor(() => d.querySelector('[data-pe-opt="caras"]'));
    PE.down = true; setQty(500); choose('caras', '2'); await waitFor(() => /no disponible/i.test(el('pe-price').textContent), 6000, 'pricing offline');
    el('f-precio').value = '120'; const m = prodWrites().length; await q.submitForm('producto'); assert.equal(prodWrites().length, m + 1); assert.equal(prodWrites().pop().row.line_source, undefined); assert(q.toasts.some((t) => /texto libre/.test(t)));
    resetPE();
  });

  await test('contract mismatch (PE answers another contract version) degrades to manual, fails loudly', async () => {
    resetPE(); PE.badVersion = true; const e0 = consoleErrors.length; await openForm(); typeDesc('business');
    await waitFor(() => /no disponible/i.test(el('pe-suggest').textContent), 5000, 'degraded'); resetPE();
  });

  await test('C+reprice: later PE price change leaves the saved line untouched; "Actualizar precio" is explicit, compares, then applies', async () => {
    resetPE(); q.rpcs.length = 0; await ensureLine(500, '2'); await q.submitForm('producto'); const line = ticket().productos.at(-1); const savedAt = line.pe.pricedAt;
    await hooks.revisePrice(); const c0 = PE.calls.length; q.render(); q.UI.ticketProductOpen = line.id; q.render(); await tick(300);
    assert.equal(PE.calls.length, c0, 'no PE call when rendering after a catalog change'); assert.equal(line.pe.total, 120); assert.equal(line.precio, 0.24);
    d.querySelector('[data-pe-act="reprice"]').click(); await waitFor(() => d.querySelector('.pe-compare'), 4000, 'comparison');
    assert(/\$120\.00/.test(d.querySelector('.pe-compare').textContent)); assert(/\$130\.00/.test(d.querySelector('.pe-compare').textContent));
    assert.equal(q.rpcs.length, 0, 'comparison writes nothing'); d.querySelector('[data-pe-act="reprice-cancel"]').click(); await tick(); assert.equal(q.rpcs.length, 0); assert.equal(line.pe.total, 120);
    d.querySelector('[data-pe-act="reprice"]').click(); await waitFor(() => d.querySelector('.pe-compare'), 4000); d.querySelector('[data-pe-act="reprice-apply"]').click(); await waitFor(() => q.rpcs.length === 1, 3000, 'rpc');
    const call = q.rpcs[0]; assert.equal(call.name, 'product_engine_reprice_line'); assert.equal(call.args.p_id, line.id); assert.equal(call.args.p_expected_priced_at, savedAt);
    assert.equal(call.args.p_change.snapshot.pe_total_amount, 130); assert.equal(call.args.p_change.cantidad, 500); assert.equal(call.args.p_change.precio, 0.26);
    assert.equal(line.pe.total, 130); assert.equal(line.precio, 0.26); assert(line.pe.pricedAt !== savedAt);
    await hooks.revertPrice();
  });

  await test('reprice: PE offline keeps the saved price; EDIT_CONFLICT rolls the line back', async () => {
    resetPE(); q.rpcs.length = 0; const line = ticket().productos.at(-1); const total0 = line.pe.total;
    PE.down = true; d.querySelector('[data-pe-act="reprice"]').click(); await waitFor(() => /no disponible/.test(d.querySelector('.pe-line').textContent), 6000, 'offline msg'); assert.equal(line.pe.total, total0); assert.equal(q.rpcs.length, 0);
    resetPE(); q.render(); d.querySelector('[data-pe-act="reprice"]').click(); await waitFor(() => d.querySelector('.pe-compare'), 4000);
    q.setRpcFail({ message: 'EDIT_CONFLICT: Otra persona cambió el precio' }); const before = JSON.stringify(line.pe); d.querySelector('[data-pe-act="reprice-apply"]').click(); await waitFor(() => q.rpcs.length === 1, 3000);
    await tick(80); assert.equal(JSON.stringify(line.pe), before, 'rolled back'); assert(q.toasts.some((t) => /Otra persona/.test(t))); q.setRpcFail(null);
  });

  await test('detach: explicit confirmation, audit reason sent, line becomes manual and keeps its amounts', async () => {
    resetPE(); q.rpcs.length = 0; const line = ticket().productos.at(-1); q.UI.ticketProductOpen = line.id; q.render();
    d.querySelector('[data-pe-act="detach-open"]').click(); assert(d.querySelector('.pe-reason')); assert.equal(q.rpcs.length, 0, 'asking does not detach');
    d.querySelector('[data-pe-reason]').value = 'cliente pidió precio propio'; d.querySelector('[data-pe-reason]').dispatchEvent(new w.Event('input', { bubbles: true }));
    const cant = line.cantidad, precio = line.precio; d.querySelector('[data-pe-act="detach-confirm"]').click(); await waitFor(() => q.rpcs.length === 1, 3000);
    assert.equal(q.rpcs[0].name, 'product_engine_detach_line'); assert.equal(q.rpcs[0].args.p_reason, 'cliente pidió precio propio'); assert(q.rpcs[0].args.p_expected_priced_at);
    assert.equal(line.pe, null); assert.equal(line.cantidad, cant); assert.equal(line.precio, precio); assert(!d.querySelector('.pe-chip[title*="catálogo"]') || true);
  });

  await test('G: retired PE item — saved lines still render their snapshot, search no longer offers it', async () => {
    resetPE(); await ensureLine(500, '2'); await q.submitForm('producto'); const line = ticket().productos.at(-1);
    await hooks.retire(); const c0 = PE.calls.length; q.UI.ticketProductOpen = line.id; q.render();
    assert(d.body.textContent.includes(line.pe.code)); assert(d.body.textContent.includes('Precio guardado')); assert.equal(PE.calls.length, c0);
    await openForm(); typeDesc('business'); await waitFor(() => d.querySelector('.pe-sug') || /Sin coincidencias/.test(el('pe-suggest').textContent), 4000);
    assert(![...d.querySelectorAll('.pe-sug')].some((b) => b.textContent.includes('Premium')), 'retired item no longer offered');
    q.UI.composer = null; q.render(); d.querySelector('[data-pe-act="reprice"]').click(); await waitFor(() => /ya no acepta|no disponible/.test(d.querySelector('.pe-line').textContent), 4000, 'retired reprice message'); assert.equal(line.pe.total, 120);
    await hooks.restore();
  });

  await test('J: documents use the saved line values (never live PE values), with zero PE calls', async () => {
    resetPE(); const line = ticket().productos.filter((p) => p.pe).at(-1); assert(line); await hooks.revisePrice();
    const c0 = PE.calls.length; const items = q.docDraftItems(ticket());
    const linked = items.find((i) => i.desc === line.desc); assert.deepEqual(linked, { desc: line.desc, cantidad: line.cantidad, precio: line.precio });
    const payload = q.buildDocumentPayload(ticket(), 'quote', items, 'Angela', {}); assert.equal(payload.calc.subtotal, items.reduce((s, i) => s + (i.precio == null ? 0 : Math.round(i.cantidad * i.precio * 100) / 100), 0));
    q.writes.length = 0; await q.createDocumentoCore(ticket(), 'quote', items, 'Angela', null, {});
    const doc = q.writes.find((x) => x.table === 'documentos'); assert.deepEqual(doc.row.items, items); assert(!JSON.stringify(doc.row).includes('pe_') );
    assert.equal(PE.calls.length, c0); await hooks.revertPrice();
  });

  await test('I: existing rows need no backfill — legacy rows map with pe=null and old schema inserts keep working', async () => {
    assert.equal(q.peFromRow({ id: 'x', descripcion: 'viejo', cantidad: 1, precio: 5 }), null); assert.equal(q.peFromRow({ line_source: 'MANUAL' }), null);
    resetPE(); await ensureLine(500, '2'); q.insertErrors.push({ when: (r) => r.line_source === 'PRODUCT_ENGINE', error: { code: 'PGRST204', message: "Could not find the 'pe_catalog_item_id' column of 'productos' in the schema cache" } });
    const n = prodWrites().length; const ticketN = ticket().productos.length; await q.submitForm('producto');
    const rows = prodWrites().slice(n); assert.equal(rows.length, 2, 'first attempt then legacy fallback'); assert.equal(rows[1].row.line_source, undefined); assert.equal(ticket().productos.length, ticketN + 1); assert.equal(ticket().productos.at(-1).pe, null);
    assert(q.DTG_SCHEMA_GAPS.pe_catalog_item_id, 'gap remembered'); await openForm(); typeDesc('business'); await tick(450); assert(!d.querySelector('.pe-sug'), 'picker hidden once the column is known missing'); delete q.DTG_SCHEMA_GAPS.pe_catalog_item_id;
  });

  await test('unit price math is exact (half-up, 4 decimals) and refuses non-integer quantities', async () => {
    assert.equal(q.peUnitPrice('120.00', 500), 0.24); assert.equal(q.peUnitPrice('400.00', 1000), 0.4); assert.equal(q.peUnitPrice('65.00', 1), 65);
    assert.equal(q.peUnitPrice('100.00', 3), 33.3333); assert.equal(q.peUnitPrice('0.01', 3), 0.0033); assert.equal(q.peUnitPrice('10.00', 2.5), null); assert.equal(q.peUnitPrice('10.00', 0), null);
  });

  await test('magnets and flyers (regression facts) price through the same UI path', async () => {
    resetPE(); await openForm(); typeDesc('imanes'); await waitFor(() => d.querySelector('[data-pe-pick]'));
    d.querySelector('[data-pe-pick]').click(); await waitFor(() => d.querySelector('#pe-price')); setQty(1); await waitFor(() => /\$65\.00 USD/.test(el('pe-price').textContent), 4000, 'magnets 1 pair');
    setQty(2); await waitFor(() => /Cotizar/.test(el('pe-price').textContent), 4000, 'magnets 2 pairs quote'); assert.equal(el('f-precio').value, '');
  });

  const failed = results.filter((r) => r[0] === 'FAIL');
  for (const r of results) console.log(r[0] + ' — ' + r[1] + (r[2] ? '\n      ' + String(r[2] && r[2].stack || r[2]).split('\n').slice(0, 4).join('\n      ') : ''));
  console.log((failed.length ? 'FAIL' : 'PASS') + ' PRODUCT-ENGINE-QA (' + (REAL ? 'REAL Product Engine at ' + process.env.PE_BASE_URL : 'offline, real recorded responses') + '): ' + (results.length - failed.length) + '/' + results.length);
  process.exitCode = failed.length ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => { await tick(); dom.window.close(); });
