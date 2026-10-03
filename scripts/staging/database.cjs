const fs=require('fs'),path=require('path');const {Client}=require('pg');const {config,confirm,connection}=require('./config.cjs');
async function main(){
 const c=config();confirm(c);const mode=process.argv[2]||'preflight';
 if(!['preflight','apply-baseline','init-identity','apply-step10','seed'].includes(mode))throw Error('No reset or clone command is provided');
 const db=new Client({connectionString:connection(process.env.STAGING_DATABASE_URL,c.crmProjectRef),ssl:{rejectUnauthorized:true}});await db.connect();
 try{
  if(mode==='apply-baseline'){
   if(process.env.STAGING_SCHEMA_REVIEWED!=='true')throw Error('Reviewed staging baseline requires STAGING_SCHEMA_REVIEWED=true');
   const occupied=await db.query("select count(*)::int as n from pg_tables where schemaname='public'");
   if(occupied.rows[0].n)throw Error('Baseline requires an empty public schema; no existing table is replaced');
   const users=await db.query('select count(*)::int as n from auth.users');
   if(users.rows[0].n)throw Error('Baseline requires an empty staging Auth instance');
   await db.query('begin');try{await db.query(fs.readFileSync(path.resolve(__dirname,'../../staging/crm-baseline.sql'),'utf8'));await db.query('commit');}catch(e){await db.query('rollback');throw e;}
   console.log('STAGING baseline applied to confirmed isolated project; no production data copied.');return;
  }
  const required=['tickets','productos','tareas','pagos','bitacora','profiles','clientes','app_settings','documentos','team_posts','chat_conversations','client_notes','client_tasks'];
  const found=await db.query("select tablename from pg_tables where schemaname='public'");const absent=required.filter(t=>!found.rows.some(r=>r.tablename===t));if(absent.length)throw Error('OWNER ACTION REQUIRED: reviewed complete baseline missing ('+absent.join(', ')+')');
  const senders=await db.query("select t.tgname from pg_trigger t join pg_proc p on p.oid=t.tgfoid where not t.tgisinternal and t.tgenabled<>'D' and (p.proname like '%push_webhook%' or p.prosrc ~* 'net[.]http|http_post|http_get')");
  if(senders.rows.length)throw Error('Enabled outbound DB triggers must be disabled in staging baseline');
  const jobs=await db.query("select to_regclass('cron.job') as table_name");if(jobs.rows[0].table_name){const active=await db.query('select count(*)::int as n from cron.job where active');if(active.rows[0].n)throw Error('Active cron jobs forbidden in staging');}
  const vault=await db.query("select to_regclass('vault.secrets') as table_name");if(vault.rows[0].table_name){const names=(await db.query('select name from vault.secrets')).rows.map(r=>r.name);const allowed=c.databaseIsolation==='shared-staging-project'?['staging_pe_db_password','staging_pe_api_token']:[];if(names.some(n=>!allowed.includes(n))||new Set(names).size!==names.length)throw Error('Unexpected Vault secrets: production webhook/VAPID secrets are forbidden');}
  const subscriptions=await db.query("select to_regclass('public.push_subscriptions') as table_name");if(subscriptions.rows[0].table_name){const count=await db.query('select count(*)::int as n from public.push_subscriptions');if(count.rows[0].n)throw Error('Push subscriptions forbidden in staging');}
  if(mode==='init-identity'){
   if(process.env.STAGING_SCHEMA_REVIEWED!=='true')throw Error('Owner must review baseline and set STAGING_SCHEMA_REVIEWED=true');
   for(const table of ['tickets','clientes','profiles','team_posts']){const count=await db.query('select count(*)::int as n from public.'+table);if(count.rows[0].n)throw Error('Initial staging must have no customers, tickets, profiles or conversations');}
   await db.query('begin');
   await db.query("create schema if not exists staging_private; revoke all on schema staging_private from public,anon,authenticated; create table if not exists staging_private.identity (singleton boolean primary key default true check(singleton), environment text not null check(environment='staging'), project_ref text not null)");
   await db.query("insert into staging_private.identity(singleton,environment,project_ref) values(true,'staging',$1) on conflict(singleton) do nothing",[c.crmProjectRef]);
   await db.query('commit');
  }
  const identity=await db.query('select environment,project_ref from staging_private.identity where singleton');if(identity.rows.length!==1||identity.rows[0].environment!=='staging'||identity.rows[0].project_ref!==c.crmProjectRef)throw Error('Staging DB identity absent or mismatched');
  if(mode==='apply-step10'){
   // Owner baseline is current CRM schema WITHOUT STEP 10. Never replay incremental history blindly.
   await db.query('begin');try{await db.query(fs.readFileSync(path.resolve(__dirname,'../../supabase/migrations/20261003000000_product_engine_line_snapshot.sql'),'utf8'));await db.query('commit');}catch(e){await db.query('rollback');throw e;}
  }
  if(mode==='seed'){
   await db.query('begin');try{await db.query(fs.readFileSync(path.resolve(__dirname,'../../staging/fixtures.sql'),'utf8'));await db.query('commit');}catch(e){await db.query('rollback');throw e;}
  }
  console.log('STAGING database '+mode+' PASS; target identity verified; no production data copied.');
 }finally{await db.end();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
