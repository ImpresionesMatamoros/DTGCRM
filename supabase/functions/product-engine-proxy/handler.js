// Product Engine proxy — core logic, runtime-agnostic ESM (Deno Edge Function and Node tests import it).
// Browser -> this function (user JWT) -> Product Engine /api/v1 (server-held bearer token).
// Allow-list adapter: four operations, never forwards an arbitrary path or header.
// If anything is wrong the answer is a 503 envelope; the CRM then degrades to manual entry.

export const EXPECTED_CONTRACT_VERSION = "1";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function reply(status, body, extra) {
  return new Response(JSON.stringify(body), {
    status,
    headers: Object.assign({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, CORS, extra || {}),
  });
}
const fail = (status, code, message) => reply(status, { error: { code, message } });

function baseUrl(env) {
  const raw = (env.PRODUCT_ENGINE_BASE_URL || "").trim().replace(/\/+$/, "");
  if (!raw) return null;
  let u;
  try { u = new URL(raw); } catch (e) { return null; }
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (u.protocol !== "https:" && !(local && u.protocol === "http:")) return null;
  return u.origin + u.pathname.replace(/\/+$/, "");
}

function timeoutMs(env) {
  const n = Number(env.PRODUCT_ENGINE_TIMEOUT_MS);
  return Number.isFinite(n) && n >= 200 && n <= 10000 ? n : 4000;
}

function plan(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "Body must be an object" };
  switch (body.op) {
    case "health":
      return { method: "GET", path: "/api/v1/health" };
    case "search": {
      const qs = new URLSearchParams();
      if (body.q != null) {
        if (typeof body.q !== "string" || body.q.length > 100) return { error: "q must be a string up to 100 chars" };
        if (body.q.trim()) qs.set("q", body.q.trim());
      }
      if (body.market != null) {
        if (body.market !== "USA" && body.market !== "MX") return { error: "market must be USA or MX" };
        qs.set("market", body.market);
      }
      if (body.limit != null) {
        if (!Number.isInteger(body.limit) || body.limit < 1 || body.limit > 50) return { error: "limit must be 1..50" };
        qs.set("limit", String(body.limit));
      }
      if (body.offset != null) {
        if (!Number.isInteger(body.offset) || body.offset < 0) return { error: "offset must be >= 0" };
        qs.set("offset", String(body.offset));
      }
      const q = qs.toString();
      return { method: "GET", path: "/api/v1/catalog/items" + (q ? "?" + q : "") };
    }
    case "detail":
      if (typeof body.id !== "string" || !/^([0-9a-fA-F-]{36}|DTG-[0-9]{5,})$/.test(body.id)) return { error: "id must be a uuid or public code" };
      return { method: "GET", path: "/api/v1/catalog/items/" + encodeURIComponent(body.id) };
    case "price":
      if (!body.request || typeof body.request !== "object") return { error: "request is required" };
      return { method: "POST", path: "/api/v1/pricing/resolve", json: body.as_of ? { as_of: body.as_of, request: body.request } : { request: body.request } };
    default:
      return { error: "Unknown op" };
  }
}

/**
 * @param {Request} req
 * @param {{ env: Record<string,string|undefined>, fetchImpl?: typeof fetch, verifyUser: (token:string)=>Promise<boolean> }} deps
 */
export async function handle(req, deps) {
  const env = deps.env || {};
  if(env.DTG_ENVIRONMENT==='staging'){
    const ref=env.STAGING_CRM_PROJECT_REF||'',url=env.SUPABASE_URL||'';
    const denied=['jpjpnxamiclvhmcywyhx','imskdujyquefsgndqled','qrllwqoobqkfcqviquhz','ltqyuylmkawfkwoquqod','tecxlkywsanxaxyogqof'];
    let pe;try{pe=new URL(env.PRODUCT_ENGINE_BASE_URL||'');}catch(e){}
    if(!/^[a-z]{20}$/.test(ref)||denied.includes(ref)||url!=='https://'+ref+'.supabase.co'||!pe||pe.protocol!=='https:'||pe.origin!==env.STAGING_PE_ORIGIN||denied.some(r=>pe.href.includes(r))||pe.origin===url||pe.hostname==='impresionesmatamoros.github.io')return fail(503,'STAGING_ISOLATION_REQUIRED','Staging isolation configuration required');
  }
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return fail(405, "METHOD_NOT_ALLOWED", "Use POST");
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return fail(401, "UNAUTHORIZED", "Sign in first");
  let ok = false;
  try { ok = await deps.verifyUser(token); } catch (e) { ok = false; }
  if (!ok) return fail(401, "UNAUTHORIZED", "Sign in first");

  let body;
  try { body = await req.json(); } catch (e) { return fail(400, "INVALID_JSON", "Body must be JSON"); }
  const p = plan(body);
  if (p.error) return fail(400, "INVALID_REQUEST", p.error);

  const base = baseUrl(env);
  const secret = (env.PRODUCT_ENGINE_API_TOKEN || "").trim();
  if (!base) return fail(503, "PE_NOT_CONFIGURED", "Catálogo no configurado");
  if (!secret && body.op !== "health") return fail(503, "PE_NOT_CONFIGURED", "Catálogo no configurado");

  const f = deps.fetchImpl || fetch;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs(env));
  try {
    const headers = { Accept: "application/json" };
    if (secret) headers.Authorization = "Bearer " + secret;
    if (p.json) headers["Content-Type"] = "application/json";
    const res = await f(base + p.path, { method: p.method, headers, body: p.json ? JSON.stringify(p.json) : undefined, signal: ctl.signal });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch (e) { return fail(503, "PE_UNAVAILABLE", "Catálogo no disponible"); }
    if (res.status >= 500) return fail(503, "PE_UNAVAILABLE", "Catálogo no disponible");
    if (res.status === 401 || res.status === 403) return fail(503, "PE_NOT_CONFIGURED", "Catálogo no configurado");
    if (body.op !== "health") {
      const v = res.headers.get("X-DTG-Contract-Version");
      if (v !== EXPECTED_CONTRACT_VERSION) return fail(503, "PE_CONTRACT_MISMATCH", "Versión de contrato incompatible");
    }
    return reply(res.status, json, { "X-DTG-Contract-Version": res.headers.get("X-DTG-Contract-Version") || "" });
  } catch (e) {
    return fail(503, "PE_UNAVAILABLE", "Catálogo no disponible");
  } finally {
    clearTimeout(timer);
  }
}
