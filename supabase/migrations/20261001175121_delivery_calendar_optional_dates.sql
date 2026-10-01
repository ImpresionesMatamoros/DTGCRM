-- Delivery is the sole scheduling date. Optional dates remain ticket metadata.
alter table public.tickets add column if not exists fechas_auxiliares jsonb not null default '[]'::jsonb;
alter table public.tickets add constraint tickets_fechas_auxiliares_array check (jsonb_typeof(fechas_auxiliares) = 'array' and jsonb_array_length(fechas_auxiliares) <= 50);

create or replace function public.set_ticket_delivery_dates(p_ticket_id uuid, p_delivery date, p_event date default null, p_auxiliary jsonb default null, p_update_optional boolean default false)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare affected integer; item jsonb; item_date date;
begin
  if not public.is_active_member() then raise exception 'Not authorized'; end if;
  if p_delivery is not null and p_delivery not between date '2000-01-01' and date '2100-12-31' then raise exception 'Invalid delivery date'; end if;
  if p_update_optional then
    if p_event is not null and p_event not between date '2000-01-01' and date '2100-12-31' then raise exception 'Invalid event date'; end if;
    if p_auxiliary is null or jsonb_typeof(p_auxiliary) <> 'array' then raise exception 'Invalid optional dates'; end if;
    if jsonb_array_length(p_auxiliary) > 50 then raise exception 'Too many optional dates'; end if;
    for item in select value from jsonb_array_elements(p_auxiliary) loop
      if jsonb_typeof(item) <> 'object' or coalesce(item->>'kind','') not in ('partial','deadline') or coalesce(item->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' or length(coalesce(item->>'label','')) > 120 then raise exception 'Invalid optional date'; end if;
      item_date := (item->>'date')::date;
      if item_date not between date '2000-01-01' and date '2100-12-31' then raise exception 'Invalid optional date'; end if;
    end loop;
  end if;
  update public.tickets set fecha_compromiso = p_delivery,
    fecha_evento = case when p_update_optional then p_event else fecha_evento end,
    fechas_auxiliares = case when p_update_optional then p_auxiliary else fechas_auxiliares end
    where id = p_ticket_id;
  get diagnostics affected = row_count;
  if affected = 0 then return false; end if;
  insert into public.bitacora(ticket_id,tipo,autor,payload) values(p_ticket_id,'sistema',(select display_name from public.profiles where id=auth.uid()),jsonb_build_object('text',case when p_update_optional then 'Fecha de entrega y fechas opcionales actualizadas' else 'Fecha de entrega actualizada' end,'fecha_compromiso',p_delivery,'optional_dates_changed',p_update_optional));
  return true;
end $$;
revoke all on function public.set_ticket_delivery_dates(uuid,date,date,jsonb,boolean) from public, anon;
grant execute on function public.set_ticket_delivery_dates(uuid,date,date,jsonb,boolean) to authenticated;
