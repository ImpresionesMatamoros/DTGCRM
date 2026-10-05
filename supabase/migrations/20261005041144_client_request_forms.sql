-- Additive, independent of AI, email and Drive. Public access is token-only.
create table public.client_form_requests (
 id uuid primary key,
 ticket_id uuid not null references public.tickets(id),
 title text not null check (length(title) between 1 and 120),
 instructions text not null default '' check (length(instructions)<=2000),
 fields text[] not null check (cardinality(fields) between 1 and 7 and fields <@ array['name','email','phone','description','quantity','delivery_date','comments']::text[]),
 token_hash text not null unique check (length(token_hash)=64),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null,
 revoked_at timestamptz,
 answers jsonb,
 submission_id uuid,
 submitted_at timestamptz,
 reviewed_by uuid references auth.users(id),
 reviewed_at timestamptz,
 check ((answers is null and submitted_at is null and submission_id is null) or
        (answers is not null and submitted_at is not null and submission_id is not null))
);
create index client_form_ticket_created on public.client_form_requests(ticket_id,created_at desc);
alter table public.client_form_requests enable row level security;
revoke all on public.client_form_requests from public,anon,authenticated;
grant select(id,ticket_id,title,instructions,fields,created_by,created_at,expires_at,revoked_at,answers,submitted_at,reviewed_by,reviewed_at) on public.client_form_requests to authenticated;
grant all on public.client_form_requests to service_role;
create policy client_form_read on public.client_form_requests for select to authenticated
 using (public.is_active_member() and public.ticket_is_visible_to_me(ticket_id));

create function public.client_form_create(p_id uuid,p_ticket uuid,p_token text,p_title text,p_instructions text,p_fields text[],p_days integer default 7)
returns uuid language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_active_member() or not coalesce(public.ticket_is_visible_to_me(p_ticket),false) then raise exception 'Not authorized'; end if;
 if p_token is null or p_token !~ '^[a-f0-9]{64}$' or p_days is null or p_days not between 1 and 30 then raise exception 'Invalid request'; end if;
 if p_fields is null or cardinality(p_fields) not between 1 and 7 or array_position(p_fields,null) is not null or not (p_fields <@ array['name','email','phone','description','quantity','delivery_date','comments']::text[]) then raise exception 'Invalid fields'; end if;
 if p_title is null or length(trim(p_title)) not between 1 and 120 or p_instructions is null or length(p_instructions)>2000 then raise exception 'Invalid request'; end if;
 -- Idempotent creation after a lost network response; no arbitrary upserts.
 if exists(select 1 from public.client_form_requests where id=p_id) then
  if exists(select 1 from public.client_form_requests where id=p_id and ticket_id=p_ticket and created_by=auth.uid() and token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') and title=trim(p_title) and instructions=p_instructions and fields=p_fields) then return p_id; end if;
  raise exception 'Request conflict';
 end if;
 insert into public.client_form_requests(id,ticket_id,title,instructions,fields,token_hash,created_by,expires_at)
 values(p_id,p_ticket,trim(p_title),p_instructions,p_fields,encode(sha256(convert_to(p_token,'UTF8')),'hex'),auth.uid(),now()+make_interval(days=>p_days));
 return p_id;
end $$;

create function public.client_form_get(p_token text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.client_form_requests%rowtype;
begin
 if p_token is null or p_token !~ '^[a-f0-9]{64}$' then return jsonb_build_object('state','unavailable'); end if;
 select * into r from public.client_form_requests where token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex');
 if not found or r.revoked_at is not null or r.expires_at<=now() then return jsonb_build_object('state','unavailable'); end if;
 if r.submitted_at is not null then return jsonb_build_object('state','submitted'); end if;
 -- Deliberately no ticket id, client, author, answers or internal data.
 return jsonb_build_object('state','open','title',r.title,'instructions',r.instructions,'fields',r.fields);
end $$;

create function public.client_form_submit(p_token text,p_submission uuid,p_answers jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.client_form_requests%rowtype; k text; v jsonb; n numeric;
begin
 if p_token is null or p_token !~ '^[a-f0-9]{64}$' or p_submission is null then return jsonb_build_object('state','unavailable'); end if;
 select * into r from public.client_form_requests where token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') for update;
 if not found or r.revoked_at is not null or r.expires_at<=now() then return jsonb_build_object('state','unavailable'); end if;
 if r.submitted_at is not null then return jsonb_build_object('state',case when r.submission_id=p_submission and r.answers=p_answers then 'received' else 'submitted' end); end if;
 if p_answers is null or jsonb_typeof(p_answers)<>'object' or octet_length(p_answers::text)>16000 or p_answers='{}'::jsonb then raise exception 'Invalid answers'; end if;
 for k,v in select * from jsonb_each(p_answers) loop
  if not(k=any(r.fields)) or jsonb_typeof(v)<>'string' or length(v#>>'{}')>2000 then raise exception 'Invalid answer'; end if;
  if k='quantity' and (v#>>'{}')<>'' then
   if (v#>>'{}') !~ '^[0-9]{1,7}$' then raise exception 'Invalid quantity'; end if;
   n:=(v#>>'{}')::numeric; if n<1 or n>1000000 then raise exception 'Invalid quantity'; end if;
  end if;
  if k='delivery_date' and (v#>>'{}')<>'' then
   if (v#>>'{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Invalid date'; end if;
   perform (v#>>'{}')::date;
  end if;
  if k='email' and (v#>>'{}')<>'' and ((v#>>'{}') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(v#>>'{}')>254) then raise exception 'Invalid email'; end if;
 end loop;
 if not exists(select 1 from jsonb_each_text(p_answers) a where length(trim(a.value))>0) then raise exception 'Empty answers'; end if;
 update public.client_form_requests set answers=p_answers,submission_id=p_submission,submitted_at=now() where id=r.id;
 return jsonb_build_object('state','received');
end $$;

create function public.client_form_manage(p_id uuid,p_action text,p_token text default null) returns boolean language plpgsql security definer set search_path='' as $$
declare r public.client_form_requests%rowtype;
begin
 select * into r from public.client_form_requests where id=p_id for update;
 if not found or auth.uid() is null or not public.is_active_member() or not coalesce(public.ticket_is_visible_to_me(r.ticket_id),false) then raise exception 'Not authorized'; end if;
 if p_action='revoke' then update public.client_form_requests set revoked_at=coalesce(revoked_at,now()) where id=p_id;
 elsif p_action='review' and r.submitted_at is not null then update public.client_form_requests set reviewed_at=coalesce(reviewed_at,now()),reviewed_by=coalesce(reviewed_by,auth.uid()) where id=p_id;
 elsif p_action='renew' and r.submitted_at is null and r.revoked_at is null and p_token ~ '^[a-f0-9]{64}$' then
  update public.client_form_requests set token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex'),expires_at=now()+interval '7 days' where id=p_id;
 else raise exception 'Invalid action'; end if;
 return true;
end $$;
revoke all on function public.client_form_create(uuid,uuid,text,text,text,text[],integer), public.client_form_get(text),public.client_form_submit(text,uuid,jsonb),public.client_form_manage(uuid,text,text) from public,anon,authenticated;
grant execute on function public.client_form_get(text),public.client_form_submit(text,uuid,jsonb) to anon,authenticated;
grant execute on function public.client_form_create(uuid,uuid,text,text,text,text[],integer),public.client_form_manage(uuid,text,text) to authenticated;
