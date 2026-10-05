-- Additive, NOT applied by this change. Existing ticket/chat/photo storage untouched.
create table public.dtg_integration_config (
 id boolean primary key default true check(id), enabled boolean not null default false,
 threshold_bytes bigint not null default 26214400 check(threshold_bytes between 1 and 52428800),
 max_file_bytes bigint not null default 2147483648 check(max_file_bytes between 1 and 2147483648),
 drive_extensions text[] not null default array['ai','psd','tif','tiff','eps','raw'],
 drive_mime_types text[] not null default array['image/tiff','image/vnd.adobe.photoshop','application/postscript'],
 drive_purposes text[] not null default array['production_source','print_ready','gang_sheet'],
 domain text not null default '956print.com', sync_query text not null default 'newer_than:90d'
);
insert into public.dtg_integration_config(id) values(true);
create table public.dtg_google_connections (
 id uuid primary key default gen_random_uuid(), singleton boolean not null default true unique check(singleton),
 account_email text, state text not null default 'disconnected' check(state in ('disconnected','connected','reauth_required','error')),
 scopes text[] not null default '{}', last_sync_at timestamptz, last_error text, connected_by uuid references public.profiles(id),
 created_at timestamptz not null default now()
);
create table public.dtg_integration_private (
 key text primary key, encrypted_value text not null, expires_at timestamptz,
 updated_at timestamptz not null default now()
);
create table public.dtg_email_inboxes (
 id uuid primary key default gen_random_uuid(), email_alias text not null unique,
 display_name text not null, logical_inbox text not null, purpose text not null,
 default_from_name text not null, default_signature text not null default '', active boolean not null default true,
 verification_status text not null default 'unverified' check(verification_status in ('unverified','accepted','pending','missing'))
);
insert into public.dtg_email_inboxes(email_alias,display_name,logical_inbox,purpose,default_from_name)
select x||'@956print.com',initcap(x)||' Inbox',x,x,'956 Print' from unnest(array['info','sales','orders','billing','design','vendors']) x;
create table public.dtg_email_inbox_access (
 inbox_id uuid references public.dtg_email_inboxes(id), user_id uuid references public.profiles(id),
 can_read boolean not null default true, can_send boolean not null default false,
 primary key(inbox_id,user_id)
);
create table public.dtg_email_messages (
 id uuid primary key default gen_random_uuid(), connection_id uuid not null references public.dtg_google_connections(id),
 external_message_id text not null, thread_id text not null, rfc_message_id text,
 from_address text not null, to_addresses text[] not null default '{}', cc_addresses text[] not null default '{}', subject text not null default '',
 received_at timestamptz, sent_at timestamptz, occurred_at timestamptz generated always as(coalesce(sent_at,received_at)) stored,
 direction text not null check(direction in ('inbound','outbound')),
 has_attachments boolean not null default false, sync_status text not null default 'synced' check(sync_status in ('synced','missing_external','error')),
 unique(connection_id,external_message_id)
);
create table public.dtg_email_message_inboxes (
 message_id uuid references public.dtg_email_messages(id), inbox_id uuid references public.dtg_email_inboxes(id),
 delivered_alias text not null, evidence text[] not null, primary key(message_id,inbox_id)
);
create table public.dtg_email_links (
 id uuid primary key default gen_random_uuid(), message_id uuid not null references public.dtg_email_messages(id),
 ticket_id uuid references public.tickets(id), customer_id uuid references public.clientes(id),
 linked_by uuid not null references public.profiles(id), linked_at timestamptz not null default now(),
 check(ticket_id is not null or customer_id is not null)
);
create unique index dtg_email_ticket_link_unique on public.dtg_email_links(message_id,ticket_id);
create unique index dtg_email_customer_link_unique on public.dtg_email_links(message_id,customer_id) where ticket_id is null;
create table public.dtg_assets (
 id uuid primary key default gen_random_uuid(), customer_id uuid references public.clientes(id),
 origin_ticket_id uuid not null references public.tickets(id), name text not null, purpose text not null,
 current_file_id uuid, created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(), active boolean not null default true
);
create table public.dtg_files (
 id uuid primary key default gen_random_uuid(), asset_id uuid not null references public.dtg_assets(id),
 filename text not null, original_filename text not null, mime_type text not null, size_bytes bigint not null check(size_bytes>0),
 storage_provider text not null check(storage_provider in ('SUPABASE','GOOGLE_DRIVE')),
 storage_key text, drive_file_id text, checksum text, thumbnail_path text,
 preview_state text not null default 'pending' check(preview_state in ('pending','ready','unsupported','failed')),
 availability text not null default 'uploading' check(availability in ('uploading','available','failed','missing_external')),
 stage text not null default 'Draft' check(stage in ('Draft','Proof','Approved','Print Ready','Archived')),
 version integer not null check(version>0), uploaded_by uuid not null references public.profiles(id), uploaded_at timestamptz not null default now(),
 unique(asset_id,version), unique(id,asset_id),
 check((storage_provider='SUPABASE' and storage_key is not null and drive_file_id is null) or
 (storage_provider='GOOGLE_DRIVE' and storage_key is null and drive_file_id is not null))
);
alter table public.dtg_assets add constraint dtg_current_file_same_asset foreign key(current_file_id,id) references public.dtg_files(id,asset_id);
create unique index dtg_drive_file_unique on public.dtg_files(drive_file_id) where drive_file_id is not null;
create unique index dtg_storage_key_unique on public.dtg_files(storage_key) where storage_key is not null;
create table public.dtg_asset_usages (
 id uuid primary key default gen_random_uuid(), file_id uuid not null references public.dtg_files(id),
 ticket_id uuid not null references public.tickets(id), product_id uuid references public.productos(id),
 production_approved boolean not null default false, approved_file_id uuid references public.dtg_files(id),
 approved_by uuid references public.profiles(id), approved_at timestamptz,
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(),
 unique(file_id,ticket_id), check(not production_approved or (approved_file_id=file_id and approved_by is not null and approved_at is not null))
);
create table public.dtg_upload_sessions (
 id uuid primary key default gen_random_uuid(), file_id uuid not null unique references public.dtg_files(id),
 actor_id uuid not null references public.profiles(id), idempotency_key uuid not null,
 confirmed_offset bigint not null default 0 check(confirmed_offset>=0), state text not null default 'pending' check(state in ('pending','uploading','complete','failed')),
 lease_token uuid, lease_until timestamptz, last_error text, policy_snapshot jsonb not null,
 expires_at timestamptz not null default now()+interval '6 days', created_at timestamptz not null default now(), unique(actor_id,idempotency_key)
);
create table public.dtg_vendors (
 id uuid primary key default gen_random_uuid(), name text not null, email text not null,
 production_type text not null, preferred_delivery_method text not null default 'drive_email' check(preferred_delivery_method='drive_email'),
 default_access_hours integer not null default 168 check(default_access_hours between 1 and 8760),
 ops_provider_key text unique, active boolean not null default true, created_at timestamptz not null default now()
);
create table public.dtg_vendor_grants (
 id uuid primary key default gen_random_uuid(), file_id uuid not null references public.dtg_files(id),
 drive_file_id text not null, recipient_email text not null, permission_id text,
 state text not null default 'pending' check(state in ('pending','granted','revoke_pending','revoked','expired','error')),
 managed boolean not null default true, expires_at timestamptz not null, confirmed_at timestamptz,
 unique(file_id,recipient_email)
);
create table public.dtg_vendor_deliveries (
 id uuid primary key default gen_random_uuid(), ticket_id uuid not null references public.tickets(id),
 file_id uuid not null references public.dtg_files(id), vendor_id uuid not null references public.dtg_vendors(id), grant_id uuid references public.dtg_vendor_grants(id),
 inbox_id uuid not null references public.dtg_email_inboxes(id), recipient_email text not null,
 actor_id uuid not null references public.profiles(id), override_reason text,
 access_expires_at timestamptz not null, revoked_at timestamptz, email_state text not null default 'queued' check(email_state in ('queued','sending','sent','failed','unknown')),
 external_message_id text, last_error text, created_at timestamptz not null default now()
);
create table public.dtg_integration_jobs (
 id uuid primary key default gen_random_uuid(), actor_id uuid references public.profiles(id), ticket_id uuid references public.tickets(id), inbox_id uuid references public.dtg_email_inboxes(id),
 kind text not null check(kind in ('send_email','sync_email','preview','vendor_delivery','revoke_grant')),
 scope_key text not null, idempotency_key uuid not null unique, payload jsonb not null,
 state text not null default 'queued' check(state in ('queued','running','retry','done','failed','unknown')),
 attempt integer not null default 0, failure_count integer not null default 0, request_fingerprint text not null default '',
 next_attempt_at timestamptz not null default now(), lease_token uuid, lease_until timestamptz,
 last_error text, created_at timestamptz not null default now(), completed_at timestamptz
);
create table public.dtg_integration_events (
 id bigint generated always as identity primary key, operation_id uuid, actor_id uuid references public.profiles(id),
 ticket_id uuid references public.tickets(id), inbox_id uuid references public.dtg_email_inboxes(id),
 kind text not null, details jsonb not null default '{}', created_at timestamptz not null default now()
);
create index dtg_usage_ticket_idx on public.dtg_asset_usages(ticket_id,created_at desc);
create index dtg_usage_file_idx on public.dtg_asset_usages(file_id);
create index dtg_files_asset_idx on public.dtg_files(asset_id);
create index dtg_asset_customer_idx on public.dtg_assets(customer_id);
create index dtg_email_thread_idx on public.dtg_email_messages(connection_id,thread_id);
create index dtg_email_date_idx on public.dtg_email_messages(received_at desc);
create index dtg_email_links_ticket_idx on public.dtg_email_links(ticket_id);
create index dtg_job_claim_idx on public.dtg_integration_jobs(state,next_attempt_at);
create index dtg_grant_expiry_idx on public.dtg_vendor_grants(expires_at) where state in ('granted','revoke_pending');

-- Every new exposed table has RLS; all writes go through authenticated backend commands.
do $$ declare t text; begin
 foreach t in array array['dtg_integration_config','dtg_google_connections','dtg_integration_private','dtg_email_inboxes','dtg_email_inbox_access',
 'dtg_email_messages','dtg_email_message_inboxes','dtg_email_links','dtg_assets','dtg_files','dtg_asset_usages','dtg_upload_sessions',
 'dtg_vendors','dtg_vendor_grants','dtg_vendor_deliveries','dtg_integration_jobs','dtg_integration_events'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
grant usage,select on sequence public.dtg_integration_events_id_seq to service_role;
grant select on public.dtg_integration_config,public.dtg_google_connections,public.dtg_email_inboxes,public.dtg_email_inbox_access,
 public.dtg_email_messages,public.dtg_email_message_inboxes,public.dtg_email_links,public.dtg_assets,public.dtg_files,
 public.dtg_asset_usages,public.dtg_upload_sessions,public.dtg_vendors,public.dtg_vendor_grants,public.dtg_vendor_deliveries,public.dtg_integration_events to authenticated;

create policy dtg_config_read on public.dtg_integration_config for select to authenticated using(public.is_active_member());
create policy dtg_connection_read on public.dtg_google_connections for select to authenticated using(public.is_active_member() and public.is_admin());
create policy dtg_access_read on public.dtg_email_inbox_access for select to authenticated using(public.is_active_member() and (user_id=auth.uid() or public.is_admin()));
create policy dtg_inbox_read on public.dtg_email_inboxes for select to authenticated using(public.is_active_member() and (public.is_admin() or exists(select 1 from public.dtg_email_inbox_access a where a.inbox_id=id and a.user_id=auth.uid() and a.can_read)));
create policy dtg_message_inboxes_read on public.dtg_email_message_inboxes for select to authenticated using(public.is_active_member() and (public.is_admin() or exists(select 1 from public.dtg_email_inbox_access a where a.inbox_id=dtg_email_message_inboxes.inbox_id and a.user_id=auth.uid() and a.can_read)));
create policy dtg_email_read on public.dtg_email_messages for select to authenticated using(public.is_active_member() and (public.is_admin() or exists(select 1 from public.dtg_email_message_inboxes i where i.message_id=id)));
create policy dtg_links_read on public.dtg_email_links for select to authenticated using(public.is_active_member() and exists(select 1 from public.dtg_email_messages m where m.id=message_id) and (ticket_id is null or public.ticket_is_visible_to_me(ticket_id)));
create policy dtg_usage_read on public.dtg_asset_usages for select to authenticated using(public.is_active_member() and public.ticket_is_visible_to_me(ticket_id));
create policy dtg_asset_read on public.dtg_assets for select to authenticated using(public.is_active_member() and public.ticket_is_visible_to_me(origin_ticket_id));
-- Reuse does not implicitly broaden original-file visibility: both origin and destination are required.
create policy dtg_file_read on public.dtg_files for select to authenticated using(exists(select 1 from public.dtg_assets a where a.id=asset_id));
create policy dtg_upload_read on public.dtg_upload_sessions for select to authenticated using(actor_id=auth.uid() and exists(select 1 from public.dtg_files f where f.id=file_id));
create policy dtg_vendor_read on public.dtg_vendors for select to authenticated using(public.is_active_member());
create policy dtg_delivery_read on public.dtg_vendor_deliveries for select to authenticated using(public.is_active_member() and public.ticket_is_visible_to_me(ticket_id));
create policy dtg_grant_read on public.dtg_vendor_grants for select to authenticated using(exists(select 1 from public.dtg_files f where f.id=file_id));
create policy dtg_event_read on public.dtg_integration_events for select to authenticated using(public.is_active_member() and
 ((ticket_id is not null and public.ticket_is_visible_to_me(ticket_id)) or
 (ticket_id is null and (public.is_admin() or (inbox_id is not null and exists(select 1 from public.dtg_email_inbox_access a where a.inbox_id=dtg_integration_events.inbox_id and a.user_id=auth.uid() and a.can_read))))));
-- Jobs and encrypted private state intentionally have no authenticated policies/grants.

insert into storage.buckets(id,name,public,file_size_limit) values
 ('dtg-originals','dtg-originals',false,52428800),('dtg-previews','dtg-previews',false,1048576)
 on conflict(id) do nothing;
create policy dtg_original_read on storage.objects for select to authenticated using(bucket_id='dtg-originals' and exists(select 1 from public.dtg_files f where f.storage_key=name and f.availability='available'));
create policy dtg_preview_read on storage.objects for select to authenticated using(bucket_id='dtg-previews' and exists(select 1 from public.dtg_files f where f.thumbnail_path=name));
-- Client never uploads/overwrites originals or previews without backend ownership validation.

create function public.dtg_claim_job() returns setof public.dtg_integration_jobs
language plpgsql security invoker set search_path='' as $$
declare picked uuid; token uuid:=gen_random_uuid(); begin
 -- Expired send leases must reconcile their persisted sending marker before any send.
 select j.id into picked from public.dtg_integration_jobs j
 where ((j.state in ('queued','retry') and j.next_attempt_at<=now()) or (j.state='running' and j.lease_until<now()))
 and not exists(select 1 from public.dtg_integration_jobs other where other.id<>j.id and other.scope_key=j.scope_key and other.state='running' and other.lease_until>now())
 order by j.next_attempt_at,j.created_at for update skip locked limit 1;
 if picked is null then return; end if;
 -- Scope serialization across simultaneous claim calls.
 if not pg_try_advisory_xact_lock(hashtextextended((select scope_key from public.dtg_integration_jobs where id=picked),0)) then return; end if;
 if exists(select 1 from public.dtg_integration_jobs other where other.id<>picked and other.scope_key=(select scope_key from public.dtg_integration_jobs where id=picked) and other.state='running' and other.lease_until>now()) then return; end if;
 return query update public.dtg_integration_jobs set state='running',attempt=attempt+1,lease_token=token,lease_until=now()+interval '4 minutes'
 where id=picked returning *;
end $$;
revoke all on function public.dtg_claim_job() from public,anon,authenticated;
grant execute on function public.dtg_claim_job() to service_role;

create function public.dtg_claim_upload(p_id uuid,p_actor uuid) returns setof public.dtg_upload_sessions
language sql security invoker set search_path='' as $$
 update public.dtg_upload_sessions set lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes'
 where id=p_id and actor_id=p_actor and expires_at>now() and (lease_until is null or lease_until<now()) returning *;
$$;
revoke all on function public.dtg_claim_upload(uuid,uuid) from public,anon,authenticated;
grant execute on function public.dtg_claim_upload(uuid,uuid) to service_role;

-- Atomic creation avoids orphan metadata and makes browser retry safe.
create function public.dtg_register_upload(p_actor uuid,p_key uuid,p_ticket uuid,p_asset uuid,p_file uuid,p_meta jsonb,p_policy jsonb)
returns public.dtg_upload_sessions language plpgsql security invoker set search_path='' as $$
declare aid uuid; v integer; cid uuid; outrow public.dtg_upload_sessions; begin
 perform pg_advisory_xact_lock(hashtextextended(p_actor::text||p_key::text,0));
 select * into outrow from public.dtg_upload_sessions where actor_id=p_actor and idempotency_key=p_key;
 if found then return outrow; end if;
 select cliente_id into cid from public.tickets where id=p_ticket; if not found then raise exception 'Ticket missing'; end if;
 if p_asset is null then
 insert into public.dtg_assets(customer_id,origin_ticket_id,name,purpose,created_by) values(cid,p_ticket,p_meta->>'filename',p_meta->>'purpose',p_actor) returning id into aid;
 else
 select id into aid from public.dtg_assets where id=p_asset for update;
 if aid is null then raise exception 'Asset missing'; end if;
 end if;
 select coalesce(max(version),0)+1 into v from public.dtg_files where asset_id=aid;
 insert into public.dtg_files(id,asset_id,filename,original_filename,mime_type,size_bytes,storage_provider,storage_key,drive_file_id,version,uploaded_by)
 values(p_file,aid,p_meta->>'filename',p_meta->>'filename',p_meta->>'mime_type',(p_meta->>'size_bytes')::bigint,p_meta->>'storage_provider',p_meta->>'storage_key',p_meta->>'drive_file_id',v,p_actor);
 insert into public.dtg_asset_usages(file_id,ticket_id,created_by) values(p_file,p_ticket,p_actor);
 insert into public.dtg_upload_sessions(file_id,actor_id,idempotency_key,policy_snapshot) values(p_file,p_actor,p_key,p_policy) returning * into outrow;
 return outrow;
end $$;
revoke all on function public.dtg_register_upload(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.dtg_register_upload(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb) to service_role;

-- Resolve the canonical customer without rewriting emitted document/email snapshots.
create function public.dtg_canonical_customer(p_id uuid) returns uuid language plpgsql stable security invoker set search_path='' as $$
declare result uuid:=p_id; nxt uuid; n integer:=0; begin
 while result is not null loop
 select merged_into into nxt from public.clientes where id=result;
 if not found then return null; end if;
 if nxt is null then return result; end if;
 n:=n+1; if n>50 then raise exception 'Customer merge cycle'; end if; result:=nxt;
 end loop; return null;
end $$;
revoke all on function public.dtg_canonical_customer(uuid) from public,anon,authenticated;
grant execute on function public.dtg_canonical_customer(uuid) to service_role;

create function public.dtg_consume_oauth_state(p_key text) returns text language plpgsql security invoker set search_path='' as $$
declare result text; begin
 delete from public.dtg_integration_private where key=p_key and key like 'oauth:%' and expires_at>now() returning encrypted_value into result;
 return result;
end $$;
revoke all on function public.dtg_consume_oauth_state(text) from public,anon,authenticated;
grant execute on function public.dtg_consume_oauth_state(text) to service_role;

create function public.dtg_finalize_upload(p_id uuid,p_checksum text) returns void language plpgsql security invoker set search_path='' as $$
declare f public.dtg_files; s public.dtg_upload_sessions; begin
 select * into s from public.dtg_upload_sessions where id=p_id for update;
 if not found then raise exception 'Upload missing'; end if;
 select * into f from public.dtg_files where id=s.file_id;
 update public.dtg_files set availability='available',checksum=p_checksum where id=f.id;
 -- Never change an existing current version automatically.
 update public.dtg_assets set current_file_id=f.id where id=f.asset_id and current_file_id is null;
 update public.dtg_upload_sessions set state='complete',confirmed_offset=f.size_bytes,last_error=null where id=p_id;
end $$;
revoke all on function public.dtg_finalize_upload(uuid,text) from public,anon,authenticated;
grant execute on function public.dtg_finalize_upload(uuid,text) to service_role;

-- Service-only permission check for asynchronous work. Reuses existing business
-- access functions under the original actor's claims, restores claims on exit.
-- No definer privilege escalation and no grants to client roles.
create function public.dtg_actor_context(p_actor uuid,p_ticket uuid default null,p_inbox uuid default null,p_send boolean default false)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare prev text; prevsub text; active boolean; adm boolean; visible boolean; box boolean; begin
 prev:=current_setting('request.jwt.claims',true); prevsub:=current_setting('request.jwt.claim.sub',true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_actor,'role','authenticated')::text,true);
 perform set_config('request.jwt.claim.sub',p_actor::text,true);
 active:=coalesce(public.is_active_member(),false); adm:=coalesce(public.is_admin(),false);
 visible:=p_ticket is null or coalesce(public.ticket_is_visible_to_me(p_ticket),false);
 box:=p_inbox is null or adm or exists(select 1 from public.dtg_email_inbox_access where inbox_id=p_inbox and user_id=p_actor and can_read and (not p_send or can_send));
 perform set_config('request.jwt.claims',coalesce(prev,''),true); perform set_config('request.jwt.claim.sub',coalesce(prevsub,''),true);
 return jsonb_build_object('active',active,'is_admin',adm,'ticket_visible',visible,'inbox_allowed',box);
end $$;
revoke all on function public.dtg_actor_context(uuid,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.dtg_actor_context(uuid,uuid,uuid,boolean) to service_role;

create view public.dtg_email_inbox_messages with(security_invoker=true) as
select m.*,i.inbox_id,i.delivered_alias from public.dtg_email_messages m join public.dtg_email_message_inboxes i on i.message_id=m.id;
revoke all on public.dtg_email_inbox_messages from public,anon,authenticated;
grant select on public.dtg_email_inbox_messages to authenticated,service_role;

create function public.dtg_change_file_stage(p_id uuid,p_stage text) returns void language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.dtg_files where id=p_id and availability='available' for update;
 if not found then raise exception 'File unavailable'; end if;
 update public.dtg_files set stage=p_stage where id=p_id;
 if p_stage<>'Print Ready' then
 update public.dtg_asset_usages set production_approved=false,approved_file_id=null,approved_by=null,approved_at=null where file_id=p_id;
 end if;
end $$;
revoke all on function public.dtg_change_file_stage(uuid,text) from public,anon,authenticated;
grant execute on function public.dtg_change_file_stage(uuid,text) to service_role;

create function public.dtg_approve_usage(p_file uuid,p_ticket uuid,p_actor uuid) returns void language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.dtg_files where id=p_file and stage='Print Ready' and availability='available' for update;
 if not found then raise exception 'Print Ready required'; end if;
 update public.dtg_asset_usages set production_approved=true,approved_file_id=p_file,approved_by=p_actor,approved_at=now() where file_id=p_file and ticket_id=p_ticket;
 if not found then raise exception 'Usage required'; end if;
end $$;
revoke all on function public.dtg_approve_usage(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.dtg_approve_usage(uuid,uuid,uuid) to service_role;

create function public.dtg_customer_family(p_id uuid) returns uuid[] language sql stable security invoker set search_path='' as $$
 with recursive family(id) as (
 select public.dtg_canonical_customer(p_id)
 union select c.id from public.clientes c join family f on c.merged_into=f.id
 ) select coalesce(array_agg(id) filter(where id is not null),'{}'::uuid[]) from family;
$$;
revoke all on function public.dtg_customer_family(uuid) from public,anon,authenticated;
grant execute on function public.dtg_customer_family(uuid) to service_role;

create function public.dtg_customer_file_history(p_clients uuid[],p_before timestamptz default null,p_limit integer default 50)
returns setof public.dtg_files language sql stable security invoker set search_path='' as $$
 select f.* from public.dtg_files f join public.dtg_assets a on a.id=f.asset_id
 where public.is_active_member() and a.customer_id=any(p_clients) and (p_before is null or f.uploaded_at<p_before)
 order by f.uploaded_at desc,f.id desc limit greatest(1,least(p_limit,100));
$$;
revoke all on function public.dtg_customer_file_history(uuid[],timestamptz,integer) from public,anon,authenticated;
grant execute on function public.dtg_customer_file_history(uuid[],timestamptz,integer) to authenticated,service_role;
