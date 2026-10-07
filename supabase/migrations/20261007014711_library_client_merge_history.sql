-- Preserve the library of merged clients while retaining origin-ticket RLS.
create or replace function public.dtg_library_list(p_customer uuid,p_before timestamptz default null,p_before_id uuid default null,p_search text default '',p_category text default '',p_limit integer default 50,p_ticket uuid default null)
returns jsonb language sql stable security invoker set search_path='' as $$
 with recursive family(id) as (select id from public.clientes where id=p_customer union select c.id from public.clientes c join family x on c.merged_into=x.id)
 select coalesce(jsonb_agg(to_jsonb(q) order by q.uploaded_at desc,q.id desc),'[]'::jsonb) from (
 select f.*,a.customer_id,a.origin_ticket_id,a.current_file_id,a.purpose,(select to_jsonb(u) from public.dtg_asset_usages u where u.file_id=f.id and u.ticket_id=p_ticket) as usage from public.dtg_files f join public.dtg_assets a on a.id=f.asset_id
 where a.customer_id in(select id from family) and a.active and (p_before is null or (f.uploaded_at,f.id)<(p_before,coalesce(p_before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
 and (p_category='' or f.category=p_category) and (p_search='' or position(lower(p_search) in lower(f.filename))>0)
 and (p_ticket is null or exists(select 1 from public.dtg_asset_usages u where u.file_id=f.id and u.ticket_id=p_ticket))
 order by f.uploaded_at desc,f.id desc limit least(greatest(p_limit,1),50)) q;
$$;
