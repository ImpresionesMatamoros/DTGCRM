-- Operational activation only; run as database owner after OAuth and a verified test setup.
-- Install pg_cron + pg_net using Supabase Extensions beforehand.
-- Create the two Vault secrets via the Dashboard, not plaintext migration files:
-- dtg_workspace_project_url = this project's https://<ref>.supabase.co
-- dtg_workspace_worker_secret = SAME value as Edge INTEGRATION_WORKER_SECRET
begin;
do $$ begin
 if not exists(select 1 from pg_extension where extname='pg_cron') or not exists(select 1 from pg_extension where extname='pg_net') then raise exception 'Enable pg_cron and pg_net first'; end if;
 if (select count(*) from vault.decrypted_secrets where name in ('dtg_workspace_project_url','dtg_workspace_worker_secret') and length(decrypted_secret)>0)<>2 then raise exception 'Worker Vault configuration missing or duplicate'; end if;
end $$;
select cron.schedule('dtg-workspace-worker','* * * * *',$job$
 select net.http_post(
  url := (select decrypted_secret from vault.decrypted_secrets where name='dtg_workspace_project_url') || '/functions/v1/integration-worker',
  headers := jsonb_build_object('Content-Type','application/json','x-dtg-worker-secret',(select decrypted_secret from vault.decrypted_secrets where name='dtg_workspace_worker_secret')),
  body := '{}'::jsonb, timeout_milliseconds := 60000
 ) from public.dtg_integration_config c
 where c.enabled and exists(select 1 from public.dtg_google_connections where state='connected');
$job$);
commit;
-- Pause without losing queued operations:
-- select cron.unschedule('dtg-workspace-worker');
