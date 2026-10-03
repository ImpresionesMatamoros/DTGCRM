-- 0015 · Price revisions (STEP 07). Smallest structure that gives:
--   · stable lineage (lineage_id) + predecessor (supersedes_id, already there) + successor (superseded_by_id);
--   · consistent closing of the predecessor's interval at supersession;
--   · concurrency-safe overlap protection (advisory lock + deferred re-check at commit);
--   · a reason in the audit trail (change_event.reason, from session setting dtg.reason).
-- No new table, no event sourcing. 0001–0014 are untouched.

-- ---------------------------------------------------------------- audit reason

alter table change_event add column reason text;
comment on column change_event.reason is 'Operator-supplied reason (session setting dtg.reason), e.g. why a price was authorized.';

create or replace function record_change() returns trigger
language plpgsql as $$
declare
  row_data jsonb := to_jsonb(coalesce(new, old));
  key text := coalesce(row_data ->> 'id', row_data::text);
begin
  insert into change_event (scope, table_name, entity_key, action, old_row, new_row, changed_by, context, reason)
  values (tg_argv[0]::change_scope, tg_table_name, key, tg_op,
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end,
          coalesce(nullif(current_setting('dtg.actor', true), ''), current_user),
          nullif(current_setting('dtg.context', true), ''),
          nullif(current_setting('dtg.reason', true), ''));
  return null;
end $$;

-- ---------------------------------------------------------------- lineage columns

alter table price_definition
  add column lineage_id       uuid,
  add column superseded_by_id uuid references price_definition (id),
  add column superseded_at    timestamptz;

-- Backfill: every existing row starts (or continues) its own lineage.
with recursive chain as (
  select id, id as root from price_definition where supersedes_id is null
  union all
  select d.id, c.root from price_definition d join chain c on d.supersedes_id = c.id
)
update price_definition d set lineage_id = chain.root from chain where chain.id = d.id;

alter table price_definition alter column lineage_id set not null;

create unique index price_definition_lineage_version on price_definition (lineage_id, version);
-- One successor per predecessor: two competing drafts of the same revision cannot coexist.
create unique index price_definition_one_successor on price_definition (supersedes_id)
  where supersedes_id is not null;
create index price_definition_lineage on price_definition (lineage_id);

-- SUPERSEDED rows are closed. The successor link is optional only to keep "retire without
-- replacement" (STEP 04 behaviour); the admin service always sets it.
alter table price_definition
  add constraint price_definition_superseded_complete check (
    (status = 'SUPERSEDED' and valid_to is not null)
    or (status <> 'SUPERSEDED' and superseded_by_id is null and superseded_at is null)
  );

comment on column price_definition.lineage_id is
  'Stable key of one commercial price across revisions (the id of its first revision). version = revision number.';

-- ---------------------------------------------------------------- overlap check (shared)

-- AUTHORIZED and SUPERSEDED rows both resolve inside their interval, so both count as "live history".
create function price_definition_find_clash(def_id uuid, ignore_id uuid) returns uuid
language sql stable as $$
  select d.id
    from price_definition n
    join price_definition d
      on d.id <> n.id
     and d.status in ('AUTHORIZED', 'SUPERSEDED')
     and d.item_id = n.item_id and d.price_book_id = n.price_book_id and d.component = n.component
     and tstzrange(d.valid_from, d.valid_to, '[)') && tstzrange(n.valid_from, n.valid_to, '[)')
     and price_definition_signature(d.id) = price_definition_signature(n.id)
   where n.id = def_id and d.id is distinct from ignore_id
   limit 1
$$;

-- ---------------------------------------------------------------- guard (replaces 0007)

create or replace function price_definition_guard() returns trigger
language plpgsql as $$
declare
  clash uuid;
  pred  price_definition;
begin
  -- Serialise every authorization/supersession of the same price scope (concurrency).
  perform pg_advisory_xact_lock(hashtextextended(
    'price:' || new.item_id || ':' || new.price_book_id || ':' || new.component, 0));

  if tg_op = 'INSERT' then
    if new.supersedes_id is not null then
      select * into pred from price_definition where id = new.supersedes_id;
      if not found then
        raise exception 'predecessor % does not exist', new.supersedes_id;
      end if;
      if (pred.item_id, pred.price_book_id, pred.component)
         is distinct from (new.item_id, new.price_book_id, new.component) then
        raise exception 'a new revision must keep item, price book and component of its predecessor';
      end if;
      if new.version <> pred.version + 1 then
        raise exception 'revision number must be predecessor % + 1', pred.version;
      end if;
      if new.valid_from < pred.valid_from then
        raise exception 'a new revision cannot start before its predecessor';
      end if;
      new.lineage_id := pred.lineage_id;
    else
      new.lineage_id := coalesce(new.lineage_id, new.id);
    end if;
    if new.status <> 'DRAFT' and new.superseded_by_id is not null then
      raise exception 'a new row cannot be born superseded';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    if new.lineage_id <> old.lineage_id then
      raise exception 'lineage_id is immutable';
    end if;
    if old.status in ('AUTHORIZED', 'SUPERSEDED') then
      if (new.item_id, new.price_book_id, new.component, new.model, new.amount, new.rate, new.rate_unit,
          new.min_charge, new.min_quantity, new.max_quantity, new.valid_from, new.version,
          new.authorized_by, new.authorized_at, new.supersedes_id)
         is distinct from
         (old.item_id, old.price_book_id, old.component, old.model, old.amount, old.rate, old.rate_unit,
          old.min_charge, old.min_quantity, old.max_quantity, old.valid_from, old.version,
          old.authorized_by, old.authorized_at, old.supersedes_id)
         or (old.status = 'SUPERSEDED' and new.status <> 'SUPERSEDED')
         or (old.status = 'AUTHORIZED' and new.status not in ('AUTHORIZED', 'SUPERSEDED')) then
        raise exception 'price_definition % is % and immutable; create a new version', old.id, old.status;
      end if;
      -- valid_to can only be closed once (NULL → value); never extended, moved or re-opened.
      if new.valid_to is distinct from old.valid_to and old.valid_to is not null then
        raise exception 'price_definition % validity is already closed; it cannot be changed', old.id;
      end if;
      if old.status = 'SUPERSEDED'
         and (new.superseded_by_id, new.superseded_at) is distinct from (old.superseded_by_id, old.superseded_at) then
        raise exception 'price_definition % is superseded; its successor link is immutable', old.id;
      end if;
      if old.status = 'AUTHORIZED' and new.status = 'SUPERSEDED' and new.superseded_by_id is not null then
        if not exists (
          select 1 from price_definition s
           where s.id = new.superseded_by_id and s.supersedes_id = old.id
             and s.status = 'AUTHORIZED' and s.valid_from = new.valid_to) then
          raise exception 'supersession needs an AUTHORIZED successor starting exactly at the predecessor''s valid_to';
        end if;
      end if;
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
    -- The predecessor is closed in the same transaction (see deferred check below).
    clash := price_definition_find_clash(new.id, new.supersedes_id);
    if clash is not null then
      raise exception 'AUTHORIZED definition % already covers the same scope and validity', clash;
    end if;
  end if;
  return new;
end $$;

-- Final safety net at COMMIT: no two live-history rows of the same scope may overlap.
create function price_definition_commit_check() returns trigger
language plpgsql as $$
declare clash uuid;
begin
  if new.status in ('AUTHORIZED', 'SUPERSEDED') then
    clash := price_definition_find_clash(new.id, null);
    if clash is not null then
      raise exception 'price revisions % and % overlap for the same scope', new.id, clash;
    end if;
  end if;
  return null;
end $$;

create constraint trigger price_definition_commit_check
  after insert or update on price_definition
  deferrable initially deferred
  for each row execute function price_definition_commit_check();

-- ---------------------------------------------------------------- rules: same closing discipline

create or replace function price_rule_guard() returns trigger
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
    if new.valid_to is distinct from old.valid_to and old.valid_to is not null then
      raise exception 'price_rule % validity is already closed; it cannot be changed', old.id;
    end if;
  end if;
  return new;
end $$;
