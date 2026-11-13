create schema if not exists private;

create table private.client_intake_submissions (
  id uuid primary key,
  client_id uuid not null,
  payload_hash bytea not null,
  created_at timestamptz not null default now()
);

alter table private.client_intake_submissions enable row level security;
revoke all on private.client_intake_submissions from public, anon, authenticated;
grant usage on schema private to service_role;
grant select, insert on private.client_intake_submissions to service_role;

create function public.receive_public_client_details(
  p_token text, p_submission uuid, p_name text, p_phone text,
  p_city text, p_email text, p_company text
) returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_name text := trim(coalesce(p_name, ''));
  v_phone text := trim(coalesce(p_phone, ''));
  v_phone_key text := regexp_replace(v_phone, '[^0-9]', '', 'g');
  v_city text := trim(coalesce(p_city, ''));
  v_email text := lower(trim(coalesce(p_email, '')));
  v_company text := trim(coalesce(p_company, ''));
  v_payload_hash bytea;
  v_old_hash bytea;
  v_client uuid;
begin
  if p_token is null or length(p_token) not between 40 and 256 or not exists (
    select 1 from public.dtg_website_gateway
    where id and token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
  ) then
    return 'unauthorized';
  end if;

  if p_submission is null or length(v_name) not between 2 and 100
     or length(v_city) not between 2 and 80
     or length(v_phone) > 30 or length(v_phone_key) not between 10 and 15
     or v_phone !~ '^[+0-9(). -]+$'
     or length(v_email) > 254 or (v_email <> '' and v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')
     or length(v_company) > 100
     or concat(v_name, v_city, v_company) ~ '[[:cntrl:]]' then
    return 'validation';
  end if;

  if length(v_phone_key) = 11 and left(v_phone_key, 1) = '1' then
    v_phone_key := substr(v_phone_key, 2);
  end if;

  v_payload_hash := extensions.digest(jsonb_build_object(
    'name', v_name, 'phone', v_phone, 'city', v_city, 'email', v_email, 'company', v_company
  )::text, 'sha256');

  perform pg_advisory_xact_lock(hashtextextended('client-intake-id:' || p_submission::text, 0));
  select payload_hash into v_old_hash from private.client_intake_submissions where id = p_submission;
  if found then
    if v_old_hash = v_payload_hash then return 'saved'; end if;
    return 'conflict';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('client-intake-contact:' || v_phone_key, 0));
  select id into v_client
  from public.clientes
  where archived_at is null
    and merged_into is null
    and lower(trim(nombre)) = lower(v_name)
    and regexp_replace(regexp_replace(coalesce(telefono, ''), '[^0-9]', '', 'g'), '^1([0-9]{10})$', '\1') = v_phone_key
    and coalesce(lower(trim(email)), '') = v_email
    and coalesce(lower(trim(empresa)), '') = lower(v_company)
    and notas_comerciales = 'Ciudad: ' || v_city
  order by created_at, id
  limit 1;

  if v_client is null then
    insert into public.clientes (nombre, telefono, email, empresa, notas_comerciales)
    values (v_name, v_phone, nullif(v_email, ''), nullif(v_company, ''), 'Ciudad: ' || v_city)
    returning id into v_client;
  end if;

  insert into private.client_intake_submissions (id, client_id, payload_hash)
  values (p_submission, v_client, v_payload_hash);
  return 'saved';
end;
$$;

revoke all on function public.receive_public_client_details(text, uuid, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.receive_public_client_details(text, uuid, text, text, text, text, text)
  to service_role;
