-- A named ticket always has a real client, regardless of its creation surface.
-- Match only case/spacing; do not guess similar people or businesses.
create function public.client_identity_key(p_name text) returns text
language sql immutable strict security invoker set search_path='' as $$
 select lower(regexp_replace(btrim(p_name),'\s+',' ','g'));
$$;
create index clientes_identity_lookup on public.clientes(public.client_identity_key(nombre)) where archived_at is null;

create function public.client_identity_resolve(p_name text) returns uuid
language plpgsql security invoker set search_path='' as $$
declare key text; found_id uuid; matches integer;
begin
 if current_user not in ('postgres','service_role') and (auth.uid() is null or not public.is_active_member()) then raise exception 'Solo miembros activos'; end if;
 key:=public.client_identity_key(p_name);
 if coalesce(key,'')='' then return null; end if;
 -- Concurrent ticket creations for the same name share a transaction lock.
 perform pg_advisory_xact_lock(hashtextextended(key,78012));
 select count(*), (array_agg(id order by created_at,id))[1] into matches,found_id
 from public.clientes where archived_at is null and public.client_identity_key(nombre)=key;
 if matches>1 then raise exception 'Hay varias fichas con ese nombre. Selecciona el cliente existente.'; end if;
 if found_id is null then
  insert into public.clientes(nombre) values(regexp_replace(btrim(p_name),'\s+',' ','g')) returning id into found_id;
 end if;
 return found_id;
end $$;
revoke all on function public.client_identity_key(text),public.client_identity_resolve(text) from public,anon;
grant execute on function public.client_identity_key(text),public.client_identity_resolve(text) to authenticated,service_role;

create function public.enforce_ticket_client_identity() returns trigger
language plpgsql security invoker set search_path='' as $$
declare c public.clientes%rowtype; seen uuid[]:=array[]::uuid[]; resolve_name boolean:=false;
begin
 if new.cliente_id is not null then
  select * into c from public.clientes where id=new.cliente_id;
  if c.id is null then raise exception 'La ficha del cliente no está disponible'; end if;
  while c.archived_at is not null and c.merged_into is not null and not c.id=any(seen) loop
   seen:=array_append(seen,c.id);
   select * into c from public.clientes where id=c.merged_into;
   if c.id is null then raise exception 'La ficha fusionada no está disponible'; end if;
  end loop;
  if c.archived_at is not null then raise exception 'Selecciona una ficha de cliente activa'; end if;
  if tg_op='UPDATE' then
   resolve_name:=new.cliente_id is not distinct from old.cliente_id
    and new.cliente is distinct from old.cliente
    and coalesce(public.client_identity_key(new.cliente),'')<>coalesce(public.client_identity_key(c.nombre),'');
  end if;
  if not resolve_name then
   new.cliente_id:=c.id;
   new.cliente:=c.nombre;
   return new;
  end if;
 end if;
 if nullif(btrim(coalesce(new.cliente,'')),'') is not null then
  new.cliente_id:=public.client_identity_resolve(new.cliente);
 else
  new.cliente_id:=null;
 end if;
 return new;
end $$;
revoke all on function public.enforce_ticket_client_identity() from public,anon,authenticated;
create trigger trg_ensure_ticket_client_identity before insert or update of cliente,cliente_id on public.tickets
 for each row execute function public.enforce_ticket_client_identity();

-- Fill historical associations without modifying ticket text or timestamps.
update public.tickets set cliente=cliente
 where cliente_id is null and nullif(btrim(cliente),'') is not null;
alter table public.tickets add constraint tickets_named_client_has_identity
 check(nullif(btrim(cliente),'') is null or cliente_id is not null);
