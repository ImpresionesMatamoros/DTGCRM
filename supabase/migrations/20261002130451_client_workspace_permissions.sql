-- Replace inherited broad default privileges with explicit least privilege.
revoke all on public.client_notes,public.client_tasks from public,anon,authenticated;
grant select,insert on public.client_notes to authenticated;
grant update(client_id) on public.client_notes to authenticated;
grant select,insert on public.client_tasks to authenticated;
grant update(client_id,description,note,responsable,area,estado,completed_at) on public.client_tasks to authenticated;
create or replace function public.client_workspace_reassign(p_ticket uuid,p_target uuid,p_expected_source uuid,p_resolution text default 'keep') returns uuid
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
 if p_resolution='delete' and old_id is not null then
  insert into public.client_notes(client_id,body,author_name)
   select p_target,left('Notas importadas de '||nombre||': '||notas_comerciales,2000),'Historial de clientes'
   from public.clientes where id=old_id and nullif(trim(notas_comerciales),'') is not null;
  update public.client_notes set client_id=p_target where client_id=old_id;
  update public.client_tasks set client_id=p_target where client_id=old_id;
  update public.clientes set archived_at=now() where id=old_id;
 end if;
 return p_target;
end $$;

