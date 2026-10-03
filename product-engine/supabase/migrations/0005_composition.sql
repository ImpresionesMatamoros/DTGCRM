-- 0005 · Composition: "component" is a role of a CatalogItem inside another (STEP 02 §7).
-- No parallel component master, no industrial BOM. REQUIRED/REPLACEMENT stay reserved.

create type composition_role as enum ('INCLUDED', 'OPTIONAL');

create table composition_line (
  id             uuid primary key default gen_random_uuid(),
  parent_item_id uuid not null references catalog_item (id) on delete cascade,
  child_item_id  uuid not null references catalog_item (id),
  quantity       integer not null check (quantity > 0),
  role           composition_role not null,
  sort           integer not null default 0,
  note           text,
  unique (parent_item_id, child_item_id),
  check (parent_item_id <> child_item_id)
);

-- No cycles; maximum depth 2 (parent → child → grandchild).
create function composition_line_guard() returns trigger
language plpgsql as $$
declare
  has_cycle boolean;
  depth_below integer;
  depth_above integer;
begin
  with recursive down(item_id, depth) as (
    select new.child_item_id, 1
    union all
    select c.child_item_id, d.depth + 1
    from composition_line c join down d on c.parent_item_id = d.item_id
    where d.depth < 10 and c.id <> new.id
  )
  select bool_or(item_id = new.parent_item_id), max(depth) into has_cycle, depth_below from down;
  if has_cycle then
    raise exception 'composition cycle through %', new.parent_item_id;
  end if;
  with recursive up(item_id, depth) as (
    select new.parent_item_id, 0
    union all
    select c.parent_item_id, u.depth + 1
    from composition_line c join up u on c.child_item_id = u.item_id
    where u.depth < 10 and c.id <> new.id
  )
  select max(depth) into depth_above from up;
  if depth_above + depth_below > 2 then
    raise exception 'composition deeper than 2 levels';
  end if;
  return new;
end $$;

create trigger composition_line_guard before insert or update on composition_line
  for each row execute function composition_line_guard();
