-- 0013 · Import review workflow and domain lineage (STEP 05B).
-- Review status is independent from catalog_status. Publication writes domain rows through
-- the adapter and records the link candidate → domain entity here (two-layer provenance:
-- cell → record → candidate → entity, and entity → candidate → record → cell).

create type import_link_kind as enum ('CREATED', 'LINKED_EXISTING');

create table import_candidate_link (
  candidate_id uuid not null references import_candidate (id),
  role         text not null check (role in ('catalog_item', 'item_option', 'option_definition',
                 'option_value', 'decoration_capability', 'decoration_policy', 'composition_line',
                 'price_definition', 'presentation', 'historical_price_evidence')),
  entity_type  entity_type not null,
  entity_id    uuid not null,
  link_kind    import_link_kind not null,
  detail       jsonb,
  linked_at    timestamptz not null default now(),
  linked_by    text not null default current_user,
  primary key (candidate_id, role, entity_id)
);
create index import_candidate_link_entity on import_candidate_link (entity_type, entity_id);

create trigger import_candidate_link_no_delete before delete on import_candidate_link
  for each row execute function import_forbid_delete();
create trigger import_candidate_link_immutable before update on import_candidate_link
  for each row execute function import_forbid_update();

-- Allowed transitions:
--   PENDING → VALID | WARNING | BLOCKED | REJECTED
--   VALID | WARNING | BLOCKED → VALID | WARNING | BLOCKED (re-validation) | REJECTED
--   VALID | WARNING → APPROVED            (BLOCKED can never be approved)
--   APPROVED → PUBLISHED | REJECTED | VALID | WARNING (approval withdrawn)
--   PUBLISHED, REJECTED: terminal
create function import_candidate_guard() returns trigger
language plpgsql as $$
declare
  ok boolean;
begin
  if (new.id, new.batch_id, new.candidate_key, new.kind, new.lineage_key, new.parser_candidate_keys,
      new.proposal, new.payload_sha256, new.parser_validation_state, new.previous_candidate_id)
     is distinct from
     (old.id, old.batch_id, old.candidate_key, old.kind, old.lineage_key, old.parser_candidate_keys,
      old.proposal, old.payload_sha256, old.parser_validation_state, old.previous_candidate_id) then
    raise exception 'import_candidate % proposal and identity are immutable', old.id;
  end if;
  if old.review_status in ('PUBLISHED', 'REJECTED') then
    raise exception 'import_candidate % is % (terminal)', old.id, old.review_status;
  end if;
  if new.review_status = old.review_status then
    if new.review_status = 'APPROVED' then
      raise exception 'approved candidate % must be re-approved through the workflow', old.id;
    end if;
    return new;
  end if;
  ok := case old.review_status
    when 'PENDING' then new.review_status in ('VALID', 'WARNING', 'BLOCKED', 'REJECTED')
    when 'VALID' then new.review_status in ('WARNING', 'BLOCKED', 'APPROVED', 'REJECTED')
    when 'WARNING' then new.review_status in ('VALID', 'BLOCKED', 'APPROVED', 'REJECTED')
    when 'BLOCKED' then new.review_status in ('VALID', 'WARNING', 'REJECTED')
    when 'APPROVED' then new.review_status in ('PUBLISHED', 'REJECTED', 'VALID', 'WARNING')
    else false
  end;
  if not ok then
    raise exception 'import_candidate %: transition % → % is not allowed', old.id, old.review_status, new.review_status;
  end if;
  if new.review_status = 'PUBLISHED' then
    if not exists (select 1 from import_candidate_link where candidate_id = new.id) then
      raise exception 'import_candidate % cannot be PUBLISHED without a domain link', new.id;
    end if;
    if new.approval_sha256 is distinct from old.approval_sha256 or new.resolution is distinct from old.resolution then
      raise exception 'import_candidate % approval changed at publication', new.id;
    end if;
  end if;
  if new.review_status in ('VALID', 'WARNING', 'BLOCKED') then
    new.approved_by := null;
    new.approved_at := null;
    new.approval_sha256 := null;
  end if;
  return new;
end $$;

create trigger import_candidate_guard before update on import_candidate
  for each row execute function import_candidate_guard();

-- A domain link can only be written for an APPROVED candidate (publication in progress).
create function import_candidate_link_guard() returns trigger
language plpgsql as $$
begin
  if (select review_status from import_candidate where id = new.candidate_id) <> 'APPROVED' then
    raise exception 'domain links require an APPROVED candidate (%).', new.candidate_id;
  end if;
  return new;
end $$;

create trigger import_candidate_link_guard before insert on import_candidate_link
  for each row execute function import_candidate_link_guard();

-- Review history reuses the append-only change log (scope IMPORT does not move
-- catalog/pricing revisions: v_revisions filters by scope).
alter type change_scope add value 'IMPORT';

create trigger import_candidate_audit after update on import_candidate
  for each row execute function record_change('IMPORT');
create trigger import_candidate_link_audit after insert on import_candidate_link
  for each row execute function record_change('IMPORT');
