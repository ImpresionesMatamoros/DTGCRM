-- Field-level compare-and-set: unrelated edits merge, stale edits never overwrite.
create or replace function public.workspace_patch_record(p_table text,p_id uuid,p_patch jsonb,p_expected jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare allowed text[]; current_row jsonb; result_row jsonb; col text; assignments text;
begin
 if auth.uid() is null or not public.is_active_member() then raise exception 'Authentication required'; end if;
 allowed:=case p_table
 when 'tickets' then array['cliente','responsable','fecha_atencion','fecha_compromiso','fecha_evento','delivery_zone','que_sigue']
 when 'productos' then array['descripcion','cantidad','precio']
 when 'tareas' then array['descripcion','responsable','area','estado','progreso','tipo_operacion','fecha_atencion','work_order_id','action_code','action_path','terminado_at'] end;
 if allowed is null or jsonb_typeof(p_patch) is distinct from 'object' or jsonb_typeof(p_expected) is distinct from 'object' or p_patch='{}'::jsonb then raise exception 'Invalid edit'; end if;
 for col in select jsonb_object_keys(p_patch) loop
  if not col=any(allowed) or not p_expected ? col then raise exception 'Invalid field'; end if;
  if col like 'fecha_%' and p_patch->>col is not null and ((p_patch->>col)::date not between date '2000-01-01' and date '2100-12-31') then raise exception 'Invalid date'; end if;
 end loop;
 execute format('select to_jsonb(r) from public.%I r where id=$1 for update',p_table) into current_row using p_id;
 if current_row is null then raise exception 'Record unavailable'; end if;
 for col in select jsonb_object_keys(p_patch) loop
  if coalesce(nullif(current_row->col,'""'::jsonb),'null'::jsonb) is distinct from coalesce(nullif(p_expected->col,'""'::jsonb),'null'::jsonb)
    and current_row->col is distinct from p_patch->col then
   raise exception using errcode='40001',message='EDIT_CONFLICT: Otra persona cambió este campo. Revisa el valor actual antes de guardar.',detail=current_row::text;
  end if;
 end loop;
 select string_agg(format('%I=v.%I',k,k),',') into assignments from jsonb_object_keys(p_patch) k;
 execute format('update public.%1$I t set %2$s from jsonb_populate_record(null::public.%1$I,$1) v where t.id=$2 returning to_jsonb(t)',p_table,assignments) into result_row using p_patch,p_id;
 return result_row;
end $$;
revoke all on function public.workspace_patch_record(text,uuid,jsonb,jsonb) from public,anon;
grant execute on function public.workspace_patch_record(text,uuid,jsonb,jsonb) to authenticated;

create or replace function public.set_ticket_delivery_dates_checked(p_ticket_id uuid,p_expected jsonb,p_delivery date,p_event date default null,p_auxiliary jsonb default null,p_update_optional boolean default false)
returns boolean language plpgsql security invoker set search_path='' as $$
declare t public.tickets; col text; current_row jsonb;
begin
 if auth.uid() is null or not public.is_active_member() then raise exception 'Authentication required'; end if;
 select * into t from public.tickets where id=p_ticket_id for update;
 if not found then raise exception 'Record unavailable'; end if;
 current_row:=to_jsonb(t);
 if jsonb_typeof(p_expected) is distinct from 'object' or not p_expected ? 'fecha_compromiso' or (p_update_optional and not(p_expected ? 'fecha_evento' and p_expected ? 'fechas_auxiliares')) then raise exception 'Missing original dates'; end if;
 for col in select unnest(case when p_update_optional then array['fecha_compromiso','fecha_evento','fechas_auxiliares'] else array['fecha_compromiso'] end) loop
  if current_row->col is distinct from p_expected->col then raise exception using errcode='40001',message='EDIT_CONFLICT: Otra persona cambió las fechas. Revisa el valor actual antes de guardar.'; end if;
 end loop;
 return public.set_ticket_delivery_dates(p_ticket_id,p_delivery,p_event,p_auxiliary,p_update_optional);
end $$;
revoke all on function public.set_ticket_delivery_dates_checked(uuid,jsonb,date,date,jsonb,boolean) from public,anon;
grant execute on function public.set_ticket_delivery_dates_checked(uuid,jsonb,date,date,jsonb,boolean) to authenticated;

-- Same recipient rules for foreground sounds and closed-app push.
create or replace function public.chat_notification_kind_for_user(p_id uuid,p_user uuid)
returns text language plpgsql stable security definer set search_path='' as $$
declare p public.team_posts; root uuid;
begin
 select * into p from public.team_posts where id=p_id;
 if not found or p.deleted_at is not null or p.author_user_id=p_user or (p.expires_at is not null and p.expires_at<=now()) or not public.chat_user_can_read_scope(p.conversation_id,p_user) then return null; end if;
 if exists(select 1 from public.chat_conversations c where c.id=p.conversation_id and c.kind='direct') then return 'personal'; end if;
 if p.mentions @> jsonb_build_array(jsonb_build_object('id',p_user::text)) then return 'mencion'; end if;
 if exists(select 1 from public.team_posts q where q.id=p.reply_to_id and q.author_user_id=p_user and q.deleted_at is null and q.conversation_id is not distinct from p.conversation_id) then return 'respuesta'; end if;
 root:=coalesce(p.thread_root_id,(select coalesce(q.thread_root_id,q.id) from public.team_posts q where q.id=p.reply_to_id and q.conversation_id is not distinct from p.conversation_id));
 if root is not null and exists(select 1 from public.team_posts q where q.id=root and q.author_user_id=p_user and q.deleted_at is null and q.conversation_id is not distinct from p.conversation_id) then return 'respuesta'; end if;
 return null;
end $$;
-- A recipient classifier is internal, not an API for inspecting private messages.
revoke all on function public.chat_notification_kind_for_user(uuid,uuid) from public,anon,authenticated;
grant execute on function public.chat_notification_kind_for_user(uuid,uuid) to service_role;
