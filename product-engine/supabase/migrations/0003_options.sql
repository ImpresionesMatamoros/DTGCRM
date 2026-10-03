-- 0003 · Options: typed configuration dimensions without one table per attribute (STEP 03 §4).

create type option_value_kind as enum ('ENUM', 'DIMENSIONS', 'QUANTITY', 'LENGTH', 'TEXT', 'BOOLEAN');
create type option_scope as enum ('ITEM', 'DECORATION');
create type selection_mode as enum ('SINGLE', 'MULTI');

create table option_definition (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique check (key ~ '^[a-z][a-z0-9_]*$'),
  label       text not null,
  value_kind  option_value_kind not null,
  unit        text check (unit in ('in', 'ft', 'oz')),
  scope       option_scope not null default 'ITEM',
  -- measured kinds need a unit; the others must not have one
  check ((value_kind in ('DIMENSIONS', 'QUANTITY', 'LENGTH')) = (unit is not null))
);

create table option_value (
  id                   uuid primary key default gen_random_uuid(),
  option_definition_id uuid not null references option_definition (id),
  code                 text not null check (btrim(code) <> ''),
  label                text not null,
  spec                 jsonb check (spec is null or jsonb_typeof(spec) = 'object'),
  sort                 integer not null default 0,
  is_active            boolean not null default true,
  unique (option_definition_id, code),
  unique (id, option_definition_id) -- target for composite FKs (value belongs to definition)
);

-- Values exist only for enumerable kinds; spec shape follows the kind.
create function option_value_guard() returns trigger
language plpgsql as $$
declare k option_value_kind;
begin
  select value_kind into k from option_definition where id = new.option_definition_id;
  if k in ('TEXT', 'BOOLEAN') then
    raise exception 'option kind % has no enumerated values', k;
  end if;
  if k = 'ENUM' and new.spec is not null then
    raise exception 'ENUM values carry no spec';
  end if;
  if k = 'DIMENSIONS' and not (new.spec ? 'w' and new.spec ? 'h') then
    raise exception 'DIMENSIONS values need spec {w, h}';
  end if;
  if k in ('QUANTITY', 'LENGTH') and not (new.spec ? 'value') then
    raise exception '% values need spec {value}', k;
  end if;
  return new;
end $$;

create trigger option_value_guard before insert or update on option_value
  for each row execute function option_value_guard();

create table item_option (
  item_id              uuid not null references catalog_item (id) on delete cascade,
  option_definition_id uuid not null references option_definition (id),
  is_required          boolean not null default false,
  selection_mode       selection_mode not null default 'SINGLE',
  -- may vary across rows of a quantity distribution (ADR-0001)
  is_distributable     boolean not null default false,
  sort                 integer not null default 0,
  default_value_id     uuid,
  primary key (item_id, option_definition_id),
  check (not is_distributable or selection_mode = 'SINGLE'),
  foreign key (default_value_id, option_definition_id) references option_value (id, option_definition_id)
);

create function item_option_guard() returns trigger
language plpgsql as $$
begin
  if new.is_distributable and (select value_kind from option_definition where id = new.option_definition_id) <> 'ENUM' then
    raise exception 'only ENUM options can be distributable';
  end if;
  return new;
end $$;

create trigger item_option_guard before insert or update on item_option
  for each row execute function item_option_guard();

-- Controlled subset of global values enabled for one item.
create table item_option_value (
  item_id              uuid not null,
  option_definition_id uuid not null,
  option_value_id      uuid not null,
  sort                 integer not null default 0,
  is_active            boolean not null default true,
  primary key (item_id, option_value_id),
  foreign key (item_id, option_definition_id) references item_option (item_id, option_definition_id) on delete cascade,
  foreign key (option_value_id, option_definition_id) references option_value (id, option_definition_id)
);
