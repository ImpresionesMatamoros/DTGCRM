-- 0017 · Scoped migration permit and REAL publication log (STEP 09).
-- The platform barrier (REAL publication disabled) is NOT lifted globally. A REAL candidate can only be
-- published when an explicit, audited, append-only PERMIT names it. A permit is a decision by a person:
--   who approved, when, why, which owner decisions it rests on, which market it covers, and exactly
--   which candidates (item + its options/prices/decorations/presentations) it includes.
-- 0001–0016 are untouched.

create table migration_permit (
  id             uuid primary key default gen_random_uuid(),
  scope_key      text not null check (scope_key ~ '^[a-z0-9][a-z0-9-]*$'),
  scope_label    text not null check (btrim(scope_label) <> ''),
  -- Everything the migration was asked to cover (all of it, publishable or not): the identity of the scope.
  scoped_legacy_ids text[] not null check (cardinality(scoped_legacy_ids) > 0),
  -- Markets the permit covers; decisions that only concern other markets may be waived for it.
  markets        text[] not null check (cardinality(markets) > 0),
  status         text not null check (status in ('ACTIVE', 'REVOKED')),
  approved_by    text not null check (btrim(approved_by) <> ''),
  approved_at    timestamptz not null default clock_timestamp(),
  reason         text not null check (btrim(reason) <> ''),
  -- Owner decision references: [{ "decisionId": "D-016", "answerId": "…" }]
  decision_refs  jsonb not null default '[]' check (jsonb_typeof(decision_refs) = 'array'),
  -- Decisions deliberately left open because they do not concern the permit's markets: [{decisionId, reason}]
  waived_decisions jsonb not null default '[]' check (jsonb_typeof(waived_decisions) = 'array'),
  supersedes_id  uuid unique references migration_permit (id)
);
create index migration_permit_scope on migration_permit (scope_key, approved_at);

create table migration_permit_item (
  permit_id      uuid not null references migration_permit (id),
  candidate_id   uuid not null references import_candidate (id),
  item_legacy_id text not null check (btrim(item_legacy_id) <> ''),
  kind           text not null,
  primary key (permit_id, candidate_id)
);
create index migration_permit_item_candidate on migration_permit_item (candidate_id);

create table migration_publication (
  id            uuid primary key default gen_random_uuid(),
  permit_id     uuid not null references migration_permit (id),
  candidate_id  uuid not null references import_candidate (id),
  item_legacy_id text not null,
  actor         text not null check (btrim(actor) <> ''),
  published_at  timestamptz not null default clock_timestamp(),
  -- links created or reused, public code, resulting catalog item
  outcome       jsonb not null check (jsonb_typeof(outcome) = 'object'),
  unique (candidate_id)
);
create index migration_publication_permit on migration_publication (permit_id, published_at);

-- Defence in depth: a publication row must refer to a candidate the ACTIVE (not superseded) permit includes.
create function migration_publication_guard() returns trigger language plpgsql as $$
begin
  if not exists (
    select 1 from migration_permit p
      join migration_permit_item i on i.permit_id = p.id and i.candidate_id = new.candidate_id
     where p.id = new.permit_id and p.status = 'ACTIVE'
       and not exists (select 1 from migration_permit n where n.supersedes_id = p.id)
  ) then
    raise exception 'candidate % is not included in an active migration permit', new.candidate_id;
  end if;
  if not exists (select 1 from import_candidate c where c.id = new.candidate_id and c.review_status = 'PUBLISHED') then
    raise exception 'candidate % is not PUBLISHED', new.candidate_id;
  end if;
  return new;
end $$;
create constraint trigger migration_publication_guard after insert on migration_publication
  deferrable initially deferred for each row execute function migration_publication_guard();

do $$
declare t text;
begin
  foreach t in array array['migration_permit', 'migration_permit_item', 'migration_publication'] loop
    execute format('create trigger %I before delete on %I for each row execute function import_forbid_delete()', t || '_no_delete', t);
    execute format('create trigger %I before update on %I for each row execute function import_forbid_update()', t || '_immutable', t);
    execute format('create trigger %I after insert on %I for each row execute function record_change(%L)', t || '_audit', t, 'IMPORT');
  end loop;
end $$;

comment on table migration_permit is
  'Explicit, append-only permission to publish a bounded set of REAL candidates (STEP 09). Revocation is a new REVOKED row superseding the permit.';
comment on table migration_publication is
  'One row per REAL candidate published under a permit (STEP 09): actor, time and outcome. Candidate-unique: publishing twice cannot duplicate.';
