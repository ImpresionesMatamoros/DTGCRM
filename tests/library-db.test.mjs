import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const {PGlite}=await import(pathToFileURL(process.env.DTG_PGLITE_PATH).href);
test('client library scopes, keyset pagination, immutable versions, source RLS and hidden identities/capabilities',async()=>{
 const db=new PGlite();try{
 const source=await fs.readFile(new URL('./integrations-db.test.mjs',import.meta.url),'utf8');
 await db.exec(source.match(/await db.exec\(`([\s\S]*?)`\);/)[1]);
 await db.exec('alter table storage.objects add column updated_at timestamptz default now(); alter table storage.objects add column metadata jsonb;');
 await db.exec(await fs.readFile(new URL('../supabase/migrations/20261005020449_google_workspace_integration_layer.sql',import.meta.url),'utf8'));
 await db.exec(await fs.readFile(new URL('../supabase/migrations/20261007013043_client_drive_library.sql',import.meta.url),'utf8'));
 await db.exec(await fs.readFile(new URL('../supabase/migrations/20261007014531_library_pilot_checks.sql',import.meta.url),'utf8'));
 await db.exec(await fs.readFile(new URL('../supabase/migrations/20261007014711_library_client_merge_history.sql',import.meta.url),'utf8'));
 const actor=crypto.randomUUID(),other=crypto.randomUUID(),inactive=crypto.randomUUID(),customer=crypto.randomUUID(),ticket=crypto.randomUUID();
 await db.query("insert into profiles values($1,'admin',true),($2,'member',true),($3,'member',false)",[actor,other,inactive]);await db.query('insert into clientes(id)values($1)',[customer]);await db.query('insert into tickets(id,cliente_id,owner_id)values($1,$2,$3)',[ticket,customer,actor]);
 async function reserve(ticketId,asset=null,name='logo.pdf'){
  const key=crypto.randomUUID(),file=crypto.randomUUID(),meta={filename:name,mime_type:'application/pdf',size_bytes:100,drive_file_id:'drive-'+file,drive_parent_id:'parent',source_sha256:'a'.repeat(64),category:'pdf',purpose:'reference'};
  await db.exec('set role service_role');const r=(await db.query('select to_jsonb(public.dtg_library_register_upload($1,$2,$3,$4,$5,$6,$7,$8)) as s',[actor,key,ticketId,customer,asset,file,meta,{direct_transfer:true}])).rows[0].s;
  const repeat=(await db.query('select to_jsonb(public.dtg_library_register_upload($1,$2,$3,$4,$5,$6,$7,$8)) as s',[actor,key,ticketId,customer,asset,file,meta,{direct_transfer:true}])).rows[0].s;assert.equal(r.id,repeat.id);
  await db.query('select public.dtg_finalize_upload($1,$2)',[r.id,'md5']);await db.exec('reset role');return (await db.query('select * from dtg_files where id=$1',[file])).rows[0];
 }
 const general=await reserve(null),privateFile=await reserve(ticket),v2=await reserve(null,general.asset_id,'logo-v2.pdf');assert.equal(v2.version,2);assert.equal((await db.query('select count(*)::int n from dtg_asset_usages')).rows[0].n,1);
 await db.query("insert into dtg_library_identities(actor_id,google_sub,google_email)values($1,'actor-google','actor@956print.com'),($2,'other-google','other@956print.com')",[actor,other]);
 async function as(id){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');}
 await as(other);assert.equal((await db.query('select count(*)::int n from dtg_files')).rows[0].n,2);assert.equal((await db.query('select count(*)::int n from dtg_upload_sessions')).rows[0].n,0);assert.equal((await db.query('select count(*)::int n from dtg_library_identities')).rows[0].n,1);
 assert.equal((await db.query('select public.dtg_library_list($1) as files',[customer])).rows[0].files.length,2);
 for(const t of ['dtg_library_folders','dtg_library_grants','dtg_image_derivatives','dtg_integration_private'])await assert.rejects(db.query('select * from '+t),/permission denied/);
 await assert.rejects(db.query('select public.dtg_library_register_upload($1,$2,null,$3,null,$4,$5,$6)',[other,crypto.randomUUID(),customer,crypto.randomUUID(),{},{}]),/permission denied/);
 await as(inactive);assert.equal((await db.query('select count(*)::int n from dtg_files')).rows[0].n,0);await db.exec('reset role');
 for(let i=0;i<51;i++)await reserve(null,null,'page-'+i+'.pdf');await as(actor);
 const first=(await db.query('select dtg_library_list($1,null,null,$2,$3,50) as files',[customer,'page-','pdf'])).rows[0].files;assert.equal(first.length,50);const last=first.at(-1);const second=(await db.query('select dtg_library_list($1,$2,$3,$4,$5,50) as files',[customer,last.uploaded_at,last.id,'page-','pdf'])).rows[0].files;assert.equal(second.length,1);assert.equal(new Set([...first,...second].map(f=>f.id)).size,51);
 const scoped=(await db.query('select dtg_library_list($1,null,null,$2,$3,50,$4) as files',[customer,'','',ticket])).rows[0].files;assert.equal(scoped.length,1);assert.equal(scoped[0].id,privateFile.id);
 await db.exec('reset role');
 await db.query("insert into dtg_library_grants values($1,$2,'other@956print.com','permission-private',now()+interval '1 hour'),($3,$2,'other@956print.com','permission-general',now()+interval '1 hour'),($3,$4,'inactive@956print.com','permission-inactive',now()+interval '1 hour')",[privateFile.id,other,general.id,inactive]);
 await db.exec('set role service_role');const revoke=(await db.query('select dtg_library_grants_to_revoke() as r')).rows[0].r;assert.deepEqual(revoke.map(x=>x.permission_id).sort(),['permission-inactive','permission-private']);await db.exec('reset role');
 const merged=crypto.randomUUID();await db.query('insert into clientes(id)values($1)',[merged]);await db.query('update clientes set merged_into=$1 where id=$2',[merged,customer]);await as(other);const history=(await db.query('select dtg_library_list($1,null,null,$2) as files',[merged,'logo'])).rows[0].files;assert.equal(history.length,2);await db.exec('reset role');
 const rls=await db.query("select relname from pg_class where relnamespace='public'::regnamespace and relname like 'dtg_%' and relkind='r' and not relrowsecurity");assert.deepEqual(rls.rows,[]);
 }finally{await db.close();}
});
