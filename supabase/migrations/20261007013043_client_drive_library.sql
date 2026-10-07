-- Client libraries extend the existing File Engine; no second file registry.
alter table public.dtg_assets alter column origin_ticket_id drop not null;
alter table public.dtg_assets add constraint dtg_asset_has_scope check(origin_ticket_id is not null or customer_id is not null);
alter table public.dtg_files add column category text not null default 'otros' check(category in ('logos','corel','pdf','fotos','recursos','otros'));
alter table public.dtg_files add column source_sha256 text check(source_sha256 is null or source_sha256 ~ '^[a-f0-9]{64}$');
alter table public.dtg_files add column drive_parent_id text;
alter table public.dtg_integration_config add column library_enabled boolean not null default false;

create table public.dtg_library_identities (
 actor_id uuid primary key references public.profiles(id), google_sub text not null unique,
 google_email text not null unique, verified_at timestamptz not null default now()
);
create table public.dtg_library_folders (
 scope_key text primary key, drive_id text not null unique, parent_id text,
 connection_id uuid not null references public.dtg_google_connections(id), created_at timestamptz not null default now()
);
create table public.dtg_library_grants (
 file_id uuid not null references public.dtg_files(id), actor_id uuid not null references public.profiles(id),
 google_email text not null, permission_id text not null, expires_at timestamptz not null,
 primary key(file_id,actor_id)
);
create table public.dtg_image_derivatives (
 source_id uuid not null references storage.objects(id) on delete cascade,
 source_bucket text not null, source_path text not null, source_updated_at timestamptz not null,
 variant text not null check(variant in ('avatar','card')), path text not null unique,
 size_bytes integer not null check(size_bytes between 1 and 131072), created_at timestamptz not null default now(),
 primary key(source_id,variant)
);
do $$ declare t text; begin
 foreach t in array array['dtg_library_identities','dtg_library_folders','dtg_library_grants','dtg_image_derivatives'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
grant select on public.dtg_library_identities to authenticated;
create policy dtg_identity_self on public.dtg_library_identities for select to authenticated using(public.is_active_member() and actor_id=auth.uid());
drop policy dtg_asset_read on public.dtg_assets;
create policy dtg_asset_read on public.dtg_assets for select to authenticated using(public.is_active_member() and
 ((origin_ticket_id is not null and public.ticket_is_visible_to_me(origin_ticket_id)) or
 (origin_ticket_id is null and exists(select 1 from public.clientes c where c.id=customer_id))));
insert into storage.buckets(id,name,public,file_size_limit) values('dtg-thumbnails','dtg-thumbnails',false,131072) on conflict(id) do nothing;
-- No direct client policies: API verifies access against the original bucket's RLS.

create function public.dtg_library_folder(p_scope text,p_drive text,p_parent text,p_connection uuid)
returns public.dtg_library_folders language plpgsql security invoker set search_path='' as $$
declare r public.dtg_library_folders; begin
 insert into public.dtg_library_folders(scope_key,drive_id,parent_id,connection_id) values(p_scope,p_drive,p_parent,p_connection) on conflict(scope_key) do nothing;
 select * into r from public.dtg_library_folders where scope_key=p_scope;
 if r.connection_id<>p_connection or r.parent_id is distinct from p_parent then raise exception 'Folder connection mismatch'; end if;
 return r;
end $$;
revoke all on function public.dtg_library_folder(text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.dtg_library_folder(text,text,text,uuid) to service_role;

create function public.dtg_library_register_upload(p_actor uuid,p_key uuid,p_ticket uuid,p_customer uuid,p_asset uuid,p_file uuid,p_meta jsonb,p_policy jsonb)
returns public.dtg_upload_sessions language plpgsql security invoker set search_path='' as $$
declare aid uuid; cid uuid; v integer; r public.dtg_upload_sessions; begin
 perform pg_advisory_xact_lock(hashtextextended(p_actor::text||p_key::text,0));
 select * into r from public.dtg_upload_sessions where actor_id=p_actor and idempotency_key=p_key;
 if found then return r; end if;
 if p_ticket is not null then
 select cliente_id into cid from public.tickets where id=p_ticket;
 if not found or cid is null then raise exception 'Ticket needs customer'; end if;
 else
 select id into cid from public.clientes where id=p_customer;
 if not found then raise exception 'Customer missing'; end if;
 end if;
 if p_asset is null then
 insert into public.dtg_assets(customer_id,origin_ticket_id,name,purpose,created_by) values(cid,p_ticket,p_meta->>'filename',p_meta->>'purpose',p_actor) returning id into aid;
 else
 select id into aid from public.dtg_assets where id=p_asset for update;
 if aid is null then raise exception 'Asset missing'; end if;
 end if;
 select coalesce(max(version),0)+1 into v from public.dtg_files where asset_id=aid;
 insert into public.dtg_files(id,asset_id,filename,original_filename,mime_type,size_bytes,storage_provider,drive_file_id,drive_parent_id,source_sha256,category,version,uploaded_by)
 values(p_file,aid,p_meta->>'filename',p_meta->>'filename',p_meta->>'mime_type',(p_meta->>'size_bytes')::bigint,'GOOGLE_DRIVE',p_meta->>'drive_file_id',p_meta->>'drive_parent_id',p_meta->>'source_sha256',p_meta->>'category',v,p_actor);
 if p_ticket is not null then insert into public.dtg_asset_usages(file_id,ticket_id,created_by) values(p_file,p_ticket,p_actor); end if;
 insert into public.dtg_upload_sessions(file_id,actor_id,idempotency_key,policy_snapshot) values(p_file,p_actor,p_key,p_policy) returning * into r;
 return r;
end $$;
revoke all on function public.dtg_library_register_upload(uuid,uuid,uuid,uuid,uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.dtg_library_register_upload(uuid,uuid,uuid,uuid,uuid,uuid,jsonb,jsonb) to service_role;

create function public.dtg_library_list(p_customer uuid,p_before timestamptz default null,p_before_id uuid default null,p_search text default '',p_category text default '',p_limit integer default 50,p_ticket uuid default null)
returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(q) order by q.uploaded_at desc,q.id desc),'[]'::jsonb) from (
 select f.*,a.customer_id,a.origin_ticket_id,a.current_file_id,a.purpose,(select to_jsonb(u) from public.dtg_asset_usages u where u.file_id=f.id and u.ticket_id=p_ticket) as usage from public.dtg_files f join public.dtg_assets a on a.id=f.asset_id
 where a.customer_id=p_customer and a.active and (p_before is null or (f.uploaded_at,f.id)<(p_before,coalesce(p_before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
 and (p_category='' or f.category=p_category) and (p_search='' or position(lower(p_search) in lower(f.filename))>0)
 and (p_ticket is null or exists(select 1 from public.dtg_asset_usages u where u.file_id=f.id and u.ticket_id=p_ticket))
 order by f.uploaded_at desc,f.id desc limit least(greatest(p_limit,1),50)) q;
$$;
revoke all on function public.dtg_library_list(uuid,timestamptz,uuid,text,text,integer,uuid) from public,anon;
grant execute on function public.dtg_library_list(uuid,timestamptz,uuid,text,text,integer,uuid) to authenticated,service_role;
create index dtg_library_date_idx on public.dtg_files(uploaded_at desc,id desc);
create index dtg_library_hash_idx on public.dtg_files(source_sha256) where source_sha256 is not null;

create function public.dtg_thumbnail_source(p_bucket text,p_path text) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',id,'updated_at',updated_at,'size',metadata->>'size','mime',metadata->>'mimetype') from storage.objects where bucket_id=p_bucket and name=p_path;
$$;
revoke all on function public.dtg_thumbnail_source(text,text) from public,anon,authenticated;
grant execute on function public.dtg_thumbnail_source(text,text) to service_role;

create function public.dtg_library_grants_to_revoke() returns jsonb
language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) from (
 select g.*,f.drive_file_id from public.dtg_library_grants g join public.dtg_files f on f.id=g.file_id join public.dtg_assets a on a.id=f.asset_id
 cross join lateral (select public.dtg_actor_context(g.actor_id,a.origin_ticket_id) as c) context
 where g.expires_at<=now() or not coalesce((context.c->>'active')::boolean,false) or not coalesce((context.c->>'ticket_visible')::boolean,false)
 order by g.expires_at limit 10) q;
$$;
revoke all on function public.dtg_library_grants_to_revoke() from public,anon,authenticated;
grant execute on function public.dtg_library_grants_to_revoke() to service_role;
