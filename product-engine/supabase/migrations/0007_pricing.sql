-- 0007 · Master pricing (STEP 03 §7; ADR-0005, ADR-0006).
-- Only AUTHORIZED definitions inside their validity window are resolvable.
-- Historical/unauthorized prices never live here (provenance evidence only).
-- DERIVED (México) and QUOTE_ONLY are behaviour of books/policies, not rows.

create type price_model as enum ('FIXED', 'PER_UNIT', 'EXACT_QUANTITY_MATRIX', 'TIERED', 'MEASURED');
create type price_component as enum ('ITEM', 'DECORATION');
create type price_status as enum ('DRAFT', 'AUTHORIZED', 'SUPERSEDED');
create type amount_basis as enum ('TOTAL', 'UNIT');
create type rule_kind as enum ('ADD_PER_UNIT', 'ADD_FIXED', 'REQUIRE_QUOTE');
create type condition_kind as enum ('OPTION_VALUE', 'DECORATION_METHOD');

create table price_definition (
  id             uuid primary key default gen_random_uuid(),
  item_id        uuid not null references catalog_item (id),
  price_book_id  uuid not null references price_book (id),
  component      price_component not null default 'ITEM',
  model          price_model not null,
  amount         numeric(12, 2) check (amount >= 0),
  rate           numeric(12, 4) check (rate >= 0),
  rate_unit      sale_unit check (rate_unit in ('SQ_FT', 'LINEAR_FT')),
  min_charge     numeric(12, 2) check (min_charge >= 0),
  min_quantity   integer check (min_quantity > 0),
  max_quantity   integer check (max_quantity > 0),
  status         price_status not null default 'DRAFT',
  valid_from     timestamptz not null,
  valid_to       timestamptz,
  version        integer not null default 1 check (version > 0),
  supersedes_id  uuid references price_definition (id),
  authorized_by  text,
  authorized_at  timestamptz,
  created_at     timestamptz not null default now(),
  check (valid_to is null or valid_to > valid_from),
  check (status <> 'AUTHORIZED' or (authorized_by is not null and authorized_at is not null)),
  check (
    case model
      when 'FIXED' then amount is not null and rate is null and max_quantity is not null
      when 'PER_UNIT' then amount is not null and rate is null
      when 'MEASURED' then rate is not null and rate_unit is not null and amount is null
      else amount is null and rate is null   -- matrices and tiers live in price_break
    end
  )
);

create index price_definition_lookup on price_definition (item_id, price_book_id, component) where status = 'AUTHORIZED';

create table price_break (
  price_definition_id uuid not null references price_definition (id) on delete cascade,
  quantity            integer not null check (quantity > 0),
  amount              numeric(12, 2) not null check (amount >= 0),
  amount_basis        amount_basis not null default 'TOTAL',
  primary key (price_definition_id, quantity)
);

create table price_rule (
  id              uuid primary key default gen_random_uuid(),
  price_book_id   uuid not null references price_book (id),
  code            text not null check (code ~ '^[a-z][a-z0-9_]*$'),
  label           text not null,
  kind            rule_kind not null,
  amount          numeric(12, 2) check (amount >= 0),
  exclusivity_key text,
  status          price_status not null default 'DRAFT',
  valid_from      timestamptz not null,
  valid_to        timestamptz,
  version         integer not null default 1 check (version > 0),
  supersedes_id   uuid references price_rule (id),
  authorized_by   text,
  authorized_at   timestamptz,
  unique (price_book_id, code, version),
  check (valid_to is null or valid_to > valid_from),
  check ((kind = 'REQUIRE_QUOTE') = (amount is null)),
  check (status <> 'AUTHORIZED' or (authorized_by is not null and authorized_at is not null))
);

-- Explicit per-item scope. Never by category (a moved item must not inherit surcharges).
create table price_rule_assignment (
  price_rule_id uuid not null references price_rule (id) on delete cascade,
  item_id       uuid not null references catalog_item (id),
  primary key (price_rule_id, item_id)
);

-- Fixed semantics: AND across options, IN within one option. No operators, no expressions.
create table price_condition (
  id                   uuid primary key default gen_random_uuid(),
  price_definition_id  uuid references price_definition (id) on delete cascade,
  price_rule_id        uuid references price_rule (id) on delete cascade,
  kind                 condition_kind not null,
  option_definition_id uuid,
  option_value_id      uuid,
  decoration_method_id uuid references decoration_method (id),
  check ((price_definition_id is null) <> (price_rule_id is null)),
  check (
    (kind = 'OPTION_VALUE' and option_definition_id is not null and option_value_id is not null
       and decoration_method_id is null)
    or (kind = 'DECORATION_METHOD' and decoration_method_id is not null
       and option_definition_id is null and option_value_id is null)
  ),
  foreign key (option_value_id, option_definition_id) references option_value (id, option_definition_id)
);

create index price_condition_definition on price_condition (price_definition_id);
create index price_condition_rule on price_condition (price_rule_id);

-- ---------------------------------------------------------------- invariants

-- Canonical signature of a definition's conditions (to detect identical AUTHORIZED definitions).
create function price_definition_signature(def_id uuid) returns text
language sql stable as $$
  select coalesce(string_agg(
           case kind when 'OPTION_VALUE' then 'opt:' || option_definition_id || '=' || option_value_id
                     else 'dec:' || decoration_method_id end, '|' order by 1), '')
  from price_condition where price_definition_id = def_id
$$;

-- AUTHORIZED is immutable: only status → SUPERSEDED and closing valid_to are allowed.
-- Authorization requires: item with a sale unit, breaks for matrices/tiers, and no
-- other AUTHORIZED definition with identical scope and overlapping validity.
create function price_definition_guard() returns trigger
language plpgsql as $$
declare
  clash uuid;
begin
  if tg_op = 'UPDATE' and old.status in ('AUTHORIZED', 'SUPERSEDED') then
    if (new.item_id, new.price_book_id, new.component, new.model, new.amount, new.rate, new.rate_unit,
        new.min_charge, new.min_quantity, new.max_quantity, new.valid_from, new.version,
        new.authorized_by, new.authorized_at)
       is distinct from
       (old.item_id, old.price_book_id, old.component, old.model, old.amount, old.rate, old.rate_unit,
        old.min_charge, old.min_quantity, old.max_quantity, old.valid_from, old.version,
        old.authorized_by, old.authorized_at)
       or (old.status = 'SUPERSEDED' and new.status <> 'SUPERSEDED')
       or (old.status = 'AUTHORIZED' and new.status not in ('AUTHORIZED', 'SUPERSEDED')) then
      raise exception 'price_definition % is % and immutable; create a new version', old.id, old.status;
    end if;
  end if;

  if new.status = 'AUTHORIZED' and (tg_op = 'INSERT' or old.status <> 'AUTHORIZED') then
    if (select sale_unit from catalog_item where id = new.item_id) is null then
      raise exception 'item % has no sale unit; it cannot have an automatic price', new.item_id;
    end if;
    if new.model in ('EXACT_QUANTITY_MATRIX', 'TIERED')
       and not exists (select 1 from price_break where price_definition_id = new.id) then
      raise exception 'matrix/tier definitions need price breaks before authorization';
    end if;
    select d.id into clash
    from price_definition d
    where d.id <> new.id
      and d.status = 'AUTHORIZED'
      and d.item_id = new.item_id
      and d.price_book_id = new.price_book_id
      and d.component = new.component
      and tstzrange(d.valid_from, d.valid_to, '[)') && tstzrange(new.valid_from, new.valid_to, '[)')
      and price_definition_signature(d.id) = price_definition_signature(new.id)
    limit 1;
    if clash is not null then
      raise exception 'AUTHORIZED definition % already covers the same scope and validity', clash;
    end if;
  end if;
  return new;
end $$;

create trigger price_definition_guard before insert or update on price_definition
  for each row execute function price_definition_guard();

-- Breaks and conditions of an AUTHORIZED/SUPERSEDED definition are frozen.
create function price_child_guard() returns trigger
language plpgsql as $$
declare
  def_id uuid := coalesce(case when tg_op = 'DELETE' then null else
                           (to_jsonb(new) ->> 'price_definition_id')::uuid end,
                          (to_jsonb(old) ->> 'price_definition_id')::uuid);
  rule_id uuid := coalesce(case when tg_op = 'DELETE' then null else
                            (to_jsonb(new) ->> 'price_rule_id')::uuid end,
                           (to_jsonb(old) ->> 'price_rule_id')::uuid);
begin
  if def_id is not null and exists (select 1 from price_definition where id = def_id and status <> 'DRAFT') then
    raise exception 'definition % is not DRAFT; its breaks/conditions are immutable', def_id;
  end if;
  if rule_id is not null and exists (select 1 from price_rule where id = rule_id and status <> 'DRAFT') then
    raise exception 'rule % is not DRAFT; its conditions are immutable', rule_id;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;

create trigger price_break_guard before insert or update or delete on price_break
  for each row execute function price_child_guard();
create trigger price_condition_guard before insert or update or delete on price_condition
  for each row execute function price_child_guard();

create function price_rule_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and old.status in ('AUTHORIZED', 'SUPERSEDED') then
    if (new.price_book_id, new.code, new.label, new.kind, new.amount, new.exclusivity_key,
        new.valid_from, new.version, new.authorized_by, new.authorized_at)
       is distinct from
       (old.price_book_id, old.code, old.label, old.kind, old.amount, old.exclusivity_key,
        old.valid_from, old.version, old.authorized_by, old.authorized_at)
       or (old.status = 'SUPERSEDED' and new.status <> 'SUPERSEDED')
       or (old.status = 'AUTHORIZED' and new.status not in ('AUTHORIZED', 'SUPERSEDED')) then
      raise exception 'price_rule % is % and immutable; create a new version', old.id, old.status;
    end if;
  end if;
  return new;
end $$;

create trigger price_rule_guard before update on price_rule
  for each row execute function price_rule_guard();

-- Authorized or superseded prices are history: they are superseded, never deleted.
create function price_delete_guard() returns trigger
language plpgsql as $$
begin
  if old.status <> 'DRAFT' then
    raise exception '% % is % and cannot be deleted; supersede it instead', tg_table_name, old.id, old.status;
  end if;
  return old;
end $$;

create trigger price_definition_delete_guard before delete on price_definition
  for each row execute function price_delete_guard();
create trigger price_rule_delete_guard before delete on price_rule
  for each row execute function price_delete_guard();
