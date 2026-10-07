-- Public intake is reviewed before it becomes a customer/ticket.
alter table public.dtg_website_requests
 add column if not exists customer_id uuid references public.clientes(id),
 add column if not exists ticket_id uuid references public.tickets(id),
 add column if not exists reviewed_by uuid references public.profiles(id),
 add column if not exists reviewed_at timestamptz,
 add column if not exists disposition text not null default 'pending' check(disposition in ('pending','linked','dismissed')),
 add column if not exists source_reference text references public.dtg_website_requests(reference),
 add column if not exists engine_files jsonb not null default '[]';

create table public.dtg_customer_portal_accounts (
 id uuid primary key default gen_random_uuid(), email text unique not null check(email=lower(trim(email))),
 customer_id uuid not null references public.clientes(id), active boolean not null default true,
 authorized_by uuid not null references public.profiles(id), created_at timestamptz not null default now()
);
create table public.dtg_customer_portal_tokens (
 token_hash text primary key, account_id uuid not null references public.dtg_customer_portal_accounts(id),
 kind text not null check(kind in ('login','session')), expires_at timestamptz not null,
 used_at timestamptz, created_at timestamptz not null default now()
);
create index on public.dtg_customer_portal_tokens(account_id,created_at);
create table public.dtg_website_comments (
 id uuid primary key, reference text not null references public.dtg_website_requests(reference),
 account_id uuid not null references public.dtg_customer_portal_accounts(id),
 body text not null check(length(body) between 1 and 2000), created_at timestamptz not null default now()
);
alter table public.dtg_customer_portal_accounts enable row level security;
alter table public.dtg_customer_portal_tokens enable row level security;
alter table public.dtg_website_comments enable row level security;
revoke all on public.dtg_customer_portal_accounts,public.dtg_customer_portal_tokens,public.dtg_website_comments from anon,authenticated;
grant all on public.dtg_customer_portal_accounts,public.dtg_customer_portal_tokens,public.dtg_website_comments to service_role;
grant select on public.dtg_website_comments to authenticated;
create policy website_comments_staff_read on public.dtg_website_comments for select to authenticated using(public.is_active_member());

create function public.dtg_review_website_request(p_reference text,p_customer uuid default null,p_portal boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.dtg_website_requests%rowtype; c public.clientes%rowtype; t public.tickets%rowtype;
begin
 if not public.is_active_member() or not public.is_admin() then raise exception 'FORBIDDEN'; end if;
 select * into r from public.dtg_website_requests where reference=p_reference for update;
 if not found or r.disposition='dismissed' then raise exception 'REQUEST_UNAVAILABLE'; end if;
 perform pg_advisory_xact_lock(hashtextextended(lower(trim(r.email)),956));
 if r.ticket_id is not null then
  if not public.ticket_is_visible_to_me(r.ticket_id) then raise exception 'FORBIDDEN'; end if;
  select * into c from public.clientes where id=r.customer_id;
  select * into t from public.tickets where id=r.ticket_id;
 else
  if p_customer is null then
   if exists(select 1 from public.clientes where lower(trim(email))=r.email and archived_at is null and merged_into is null) then raise exception 'CHOOSE_EXISTING_CUSTOMER'; end if;
   insert into public.clientes(nombre,email,telefono) values(r.name,r.email,nullif(r.phone,'')) returning * into c;
  else
   select * into c from public.clientes where id=p_customer and archived_at is null and merged_into is null;
   if not found then raise exception 'CUSTOMER_UNAVAILABLE'; end if;
  end if;
  insert into public.tickets(cliente_id,cliente,que_sigue) values(c.id,c.nombre,'Revisar solicitud web '||r.reference) returning * into t;
  insert into public.bitacora(ticket_id,tipo,autor,payload) values(t.id,'sistema',(select display_name from public.profiles where id=auth.uid()),jsonb_build_object('text','Solicitud web vinculada: '||r.reference||E'\n'||r.project,'website_reference',r.reference));
  update public.dtg_website_requests set customer_id=c.id,ticket_id=t.id,disposition='linked',reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now() where reference=r.reference;
 end if;
 if p_portal then
  -- Staff explicitly authorize the contact. A typed public email never claims historical orders.
  if lower(trim(coalesce(c.email,'')))<>r.email then raise exception 'CUSTOMER_EMAIL_MISMATCH'; end if;
  if exists(select 1 from public.dtg_customer_portal_accounts where email=r.email and customer_id<>c.id) then raise exception 'PORTAL_ACCOUNT_CONFLICT'; end if;
  insert into public.dtg_customer_portal_accounts(email,customer_id,authorized_by) values(r.email,c.id,auth.uid()) on conflict(email) do update set active=true,authorized_by=auth.uid();
 end if;
 return jsonb_build_object('ticket_id',t.id,'seq',t.seq,'customer_id',c.id,'portal_enabled',p_portal);
end $$;
revoke all on function public.dtg_review_website_request(text,uuid,boolean) from public,anon;
grant execute on function public.dtg_review_website_request(text,uuid,boolean) to authenticated;

create function public.dtg_consume_portal_login(p_hash text,p_session text)
returns uuid language plpgsql security invoker set search_path='' as $$
declare a uuid;
begin
 update public.dtg_customer_portal_tokens tok set used_at=now()
 where tok.token_hash=p_hash and tok.kind='login' and tok.used_at is null and tok.expires_at>now()
 and exists(select 1 from public.dtg_customer_portal_accounts ac where ac.id=tok.account_id and ac.active)
 returning account_id into a;
 if a is null then raise exception 'LOGIN_UNAVAILABLE'; end if;
 insert into public.dtg_customer_portal_tokens(token_hash,account_id,kind,expires_at) values(p_session,a,'session',now()+interval '7 days');
 return a;
end $$;
revoke all on function public.dtg_consume_portal_login(text,text) from public,anon,authenticated;
grant execute on function public.dtg_consume_portal_login(text,text) to service_role;

create function public.dtg_website_delivery_status() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.entregado_at is distinct from old.entregado_at then
  update public.dtg_website_requests set status=case when new.entregado_at is not null then 'finished' else 'working' end,updated_at=now() where ticket_id=new.id and disposition='linked';
 end if;
 return new;
end $$;
revoke all on function public.dtg_website_delivery_status() from public,anon,authenticated;
create trigger website_delivery_status after update of entregado_at on public.tickets for each row execute function public.dtg_website_delivery_status();
