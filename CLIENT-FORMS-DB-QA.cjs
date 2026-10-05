// Real PostgreSQL engine (PGlite); host auth/ticket helpers are fixture contracts.
const fs=require('fs'),assert=require('assert');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
(async()=>{const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth; create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table public.tickets(id uuid primary key,allowed uuid[]);
 create function public.is_active_member() returns boolean language sql as $$select auth.uid() in ('11111111-1111-4111-8111-111111111111'::uuid,'22222222-2222-4222-8222-222222222222'::uuid)$$;
 create function public.ticket_is_visible_to_me(p_id uuid) returns boolean language sql security definer as $$select auth.uid()=any(allowed) from public.tickets where id=p_id$$;
 insert into auth.users values('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');
 insert into tickets values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',array['11111111-1111-4111-8111-111111111111'::uuid]);
 grant usage on schema public,auth to anon,authenticated,service_role;
 `);
 // Apply the existing Integration Team migration first to verify coexistence.
 await db.exec(`create schema storage;
 create table profiles(id uuid primary key,role text,active boolean);
 create table clientes(id uuid primary key,email text,merged_into uuid references clientes(id),archived_at timestamptz);
 alter table tickets add column cliente_id uuid references clientes(id);
 create table productos(id uuid primary key,ticket_id uuid references tickets(id));
 create function public.is_admin() returns boolean language sql as $$select false$$;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
 alter table storage.objects enable row level security;
 grant usage on schema storage to anon,authenticated,service_role;`);
 await db.exec(fs.readFileSync(__dirname+'/supabase/migrations/20261005020449_google_workspace_integration_layer.sql','utf8'));
 const file=fs.readdirSync(__dirname+'/supabase/migrations').find(x=>x.endsWith('_client_request_forms.sql'));
 await db.exec(fs.readFileSync(__dirname+'/supabase/migrations/'+file,'utf8'));
 await db.exec(fs.readFileSync(__dirname+'/supabase/tests/client_forms_permissions_qa.sql','utf8'));
 await db.exec('begin');
 const user='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',ticket='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',submission='cccccccc-cccc-4ccc-8ccc-cccccccccccc',token='a'.repeat(64),renewed='b'.repeat(64);
 async function role(name,uid=''){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,true)",[uid]);await db.exec('set local role '+name);}
 async function scalar(sql,params=[]){return Object.values((await db.query(sql,params)).rows[0])[0];}
 async function denied(sql,params=[]){await db.exec('savepoint expected_denial');try{await db.query(sql,params);assert.fail('Access unexpectedly allowed: '+sql);}catch(e){if(e.code==='ERR_ASSERTION')throw e;}finally{await db.exec('rollback to savepoint expected_denial');}}
 await role('authenticated',user);
 const create="select public.client_form_create($1,$2,$3,'Pedido','Solo texto',array['description','quantity','email','delivery_date'],7)";
 assert.equal(await scalar(create,[id,ticket,token]),id);assert.equal(await scalar(create,[id,ticket,token]),id);
 assert.equal(await scalar('select count(id) from client_form_requests'),1);
 await denied('select token_hash from client_form_requests');
 await denied("insert into client_form_requests(id) values(gen_random_uuid())");
 await denied("update client_form_requests set title='Hijacked'");
 await role('authenticated',other);assert.equal(await scalar('select count(id) from client_form_requests'),0);
 await denied("select client_form_manage($1,'revoke')",[id]);await denied(create,['dddddddd-dddd-4ddd-8ddd-dddddddddddd',ticket,'d'.repeat(64)]);
 await role('anon');await denied('select id from client_form_requests');await denied(create,[id,ticket,token]);
 const get=t=>scalar('select client_form_get($1)',[t]);let r=await get(token);assert.deepEqual(Object.keys(r).sort(),['fields','instructions','state','title']);assert.equal(r.state,'open');assert.equal((await get('wrong')).state,'unavailable');
 const submit=(answers,key=submission,t=token)=>scalar('select client_form_submit($1,$2,$3)',[t,key,answers]);
 await denied('select client_form_submit($1,$2,$3)',[token,submission,{price:'99'}]);
 await denied('select client_form_submit($1,$2,$3)',[token,submission,{quantity:'-1'}]);
 await denied('select client_form_submit($1,$2,$3)',[token,submission,{delivery_date:'2026-02-30'}]);
 await denied('select client_form_submit($1,$2,$3)',[token,submission,{email:'bad'}]);
 await denied('select client_form_submit($1,$2,$3)',[token,submission,{description:'x'.repeat(2001)}]);
 await denied('select client_form_submit($1,$2,$3)',[token,submission,{description:42}]);
 assert.equal((await submit({description:'24 camisas',quantity:'24'})).state,'received');
 assert.equal((await submit({description:'24 camisas',quantity:'24'})).state,'received');
 assert.equal((await submit({description:'changed after network failure'})).state,'submitted');
 assert.equal((await submit({description:'overwrite'},'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')).state,'submitted');
 assert.deepEqual(await get(token),{state:'submitted'});
 await role('authenticated',user);assert.deepEqual(await scalar('select answers from client_form_requests where id=$1',[id]),{description:'24 camisas',quantity:'24'});
 assert.equal(await scalar("select client_form_manage($1,'review')",[id]),true);
 await denied("select client_form_manage($1,'renew',$2)",[id,renewed]);
 assert.equal(await scalar("select client_form_manage($1,'revoke')",[id]),true);
 await role('anon');assert.equal((await get(token)).state,'unavailable');
 await role('authenticated',user);const id2='ffffffff-ffff-4fff-8fff-ffffffffffff';await scalar(create,[id2,ticket,'c'.repeat(64)]);
 await scalar("select client_form_manage($1,'renew',$2)",[id2,renewed]);await role('anon');assert.equal((await get('c'.repeat(64))).state,'unavailable');assert.equal((await get(renewed)).state,'open');
 await role('postgres');await db.query("update client_form_requests set expires_at=now()-interval '1 minute' where id=$1",[id2]);await role('anon');assert.equal((await get(renewed)).state,'unavailable');assert.equal((await submit({description:'late'},submission,renewed)).state,'unavailable');
 await role('postgres');assert.equal(await scalar('select count(*) from tickets'),1);await db.exec('rollback');
 console.log('PASS PostgreSQL: both migrations coexist; hashed capability; RLS visible/hidden tickets; grants; create retry; validation; single immutable response; public whitelist; review; revoke; renewal; expiration; rollback. Host helpers mocked, no production database accessed.');
 }finally{await db.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
