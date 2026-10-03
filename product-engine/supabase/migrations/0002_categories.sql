-- 0002 · Mutable classification. Identity never depends on it (STEP 02 §13).

create table category (
  id         uuid primary key default gen_random_uuid(),
  key        text not null unique check (key ~ '^[a-z][a-z0-9_]*$'),
  name       text not null check (btrim(name) <> ''),
  parent_id  uuid references category (id),
  sort       integer not null default 0,
  is_active  boolean not null default true,
  check (parent_id is null or parent_id <> id)
);

create table catalog_item_category (
  item_id     uuid not null references catalog_item (id) on delete cascade,
  category_id uuid not null references category (id),
  is_primary  boolean not null default false,
  primary key (item_id, category_id)
);

-- At most one primary category per item.
create unique index catalog_item_category_one_primary
  on catalog_item_category (item_id) where is_primary;
