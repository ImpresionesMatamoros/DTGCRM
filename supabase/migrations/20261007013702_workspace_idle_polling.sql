-- Automatic inbox sync is every five minutes; queued work remains eligible each minute.
alter table public.dtg_integration_config add column sync_interval_seconds integer not null default 300 check(sync_interval_seconds between 60 and 3600);
select cron.schedule('dtg-workspace-worker','* * * * *',$job$
 select net.http_post(
  url:=(select decrypted_secret from vault.decrypted_secrets where name='dtg_workspace_SUPABASE_URL') || '/functions/v1/integration-worker',
  headers:=jsonb_build_object('Content-Type','application/json','x-dtg-worker-secret',(select decrypted_secret from vault.decrypted_secrets where name='dtg_workspace_INTEGRATION_WORKER_SECRET')),
  body:='{}'::jsonb,timeout_milliseconds:=60000
 ) from public.dtg_integration_config c where c.enabled
 and exists(select 1 from public.dtg_google_connections where state='connected')
 and exists(select 1 from vault.secrets where name='dtg_workspace_SUPABASE_URL')
 and exists(select 1 from vault.secrets where name='dtg_workspace_INTEGRATION_WORKER_SECRET')
 and (
 exists(select 1 from public.dtg_integration_jobs j where (j.state in ('queued','retry') and j.next_attempt_at<=now()) or (j.state='running' and j.lease_until<now()))
 or exists(select 1 from public.dtg_vendor_grants g where g.managed and g.state in ('granted','revoke_pending') and g.expires_at<=now())
 or jsonb_array_length(public.dtg_library_grants_to_revoke())>0
 or exists(select 1 from public.dtg_google_connections g where g.state='connected' and (g.last_sync_at is null or g.last_sync_at<now()-make_interval(secs=>c.sync_interval_seconds)))
 );
$job$);
