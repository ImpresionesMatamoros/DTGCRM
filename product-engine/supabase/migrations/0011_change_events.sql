-- 0011 · Append-only change log and monotonic revisions (catalog / pricing).
-- Revisions are what the CRM snapshot will reference (CRM-INTEGRATION-CONTRACT §5).

create type change_scope as enum ('CATALOG', 'PRICING');

create sequence revision_seq;

create table change_event (
  id          bigint generated always as identity primary key,
  revision    bigint not null default nextval('revision_seq'),
  scope       change_scope not null,
  table_name  text not null,
  entity_key  text not null,
  action      text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  old_row     jsonb,
  new_row     jsonb,
  changed_at  timestamptz not null default now(),
  changed_by  text not null default current_user
);

create function record_change() returns trigger
language plpgsql as $$
declare
  row_data jsonb := to_jsonb(coalesce(new, old));
  key text := coalesce(row_data ->> 'id', row_data::text);
begin
  insert into change_event (scope, table_name, entity_key, action, old_row, new_row)
  values (tg_argv[0]::change_scope, tg_table_name, key, tg_op,
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return null;
end $$;

create function forbid_change_event_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'change_event is append-only';
end $$;

create trigger change_event_append_only before update or delete on change_event
  for each row execute function forbid_change_event_mutation();

do $$
declare t text;
begin
  foreach t in array array['catalog_item', 'category', 'catalog_item_category', 'option_definition',
    'option_value', 'item_option', 'item_option_value', 'decoration_method', 'decoration_capability',
    'composition_line', 'presentation', 'publication_profile', 'publication_assignment', 'market']
  loop
    execute format('create trigger %I after insert or update or delete on %I
                    for each row execute function record_change(%L)', t || '_audit', t, 'CATALOG');
  end loop;
  foreach t in array array['price_book', 'item_market_policy', 'pricing_parameter', 'price_definition',
    'price_break', 'price_condition', 'price_rule', 'price_rule_assignment']
  loop
    execute format('create trigger %I after insert or update or delete on %I
                    for each row execute function record_change(%L)', t || '_audit', t, 'PRICING');
  end loop;
end $$;

create view v_revisions as
select coalesce(max(revision) filter (where scope = 'CATALOG'), 0) as catalog_revision,
       coalesce(max(revision) filter (where scope = 'PRICING'), 0) as pricing_revision
from change_event;
