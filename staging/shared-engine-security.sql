-- Staging-only adapter; original PE migrations/business rules are unchanged.
do $$ declare f record; t record; begin
 if not exists(select 1 from staging_private.identity where environment='staging' and project_ref='hhzqmqndavqqswerjhxe') then raise exception 'Staging identity mismatch'; end if;
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='dtg_pe' and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e') loop
  execute format('alter function %s set search_path=dtg_pe,extensions,pg_catalog',f.signature);
 end loop;
 for t in select tablename from pg_tables where schemaname='dtg_pe' loop
  execute format('alter table dtg_pe.%I enable row level security',t.tablename);
  if exists(select 1 from pg_roles where rolname='dtg_pe_runtime') and not exists(select 1 from pg_policies where schemaname='dtg_pe' and tablename=t.tablename and policyname='pe_runtime_read') then
   execute format('create policy pe_runtime_read on dtg_pe.%I for select to dtg_pe_runtime using (true)',t.tablename);
  end if;
 end loop;
end $$;
revoke all on schema dtg_pe from public,anon,authenticated,service_role;
revoke all on all tables in schema dtg_pe from public,anon,authenticated,service_role;
revoke all on all functions in schema dtg_pe from public,anon,authenticated,service_role;
alter default privileges in schema dtg_pe revoke all on functions from public,anon,authenticated,service_role;
do $$ begin if exists(select 1 from pg_roles where rolname='dtg_pe_runtime') then
 grant usage on schema dtg_pe,extensions to dtg_pe_runtime;
 grant select on all tables in schema dtg_pe to dtg_pe_runtime;
 alter default privileges in schema dtg_pe grant select on tables to dtg_pe_runtime;
end if; end $$;

