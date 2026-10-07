alter table public.dtg_website_requests add column import_actor uuid references public.profiles(id), add column import_lease_until timestamptz;
create function public.dtg_claim_website_import(p_reference text) returns boolean language plpgsql security definer set search_path='' as $$
declare r public.dtg_website_requests%rowtype;
begin
 if not public.is_active_member() or not public.is_admin() then raise exception 'FORBIDDEN'; end if;
 select * into r from public.dtg_website_requests where reference=p_reference for update;
 if not found or r.ticket_id is null or not public.ticket_is_visible_to_me(r.ticket_id) then raise exception 'FORBIDDEN'; end if;
 if r.import_lease_until>now() or (r.import_actor is not null and r.import_actor<>auth.uid()) then raise exception 'IMPORT_BUSY_OR_OTHER_ACTOR'; end if;
 update public.dtg_website_requests set import_actor=auth.uid(),import_lease_until=now()+interval '3 minutes' where reference=p_reference;
 return true;
end $$;
revoke all on function public.dtg_claim_website_import(text) from public,anon;
grant execute on function public.dtg_claim_website_import(text) to authenticated;
