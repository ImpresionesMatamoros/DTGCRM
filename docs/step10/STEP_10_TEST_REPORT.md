# STEP 10 — Test report

Run date 2026-10-02. Product Engine validated in a **fresh `git clone`** of branch `step10/crm-integration` (commit `2c3f2b6`) against
an empty local database, via `tools/step09-rebuild.sh` (install → DB rebuild → seed check → importer → staging → gate → dry run →
Playwright → unit → lint). CRM validated from the repository working tree.

## Product Engine

| Check                                                       | Result                                                                                                  |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile` (fresh clone)              | OK                                                                                                      |
| DB rebuild (19 migrations + seeds)                          | OK                                                                                                      |
| `seed:check`, `crm-api:schema` (no drift)                   | OK                                                                                                      |
| `lint`                                                      | 0 errors (1 pre-existing warning in `scripts/step09-report.ts`)                                         |
| `format:check`, `typecheck`                                 | OK                                                                                                      |
| Unit (`vitest --project unit`)                              | **277 / 277** (includes 19 CRM-API tests)                                                               |
| DB (`vitest --project db`)                                  | **137 / 137** (includes 4 CRM-API DB tests)                                                             |
| Importer (python)                                           | OK                                                                                                      |
| Playwright e2e (STEP 06–09 flows; STEP 10 adds no admin UI) | 9 + 19 + 8 = **36 passed**                                                                              |
| `next build`                                                | OK (new routes: `/api/v1/catalog/items`, `/api/v1/catalog/items/[idOrCode]`, `/api/v1/pricing/resolve`) |

Note: `step09-rebuild.sh` regenerates the STEP 09 report files inside the clone, which makes its last `prettier --check` line
fail on those generated files only; the committed tree passes `format:check` (run separately above).

## CRM

Baseline (pinned `4c1d50b`, this sandbox): 24 QA suites, **18 pass, 6 fail**. The 6 failures are environment/stale-suite failures
that exist **before** any change (ASTRA-02, ASTRA-03, ASTRA-03-DOM, CHAT-WHATSAPP, TASKS-SIMPLE, TICKET-UX). After STEP 10 the same 6 fail with
identical messages (only source line numbers moved); 18 original suites still pass. New suites: `PRODUCT-ENGINE-QA.cjs` and
`PRODUCT-ENGINE-PROXY-QA.cjs` → **26 suites, 20 pass, 6 unchanged baseline failures, 0 regressions**.

| New suite                                            | Offline (recorded real responses) | Real PE (`localhost`, real DB, real hooks) |
| ---------------------------------------------------- | --------------------------------- | ------------------------------------------ |
| `PRODUCT-ENGINE-QA.cjs`                              | 20 / 20                           | 20 / 20                                    |
| `PRODUCT-ENGINE-PROXY-QA.cjs`                        | 9 / 9                             | n/a (pure handler)                         |
| `supabase/tests/product_engine_line_snapshot_qa.sql` | —                                 | pass, migration idempotent on re-apply     |

Every response in both modes is validated with ajv against the generated JSON schema; the schema SHA is pinned.

## Scenarios A–J (cross-system, real PE through the real proxy handler into the real CRM page)

|     | Scenario                                                                                                                                      | Result |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| A   | Search “business” → Business Card results with code and badge; Esc closes suggestions only                                                    | PASS   |
| B   | Premium card, 2 sides, 500 → $120.00 USD; line saved with full snapshot; unit price 0.24                                                      | PASS   |
| C   | PE price revised later ($130) → saved line unchanged, no PE call on render/reload; explicit “Actualizar precio” compares then applies via RPC | PASS   |
| D   | 750 → QUOTE_ONLY, no invented price, line still addable                                                                                       | PASS   |
| E   | Manual free text unchanged (legacy 5-column insert, zero PE columns)                                                                          | PASS   |
| F   | PE down/slow/contract mismatch → suggestions degrade, manual and picked-then-failed lines still save                                          | PASS   |
| G   | Item retired in the PE → saved line still shows snapshot; search no longer offers it; re-price refuses and keeps price                        | PASS   |
| H   | No secret/URL/table reference in the shipped page; CRM has no DB access to PE; proxy never leaks its token                                    | PASS   |
| I   | No backfill: legacy rows map to `pe = null`; un-migrated schema falls back to the legacy insert                                               | PASS   |
| J   | Quote/invoice use saved line values, zero PE calls, no `pe_*` keys in document items                                                          | PASS   |

Regression facts through the real API and UI: Premium card 500/2 sides = $120 · Flyer 1000 = $400 · Magnets 1 pair = $65 · 750 cards
= QUOTE_ONLY · 2 pairs of magnets = QUOTE_ONLY.

## Defects found and fixed by these tests

1. CRM: choosing a suggestion closed the whole composer (the global “click outside” handler saw a node the picker had just replaced). Fixed.
2. CRM: after a failed “Actualizar precio” the line offered no action to retry or detach. Fixed.
3. PE: search found nothing for English vocabulary (“business card”) because presentations are DRAFT and have no English alias → owner aliases (seed + migration 0019).
4. Harness: price-revision hook tried a retroactive supersession (correctly blocked by PE rule); it now takes effect from “now”.

## Not covered / limits

The Edge Function is tested as a handler (Node), not deployed on Supabase/Deno. SQL tests run on local Postgres with stand-ins for
Supabase-only objects (`auth`, roles), not a real Supabase project. 6 baseline CRM suites need their own environment/maintenance (pre-existing).
