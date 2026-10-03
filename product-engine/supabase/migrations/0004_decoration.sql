-- 0004 · Decoration methods are processes, never products (ADR-0004).
-- "Blank" is not a method: it is the absence of decoration selections.

create table decoration_method (
  id        uuid primary key default gen_random_uuid(),
  key       text not null unique check (key ~ '^[A-Z][A-Z0-9_]*$'),
  name      text not null,
  is_active boolean not null default true
);

create table decoration_capability (
  item_id     uuid not null references catalog_item (id) on delete cascade,
  method_id   uuid not null references decoration_method (id),
  constraints jsonb check (constraints is null or jsonb_typeof(constraints) = 'object'),
  note        text,
  primary key (item_id, method_id)
);

-- An item with decoration_policy = NONE cannot declare decoration capabilities.
create function decoration_capability_guard() returns trigger
language plpgsql as $$
begin
  if (select decoration_policy from catalog_item where id = new.item_id) = 'NONE' then
    raise exception 'item % does not accept decoration (policy NONE)', new.item_id;
  end if;
  return new;
end $$;

create trigger decoration_capability_guard before insert or update on decoration_capability
  for each row execute function decoration_capability_guard();
