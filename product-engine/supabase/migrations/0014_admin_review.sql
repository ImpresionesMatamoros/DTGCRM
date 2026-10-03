-- 0014 · Admin review console (STEP 06).
-- Draft resolutions live in import_candidate.resolution (already allowed by the 0013 guard while
-- a candidate is not APPROVED). This migration only adds what the console cannot do without:
--   1. actor attribution in change_event (application actor instead of the database role);
--   2. open_fields: fields still unresolved AFTER the draft (computed by src/import, never in SQL);
--   3. an append-only, field-level review audit trail and bulk operation metadata;
--   4. a read-only projection for server-side filtering of the review inbox.

-- ---------------------------------------------------------------- 1 · actor attribution

alter table change_event add column context text;

comment on column change_event.changed_by is
  'Application actor (session setting dtg.actor) or, without one, the database role.';
comment on column change_event.context is
  'Application context of the change (session setting dtg.context), e.g. admin:catalog.update.';

-- Same trigger contract as 0011; only who/why is richer. Without dtg.actor it behaves as before.
create or replace function record_change() returns trigger
language plpgsql as $$
declare
  row_data jsonb := to_jsonb(coalesce(new, old));
  key text := coalesce(row_data ->> 'id', row_data::text);
begin
  insert into change_event (scope, table_name, entity_key, action, old_row, new_row, changed_by, context)
  values (tg_argv[0]::change_scope, tg_table_name, key, tg_op,
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end,
          coalesce(nullif(current_setting('dtg.actor', true), ''), current_user),
          nullif(current_setting('dtg.context', true), ''));
  return null;
end $$;

-- ---------------------------------------------------------------- 2 · open fields

alter table import_candidate add column open_fields text[];

comment on column import_candidate.open_fields is
  'Fields still unresolved after the draft resolution (src/import unresolvedFields). NULL = same as unresolved_fields.';

-- ---------------------------------------------------------------- 3 · review audit trail

create type review_event_action as enum
  ('SET', 'CLEAR', 'APPROVE', 'REJECT', 'WITHDRAW_APPROVAL', 'PUBLISH');
-- Where the decision came from. DECISION_GROUP is reserved for STEP 05C decision packs.
create type review_event_origin as enum ('UI_SINGLE', 'UI_BULK', 'DECISION_GROUP');

create table review_bulk_operation (
  id                  uuid primary key default gen_random_uuid(),
  actor               text not null check (btrim(actor) <> ''),
  kind                import_candidate_kind not null,
  -- field → value applied (the same shape as a draft resolution fragment)
  changes             jsonb not null check (jsonb_typeof(changes) = 'object' and changes <> '{}'::jsonb),
  candidate_ids       uuid[] not null check (cardinality(candidate_ids) > 0),
  -- {selected, affected, unresolved, same, different, skipped: {reason: n}}
  counts              jsonb not null check (jsonb_typeof(counts) = 'object'),
  overwrite_confirmed boolean not null,
  plan_sha256         text not null check (plan_sha256 ~ '^[0-9a-f]{64}$'),
  origin              review_event_origin not null check (origin <> 'UI_SINGLE'),
  origin_ref          text,
  reason              text,
  created_at          timestamptz not null default clock_timestamp(),
  check ((origin = 'DECISION_GROUP') = (origin_ref is not null))
);

create table review_event (
  id                bigint generated always as identity primary key,
  candidate_id      uuid not null references import_candidate (id),
  action            review_event_action not null,
  -- SET/CLEAR: one resolution field. SQL NULL = absent from the draft; JSON null = explicit null.
  field             text,
  old_value         jsonb,
  new_value         jsonb,
  -- Context such as the value the source proposed, the review status before/after, publish links.
  detail            jsonb,
  actor             text not null check (btrim(actor) <> ''),
  reason            text,
  origin            review_event_origin not null,
  bulk_operation_id uuid references review_bulk_operation (id),
  created_at        timestamptz not null default clock_timestamp(),
  check ((action in ('SET', 'CLEAR')) = (field is not null)),
  check ((origin = 'UI_SINGLE') = (bulk_operation_id is null))
);
create index review_event_candidate on review_event (candidate_id, id);
create index review_event_bulk on review_event (bulk_operation_id) where bulk_operation_id is not null;

-- Audit is history: never edited, never deleted (same guards as the import tables).
create trigger review_bulk_operation_no_delete before delete on review_bulk_operation
  for each row execute function import_forbid_delete();
create trigger review_bulk_operation_immutable before update on review_bulk_operation
  for each row execute function import_forbid_update();
create trigger review_event_no_delete before delete on review_event
  for each row execute function import_forbid_delete();
create trigger review_event_immutable before update on review_event
  for each row execute function import_forbid_update();

comment on table review_event is 'Field-level review audit (STEP 06): who changed which resolution field, from what, to what, why.';
comment on table review_bulk_operation is 'One explicit bulk resolution (STEP 06): what was applied to which candidates and what was skipped.';

-- ---------------------------------------------------------------- 4 · inbox projection

create index import_candidate_price_item on import_candidate ((proposal ->> 'itemLegacyId'))
  where kind = 'PRICE';
create index import_candidate_item_legacy on import_candidate ((proposal ->> 'legacyId'))
  where kind = 'CATALOG_ITEM';
create index import_record_historical_item on import_record ((evidence ->> 'item_legacy'))
  where evidence_class = 'HISTORICAL_PRICE';

-- Read-only projection used by the review inbox (filters, sorting, pagination on the server).
-- It projects staging facts; it decides nothing (no status, no validity, no pricing).
create view v_review_candidate as
select c.id,
       c.batch_id,
       c.kind,
       c.lineage_key,
       c.review_status,
       c.proposal,
       c.resolution,
       c.unresolved_fields,
       c.blocking_reasons,
       case when c.review_status in ('APPROVED', 'PUBLISHED') then '{}'::text[]
            else coalesce(c.open_fields, c.unresolved_fields) end as open_fields,
       b.source_file,
       b.data_class,
       b.staged_at,
       coalesce(c.proposal ->> 'legacyId', c.proposal ->> 'itemLegacyId',
                c.proposal ->> 'parentLegacyId') as item_legacy_id,
       case c.kind
         when 'CATALOG_ITEM' then c.proposal ->> 'name'
         when 'OPTION' then c.proposal ->> 'name'
         when 'PRESENTATION' then c.proposal ->> 'displayName'
         when 'DECORATION' then coalesce(
           array_to_string(array(select jsonb_array_elements_text(c.proposal -> 'methodLabels')), ', '),
           array_to_string(array(select jsonb_array_elements_text(c.proposal -> 'valueLabels')), ', '))
         when 'COMPOSITION' then coalesce(c.proposal ->> 'childLegacyId',
           array_to_string(array(select jsonb_array_elements_text(c.proposal -> 'valueLabels')), ', '))
         when 'PRICE' then concat_ws(' · ', c.proposal ->> 'currency', c.proposal ->> 'model',
           jsonb_array_length(c.proposal -> 'observations') || ' obs')
       end as label,
       item.proposal ->> 'name' as item_name,
       src.sheet as source_sheet,
       src.row as source_row,
       src.cell as source_cell,
       coalesce(iss.errors, 0) as error_count,
       coalesce(iss.warnings, 0) as warning_count,
       coalesce(iss.infos, 0) as info_count,
       coalesce(iss.duplicates, 0) > 0 as has_duplicate,
       exists (select 1 from import_candidate p
                where p.batch_id = c.batch_id and p.kind = 'PRICE'
                  and p.proposal ->> 'itemLegacyId' =
                      coalesce(c.proposal ->> 'legacyId', c.proposal ->> 'itemLegacyId')) as has_price,
       exists (select 1 from import_record h
                where h.batch_id = c.batch_id and h.evidence_class = 'HISTORICAL_PRICE'
                  and h.evidence ->> 'item_legacy' =
                      coalesce(c.proposal ->> 'legacyId', c.proposal ->> 'itemLegacyId')) as has_historical
  from import_candidate c
  join import_batch b on b.id = c.batch_id
  left join lateral (
    select i.proposal from import_candidate i
     where i.batch_id = c.batch_id and i.kind = 'CATALOG_ITEM'
       and i.proposal ->> 'legacyId' = coalesce(c.proposal ->> 'legacyId', c.proposal ->> 'itemLegacyId',
                                                 c.proposal ->> 'parentLegacyId')
     limit 1
  ) item on true
  left join lateral (
    select r.source_cells -> 0 ->> 'source_sheet' as sheet,
           (r.source_cells -> 0 ->> 'source_row')::int as row,
           r.source_cells -> 0 ->> 'source_cell' as cell
      from import_candidate_source cs join import_record r on r.id = cs.record_id
     where cs.candidate_id = c.id
     order by (cs.role <> 'PRIMARY'), cs.ordinal
     limit 1
  ) src on true
  left join lateral (
    select count(*) filter (where i.severity = 'ERROR') as errors,
           count(*) filter (where i.severity = 'WARNING') as warnings,
           count(*) filter (where i.severity = 'INFO') as infos,
           count(*) filter (where i.code = 'IMPORT_POSSIBLE_DUPLICATE'
                              or (i.code = 'IMPORT_DUPLICATE_REVIEW' and i.severity <> 'INFO')) as duplicates
      from import_issue i
     where i.candidate_id = c.id
        or i.record_id in (select cs.record_id from import_candidate_source cs where cs.candidate_id = c.id)
  ) iss on true;

comment on view v_review_candidate is 'Review inbox projection (STEP 06). Staging facts only; never read by pricing or the CRM.';
