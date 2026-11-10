alter table public.client_notes
  drop constraint client_notes_kind_check,
  add constraint client_notes_kind_check
    check (kind in ('internal', 'summary', 'contact', 'preference', 'observation', 'lesson', 'followup', 'reference')),
  add column source_label text check (length(source_label) <= 200),
  add column source_url text check (length(source_url) <= 2048 and source_url ~ '^https://[^[:space:]]+$'),
  alter column author_user_id drop not null;

-- Authenticated writes still require author_user_id = auth.uid() through RLS.
