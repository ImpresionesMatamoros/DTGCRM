// Local PostgreSQL-engine tests. Never connect to production.
// Install @electric-sql/pglite@0.3.14 in a scratch folder, set DTG_PGLITE_PATH
// to its absolute dist/index.js path, then node --test tests/integrations-db.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const {PGlite}=await import(process.env.DTG_PGLITE_PATH?pathToFileURL(process.env.DTG_PGLITE_PATH).href:'@electric-sql/pglite');

test('migration, RLS, atomic sessions, versions, job leases and hidden secrets in local PostgreSQL',async()=>{
  const db=new PGlite();
  try{
    await db.exec(`
      create role anon;create role authenticated;create role service_role bypassrls;
      create schema auth;create schema storage;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create table public.profiles(id uuid primary key,role text,active boolean);
      create table public.clientes(id uuid primary key,email text,merged_into uuid references public.clientes(id),archived_at timestamptz);
      create table public.tickets(id uuid primary key,cliente_id uuid references public.clientes(id),owner_id uuid references public.profiles(id));
      create table public.productos(id uuid primary key,ticket_id uuid references public.tickets(id));
      create function public.is_active_member() returns boolean language sql stable as $$select exists(select 1 from public.profiles where id=auth.uid() and active)$$;
      create function public.is_admin() returns boolean language sql stable as $$select exists(select 1 from public.profiles where id=auth.uid() and role='admin' and active)$$;
      create function public.ticket_is_visible_to_me(p_id uuid) returns boolean language sql stable as $$select exists(select 1 from public.tickets where id=p_id and owner_id=auth.uid())$$;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
      alter table storage.objects enable row level security;
      grant usage on schema public,auth,storage to authenticated,service_role,anon;
      grant select on public.profiles,public.clientes,public.tickets,public.productos,storage.objects to authenticated;
      grant all on all tables in schema public,storage to service_role;
    `);
    const sql=await fs.readFile(new URL('../supabase/migrations/20261005020449_google_workspace_integration_layer.sql',import.meta.url),'utf8');
    await db.exec(sql);
    const actor='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002',customer='20000000-0000-4000-8000-000000000001',ticket='30000000-0000-4000-8000-000000000001',newTicket='30000000-0000-4000-8000-000000000002',file='40000000-0000-4000-8000-000000000001',uploadKey='50000000-0000-4000-8000-000000000001';
    await db.query('insert into public.profiles values($1,\'admin\',true),($2,\'member\',true)',[actor,other]);
    await db.query('insert into public.clientes(id,email) values($1,\'client@example.com\')',[customer]);
    await db.query('insert into public.tickets values($1,$2,$3),($4,$2,$3)',[ticket,customer,actor,newTicket]);
    await db.exec('set role service_role');
    const meta={filename:'production.ai',mime_type:'application/postscript',size_bytes:500*1048576,purpose:'production_source',storage_provider:'GOOGLE_DRIVE',drive_file_id:'drive1'};
    const register=await db.query('select (public.dtg_register_upload($1,$2,$3,null,$4,$5::jsonb,$6::jsonb)).*',[actor,uploadKey,ticket,file,JSON.stringify(meta),'{}']);
    const session=register.rows[0];assert.equal(session.file_id,file);
    const again=await db.query('select (public.dtg_register_upload($1,$2,$3,null,$4,$5::jsonb,$6::jsonb)).*',[actor,uploadKey,ticket,crypto.randomUUID(),JSON.stringify(meta),'{}']);assert.equal(again.rows[0].id,session.id);
    assert.equal((await db.query('select count(*)::int as n from public.dtg_files')).rows[0].n,1);
    await db.query('select public.dtg_finalize_upload($1,\'checksum\')',[session.id]);
    const asset=(await db.query('select * from public.dtg_assets')).rows[0];assert.equal(asset.current_file_id,file);
    await db.query('insert into public.dtg_asset_usages(file_id,ticket_id,created_by) values($1,$2,$3)',[file,newTicket,actor]);
    assert.equal((await db.query('select count(*)::int as n from public.dtg_files')).rows[0].n,1);
    assert.equal((await db.query('select production_approved from public.dtg_asset_usages where ticket_id=$1',[newTicket])).rows[0].production_approved,false);
    const sessionClaim=await db.query('select * from public.dtg_claim_upload($1,$2)',[session.id,actor]);assert.equal(sessionClaim.rows.length,1);
    assert.equal((await db.query('select * from public.dtg_claim_upload($1,$2)',[session.id,actor])).rows.length,0);
    await db.query('insert into public.dtg_integration_private(key,encrypted_value,expires_at) values(\'oauth:test\',\'encrypted\',now()+interval \'1 minute\')');
    assert.equal((await db.query('select public.dtg_consume_oauth_state(\'oauth:test\') as value')).rows[0].value,'encrypted');
    assert.equal((await db.query('select public.dtg_consume_oauth_state(\'oauth:test\') as value')).rows[0].value,null);
    const ctx=(await db.query('select public.dtg_actor_context($1,$2) as value',[other,ticket])).rows[0].value;assert.equal(ctx.ticket_visible,false);assert.equal(ctx.active,true);
    const box=(await db.query('select id from public.dtg_email_inboxes limit 1')).rows[0].id;
    await db.query('insert into public.dtg_integration_jobs(actor_id,kind,scope_key,idempotency_key,payload) values($1,\'send_email\',\'gmail-send\',$2,\'{}\'),($1,\'send_email\',\'gmail-send\',$3,\'{}\')',[actor,crypto.randomUUID(),crypto.randomUUID()]);
    const job=(await db.query('select * from public.dtg_claim_job()')).rows[0];assert.equal(job.state,'running');assert.equal((await db.query('select * from public.dtg_claim_job()')).rows.length,0);
    await db.query('update public.dtg_integration_jobs set lease_until=now()-interval \'1 second\' where id=$1',[job.id]);
    assert.equal((await db.query('select * from public.dtg_claim_job()')).rows.length,1);
    await db.exec('reset role');
    await db.query('insert into storage.objects(bucket_id,name) values(\'dtg-previews\',\'preview1\')');
    await db.query('update public.dtg_files set thumbnail_path=\'preview1\' where id=$1',[file]);
    await db.query('select set_config(\'request.jwt.claim.sub\',$1,false)',[actor]);await db.exec('set role authenticated');
    assert.equal((await db.query('select * from public.dtg_files')).rows.length,1);assert.equal((await db.query('select * from storage.objects')).rows.length,1);
    await assert.rejects(db.query('select * from public.dtg_integration_private'),/permission denied/);
    await assert.rejects(db.query('select * from public.dtg_integration_jobs'),/permission denied/);
    await assert.rejects(db.query('select public.dtg_actor_context($1,$2)',[other,ticket]),/permission denied/);
    await assert.rejects(db.query('update public.dtg_files set stage=\'Print Ready\''),/permission denied/);
    await db.exec('reset role');await db.query('select set_config(\'request.jwt.claim.sub\',$1,false)',[other]);await db.exec('set role authenticated');
    assert.equal((await db.query('select * from public.dtg_files')).rows.length,0);assert.equal((await db.query('select * from public.dtg_assets')).rows.length,0);assert.equal((await db.query('select * from storage.objects')).rows.length,0);
    assert.equal((await db.query('select * from public.dtg_email_inboxes')).rows.length,0);
    await db.exec('reset role');await db.query('insert into public.dtg_email_inbox_access(inbox_id,user_id,can_read) values($1,$2,true)',[box,other]);await db.exec('set role authenticated');assert.equal((await db.query('select * from public.dtg_email_inboxes')).rows.length,1);
    await db.exec('reset role');
    const rls=await db.query("select relname from pg_class where relnamespace='public'::regnamespace and relname like 'dtg_%' and relkind='r' and not relrowsecurity");assert.deepEqual(rls.rows,[]);
  }finally{await db.close();}
});
