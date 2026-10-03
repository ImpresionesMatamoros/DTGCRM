# STEP 10 — CRM ↔ DTG Product Engine integration — final report

## Classification

**PASS WITH P1 OPEN ITEMS — STEP 10 CRM INTEGRATION COMPLETE**

## Exact commits

| Repo           | Start (baseline)                                                               | Final functional commit                                                                 | Branch                              |
| -------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | ----------------------------------- |
| Product Engine | `2b62302e1c1a5aa92677e8963cab0d9c80e8f888`                                     | `2c3f2b6f43721500db00df8317b62dbc66cf2732` (docs commit on top, see delivery `git log`) | `step10/crm-integration`            |
| CRM            | `4c1d50b32d2f5e10657dbc94b6f635ad226909c5` (zip; first local commit `4add65a`) | `5e1551a` (docs commit on top, see delivery `git log`)                                  | `step10/product-engine-integration` |

PE commits: `8c0d3c4` assessment · `8dd15e2` API v1 · `f1573ee` aliases + migration 0019 · `ed59d89` hooks/recorder · `2c3f2b6` hook fix · then docs.
CRM commits: `4add65a` snapshot · `5e33b62` migration + edge function · `5f1167d` UI · `10390ae` QA + contract pin + two UI fixes · `5e1551a` proxy QA · then docs.
The upstream CRM Git history was not reachable; the CRM history starts at the pinned tree, and `crm-step10.patch` (diff against `4add65a`) applies on the real repo at `4c1d50b`.

## Migrations

| Repo | Migration                                                             | Nature                                                                                                                                     |
| ---- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| PE   | `supabase/migrations/0019_crm_search_aliases.sql`                     | data-only, idempotent: owner search aliases for tarjeta tradicional / premium, flyers, imanes (vocabulary is a **proposal**)               |
| CRM  | `supabase/migrations/20261003000000_product_engine_line_snapshot.sql` | additive columns + constraints + guard trigger + 2 RPCs; guarded widening of `productos.precio` only if its scale is < 4; no row rewritten |

## What was built

- **PE** `/api/v1`: `GET catalog/items` (search/list), `GET catalog/items/{id|code}`, `POST pricing/resolve`; strict zod contract, generated JSON schema (CI drift check), contract-version header, bearer auth (`PRODUCT_ENGINE_API_TOKENS`, fail-closed in production), only ACTIVE non-merged items, no internal data.
- **CRM**: Supabase Edge Function `product-engine-proxy` (JWT + allow-list + server-held token + 4 s timeout); catalog picker inside the existing product form (autocomplete, typed options, live price, QUOTE_ONLY/INVALID handling); immutable per-line snapshot in `productos`; explicit “Actualizar precio” (compare then apply) and “Desvincular” (audited); documents keep using saved line values; manual lines unchanged; PE outage never blocks create/save.
- **Docs**: Assessment, API contract, Snapshot model, Auth/network ADR, CRM migration notes, Test report (this folder).

## Acceptance

Scenarios A–J pass with the real PE (see Test report). Regression facts hold ($120 / $400 / $65 / QUOTE_ONLY / QUOTE_ONLY). PE fresh-clone validation green; CRM 18 original suites still pass, 6 baseline-failing suites unchanged, 2 new suites green.

## P1 open items (none blocks the integration; all need the owner or an environment)

1. **Edge Function not deployed** to a real Supabase project and its three secrets not set; until then the CRM behaves as manual-only (safe). Needs a staging deploy + smoke test.
2. **`productos.precio` widening** needs owner/DBA confirmation before production (brief lock; no data loss).
3. **6 CRM QA suites fail at the pinned baseline** in this sandbox (ASTRA-02/03/03-DOM, CHAT-WHATSAPP, TASKS-SIMPLE, TICKET-UX) — pre-existing, unchanged by STEP 10; they need their own maintenance/environment.
4. **Search aliases are proposed vocabulary** (migration 0019) — owner should review the terms.
5. **All PE presentations are DRAFT**: the picker shows canonical names, not curated customer names, until the owner publishes presentations.
6. **Network decision for production** (PE host, optional IP allow-listing, token rotation owner) — ADR gives the baseline only.

## Non-goals respected

No other categories, no CRM master pricing, no SSO/RBAC, no production deploy, no STEP 11 work.
