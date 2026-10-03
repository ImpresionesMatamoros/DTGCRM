// Remote adapter for the delivered PE schema. Does not change PE business logic.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),{Client}=require('pg');
const {config,connection}=require('./config.cjs');
async function main(){
 const c=config(),mode=process.argv[2]||'status';
 if(process.env.STAGING_CONFIRMED_PE_PROJECT_REF!==c.peProjectRef)throw Error('Explicit PE staging project confirmation required');
 if(!['status','migrate','seed'].includes(mode))throw Error('No remote reset/rebuild supported');
 const root=path.resolve(process.env.STAGING_PE_SOURCE||'');if(!process.env.STAGING_PE_SOURCE||!fs.existsSync(path.join(root,'src/api/crm-contracts.ts')))throw Error('STAGING_PE_SOURCE must point to delivered, reviewed STEP 10 engine');
 const client=new Client({connectionString:connection(process.env.STAGING_PE_DATABASE_URL,c.peProjectRef),ssl:{rejectUnauthorized:true}});await client.connect();
 try{
  if(mode==='status'){const r=await client.query("select to_regclass('public.schema_migrations') as t");console.log(r.rows[0].t?'PE migration ledger present':'PE staging schema not provisioned');return;}
  if(process.env.STAGING_PE_SCHEMA_REVIEWED!=='true')throw Error('Owner must review PE migrations and seeds before applying');
  const privateTable=await client.query("select to_regclass('staging_private.identity') as t");
  if(!privateTable.rows[0].t){
   const existing=await client.query("select count(*)::int as n from pg_tables where schemaname='public'");if(existing.rows[0].n)throw Error('PE adapter requires an empty project or matching staging identity');
   await client.query("create schema staging_private; revoke all on schema staging_private from public,anon,authenticated; create table staging_private.identity(project_ref text primary key,environment text not null check(environment='staging'))");
   await client.query("insert into staging_private.identity values($1,'staging')",[c.peProjectRef]);
  }
  const identity=await client.query('select project_ref,environment from staging_private.identity');if(identity.rows.length!==1||identity.rows[0].project_ref!==c.peProjectRef||identity.rows[0].environment!=='staging')throw Error('PE staging identity mismatch');
  await client.query('create table if not exists public.schema_migrations(version text primary key,checksum text not null,applied_at timestamptz not null default now())');
  const applied=new Map((await client.query('select version,checksum from public.schema_migrations')).rows.map(r=>[r.version,r.checksum]));
  if(mode==='seed'&&process.env.STAGING_PE_SEEDS_CONFIRMED!=='true')throw Error('Explicit reviewed catalogue seed confirmation required');
  const dir=path.join(root,'supabase',mode==='migrate'?'migrations':'seeds');
  for(const file of fs.readdirSync(dir).filter(f=>/^\d{4}_[a-z0-9_.]+\.sql$/.test(f)).sort()){
   const sql=fs.readFileSync(path.join(dir,file),'utf8'),hash=crypto.createHash('sha256').update(sql).digest('hex');
   if(mode==='migrate'&&applied.has(file)){if(applied.get(file)!==hash)throw Error('PE migration checksum mismatch');continue;}
   if(/net\.http|http_post|http_get|https?:\/\/[^'" ]+|COPY.*FROM|\\copy/i.test(sql))throw Error('PE SQL requires additional manual review for external references');
   await client.query('begin');try{await client.query(sql);if(mode==='migrate')await client.query('insert into public.schema_migrations(version,checksum) values($1,$2)',[file,hash]);await client.query('commit');}catch(e){await client.query('rollback');throw e;}
  }
  // PE tables are internal. Supabase Data API must not expose the master catalog DB.
  await client.query("revoke all on all tables in schema public from public,anon,authenticated; revoke all on all sequences in schema public from public,anon,authenticated; revoke all on all functions in schema public from public,anon,authenticated; alter default privileges in schema public revoke all on tables from public,anon,authenticated; alter default privileges in schema public revoke all on sequences from public,anon,authenticated; alter default privileges in schema public revoke all on functions from public,anon,authenticated");
  const tables=await client.query("select tablename from pg_tables where schemaname='public'");for(const row of tables.rows)await client.query('alter table public."'+row.tablename.replaceAll('"','""')+'" enable row level security');
  console.log('PE STAGING '+mode+' finished. No reset or production connection. Review the catalogue before declaring it ready.');
 }finally{await client.end();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
