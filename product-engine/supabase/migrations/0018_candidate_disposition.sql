-- 0018 · Candidate disposition (STEP 09 completion · owner decisions).
-- Some source rows are NOT products: a generic alias, a configuration or style of a canonical product, or a
-- legacy label that was never valid. Rejecting the candidate keeps the evidence but loses WHY and WHERE TO:
-- this append-only table records, per source item, what it is, which canonical item(s) it points to, and the
-- owner decision (and its recorded answer) behind that. No merge, no MDM: it only explains rows that do not
-- become CatalogItems. 0001–0017 are untouched.

create table candidate_disposition (
  id                  uuid primary key default gen_random_uuid(),
  item_legacy_id      text not null check (btrim(item_legacy_id) <> ''),
  disposition         text not null check (disposition in ('ALIAS', 'CONFIGURATION', 'STYLE', 'LEGACY_INVALID')),
  -- Canonical source items this row belongs to (legacy ids). Empty only for a never-valid legacy label.
  canonical_legacy_ids text[] not null default '{}',
  -- What it is, in the owner's words (e.g. "configuración de Invitación Premium").
  detail              text not null check (btrim(detail) <> ''),
  decision_id         text not null check (decision_id ~ '^D-[0-9]{3}$'),
  decision_answer_id  uuid not null references owner_decision_answer (id),
  reason              text not null check (btrim(reason) <> ''),
  actor               text not null check (btrim(actor) <> ''),
  decided_at          timestamptz not null default clock_timestamp(),
  supersedes_id       uuid unique references candidate_disposition (id),
  check ((disposition = 'LEGACY_INVALID') = (cardinality(canonical_legacy_ids) = 0))
);
create index candidate_disposition_item on candidate_disposition (item_legacy_id, decided_at);

create trigger candidate_disposition_no_delete before delete on candidate_disposition
  for each row execute function import_forbid_delete();
create trigger candidate_disposition_immutable before update on candidate_disposition
  for each row execute function import_forbid_update();
create trigger candidate_disposition_audit after insert on candidate_disposition
  for each row execute function record_change('IMPORT');

comment on table candidate_disposition is
  'Why a source item is not a CatalogItem: alias / configuration / style of a canonical item, or a never-valid legacy label (STEP 09 completion). Evidence stays in staging; this only records the owner-backed disposition.';
