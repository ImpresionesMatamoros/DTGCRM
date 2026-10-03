# STEP 10 — Integration Assessment (written before any code)

Date: 2026-10-02 · Scope: CRM ↔ DTG Product Engine (PE) integration, Commercial Print only.

## 0. Baselines actually used

| Repo                              | Baseline                                                                        | Branch                              |
| --------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------- |
| Product Engine                    | `2b62302e1c1a5aa92677e8963cab0d9c80e8f888` (STEP 09 owner-decisions completion) | `step10/crm-integration`            |
| CRM `ImpresionesMatamoros/DTGCRM` | `4c1d50b32d2f5e10657dbc94b6f635ad226909c5`, tree `6ec32d03…`, 80 files          | `step10/product-engine-integration` |

The CRM repo was not reachable from the sandbox (403). The owner supplied the commit-pinned zip; `verify_crm_snapshot.py`
reports **PASS** (all critical Git blob SHAs match). The CRM working copy is a fresh git repo whose first commit is that
snapshot, so the CRM history in the delivered zip starts at the pinned tree (not the upstream history). Final CRM
changes are therefore delivered as commits on top of the pinned tree plus a patch.

## 1. Product Engine — what exists today

- **Pricing authority**: `resolvePrice(request, snapshot, asOf)` in `src/pricing/resolve.ts` is pure and deterministic; it
  throws without an explicit valid `asOf`. Models FIXED, PER_UNIT, EXACT_QUANTITY_MATRIX, TIERED, MEASURED. Statuses
  RESOLVED / QUOTE_ONLY / INVALID / AMBIGUOUS. Only AUTHORIZED/SUPERSEDED price definitions are loaded by
  `loadCatalogSnapshot` (`src/db/catalog-snapshot.ts`), so drafts, candidates and evidence prices never reach pricing.
- **Wire contract**: `src/api/contracts.ts` already defines `PriceRequestSchema`, `PriceResultWireSchema`,
  `parsePriceRequest`, `priceResultToWire` (snake_case, money as decimal string + currency, ADR-0008). It had **no transport**.
- **HTTP surface**: only `GET /api/v1/health` (static `{service,status,stage}`).
- **Visibility**: `v_publication_membership` + `publication_profile` (`crm_internal`, `catalog_general`, `price_list_usa`,
  `price_list_mx`) all allow only `ACTIVE`. CANDIDATE/PLANNED/unset/RETIRED are never published. `DTG-00016` (unset status) is never public.
- **Customer-facing data model**: `presentation` (es/en display name, short description, aliases, status DRAFT/READY),
  `item_option`/`item_option_value`/`option_definition`/`option_value` (typed, controlled values),
  `decoration_capability`/`decoration_method`, `composition_line` (INCLUDED/OPTIONAL components), `item_market_policy`.
- **Never-public data**: `description_internal`, `price_definition` (authorships, versions, drafts), `provenance`,
  import staging, `candidate_disposition`, owner-decision internals, change events, cost data (none stored), evidence-only history.

Conclusion: the engine is complete as a _library_; STEP 10 only adds a thin, read-only, versioned HTTP layer. No domain or pricing change.

## 2. API v1 plan (Product Engine)

| Endpoint                                              | Behaviour                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/health`                                  | unchanged (open, no DB).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `GET /api/v1/catalog/items?q=&market=&limit=&offset=` | ACTIVE-only (never non-ACTIVE; no override), non-merged, available in `market` when given. Text search over canonical name, public code, es/en READY presentation names and aliases (accent/case-insensitive in the app layer). `limit` 1–50 (default 20), `offset` ≥ 0; invalid → 400 `INVALID_QUERY`. Deterministic order (exact public code, then name, then public code).                                                                                                                                          |
| `GET /api/v1/catalog/items/{uuid-or-public-code}`     | CRM-safe detail: identity, `item_type`, customer description (READY presentation short description only), sale unit, measurement spec, selectable options + allowed values (+ default), decoration only when policy ≠ NONE (methods and constraint keys that are customer-selectable), included/optional components (id, public code, name, quantity, role), per-market availability and `price_availability` (`AUTHORIZED_PRICES` / `QUOTE_ONLY` / `UNAVAILABLE`). Non-ACTIVE → 404 (indistinguishable from missing). |
| `POST /api/v1/pricing/resolve`                        | Body `{ "as_of"?: ISO-8601, "request": <PriceRequestSchema> }`. `as_of` omitted → server clock, echoed as `effective_at`. Same `resolvePrice` + `priceResultToWire`; response is `PriceResultWireSchema`. Non-ACTIVE item → 404 `ITEM_NOT_FOUND`. Invalid body → 400 `INVALID_REQUEST` (zod issues, no stack traces). Business states (QUOTE_ONLY/INVALID/AMBIGUOUS) are **HTTP 200** — they are valid answers, not transport errors.                                                                                  |

Cross-cutting: JSON error envelope `{ "error": { "code", "message" } }`; header `X-DTG-Contract-Version: 1`; `Cache-Control: no-store`;
response bodies validated against zod schemas before leaving the server (a mismatch is a 500 and a failing test, never a silent leak).
Machine-readable schemas are generated from the zod source into `contracts/crm-api.v1.schema.json` (checked by a `--check` script and a unit test) so the CRM harness consumes the same artefact instead of a hand copy.

### Auth / runtime

The PE has no auth today (STEP 10 forbids SSO/RBAC). Minimal policy: `PRODUCT_ENGINE_API_TOKENS` (comma-separated bearer
tokens, constant-time compare). Unset → allowed only outside production; in production unset → **503 `AUTH_NOT_CONFIGURED`** (fail closed). `health` stays open.
Admin routes are not touched (they do not exist over HTTP).

## 3. CRM — what exists today

- Single browser SPA (`index.html`, ~1.8 MB, vanilla JS) + Supabase (Postgres, RLS, Realtime, 2 Edge Functions). No build step.
- `productos(id, ticket_id, descripcion, cantidad, precio)`; `precio` is the **unit** price, line total = `cantidad × precio`;
  `precio IS NULL` means "pendiente" and is a first-class state. Created with a direct insert + `bitacora` row (`addProductoCore`),
  edited through `workspace_patch_record('productos', …)` which whitelists `descripcion, cantidad, precio` with field-level
  compare-and-set (`EDIT_CONFLICT`, errcode 40001), deleted with a real DELETE.
- Documents (quotes/invoices) are **already immutable snapshots**: `documentos.items` (jsonb) is copied at emission
  (`createDocumentoCore`) and rendering never reads `productos` again. Scenario J therefore holds by construction; we add a test to pin it.
- Add-product entry points that must keep working: ticket product bar popover (`popoverForm('producto')` → `submitForm`),
  `/producto` slash command (`parseProductoArg`), quick-create paths, duplicate (re-calls `addProductoCore`), Kanban cell editor.
- The CRM never talks to anything but Supabase today; no PE call, no service secret in the browser.

### Where the picker belongs

Inside the existing **"+ Producto" popover** of the ticket (`popoverForm('producto')`), directly under the _Descripción_ input:
typing ≥ 2 chars shows a debounced suggestion list (public code + name + "Priced/Quote required" hint). Picking a suggestion links the
draft; free text with no pick stays a manual line exactly as today (Enter/Tab flow and the existing `TICKET-UX` behaviour preserved).
A compact configuration block (one `<select>` per required/selectable option, quantity already in the form) appears only after a pick.
No wizard, no new screen. Saved linked lines show a small `DTG-00002` chip + status badge in the existing product row editor, with
"Actualizar precio" and "Desvincular".

## 4. Persistence design (CRM)

One additive Supabase migration `20261003000000_product_engine_line_snapshot.sql` extends `productos` (no parallel table, no old migration edited):

`line_source text` (`MANUAL` default / `PRODUCT_ENGINE`), `pe_catalog_item_id uuid`, `pe_public_code text`, `pe_canonical_name_snapshot text`,
`pe_customer_description_snapshot text`, `pe_configuration_snapshot jsonb`, `pe_quantity numeric`, `pe_market text`,
`pe_pricing_status_snapshot text`, `pe_total_amount numeric`, `pe_currency text`, `pe_catalog_revision int`, `pe_pricing_revision int`,
`pe_effective_at timestamptz`, `pe_reason_code text`, `pe_contract_version text`, `pe_priced_at timestamptz`, `pe_detached_at`, `pe_detached_by`, `pe_detach_reason`.
All nullable except `line_source` (default `MANUAL`) ⇒ **every existing row is valid as-is; no backfill** (scenario I).

Integrity: CHECK constraints (`PRODUCT_ENGINE` rows must carry item id, public code, name, configuration, quantity, status; status in the four PE statuses;
`RESOLVED` must carry total + currency); a trigger makes the snapshot columns **write-once from plain UPDATE** — they can only change inside two
new SECURITY INVOKER RPCs (`product_engine_reprice_line`, `product_engine_detach_line`) that use a transaction-local flag and the same optimistic-expected pattern as `workspace_patch_record`.
`workspace_patch_record` is **not widened**: editing `descripcion/cantidad/precio` on a linked line keeps working (amount adjustments stay in the CRM) while snapshot fields cannot be changed through the generic edit path.
The unit price is `total / quantity`; if that is not cent-exact the migration's guarded widening of `precio` to unconstrained `numeric` (only when the existing column has a fixed scale < 4) preserves the exact total — see `STEP_10_CRM_MIGRATION.md`.

## 5. Network / auth for the CRM

Browser → **Supabase Edge Function `product-engine-proxy`** (verify_jwt, active member check) → PE `/api/v1` with a server-held bearer token.
Reasons: (a) no service secret in `index.html`; (b) no CORS exposure of the PE; (c) timeouts and fail-soft behaviour in one place; (d) PE base URL is a function secret (`PRODUCT_ENGINE_BASE_URL`). The function is an allow-list adapter (4 operations: `search`, `detail`, `price`, `health`), 4 s timeout, never forwards arbitrary paths. If the function is missing, errors, or times out, the CRM shows "Catálogo no disponible — captura manual" and every manual flow is untouched; ticket create/save never awaits PE. Detail in `STEP_10_AUTH_NETWORK_ADR.md`.

## 6. Compatibility risks and mitigations

| Risk                                     | Mitigation                                                                                                                                                                                      |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Old CRM schema (migration not applied)   | Insert falls back to the legacy 5-column payload; PE lines degrade to manual lines (UI hides picker when `SCHEMA` flag says snapshot columns missing).                                          |
| Silent re-pricing                        | No code path calls PE for saved lines except the explicit button; test asserts zero PE calls on render/reload/edit.                                                                             |
| Unit-price rounding                      | See §4; exact total always stored in the snapshot.                                                                                                                                              |
| `workspace_patch_record` conflicts       | Not widened; new RPCs reuse the expected-value check; concurrent-edit SQL test included.                                                                                                        |
| PE catalog change/retire                 | Saved line never reads PE; retired item search no longer finds it, saved snapshot still renders (scenario G).                                                                                   |
| QUOTE_ONLY                               | Line is added with `precio = NULL` ("pendiente"), badge "Cotizar", never an invented price.                                                                                                     |
| INVALID/AMBIGUOUS                        | INVALID: inline actionable errors, Add disabled for the linked path (manual still available). AMBIGUOUS: shown as catalog configuration problem; the line may still be added as quote-required. |
| Stale QA suites in the pinned CRM        | 6/24 fail at baseline (see `STEP_10_TEST_REPORT.md`); rule = no regression in the 18 that pass, results recorded before and after.                                                              |
| Public repo + Edge Function not deployed | All deployment is documented, nothing deployed (no production deploy in scope).                                                                                                                 |

## 7. Exact plan

1. PE: branch, API layer (`src/api/*`, routes), DB read model (`src/db/crm-catalog.ts`), auth, JSON schema generation, unit + DB tests, docs.
2. CRM: migration + SQL test, Edge Function, browser adapter (debounce, abort, timeout, validation), picker UI, snapshot save, explicit re-price/detach, manual path untouched.
3. Cross-system harness: boots the real PE API (Next production server on the rebuilt DB) and drives the CRM page logic in jsdom through the real proxy contract (Node stand-in for the Edge Function logic), scenarios A–J.
4. Clean validation of both repos, reports, zips, final classification.

Out of scope (unchanged): other catalog categories, customers/tickets/payments in PE, CRM master pricing, manual product removal, e-commerce, SSO/RBAC, Mexico tax, production deploy.
