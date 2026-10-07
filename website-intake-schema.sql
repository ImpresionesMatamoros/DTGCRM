create table if not exists public.dtg_website_gateway (
 id boolean primary key default true check(id), token_hash text not null,
 actor_id uuid not null references public.profiles(id)
);
alter table public.dtg_website_gateway enable row level security;
revoke all on public.dtg_website_gateway from anon,authenticated;
grant all on public.dtg_website_gateway to service_role;
create table if not exists public.dtg_website_requests (
 reference text primary key, payload_hash text not null, name text not null, email text not null,
 phone text not null default '', product text not null default '', project text not null,
 language text not null check(language in ('en','es')), files jsonb not null default '[]',
 status text not null default 'received' check(status in ('received','working','finished')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.dtg_website_requests enable row level security;
grant select,update on public.dtg_website_requests to authenticated;
grant all on public.dtg_website_requests to service_role;
create policy website_requests_staff_read on public.dtg_website_requests for select to authenticated using(public.is_active_member());
create policy website_requests_staff_update on public.dtg_website_requests for update to authenticated using(public.is_admin()) with check(public.is_admin());
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('dtg-website-files','dtg-website-files',false,20971520,array['application/pdf','image/png','image/jpeg','image/webp'])
on conflict(id) do nothing;
create policy website_files_staff_read on storage.objects for select to authenticated using(bucket_id='dtg-website-files' and public.is_active_member());
