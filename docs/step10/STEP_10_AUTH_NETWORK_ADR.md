# ADR — STEP 10: authentication and network path between the CRM and the Product Engine

Status: accepted for STEP 10 (development/staging). Production network decisions remain with the owner (P1).

## Context

The CRM is a browser SPA on Supabase (anon key + user JWT). The PE is a separate Next.js service with its own PostgreSQL and
no user model. Constraints: no PE secret in the browser; the CRM never touches PE tables; a PE outage must not block tickets;
no SSO/RBAC work in this step.

## Decision

```
Browser (CRM user JWT) ──► Supabase Edge Function `product-engine-proxy` ──► PE /api/v1  (bearer token held server-side)
```

1. **Proxy is the only caller.** The browser calls `supabase.functions.invoke('product-engine-proxy', {op, …})`. The function
   verifies the user's JWT and that the user is an active CRM member (`verifyUser`), then forwards **one of four allow-listed
   operations** (`search`, `detail`, `price`, `health`) to a path it builds itself. The browser can choose neither path nor
   headers. Inputs are validated again (q ≤100, limit 1–50, id uuid/public code, market USA|MX).
2. **Service credential.** The PE accepts `Authorization: Bearer <token>` against `PRODUCT_ENGINE_API_TOKENS` (comma list, each
   ≥16 chars, constant-time comparison). Tokens live only in Supabase function secrets (`PRODUCT_ENGINE_API_TOKEN`) and the PE
   environment. Unset tokens: open outside production (local dev/CI), `503 AUTH_NOT_CONFIGURED` in production, so a mis-deployed
   PE fails closed. `/api/v1/health` stays open for monitoring. Rotation: add the new token to the PE list, change the function
   secret, remove the old token.
3. **Failure = degrade.** Timeout (default 4 s, `PRODUCT_ENGINE_TIMEOUT_MS` 200–10000), PE 5xx, non-JSON, PE rejecting our token,
   missing/insecure config (`http` only for localhost) → `503` envelope (`PE_UNAVAILABLE` / `PE_NOT_CONFIGURED`). A contract
   header other than `1` → `PE_CONTRACT_MISMATCH`. The CRM shows “catálogo no disponible” and keeps manual entry; nothing awaits the PE on save.
4. **Transport.** HTTPS PE ↔ function is required. Network allow-listing (PE accepting only Supabase egress) and the PE hosting
   location are not decided here; the bearer token + HTTPS is the baseline, IP restriction is an optional hardening.
5. **No direct DB.** The CRM has no connection string, role or view into PE tables (scenario H: a test greps the shipped page for
   PE secrets/URLs/table names; the proxy test proves the secret never appears in any response).

## Alternatives rejected

- _Browser → PE directly with a token_: puts a secret (or open CORS API) in the browser.
- _Shared database / foreign data wrapper_: makes the CRM depend on PE internals, breaks the “CRM is not a second catalog” rule.
- _Replicating the catalog into the CRM_: a second catalog that drifts; explicitly out of scope.
- _Per-user PE accounts / SSO_: out of scope (non-goal); the proxy already authenticates the user.

## Consequences / open items

- The function must be deployed and its three secrets set before the picker works in an environment (see migration notes). Until then the CRM behaves exactly as before (manual entry) — verified in tests F and I.
- Edge Function body cap and cold-start latency add to the 4 s budget; the CRM debounces and aborts stale searches.
- Auditing which CRM user priced which line is covered by the line snapshot (`pe_priced_at`, ticket history), not by PE logs.
