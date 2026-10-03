-- 0010 · Provenance beside the catalog, never inside names/codes/notes (STEP 02 §18).
-- HISTORICAL_PRICE_EVIDENCE keeps unauthorized prices out of price_definition (ADR-0005).
-- Polymorphic references (entity_type, entity_id) are audit metadata: never used by pricing.

create type source_kind as enum ('LEGACY_ID', 'EXCEL_ROW', 'OWNER_INTERVIEW', 'DOCUMENT', 'HISTORICAL_PRICE_EVIDENCE');
create type decision_status as enum ('OPEN', 'DECIDED', 'SUPERSEDED');

create domain entity_type as text check (value in (
  'catalog_item', 'option_definition', 'option_value', 'composition_line',
  'price_definition', 'price_rule', 'presentation', 'category'
));

create table source_reference (
  id             uuid primary key default gen_random_uuid(),
  entity_type    entity_type not null,
  entity_id      uuid not null,
  field          text,
  source_kind    source_kind not null,
  source_locator text not null,
  payload        jsonb,
  captured_at    timestamptz not null default now()
);

create index source_reference_entity on source_reference (entity_type, entity_id);
-- Support lookups by legacy Excel id (e.g. MIG1-O-004): provenance only, never identity.
create index source_reference_legacy on source_reference (source_locator) where source_kind = 'LEGACY_ID';

create table decision_record (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  title       text not null,
  status      decision_status not null,
  statement   text not null,
  decided_by  text,
  decided_at  timestamptz,
  source      text,
  check (status = 'OPEN' or (decided_by is not null and decided_at is not null))
);

create table decision_subject (
  decision_id uuid not null references decision_record (id) on delete cascade,
  entity_type entity_type not null,
  entity_id   uuid not null,
  primary key (decision_id, entity_type, entity_id)
);
