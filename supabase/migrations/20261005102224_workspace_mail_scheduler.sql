-- Quiet while OFF; Vault credential stays out of the cron command and logs.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net;
select cron.schedule('dtg-workspace-worker','* * * * *',$job$
 select net.http_post(
  url:=(select decrypted_secret from vault.decrypted_secrets where name='dtg_workspace_SUPABASE_URL') || '/functions/v1/integration-worker',
  headers:=jsonb_build_object('Content-Type','application/json','x-dtg-worker-secret',(select decrypted_secret from vault.decrypted_secrets where name='dtg_workspace_INTEGRATION_WORKER_SECRET')),
  body:='{}'::jsonb,timeout_milliseconds:=60000
 ) from public.dtg_integration_config c
 where c.enabled and exists(select 1 from public.dtg_google_connections where state='connected')
 and exists(select 1 from vault.secrets where name='dtg_workspace_SUPABASE_URL')
 and exists(select 1 from vault.secrets where name='dtg_workspace_INTEGRATION_WORKER_SECRET');
$job$);
