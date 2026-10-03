create or replace function public.staging_engine_runtime_config() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from staging_private.identity where environment='staging' and project_ref='hhzqmqndavqqswerjhxe') then raise exception 'Staging identity mismatch'; end if;
 return jsonb_build_object('password',(select decrypted_secret from vault.decrypted_secrets where name='staging_pe_db_password'),'token',(select decrypted_secret from vault.decrypted_secrets where name='staging_pe_api_token'));
end $$;
revoke all on function public.staging_engine_runtime_config() from public,anon,authenticated;
grant execute on function public.staging_engine_runtime_config() to service_role;
