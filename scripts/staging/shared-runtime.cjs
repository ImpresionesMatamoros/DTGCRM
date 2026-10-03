// Creates fresh server credentials only once. Never resets or rotates an existing role.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),{Client}=require('pg');
const {config,confirm,connection}=require('./config.cjs');
async function main(){
 const c=config();confirm(c);if(c.databaseIsolation!=='shared-staging-project')throw Error('Shared staging mode required');
 const db=new Client({connectionString:connection(process.env.STAGING_DATABASE_URL,c.crmProjectRef),ssl:{rejectUnauthorized:true}});await db.connect();
 try{await db.query('begin');
 const identity=(await db.query('select environment,project_ref from staging_private.identity')).rows;
 if(identity.length!==1||identity[0].environment!=='staging'||identity[0].project_ref!==c.crmProjectRef)throw Error('Staging identity mismatch');
 if((await db.query("select 1 from pg_roles where rolname='dtg_pe_runtime'")).rowCount)throw Error('Runtime already exists; no credentials changed');
 if((await db.query("select 1 from vault.secrets where name in ('staging_pe_db_password','staging_pe_api_token')")).rowCount)throw Error('Existing secrets must be reviewed; no overwrite');
 const password=crypto.randomBytes(32).toString('hex'),token=crypto.randomBytes(32).toString('hex');
 await db.query("create role dtg_pe_runtime login noinherit nosuperuser nocreatedb nocreaterole noreplication password '"+password+"'");
 await db.query('grant connect on database postgres to dtg_pe_runtime');
 await db.query('alter role dtg_pe_runtime set search_path=dtg_pe,extensions,pg_catalog');
 await db.query('select vault.create_secret($1,$2)',[password,'staging_pe_db_password']);
 await db.query('select vault.create_secret($1,$2)',[token,'staging_pe_api_token']);
 await db.query(fs.readFileSync(path.resolve(__dirname,'../../staging/shared-engine-security.sql'),'utf8'));
 await db.query(fs.readFileSync(path.resolve(__dirname,'../../staging/shared-runtime-rpc.sql'),'utf8'));
 await db.query('commit');console.log('Fresh staging runtime provisioned; secrets remain in Vault, never printed.');
 }catch(e){await db.query('rollback');throw e;}finally{await db.end();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
