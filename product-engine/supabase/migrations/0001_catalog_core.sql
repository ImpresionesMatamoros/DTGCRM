-- 0001 · Catalog core: stable identity (STEP 02 §3, ADR-0002, ADR-0011)
-- CatalogItem = PRODUCT | SERVICE. BUNDLE stays conceptual until real evidence exists.

create type catalog_item_kind as enum ('PRODUCT', 'SERVICE');
create type catalog_status as enum ('CANDIDATE', 'PLANNED', 'ACTIVE', 'RETIRED');
create type sale_unit as enum ('PIECE', 'PAIR', 'SET', 'PACKAGE', 'SHEET', 'SQ_FT', 'LINEAR_FT');
create type decoration_policy as enum ('NONE', 'OPTIONAL', 'REQUIRED');
create type customer_supplied_item as enum ('NOT_APPLICABLE', 'ALLOWED', 'REQUIRED');

-- Human public code: DTG-00001, DTG-00002… never reused, no embedded meaning (ADR-0011).
create sequence catalog_item_public_code_seq start 1;

create function next_public_code() returns text
language sql volatile as $$
  select 'DTG-' || lpad(nextval('catalog_item_public_code_seq')::text, 5, '0')
$$;

create table catalog_item (
  id                     uuid primary key default gen_random_uuid(),
  public_code            text not null unique default next_public_code()
                           check (public_code ~ '^DTG-[0-9]{5,}$'),
  kind                   catalog_item_kind not null,
  canonical_name         text not null check (btrim(canonical_name) <> ''),
  -- NULL = not assigned yet (migration only). Never a fifth business state (ADR-0002).
  status                 catalog_status,
  sale_unit              sale_unit,
  measurement_spec       jsonb check (measurement_spec is null or jsonb_typeof(measurement_spec) = 'object'),
  decoration_policy      decoration_policy not null default 'NONE',
  customer_supplied_item customer_supplied_item not null default 'NOT_APPLICABLE',
  description_internal   text,
  merged_into_id         uuid references catalog_item (id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint customer_supplied_only_for_service
    check (customer_supplied_item = 'NOT_APPLICABLE' or kind = 'SERVICE'),
  constraint merge_requires_retired
    check (merged_into_id is null or (coalesce(status = 'RETIRED', false) and merged_into_id <> id))
);

comment on table catalog_item is 'Stable commercial identity. Category, presentation and publication live elsewhere.';
comment on column catalog_item.status is 'NULL = unset (migration only); such items are never offered nor published.';

create function catalog_item_guard() returns trigger
language plpgsql as $$
begin
  if new.id <> old.id then
    raise exception 'catalog_item.id is immutable';
  end if;
  if new.public_code <> old.public_code then
    raise exception 'catalog_item.public_code is immutable (ADR-0011)';
  end if;
  if old.status is not null and new.status is null then
    raise exception 'catalog_item.status cannot return to unset (ADR-0002)';
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger catalog_item_guard before update on catalog_item
  for each row execute function catalog_item_guard();
