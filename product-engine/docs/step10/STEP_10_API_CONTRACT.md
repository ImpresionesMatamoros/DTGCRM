# STEP 10 — CRM-facing API contract (v1)

Machine-readable source of truth: `contracts/crm-api.v1.schema.json`, generated from the zod schemas in
`src/api/crm-contracts.ts` + `src/api/contracts.ts` by `pnpm crm-api:schema` (CI fails if the committed file drifts).
The CRM carries a pinned copy in `product-engine-contract/` (`SOURCE.json` records the schema SHA-256) and validates
every recorded and live response against it in `PRODUCT-ENGINE-QA.cjs`.

## Rules

- Base path `/api/v1`. Every business response carries `contract_version: "1"` (body) and `X-DTG-Contract-Version: 1`
  (header). The CRM refuses any other version (`PE_CONTRACT_MISMATCH`) and degrades to manual entry.
- Additive changes (new optional fields, new endpoints) keep `1`. Renames, removals, type or semantic changes require `2`
  and a new path prefix; the CRM must not silently accept it.
- Auth: `Authorization: Bearer <token>` (see ADR). `GET /api/v1/health` stays open.
- Money is a decimal string + currency (ADR-0008). Quantities are integers. Unknown request keys are rejected (strict).
- Business outcomes are HTTP 200 with a `status`: `RESOLVED`, `QUOTE_ONLY`, `INVALID`, `AMBIGUOUS`. HTTP errors are only for
  transport/validation/auth. The CRM never turns `QUOTE_ONLY` into a price and never saves `INVALID` as a linked line.
- Only items that are `ACTIVE` and not merged are visible. CANDIDATE / PLANNED / unset / RETIRED items answer `404 ITEM_NOT_FOUND`
  everywhere (list, detail, resolve — including optional components), so internal items cannot be probed.
- Internal data never leaves: internal description, price definitions, provenance, evidence, owner decisions.

## Endpoints

### `GET /api/v1/catalog/items`

Query (strict, no duplicates): `q` (≤100 chars), `market` (`USA`|`MX`), `limit` (1–50, default 20), `offset` (≥0).
Search ranks public code, then name/READY display name prefix, then name contains, then aliases. Matching is
accent- and case-insensitive over canonical name, READY display names and aliases (any status; aliases only widen matching
and are never emitted). Response: `{contract_version, items:[ItemSummary], page:{limit,offset,total,next_offset}}`.
`ItemSummary`: `id`, `public_code`, `canonical_name`, `display_name`, `item_type`, `sale_unit`, `description`,
`markets[{market,is_available,price_availability,currency}]`. `price_availability` is indicative
(`AUTHORIZED_PRICES` | `QUOTE_ONLY` | `UNAVAILABLE`); the resolve endpoint is the only authority.

### `GET /api/v1/catalog/items/{id|DTG-NNNNN}`

`{contract_version, item, presentations[READY only], options[{key,label,value_kind,unit,is_required,selection_mode,
is_distributable,default_value_code,values[{code,label,spec}]}], decoration|null, components[{role,quantity,item}], markets[]}`.
Enough for the CRM to render a configuration form without knowing any catalog rule.

### `POST /api/v1/pricing/resolve`

Body `{as_of?: ISO-8601, request: PriceRequest}` (strict). `PriceRequest` is the existing wire request
(`catalog_item_id`, `market`, `quantity`, `selections`, measurements, decoration, optional components). Response is the existing
`PriceResult` wire (status, `total`, `catalog_revision`, `pricing_revision`, `effective_at`, `reason_code`, lines, issues).
`as_of` omitted → server clock. The CRM omits it (it wants today's price) and stores `effective_at` from the answer.

## Errors

`{ "error": { "code", "message", "issues?" } }` with codes `UNAUTHORIZED` (401), `AUTH_NOT_CONFIGURED` (503, production
without tokens), `INVALID_QUERY` / `INVALID_JSON` / `INVALID_REQUEST` (400), `ITEM_NOT_FOUND` (404), `INTERNAL` (500, cause only
in the server log). The Supabase proxy additionally answers `PE_UNAVAILABLE`, `PE_NOT_CONFIGURED`, `PE_CONTRACT_MISMATCH` (503)
and `UNAUTHORIZED` (401) — see the ADR.

## Verified regression facts (real API, real DB)

Premium Business Card, 2 sides, 500 → RESOLVED $120.00 USD · Flyer 1000 → $400.00 · Magnets 1 pair → $65.00 ·
Business card 750 → QUOTE_ONLY · Magnets 2 pairs → QUOTE_ONLY.
