# STEP 07 — Pricing assessment (before coding)

Baseline: `db5258b` (STEP 06), branch `step07/pricing-productionization`. Everything below was read from the
actual migrations (0001–0014), `src/pricing`, `src/db/admin/pricing.ts` and the admin pages.

## 1. What already exists (reuse unchanged)

| Area                       | Current state (0007, 0006, 0011, 0014)                                                                                                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `price_definition`         | `status` (`DRAFT/AUTHORIZED/SUPERSEDED`), `valid_from` (NOT NULL), `valid_to`, `version`, `supersedes_id`, `authorized_by/at`, check `valid_to > valid_from`, check "AUTHORIZED ⇒ authorizer + time", model checks per `price_model`. |
| `price_break`              | PK `(definition, quantity)` ⇒ duplicate quantities impossible; `amount_basis` TOTAL/UNIT.                                                                                                                                             |
| `price_condition`          | OPTION_VALUE / DECORATION_METHOD, AND across options, IN within one option.                                                                                                                                                           |
| `price_rule` (+assignment) | Same lifecycle columns; explicit per-item scope.                                                                                                                                                                                      |
| Immutability               | `price_definition_guard`: AUTHORIZED/SUPERSEDED rows frozen except `status → SUPERSEDED` and `valid_to`; `price_child_guard` freezes breaks/conditions of non-DRAFT; `price_delete_guard` forbids deleting non-DRAFT.                 |
| Authorization checks (DB)  | sale unit present, breaks for matrix/tier, **identical condition signature + overlapping interval** rejected.                                                                                                                         |
| Audit                      | `change_event` (append-only, monotonic `revision`) on every pricing table; 0014 adds `changed_by` = `dtg.actor` and `context` = `dtg.context` set per admin transaction.                                                              |
| Capability model           | `src/admin/permissions.ts`: single `ROLE_GRANTS`; `price.authorize` exists but is granted to nobody (D-016).                                                                                                                          |
| Resolver                   | Pure, `asOf` explicit, ADR-0001…0010. Candidate selection → most specific → tie ⇒ `AMBIGUOUS`.                                                                                                                                        |
| Parameters                 | `pricing_parameter` with GiST exclusion (no overlapping validity per key); FX `usd_mxn_fx` = 16.5 from 2026-09-29.                                                                                                                    |
| Market policy              | `item_market_policy` (INHERIT/DERIVED/MANUAL/QUOTE_ONLY + `factor_override`), guard for DERIVED.                                                                                                                                      |
| Admin                      | `/admin/pricing` (item list), `/admin/pricing/[id]` (read-only viewer + simulator), `/admin/pricing/historical`. No price mutation exists anywhere.                                                                                   |

## 2. Gaps vs. STEP 07 goals

1. **No service creates/edits/clones/authorizes/supersedes prices** — only seeds touch `price_definition`.
2. **Resolver ignores SUPERSEDED** (`isLive` requires `AUTHORIZED`), so a past `asOf` cannot be replayed after supersession (goal 8).
3. **`valid_to` on a frozen row is unconstrained** by the guard (it can be moved forward, re-opened or set on an AUTHORIZED row without superseding it).
4. **Supersession is not atomic or consistent:** nothing forces `SUPERSEDED ⇒ valid_to IS NOT NULL`, nor `successor.valid_from = predecessor.valid_to`.
5. **Lineage:** `version` + `supersedes_id` exist but there is no stable lineage key; "revision 3 of definition X" needs a recursive walk and two drafts of the same predecessor are not prevented.
6. **Overlap detection is only "identical signature".** Two definitions with different but _compatible_ conditions and equal specificity (e.g. sides=2 vs size=half-letter) pass the DB check and resolve as `AMBIGUOUS` at runtime. There is no preview.
7. **Concurrency:** the guard's `select … clash` is racy under READ COMMITTED (two transactions can both authorize).
8. **Audit lacks a reason** column and has no explicit authorization/supersession event semantics (only row diffs).
9. **Authorization capability** is un-grantable; there is no controlled dev actor.
10. **No draft simulation**, no comparison, no matrix editor, no market-policy admin, no FX-parameter admin, no decision-intelligence view, no Commercial Print readiness view.

## 3. Proposed migrations (small, after 0014; 0001–0014 untouched)

`0015_price_revisions.sql`

- `price_definition.lineage_id uuid` (stable key; first revision `lineage_id = id`, successors inherit) + unique `(lineage_id, version)` + partial unique index "at most one non-superseded successor per predecessor" (`supersedes_id` unique where status <> 'SUPERSEDED' is not enough; use plain unique on `supersedes_id`).
- `price_definition.superseded_by_id`, `superseded_at` (set once, with the status flip).
- `change_event.reason text` + `record_change()` reads `dtg.reason` (same trigger contract).
- Replace `price_definition_guard`: (a) take `pg_advisory_xact_lock` on `(item, book, component)` before the clash query (concurrency); (b) `valid_to` on frozen rows may only go NULL → value (closing) or stay; never extended/re-opened; (c) `SUPERSEDED` requires `valid_to`, `superseded_by_id`, `superseded_at`; (d) successor `valid_from` ≥ predecessor `valid_from`.
- Same `valid_to`/status tightening for `price_rule` (no new rule lifecycle UI is built; protection only).

No new table. No event-sourcing.

## 4. Code changes (planned)

- Resolver: `isLive` accepts `AUTHORIZED` **and** `SUPERSEDED` inside their (closed) interval. Invariants listed in the prompt §3 are unchanged → no ADR-P0; ADR-0017 documents the temporal-replay semantics.
- `src/pricing/conflicts.ts` (pure): conflict analysis between a candidate definition and the authorized set (identical scope, equal-specificity compatible tie, duplicate breaks, more-specific precedence note, disjoint intervals ignored).
- `src/db/admin/price-admin.ts`: `createDraftPriceDefinition`, `updateDraftPriceDefinition`, `cloneAuthorizedToDraft`, `analyzeAuthorizationConflicts`, `authorizePriceRevision` (tx + lock + supersede), `previewDraft`/`simulateDraft` (in-memory overlay, never reads drafts in normal resolution), `compareRevisions`, `setItemMarketPolicy`, `createFxParameterRevision`.
- Permissions: new capabilities `price.edit`, `price.authorize`, `market.policy`, `pricing.parameter`. `price.authorize` is held only by a _controlled development actor_ (env `DTG_PRICE_AUTHORIZERS`); empty by default. **D-016 stays open.**
- Decision reference: static ingestion of STEP 05C `OWNER-DECISION-QUEUE.json` into `src/decisions/` (domain-neutral, read-only), linked to staging candidates by `legacyId`.
- UI: price list filters, price detail (lineage/history/compare), matrix editor, authorize page with conflict preview, policy admin, FX parameters, `/admin/decisions`, `/admin/pricing/readiness/commercial-print`.

## 5. Explicit non-goals (unchanged)

No REAL publication, no auto-activation of imported prices, no tax engine, no CRM, no deploy, no remote Supabase, no Variant/Bundle/Supplier/Brand/inventory model.
