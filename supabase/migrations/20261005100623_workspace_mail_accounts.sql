-- Multiple real Gmail accounts; each send-as belongs to exactly one verified account.
alter table public.dtg_google_connections drop constraint dtg_google_connections_singleton_key;
alter table public.dtg_google_connections drop constraint dtg_google_connections_singleton_check;
create unique index dtg_primary_google_connection on public.dtg_google_connections(singleton) where singleton;
create unique index dtg_google_account_email on public.dtg_google_connections(account_email);
alter table public.dtg_email_inboxes add column connection_id uuid references public.dtg_google_connections(id);
update public.dtg_email_inboxes set connection_id=(select id from public.dtg_google_connections where singleton) where verification_status='accepted';
create index dtg_inbox_connection on public.dtg_email_inboxes(connection_id);
-- Queued sends snapshot their connection. Alias reassignment cannot redirect a queued send.
create function public.dtg_claim_specific_job(p_id uuid) returns setof public.dtg_integration_jobs
language plpgsql security invoker set search_path='' as $$
declare picked uuid; begin
 select j.id into picked from public.dtg_integration_jobs j where j.id=p_id
 and ((j.state in ('queued','retry') and j.next_attempt_at<=now()) or (j.state='running' and j.lease_until<now()))
 and not exists(select 1 from public.dtg_integration_jobs o where o.id<>j.id and o.scope_key=j.scope_key and o.state='running' and o.lease_until>now()) for update skip locked;
 if picked is null then return; end if;
 if not pg_try_advisory_xact_lock(hashtextextended((select scope_key from public.dtg_integration_jobs where id=picked),0)) then return; end if;
 if exists(select 1 from public.dtg_integration_jobs o where o.id<>picked and o.scope_key=(select scope_key from public.dtg_integration_jobs where id=picked) and o.state='running' and o.lease_until>now()) then return; end if;
 return query update public.dtg_integration_jobs set state='running',attempt=attempt+1,lease_token=gen_random_uuid(),lease_until=now()+interval '4 minutes' where id=picked returning *;
end $$;
revoke all on function public.dtg_claim_specific_job(uuid) from public,anon,authenticated;
grant execute on function public.dtg_claim_specific_job(uuid) to service_role;
-- Vault fallback when Edge environment secrets have not been configured. Service-only invoker.
create function public.dtg_workspace_secrets() returns jsonb language sql security invoker set search_path='' as $$
 select coalesce(jsonb_object_agg(upper(substr(name,15)),decrypted_secret),'{}'::jsonb)
 from vault.decrypted_secrets where name in ('dtg_workspace_SUPABASE_URL','dtg_workspace_GOOGLE_CLIENT_ID','dtg_workspace_GOOGLE_CLIENT_SECRET','dtg_workspace_GOOGLE_REDIRECT_URI','dtg_workspace_INTEGRATION_ENCRYPTION_KEY','dtg_workspace_INTEGRATION_WORKER_SECRET');
$$;
create function public.dtg_workspace_configure_secrets(p_config jsonb) returns void language plpgsql security invoker set search_path='' as $$
declare k text; v text; sid uuid; begin
 if jsonb_typeof(p_config)<>'object' or octet_length(p_config::text)>12000 then raise exception 'Invalid config'; end if;
 perform pg_advisory_xact_lock(hashtextextended('dtg-workspace-configuration',0));
 for k,v in select * from jsonb_each_text(p_config) loop
  if k not in ('SUPABASE_URL','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GOOGLE_REDIRECT_URI','INTEGRATION_ENCRYPTION_KEY','INTEGRATION_WORKER_SECRET') or length(v) not between 1 and 3000 then raise exception 'Invalid config'; end if;
  select id into sid from vault.secrets where name='dtg_workspace_'||k;
  if sid is null then perform vault.create_secret(v,'dtg_workspace_'||k);
  elsif k in ('GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GOOGLE_REDIRECT_URI') then perform vault.update_secret(sid,v);
  end if;
 end loop;
end $$;
revoke all on function public.dtg_workspace_secrets(),public.dtg_workspace_configure_secrets(jsonb) from public,anon,authenticated;
grant execute on function public.dtg_workspace_secrets(),public.dtg_workspace_configure_secrets(jsonb) to service_role;

alter table public.dtg_email_messages add column label_ids text[] not null default '{}';
alter table public.dtg_email_messages add column snippet text not null default '';

create table public.dtg_mail_drafts (
 id uuid primary key, actor_id uuid not null references public.profiles(id),subject text not null default '' check(length(subject)<=300),encrypted_payload text not null,updated_at timestamptz not null default now()
);
alter table public.dtg_mail_drafts enable row level security;
revoke all on public.dtg_mail_drafts from public,anon,authenticated;
grant all on public.dtg_mail_drafts to service_role;
create index dtg_mail_drafts_actor on public.dtg_mail_drafts(actor_id,updated_at desc);

-- Addresses explicitly created by owner; actual sender ownership is still verified via Gmail.
insert into public.dtg_email_inboxes(email_alias,display_name,logical_inbox,purpose,default_from_name)
select x||'@956print.com',x,x,'general','956 Print' from unnest(array['hello','sales','quotes','orders','artwork','jona','tania','ceci','israel','alex','billing','support','help','ventas','facturas','ayuda','arte'])x on conflict(email_alias) do nothing;
