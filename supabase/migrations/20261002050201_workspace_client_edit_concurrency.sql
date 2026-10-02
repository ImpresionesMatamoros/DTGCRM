-- Field-level compare-and-set: unrelated edits merge, stale edits never overwrite.
create or replace function public.workspace_patch_record(p_table text,p_id uuid,p_patch jsonb,p_expected jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare allowed text[]; current_row jsonb; result_row jsonb; col text; assignments text;
begin
 if auth.uid() is null or not public.is_active_member() then raise exception 'Authentication required'; end if;
 allowed:=case p_table
 when 'tickets' then array['cliente','responsable','fecha_atencion','fecha_compromiso','fecha_evento','delivery_zone','que_sigue']
 when 'clientes' then array['nombre','empresa','telefono','email','notas_comerciales','preautorizado','tax_exempt','tax_exempt_reason','tax_exempt_ref','logo_storage_path','accent_theme','visual_style']
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


