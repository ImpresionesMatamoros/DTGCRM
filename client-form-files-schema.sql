create table public.client_form_file_batches(
 id uuid primary key,request_id uuid not null references public.client_form_requests(id),
 files jsonb not null check(jsonb_typeof(files)='array'),total_bytes bigint not null check(total_bytes>0),
 fingerprint text not null,state text not null default 'pending' check(state in('pending','ready')),created_at timestamptz not null default now());
alter table public.client_form_file_batches enable row level security;
revoke all on public.client_form_file_batches from public,anon,authenticated;
grant all on public.client_form_file_batches to service_role;
grant select on public.client_form_file_batches to authenticated;
create policy client_form_files_staff on public.client_form_file_batches for select to authenticated using(public.is_active_member() and exists(select 1 from public.client_form_requests r where r.id=request_id));
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('dtg-client-form-files','dtg-client-form-files',false,20971520,array['application/pdf','image/png','image/jpeg','image/webp']) on conflict(id) do nothing;

create function public.client_form_reserve_files(p_token text,p_batch uuid,p_files jsonb,p_fingerprint text) returns uuid language plpgsql security definer set search_path='' as $$
declare r public.client_form_requests%rowtype; b public.client_form_file_batches%rowtype; size bigint; used bigint; count_files bigint;
begin
 if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception 'FORM_UNAVAILABLE'; end if;
 select * into r from public.client_form_requests where token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') for update;
 if not found or r.revoked_at is not null or r.expires_at<=now() or r.order_snapshot is null then raise exception 'FORM_UNAVAILABLE'; end if;
 if p_files is null or jsonb_typeof(p_files)<>'array' or jsonb_array_length(p_files) not between 1 and 5 then raise exception 'INVALID_FILES'; end if;
 select * into b from public.client_form_file_batches where id=p_batch;
 if found then
  if b.request_id=r.id and b.fingerprint=p_fingerprint and b.files=p_files then return r.id; end if;
  raise exception 'UPLOAD_CONFLICT';
 end if;
 select sum((v->>'size')::bigint) into size from jsonb_array_elements(p_files) v;
 if size is null or size<=0 or exists(select 1 from jsonb_array_elements(p_files) v where coalesce((v->>'size')::bigint,0)<=0) then raise exception 'INVALID_FILES'; end if;
 select coalesce(sum(total_bytes),0),coalesce(sum(jsonb_array_length(files)),0) into used,count_files from public.client_form_file_batches where request_id=r.id;
 if used+size>20971520 or count_files+jsonb_array_length(p_files)>5 then raise exception 'FILE_LIMIT'; end if;
 insert into public.client_form_file_batches(id,request_id,files,total_bytes,fingerprint) values(p_batch,r.id,p_files,size,p_fingerprint);
 return r.id;
end $$;
revoke all on function public.client_form_reserve_files(text,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.client_form_reserve_files(text,uuid,jsonb,text) to service_role;

create or replace function public.client_form_get(p_token text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.client_form_requests%rowtype;
begin
 if p_token is null or p_token !~ '^[a-f0-9]{64}$' then return jsonb_build_object('state','unavailable'); end if;
 select * into r from public.client_form_requests where token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex');
 if not found or r.revoked_at is not null or r.expires_at<=now() then return jsonb_build_object('state','unavailable'); end if;
 if r.submitted_at is not null and r.order_snapshot is null then return jsonb_build_object('state','submitted'); end if;
 return jsonb_build_object('state',case when r.submitted_at is null then 'open' else 'submitted' end,'title',r.title,'instructions',r.instructions,'fields',case when r.submitted_at is null then r.fields else array[]::text[] end,'order',case when r.submitted_at is null then r.order_snapshot else r.order_snapshot||jsonb_build_object('locked',(r.order_snapshot->'locked')||coalesce(r.answers,'{}')) end);
end $$;

