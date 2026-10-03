# STEP 10 — CRM migration and deployment notes

## Migration

`supabase/migrations/20261003000000_product_engine_line_snapshot.sql` (CRM repo). Idempotent (`add column if not exists`,
`drop constraint if exists`, `create or replace`).

What it does: adds nullable `pe_*` columns and `line_source text not null default 'MANUAL'` to `productos`; CHECK constraints
(`productos_line_source_chk`, `productos_pe_snapshot_chk`); partial index on `pe_catalog_item_id`; guard trigger
`productos_pe_snapshot_guard`; RPCs `product_engine_reprice_line` and `product_engine_detach_line` (security invoker, active
member required, `EDIT_CONFLICT` 40001, `NOT_LINKED`, `DIFFERENT_ITEM`). It does **not** widen `workspace_patch_record`, and
**no existing row is rewritten** (no backfill).

### Pre-apply notes

1. **`productos.precio` precision.** The only non-purely-additive step: if `precio` is `numeric(p,s)` with `s < 4`, the migration
   alters it to unconstrained `numeric` so an exact unit price (e.g. 120/500 = 0.24, 400/1000 = 0.4, 65/1 = 65) and 4-decimal
   prices survive. Widening never loses data; it takes a brief table lock. Owner confirmation before production is listed as a P1 decision.
   If you refuse it, linked lines still save but 4-decimal unit prices would round on write.
2. Apply with the normal Supabase flow (`supabase db push`) on staging first. Roll back by dropping the trigger/RPCs/columns only if
   no `PRODUCT_ENGINE` line exists (otherwise detach lines first); the `precio` widening has no rollback need.
3. Old frontends keep working after the migration (all new columns nullable/defaulted). New frontends on an un-migrated schema
   degrade to the legacy insert and show a schema-gap message (test I).

### Verification

`supabase/tests/product_engine_line_snapshot_qa.sql` (needs the CRM migrations incl. `workspace_patch_record` applied; verified on local Postgres with a stand-in for the Supabase-only parts; everything rolled back): legacy 5-column insert stays valid and defaults to MANUAL; CHECK constraints reject incomplete snapshots and `INVALID`; re-price fails on a stale `p_expected_priced_at` and succeeds on a fresh one, and cannot change the item; anon cannot call the RPCs.

## Edge Function deployment

```
supabase functions deploy product-engine-proxy
supabase secrets set PRODUCT_ENGINE_BASE_URL=https://<pe-host>  PRODUCT_ENGINE_API_TOKEN=<token ≥16 chars>
# optional: PRODUCT_ENGINE_TIMEOUT_MS=4000
```

PE side: set `PRODUCT_ENGINE_API_TOKENS=<same token>` and apply PE migration `0019_crm_search_aliases.sql` (data-only, idempotent:
owner search vocabulary such as “business card”). Smoke test: `invoke` with `{op:"health"}` then `{op:"search", q:"business"}`.

## Not done here (by design)

Function not deployed to any real project; no production data touched; no secrets committed. All presentations in the PE are still
DRAFT, so customer-facing display names come from canonical names until the owner publishes presentations.
