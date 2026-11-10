alter table public.client_notes
  add column kind text not null default 'internal'
  check (kind in ('internal', 'summary', 'contact', 'preference', 'observation', 'lesson', 'followup'));
