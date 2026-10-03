-- 0016 · Data quality & controlled bulk operations (STEP 08).
-- Findings and readiness are NOT stored: they are recomputed from staging by src/quality (ADR-0018).
-- This migration only keeps what cannot be derived — explicit human acts, append-only:
--   1. owner_decision_answer : "the owner answered D-xxx with …" (never inferred by the app);
--   2. category_mapping      : source category → Product Engine category, with who/why/impact;
--   3. quality_mark          : a reviewer marked a possible-duplicate pair DISTINCT or REVIEWED;
--   4. review_bulk_operation.decision_answer_id : a DECISION_GROUP bulk operation names the answer behind it.
-- 0001–0015 are untouched.

-- ---------------------------------------------------------------- 1 · owner decision answers

create table owner_decision_answer (
  id            uuid primary key default gen_random_uuid(),
  decision_id   text not null check (decision_id ~ '^D-[0-9]{3}$'),
  -- Free-form but object-shaped; `summary` is the human statement of the answer.
  answer        jsonb not null check (jsonb_typeof(answer) = 'object'),
  summary       text not null check (btrim(summary) <> ''),
  notes         text,
  actor         text not null check (btrim(actor) <> ''),
  answered_at   timestamptz not null default clock_timestamp(),
  -- A later answer revises an earlier one; the earlier row is kept (history).
  supersedes_id uuid unique references owner_decision_answer (id)
);
create index owner_decision_answer_decision on owner_decision_answer (decision_id, answered_at);

create trigger owner_decision_answer_no_delete before delete on owner_decision_answer
  for each row execute function import_forbid_delete();
create trigger owner_decision_answer_immutable before update on owner_decision_answer
  for each row execute function import_forbid_update();
create trigger owner_decision_answer_audit after insert on owner_decision_answer
  for each row execute function record_change('IMPORT');

comment on table owner_decision_answer is
  'Explicit owner answers to STEP 05C decisions (STEP 08). Written only by a person through a controlled action; an unanswered decision has no row.';

-- ---------------------------------------------------------------- 2 · category mapping

create table category_mapping (
  id                uuid primary key default gen_random_uuid(),
  source_category   text not null check (btrim(source_category) <> ''),
  category_key      text not null references category (key),
  candidates        integer not null check (candidates >= 0),
  reason            text,
  actor             text not null check (btrim(actor) <> ''),
  decided_at        timestamptz not null default clock_timestamp(),
  bulk_operation_id uuid references review_bulk_operation (id),
  supersedes_id     uuid unique references category_mapping (id)
);
create index category_mapping_source on category_mapping (source_category, decided_at);

create trigger category_mapping_no_delete before delete on category_mapping
  for each row execute function import_forbid_delete();
create trigger category_mapping_immutable before update on category_mapping
  for each row execute function import_forbid_update();
create trigger category_mapping_audit after insert on category_mapping
  for each row execute function record_change('IMPORT');

comment on table category_mapping is
  'A reviewed decision "source category X → Product Engine category Y" (STEP 08). Never inferred from names; applying it goes through the bulk planner.';

-- ---------------------------------------------------------------- 3 · quality marks

create table quality_mark (
  id            uuid primary key default gen_random_uuid(),
  subject_type  text not null check (subject_type in ('DUPLICATE_PAIR')),
  -- Stable across re-staging: the two LEGACY ids, sorted and joined with '|'.
  subject_key   text not null check (btrim(subject_key) <> ''),
  mark          text not null check (mark in ('DISTINCT', 'REVIEWED')),
  reason        text,
  actor         text not null check (btrim(actor) <> ''),
  marked_at     timestamptz not null default clock_timestamp(),
  supersedes_id uuid unique references quality_mark (id)
);
create index quality_mark_subject on quality_mark (subject_type, subject_key, marked_at);

create trigger quality_mark_no_delete before delete on quality_mark
  for each row execute function import_forbid_delete();
create trigger quality_mark_immutable before update on quality_mark
  for each row execute function import_forbid_update();
create trigger quality_mark_audit after insert on quality_mark
  for each row execute function record_change('IMPORT');

comment on table quality_mark is
  'Reviewer marks on possible duplicates (STEP 08). There is no merge: DISTINCT / REVIEWED only silence or downgrade a finding.';

-- ---------------------------------------------------------------- 4 · bulk operations name their decision

alter table review_bulk_operation
  add column decision_answer_id uuid references owner_decision_answer (id);

-- Enforced for new rows; operations recorded before STEP 08 had no answer to point to.
alter table review_bulk_operation
  add constraint review_bulk_decision_answer
  check (origin <> 'DECISION_GROUP' or decision_answer_id is not null) not valid;
