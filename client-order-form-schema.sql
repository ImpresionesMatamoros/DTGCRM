alter table public.client_form_requests add column order_snapshot jsonb, add column applied_at timestamptz, add column source_customer_id uuid references public.clientes(id);
alter table public.client_form_requests drop constraint client_form_requests_fields_check;
alter table public.client_form_requests add constraint client_form_requests_fields_check check(cardinality(fields) between 1 and 8 and fields <@ array['name','email','phone','description','quantity','delivery_date','delivery_area','comments']::text[]);
grant select(order_snapshot,applied_at) on public.client_form_requests to authenticated;

create function public.client_order_form_create(p_id uuid,p_ticket uuid,p_token text) returns uuid language plpgsql security definer set search_path='' as $$
declare t public.tickets%rowtype; c public.clientes%rowtype; locked jsonb; lines jsonb; editable text[]; total numeric;
begin
 if auth.uid() is null or not public.is_active_member() or not coalesce(public.ticket_is_visible_to_me(p_ticket),false) then raise exception 'FORBIDDEN'; end if;
 if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_TOKEN'; end if;
 if exists(select 1 from public.client_form_requests where id=p_id) then
  if exists(select 1 from public.client_form_requests where id=p_id and ticket_id=p_ticket and created_by=auth.uid() and token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') and order_snapshot is not null) then return p_id; end if;
  raise exception 'CONFLICT';
 end if;
 select * into t from public.tickets where id=p_ticket;
 if t.cerrado_at is not null then raise exception 'TICKET_CLOSED'; end if;
 select * into c from public.clientes where id=t.cliente_id;
 select jsonb_agg(jsonb_build_object('description',descripcion,'quantity',coalesce(cantidad,1),'unit_price',precio,'line_total',coalesce(cantidad,1)*precio) order by created_at,id),sum(coalesce(cantidad,1)*precio) into lines,total from public.productos where ticket_id=p_ticket;
 if lines is null then raise exception 'ADD_PRODUCTS_FIRST'; end if;
 locked=jsonb_strip_nulls(jsonb_build_object('name',case when nullif(trim(c.nombre),'') is not null and regexp_replace(c.nombre,'[^0-9]','','g') is distinct from nullif(regexp_replace(coalesce(c.telefono,''),'[^0-9]','','g'),'') then c.nombre end,'phone',nullif(trim(c.telefono),''),'email',nullif(trim(c.email),''),'delivery_date',t.fecha_compromiso,'delivery_area',nullif(t.delivery_zone,'')));
 select array_agg(k) into editable from unnest(array['name','phone','email','delivery_date','delivery_area','comments']) k where not locked ? k;
 insert into public.client_form_requests(id,ticket_id,title,instructions,fields,token_hash,created_by,expires_at,source_customer_id,order_snapshot)
 values(p_id,p_ticket,'Completa los datos de tu pedido','Tu pedido está recibido. Comparte los datos pendientes para facilitar su entrega.',editable,encode(sha256(convert_to(p_token,'UTF8')),'hex'),auth.uid(),now()+interval '7 days',t.cliente_id,jsonb_build_object('reference',t.seq,'currency','USD','items',lines,'product_total',case when exists(select 1 from public.productos where ticket_id=p_ticket and precio is null) then null else total end,'locked',locked));
 return p_id;
end $$;
revoke all on function public.client_order_form_create(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.client_order_form_create(uuid,uuid,text) to authenticated;

create or replace function public.client_form_get(p_token text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.client_form_requests%rowtype;
begin
 if p_token is null or p_token !~ '^[a-f0-9]{64}$' then return jsonb_build_object('state','unavailable'); end if;
 select * into r from public.client_form_requests where token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex');
 if not found or r.revoked_at is not null or r.expires_at<=now() then return jsonb_build_object('state','unavailable'); end if;
 if r.submitted_at is not null then return jsonb_build_object('state','submitted'); end if;
 return jsonb_build_object('state','open','title',r.title,'instructions',r.instructions,'fields',r.fields,'order',r.order_snapshot);
end $$;

create function public.client_order_form_validate() returns trigger language plpgsql set search_path='' as $$
begin
 if new.answers ? 'delivery_area' and new.answers->>'delivery_area'<>'' and not(new.answers->>'delivery_area'=any(array['matamoros','brownsville','harlingen_area','mcallen_area','south_padre_island','otra','los_fresnos','olmito','san_benito','harlingen','la_feria','weslaco','mercedes','port_isabel','starbase','donna','san_juan','pharr','mcallen','edinburg','mission','palmview','hidalgo','edcouch','alamo','elsa','rio_hondo','reynosa','rio_grande_city'])) then raise exception 'INVALID_AREA'; end if;
 return new;
end $$;
revoke all on function public.client_order_form_validate() from public,anon,authenticated;
create trigger client_order_form_validate before update of answers on public.client_form_requests for each row execute function public.client_order_form_validate();

create function public.client_order_form_apply(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.client_form_requests%rowtype; t public.tickets%rowtype; c public.clientes%rowtype; a jsonb;
begin
 select * into r from public.client_form_requests where id=p_id for update;
 if not found or auth.uid() is null or not public.is_active_member() or not coalesce(public.ticket_is_visible_to_me(r.ticket_id),false) then raise exception 'FORBIDDEN'; end if;
 if r.order_snapshot is null or r.submitted_at is null then raise exception 'NO_ORDER_ANSWERS'; end if;
 if r.applied_at is not null then return jsonb_build_object('applied',true); end if;
 select * into t from public.tickets where id=r.ticket_id for update;
 if t.cerrado_at is not null then raise exception 'TICKET_CLOSED'; end if;
 if r.source_customer_id is distinct from t.cliente_id then raise exception 'CLIENT_CHANGED_REVIEW_FIRST'; end if;
 a=r.answers;
 if t.cliente_id is null and nullif(trim(a->>'name'),'') is not null then
  -- A public email never claims an existing customer's identity.
  insert into public.clientes(nombre,telefono,email) values(trim(a->>'name'),nullif(trim(a->>'phone'),''),nullif(trim(a->>'email'),'')) returning * into c;
  update public.tickets set cliente_id=c.id,cliente=c.nombre where id=t.id;
 elsif t.cliente_id is not null then
  select * into c from public.clientes where id=t.cliente_id for update;
  if c.archived_at is not null or c.merged_into is not null then raise exception 'REVIEW_CUSTOMER_FIRST'; end if;
  update public.clientes set nombre=case when nullif(trim(nombre),'') is null or (regexp_replace(nombre,'[^0-9]','','g')=nullif(regexp_replace(coalesce(telefono,''),'[^0-9]','','g'),'')) then coalesce(nullif(trim(a->>'name'),''),nombre) else nombre end,telefono=coalesce(nullif(trim(telefono),''),nullif(trim(a->>'phone'),'')),email=coalesce(nullif(trim(email),''),nullif(trim(a->>'email'),'')) where id=c.id returning * into c;
  update public.tickets set cliente=c.nombre where id=t.id;
 end if;
 update public.tickets set fecha_compromiso=coalesce(fecha_compromiso,nullif(a->>'delivery_date','')::date),delivery_zone=coalesce(nullif(delivery_zone,''),nullif(a->>'delivery_area','')) where id=t.id;
 insert into public.bitacora(ticket_id,tipo,autor,payload) values(t.id,'sistema',(select display_name from public.profiles where id=auth.uid()),jsonb_build_object('text','Datos del formulario del cliente revisados y aplicados únicamente en campos pendientes.','client_form_id',r.id,'answers',a));
 update public.client_form_requests set applied_at=now(),reviewed_at=coalesce(reviewed_at,now()),reviewed_by=coalesce(reviewed_by,auth.uid()) where id=r.id;
 return jsonb_build_object('applied',true);
end $$;
revoke all on function public.client_order_form_apply(uuid) from public,anon,authenticated;
grant execute on function public.client_order_form_apply(uuid) to authenticated;
