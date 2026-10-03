# STEP 10 — Per-line transaction snapshot (CRM `productos`)

## Principle

A CRM ticket line is a **transaction record**, not a catalog reference. When a line is linked to the Product Engine the CRM
stores what the PE answered _at that moment_; nothing is looked up again when a ticket, quote or invoice is rendered. The PE
can change price, rename, retire or restructure the item and the saved line does not move. Re-pricing is an explicit user action.

## Table

`productos` stays the only line table. Existing columns keep their meaning: `descripcion`, `cantidad`, and `precio` = **unit
price** (what documents already multiply by `cantidad`). For a linked line `precio = pe_total_amount / pe_quantity`, half-up to
4 decimals (integer-cents math), so `cantidad × precio` reproduces the PE total to the cent for the quoted quantity. Adjustments,
discounts and the amount actually charged stay in the CRM (payments / document calc), never in the PE.

| Column                                                           | Meaning                                                                                                                          |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `line_source`                                                    | `MANUAL` (default, every existing row) or `PRODUCT_ENGINE`                                                                       |
| `pe_catalog_item_id`, `pe_public_code`                           | stable reference (uuid, `DTG-NNNNN`) — never joined to PE tables                                                                 |
| `pe_canonical_name_snapshot`, `pe_customer_description_snapshot` | names as shown/answered then                                                                                                     |
| `pe_configuration_snapshot`                                      | `{request, selections, contract_version}`: the exact `PriceRequest` + human-readable selection labels, so re-price can resend it |
| `pe_quantity`, `pe_market`                                       | quantity/market priced                                                                                                           |
| `pe_pricing_status_snapshot`                                     | `RESOLVED` / `QUOTE_ONLY` / `AMBIGUOUS` (never `INVALID`)                                                                        |
| `pe_total_amount`, `pe_currency`                                 | PE total (RESOLVED only)                                                                                                         |
| `pe_catalog_revision`, `pe_pricing_revision`, `pe_effective_at`  | provenance from the answer                                                                                                       |
| `pe_reason_code`                                                 | why QUOTE_ONLY / AMBIGUOUS                                                                                                       |
| `pe_contract_version`, `pe_priced_at`                            | contract used, when saved (also the optimistic-concurrency token)                                                                |
| `pe_detached_*`                                                  | who/when/why a line was unlinked, plus the final snapshot (audit)                                                                |

## Lifecycle

1. **Create** — through the normal `productos` insert (same path as manual lines) with the snapshot columns. CHECK constraints
   require a complete snapshot for `PRODUCT_ENGINE` and forbid snapshot data on `MANUAL`.
2. **Save/edit** — `workspace_patch_record` is not widened: description/quantity/price edits keep field-level compare-and-set.
   A guard trigger rejects any change to a snapshot column outside the two RPCs (`PE_SNAPSHOT_IMMUTABLE`).
3. **Re-price** (`product_engine_reprice_line`) — user clicks “Actualizar precio”; the CRM asks the PE, shows _before → after_,
   and only “Aplicar” writes. The RPC compares `p_expected_priced_at` (EDIT_CONFLICT if someone else changed it) and updates
   snapshot + `cantidad` + `precio` atomically.
4. **Detach** (`product_engine_detach_line`) — explicit confirmation + optional reason; the line becomes `MANUAL`, keeps
   `cantidad`/`precio`, and the old snapshot is archived in `pe_detached_snapshot` with actor and time.
5. **Documents** — quotes/invoices already freeze `items` jsonb (`desc`, `cantidad`, `precio`) at emission; they read the saved
   line values and make **zero** PE calls (test J). Document items carry no `pe_*` keys.
6. **Retired / renamed / repriced item** — saved lines keep rendering their snapshot (test G, C). The picker no longer offers
   a retired item; “Actualizar precio” on its line answers “el catálogo ya no acepta esta configuración” and keeps the saved price.

## Manual lines and outages

Free text remains first class (same Enter flow, 5-column legacy insert, no PE columns). If the PE is unreachable, slow
(proxy timeout 4 s), misconfigured or on another contract version, suggestions degrade to “catálogo no disponible”, the typed
text saves as a manual line, and a picked-then-failed line saves as free text with a note. Ticket create/save never awaits the PE.

## No backfill

Existing rows are `MANUAL` with all `pe_*` NULL; the migration touches no row data (test I). Old clients/schemas without the
columns keep working: the CRM maps a missing-column error to a schema-gap message and falls back to the legacy insert.
