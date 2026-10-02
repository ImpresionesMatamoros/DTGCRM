alter table public.clientes add column if not exists frequent_client boolean not null default false,
 add column if not exists high_ticket boolean not null default false,
 add column if not exists archived_at timestamptz,
 add column if not exists merged_into uuid references public.clientes(id);

create table public.client_notes (
 id uuid primary key default gen_random_uuid(), client_id uuid not null references public.clientes(id),
 body text not null check(length(trim(body)) between 1 and 2000),
 author_user_id uuid not null default auth.uid(), author_name text not null,
 created_at timestamptz not null default now()
);
create table public.client_tasks (
 id uuid primary key default gen_random_uuid(), client_id uuid not null references public.clientes(id),
 description text not null check(length(trim(description)) between 1 and 120),
 note text not null default '' check(length(note)<=240), responsable text not null,
 area text not null check(area in ('planeacion','produccion')),
 estado text not null default 'pendiente' check(estado in ('pendiente','terminado')),
 created_by uuid not null default auth.uid(), created_at timestamptz not null default now(), completed_at timestamptz
);
create index client_notes_client_date on public.client_notes(client_id,created_at desc);
create index client_tasks_client_state on public.client_tasks(client_id,estado);
alter table public.client_notes enable row level security;
alter table public.client_tasks enable row level security;
create policy client_notes_read on public.client_notes for select to authenticated using(public.is_active_member());
create policy client_notes_insert on public.client_notes for insert to authenticated with check(public.is_active_member() and author_user_id=auth.uid() and exists(select 1 from public.clientes c where c.id=client_id and c.archived_at is null));
create policy client_notes_move on public.client_notes for update to authenticated using(public.is_active_member()) with check(public.is_active_member());
create policy client_tasks_read on public.client_tasks for select to authenticated using(public.is_active_member());
create policy client_tasks_insert on public.client_tasks for insert to authenticated with check(public.is_active_member() and created_by=auth.uid() and exists(select 1 from public.clientes c where c.id=client_id and c.archived_at is null));
create policy client_tasks_update on public.client_tasks for update to authenticated using(public.is_active_member()) with check(public.is_active_member());
revoke all on public.client_notes,public.client_tasks from anon;
grant select,insert on public.client_notes to authenticated;
grant update(client_id) on public.client_notes to authenticated;
grant select,insert,update on public.client_tasks to authenticated;

-- Read-only privileged guard prevents archiving a client with inaccessible tickets.
-- All mutations below remain invoker operations subject to ticket RLS.
create function public.client_workspace_check_coverage(p_sources uuid[]) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not public.is_active_member() then raise exception 'Solo miembros activos'; end if;
 if exists(select 1 from public.tickets t where t.cliente_id=any(p_sources) and not coalesce(public.ticket_is_visible_to_me(t.id),false)) then
  raise exception 'Este cliente contiene tickets que no puedes modificar. No se realizó ningún cambio.';
 end if;
end $$;

create function public.client_workspace_merge(p_target uuid,p_sources uuid[]) returns uuid
language plpgsql security invoker set search_path='' as $$
declare s public.clientes%rowtype; target public.clientes%rowtype; ids uuid[];
begin
 if not public.is_active_member() then raise exception 'Solo miembros activos'; end if;
 select array_agg(distinct x) into ids from unnest(p_sources) x where x<>p_target;
 if coalesce(cardinality(ids),0)=0 or cardinality(ids)>50 then raise exception 'Selecciona entre 2 y 51 clientes'; end if;
 perform 1 from public.clientes where id=p_target or id=any(ids) order by id for update;
 select * into target from public.clientes where id=p_target and archived_at is null;
 if target.id is null or (select count(*) from public.clientes where id=any(ids) and archived_at is null)<>cardinality(ids) then raise exception 'Los clientes cambiaron. Actualiza la vista.'; end if;
 perform public.client_workspace_check_coverage(ids);
 perform 1 from public.tickets where cliente_id=any(ids) order by id for update;
 for s in select * from public.clientes where id=any(ids) order by created_at,id loop
  if nullif(trim(s.notas_comerciales),'') is not null then
   insert into public.client_notes(client_id,body,author_name) values(p_target,left('Notas importadas de '||s.nombre||': '||s.notas_comerciales,2000),'Historial de clientes');
  end if;
  update public.clientes set telefono=coalesce(nullif(telefono,''),s.telefono),email=coalesce(nullif(email,''),s.email),
   empresa=coalesce(nullif(empresa,''),s.empresa),logo_storage_path=coalesce(nullif(logo_storage_path,''),s.logo_storage_path),
   frequent_client=frequent_client or s.frequent_client,high_ticket=high_ticket or s.high_ticket where id=p_target;
 end loop;
 update public.tickets set cliente_id=p_target,cliente=target.nombre where cliente_id=any(ids);
 update public.client_notes set client_id=p_target where client_id=any(ids);
 update public.client_tasks set client_id=p_target where client_id=any(ids);
 update public.clientes set archived_at=now(),merged_into=p_target where id=any(ids);
 return p_target;
end $$;

create function public.client_workspace_reassign(p_ticket uuid,p_target uuid,p_expected_source uuid,p_resolution text default 'keep') returns uuid
language plpgsql security invoker set search_path='' as $$
declare old_id uuid; target public.clientes%rowtype; n integer;
begin
 if not public.is_active_member() then raise exception 'Solo miembros activos'; end if;
 if p_resolution not in ('keep','merge','delete') then raise exception 'Opción inválida'; end if;
 perform 1 from public.clientes where id=p_target or id=p_expected_source order by id for update;
 select cliente_id into old_id from public.tickets where id=p_ticket for update;
 if not found or old_id is distinct from p_expected_source then raise exception 'El ticket cambió de cliente. Actualiza y vuelve a intentarlo.'; end if;
 select * into target from public.clientes where id=p_target and archived_at is null;
 if target.id is null then raise exception 'Cliente destino no disponible'; end if;
 if old_id=p_target then return p_target; end if;
 if p_resolution='merge' and old_id is not null then return public.client_workspace_merge(p_target,array[old_id]); end if;
 if p_resolution='delete' and old_id is not null then
  perform public.client_workspace_check_coverage(array[old_id]);
  if exists(select 1 from public.tickets where cliente_id=old_id and id<>p_ticket) then raise exception 'El cliente aún tiene otros tickets; elige fusionar o dejar como está.'; end if;
 end if;
 update public.tickets set cliente_id=p_target,cliente=target.nombre where id=p_ticket;
 get diagnostics n=row_count;
 if n<>1 then raise exception 'No tienes permiso para cambiar este ticket'; end if;
 if p_resolution='delete' and old_id is not null then update public.clientes set archived_at=now() where id=old_id; end if;
 return p_target;
end $$;

create function public.client_workspace_flag(p_client uuid,p_flag text,p_value boolean,p_expected boolean) returns boolean
language plpgsql security invoker set search_path='' as $$
declare n integer;
begin
 if not public.is_active_member() then raise exception 'Solo miembros activos'; end if;
 if p_flag='frequent_client' then update public.clientes set frequent_client=p_value where id=p_client and archived_at is null and frequent_client=p_expected;
 elsif p_flag='high_ticket' then update public.clientes set high_ticket=p_value where id=p_client and archived_at is null and high_ticket=p_expected;
 else raise exception 'Marca inválida'; end if;
 get diagnostics n=row_count;
 if n<>1 then raise exception 'La marca cambió. Actualiza la vista.'; end if;
 return p_value;
end $$;
revoke all on function public.client_workspace_check_coverage(uuid[]),public.client_workspace_merge(uuid,uuid[]),public.client_workspace_reassign(uuid,uuid,uuid,text),public.client_workspace_flag(uuid,text,boolean,boolean) from public,anon;
grant execute on function public.client_workspace_check_coverage(uuid[]),public.client_workspace_merge(uuid,uuid[]),public.client_workspace_reassign(uuid,uuid,uuid,text),public.client_workspace_flag(uuid,text,boolean,boolean) to authenticated;
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  alter publication supabase_realtime add table public.client_notes,public.client_tasks;
 end if;
end $$;
