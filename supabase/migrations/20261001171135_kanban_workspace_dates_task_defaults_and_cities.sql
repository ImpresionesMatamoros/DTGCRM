-- New UI fields preserve all historical markers, dates and task metadata.
alter table public.tickets add column if not exists fecha_evento date;
alter table public.tickets add constraint tickets_fecha_evento_sane check (fecha_evento is null or fecha_evento between date '2000-01-01' and date '2100-12-31');
alter table public.profiles add column if not exists default_task_area text;
alter table public.profiles add constraint profiles_default_task_area_check check (default_task_area is null or default_task_area in ('planeacion','produccion'));
alter table public.ticket_markers drop constraint ticket_markers_type_check;
alter table public.ticket_markers add constraint ticket_markers_type_check check (type in ('urgente','cliente_molesto','pendiente_cobro','no_producir','falta_informacion','ordenar','mexico','rgv','diseno','esperando_cliente','esperando_pago','material','imprimir','acabado','costura','recoger','entregar','envio','bloqueado','esperando_demo'));
alter table public.tickets drop constraint tickets_delivery_zone_check;
alter table public.tickets add constraint tickets_delivery_zone_check check (delivery_zone is null or delivery_zone in ('matamoros','brownsville','harlingen_area','mcallen_area','south_padre_island','otra','los_fresnos','olmito','san_benito','harlingen','la_feria','weslaco','mercedes','port_isabel','starbase','donna','san_juan','pharr','mcallen','edinburg','mission','palmview','hidalgo','edcouch','alamo','elsa','rio_hondo','reynosa','rio_grande_city'));

create or replace function public.set_ticket_work_dates(p_ticket_id uuid,p_promised date,p_event date)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare affected integer;
begin
  if not public.is_active_member() then raise exception 'Not authorized'; end if;
  if (p_promised is not null and p_promised not between date '2000-01-01' and date '2100-12-31') or (p_event is not null and p_event not between date '2000-01-01' and date '2100-12-31') then raise exception 'Invalid date'; end if;
  update public.tickets set fecha_compromiso=p_promised,fecha_evento=p_event where id=p_ticket_id;
  get diagnostics affected = row_count;
  if affected=0 then return false; end if;
  insert into public.bitacora(ticket_id,tipo,autor,payload) values(p_ticket_id,'sistema',(select display_name from public.profiles where id=auth.uid()),jsonb_build_object('text','Fechas de entrega y evento actualizadas','fecha_compromiso',p_promised,'fecha_evento',p_event));
  return true;
end $$;
revoke all on function public.set_ticket_work_dates(uuid,date,date) from public,anon;
grant execute on function public.set_ticket_work_dates(uuid,date,date) to authenticated;
