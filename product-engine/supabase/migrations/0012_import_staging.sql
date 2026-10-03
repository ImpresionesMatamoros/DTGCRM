-- 0012 · Import staging (STEP 05B). Generic, append-only evidence of every import run.
-- Staging is NOT the domain: nothing here is read by pricing, publication or the CRM.
-- Candidate payloads are JSONB hypotheses; they reach domain tables only through the
-- explicit domain adapter after human approval (0013).

create type import_data_class as enum ('REAL', 'FIXTURE');
create type import_source_role as enum ('PRIMARY_RC', 'COMPARISON', 'SPECIALIZED_EVIDENCE');
create type import_batch_status as enum ('STAGED', 'VALIDATED');
create type import_candidate_kind as enum
  ('CATALOG_ITEM', 'PRICE', 'OPTION', 'DECORATION', 'COMPOSITION', 'PRESENTATION');
-- Review state is deliberately disjoint from catalog_status (CANDIDATE/PLANNED/ACTIVE/RETIRED).
create type import_review_status as enum
  ('PENDING', 'VALID', 'WARNING', 'BLOCKED', 'APPROVED', 'REJECTED', 'PUBLISHED');
create type import_issue_severity as enum ('ERROR', 'WARNING', 'INFO');
create type import_issue_origin as enum ('PARSER', 'INTERCHANGE', 'STAGING', 'ADAPTER');
create type import_lineage_status as enum ('NEW', 'UNCHANGED', 'CHANGED');

-- One row per import run (per workbook envelope).
create table import_batch (
  id                     uuid primary key default gen_random_uuid(),
  source_batch_key       text not null check (source_batch_key ~ '^[0-9a-f]{24}$'),
  contract_version       text not null,
  exporter_version       text not null,
  parser_name            text not null,
  parser_version         text not null,
  source_file            text not null,
  source_sha256          text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  source_role            import_source_role not null,
  data_class             import_data_class not null,
  fixture_name           text,
  -- Explicit lineage (e.g. 'catalog:PRIMARY_RC'): which earlier runs this one follows.
  lineage_key            text not null check (btrim(lineage_key) <> ''),
  attempt                integer not null default 1 check (attempt > 0),
  rerun_of_batch_id      uuid references import_batch (id),
  previous_batch_id      uuid references import_batch (id),
  envelope_sha256        text not null check (envelope_sha256 ~ '^[0-9a-f]{64}$'),
  sheets_inspected       integer not null check (sheets_inspected >= 0),
  rows_inspected         integer not null check (rows_inspected >= 0),
  record_count           integer not null check (record_count >= 0),
  candidate_count        integer not null check (candidate_count >= 0),
  historical_price_count integer not null check (historical_price_count >= 0),
  error_count            integer not null default 0,
  warning_count          integer not null default 0,
  info_count             integer not null default 0,
  parser_counts          jsonb not null,
  workbook               jsonb not null,
  profile                jsonb,
  status                 import_batch_status not null default 'STAGED',
  staged_at              timestamptz not null default now(),
  staged_by              text not null default current_user,
  validated_at           timestamptz,
  check ((attempt = 1) = (rerun_of_batch_id is null)),
  check ((data_class = 'FIXTURE') = (fixture_name is not null)),
  check ((status = 'VALIDATED') = (validated_at is not null)),
  check (previous_batch_id is null or previous_batch_id <> id)
);

-- Idempotency: the same bytes, parser, contract and data class are staged once per attempt.
create unique index import_batch_identity on import_batch
  (source_sha256, parser_version, contract_version, data_class, coalesce(fixture_name, ''), attempt);
create index import_batch_lineage on import_batch (lineage_key, staged_at);

-- Raw evidence: one row per parser record, cells verbatim.
create table import_record (
  id                uuid primary key default gen_random_uuid(),
  batch_id          uuid not null references import_batch (id),
  record_key        text not null check (record_key ~ '^[0-9a-f]{24}$'),
  record_type       text not null,
  legacy_id         text,
  synthetic         boolean not null,
  raw_payload       jsonb not null,
  normalized_payload jsonb not null,
  source_cells      jsonb not null check (jsonb_typeof(source_cells) = 'array'
                                          and jsonb_array_length(source_cells) > 0),
  -- HISTORICAL_PRICE = unauthorized/historical price row: evidence only (ADR-0005).
  evidence_class    text check (evidence_class in ('HISTORICAL_PRICE')),
  evidence          jsonb,
  check ((evidence_class is null) = (evidence is null)),
  unique (batch_id, record_key),
  unique (id, batch_id)
);
create index import_record_legacy on import_record (legacy_id) where legacy_id is not null;

-- Reviewable hypothesis of one domain object (proposal = JSONB, never a domain row).
create table import_candidate (
  id                      uuid primary key default gen_random_uuid(),
  batch_id                uuid not null references import_batch (id),
  candidate_key           text not null check (candidate_key ~ '^[0-9a-f]{24}$'),
  kind                    import_candidate_kind not null,
  -- Cross-batch identity of the hypothesis (kind + legacy lineage), never a coordinate.
  lineage_key             text not null,
  parser_candidate_keys   text[] not null check (cardinality(parser_candidate_keys) > 0),
  proposal                jsonb not null check (jsonb_typeof(proposal) = 'object'),
  payload_sha256          text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  parser_validation_state text not null check (parser_validation_state in ('VALID', 'WARNING', 'REJECTED')),
  unresolved_fields       text[] not null default '{}',
  blocking_reasons        text[] not null default '{}',
  review_status           import_review_status not null default 'PENDING',
  resolution              jsonb check (resolution is null or jsonb_typeof(resolution) = 'object'),
  approved_by             text,
  approved_at             timestamptz,
  approval_sha256         text,
  rejected_by             text,
  rejected_at             timestamptz,
  rejection_reason        text,
  published_by            text,
  published_at            timestamptz,
  previous_candidate_id   uuid references import_candidate (id),
  lineage_status          import_lineage_status not null default 'NEW',
  unique (batch_id, candidate_key),
  unique (id, batch_id),
  check (review_status <> 'BLOCKED' or cardinality(blocking_reasons) > 0),
  check (review_status not in ('APPROVED', 'PUBLISHED') or
         (approved_by is not null and approved_at is not null and approval_sha256 is not null
          and cardinality(blocking_reasons) = 0)),
  check ((review_status = 'PUBLISHED') = (published_at is not null and published_by is not null)),
  check ((review_status = 'REJECTED') = (rejected_at is not null and rejected_by is not null
                                         and rejection_reason is not null))
);
create index import_candidate_lineage on import_candidate (lineage_key);
create index import_candidate_review on import_candidate (batch_id, kind, review_status);

-- Candidate → records it was built from (with the parser's role for each).
create table import_candidate_source (
  candidate_id uuid not null,
  batch_id     uuid not null,
  record_id    uuid not null,
  role         text not null check (role in
                 ('PRIMARY', 'REFERENCE', 'VALUE', 'CONDITION', 'OBSERVATION', 'ATTRIBUTE')),
  ordinal      integer not null check (ordinal >= 0),
  primary key (candidate_id, record_id),
  unique (candidate_id, ordinal),
  foreign key (candidate_id, batch_id) references import_candidate (id, batch_id),
  foreign key (record_id, batch_id) references import_record (id, batch_id)
);
create index import_candidate_source_record on import_candidate_source (record_id);

-- Issues from the parser, the interchange, staging validation and the adapter.
create table import_issue (
  id           uuid primary key default gen_random_uuid(),
  batch_id     uuid not null references import_batch (id),
  issue_key    text not null,
  code         text not null check (code ~ '^[A-Z][A-Z0-9_]*$'),
  severity     import_issue_severity not null,
  origin       import_issue_origin not null,
  message      text not null,
  record_id    uuid,
  candidate_id uuid,
  detail       jsonb,
  -- Cells only for issues without a record (header errors); otherwise the record holds them.
  source_cells jsonb,
  occurrences  integer not null default 1 check (occurrences > 0),
  unique (batch_id, issue_key),
  foreign key (record_id, batch_id) references import_record (id, batch_id),
  foreign key (candidate_id, batch_id) references import_candidate (id, batch_id),
  check (record_id is not null or candidate_id is not null or source_cells is not null)
);
create index import_issue_record on import_issue (record_id);
create index import_issue_candidate on import_issue (candidate_id);

-- ---------------------------------------------------------------- guards

-- Staging is history: rows are never deleted; evidence rows are never edited.
create function import_forbid_delete() returns trigger
language plpgsql as $$
begin
  raise exception '% rows are import history and cannot be deleted', tg_table_name;
end $$;

create function import_forbid_update() returns trigger
language plpgsql as $$
begin
  raise exception '% rows are immutable import evidence', tg_table_name;
end $$;

do $$
declare t text;
begin
  foreach t in array array['import_batch', 'import_record', 'import_candidate',
                           'import_candidate_source', 'import_issue']
  loop
    execute format('create trigger %I before delete on %I for each row execute function import_forbid_delete()',
                   t || '_no_delete', t);
  end loop;
  foreach t in array array['import_record', 'import_candidate_source', 'import_issue']
  loop
    execute format('create trigger %I before update on %I for each row execute function import_forbid_update()',
                   t || '_immutable', t);
  end loop;
end $$;

-- A batch only changes its validation status; its identity and counts are frozen.
create function import_batch_guard() returns trigger
language plpgsql as $$
begin
  if (new.id, new.source_batch_key, new.contract_version, new.exporter_version, new.parser_name,
      new.parser_version, new.source_file, new.source_sha256, new.source_role, new.data_class,
      new.fixture_name, new.lineage_key, new.attempt, new.rerun_of_batch_id, new.previous_batch_id,
      new.envelope_sha256, new.record_count, new.candidate_count, new.historical_price_count,
      new.staged_at, new.staged_by)
     is distinct from
     (old.id, old.source_batch_key, old.contract_version, old.exporter_version, old.parser_name,
      old.parser_version, old.source_file, old.source_sha256, old.source_role, old.data_class,
      old.fixture_name, old.lineage_key, old.attempt, old.rerun_of_batch_id, old.previous_batch_id,
      old.envelope_sha256, old.record_count, old.candidate_count, old.historical_price_count,
      old.staged_at, old.staged_by) then
    raise exception 'import_batch % identity is immutable', old.id;
  end if;
  return new;
end $$;

create trigger import_batch_guard before update on import_batch
  for each row execute function import_batch_guard();

-- Historical price evidence can never feed a PRICE candidate (ADR-0005).
create function import_candidate_source_guard() returns trigger
language plpgsql as $$
begin
  if (select kind from import_candidate where id = new.candidate_id) = 'PRICE'
     and (select evidence_class from import_record where id = new.record_id) = 'HISTORICAL_PRICE' then
    raise exception 'historical price evidence % cannot be a PRICE candidate source', new.record_id;
  end if;
  return new;
end $$;

create trigger import_candidate_source_guard before insert on import_candidate_source
  for each row execute function import_candidate_source_guard();

-- Synthetic (TEST-) rows never become candidate sources.
create function import_candidate_source_synthetic_guard() returns trigger
language plpgsql as $$
begin
  if (select synthetic from import_record where id = new.record_id) then
    raise exception 'synthetic TEST record % cannot feed a candidate', new.record_id;
  end if;
  return new;
end $$;

create trigger import_candidate_source_synthetic_guard before insert on import_candidate_source
  for each row execute function import_candidate_source_synthetic_guard();

comment on table import_batch is 'Import run evidence (STEP 05B). Not domain data; never read by pricing or the CRM.';
comment on table import_candidate is 'Reviewable hypothesis; proposal is JSONB and reaches the domain only via the adapter.';
