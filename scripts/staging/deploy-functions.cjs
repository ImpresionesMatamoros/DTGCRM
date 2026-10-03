const fs=require('fs'),path=require('path'),os=require('os'),cp=require('child_process');
const {config,confirm}=require('./config.cjs');
const root=path.resolve(__dirname,'../..');
function deploy(){
 const c=config();confirm(c);
 if(!process.env.SUPABASE_ACCESS_TOKEN)throw Error('A scoped staging-only Supabase access token is required');
 const pe=new URL(process.env.STAGING_PE_BASE_URL||'');if(pe.origin!==new URL(c.productEngineUrl).origin||pe.href!==new URL(c.productEngineUrl).href)throw Error('PE URL must match reviewed configuration');
 const shared=c.databaseIsolation==='shared-staging-project';
 const token=process.env.STAGING_PE_API_TOKEN;if(!shared&&(!token||token.length<32||/OWNER_|REPLACE_/.test(token)))throw Error('New staging-only PE token (32+ characters) required');
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'dtg-staging-functions-'));
 try{
  fs.mkdirSync(path.join(temp,'supabase/functions'),{recursive:true});
  fs.cpSync(path.join(root,'supabase/functions/product-engine-proxy'),path.join(temp,'supabase/functions/product-engine-proxy'),{recursive:true});
  if(shared){
   if(c.crmProjectRef!=='hhzqmqndavqqswerjhxe')throw Error('Shared runtime is pinned to the reviewed staging project');
   cp.execFileSync(process.execPath,[path.join(root,'scripts/staging/build-engine.cjs')],{cwd:root,stdio:'pipe'});
   fs.cpSync(path.join(root,'supabase/functions/product-engine'),path.join(temp,'supabase/functions/product-engine'),{recursive:true});
   fs.copyFileSync(path.join(root,'supabase/functions/product-engine-proxy/staging-index.ts'),path.join(temp,'supabase/functions/product-engine-proxy/index.ts'));
  }
  for(const name of ['push-fanout','transcribe-chat-audio']){fs.mkdirSync(path.join(temp,'supabase/functions',name));fs.copyFileSync(path.join(root,'staging/blocked-function.ts'),path.join(temp,'supabase/functions',name,'index.ts'));}
  fs.writeFileSync(path.join(temp,'supabase/config.toml'),'project_id = "dtg-crm-staging"\n'+(shared?'[functions.product-engine]\nverify_jwt = false\nimport_map = "./functions/product-engine/deno.json"\n':''));
  const vars={DTG_ENVIRONMENT:'staging',STAGING_CRM_PROJECT_REF:c.crmProjectRef,STAGING_PE_ORIGIN:new URL(c.productEngineUrl).origin,PRODUCT_ENGINE_BASE_URL:c.productEngineUrl,PRODUCT_ENGINE_API_TOKEN:token,PRODUCT_ENGINE_TIMEOUT_MS:'4000'};
  if(Object.values(vars).some(v=>/[\r\n]/.test(v)))throw Error('Invalid secret format');
  const secretFile=path.join(temp,'secrets.env');if(!shared)fs.writeFileSync(secretFile,Object.entries(vars).map(([k,v])=>k+'='+v).join('\n'),{mode:0o600});
  const cli=process.env.SUPABASE_CLI||'supabase';
  if(!shared){cp.execFileSync(cli,['secrets','set','--project-ref',c.crmProjectRef,'--env-file',secretFile],{cwd:temp,stdio:'pipe'});fs.unlinkSync(secretFile);}
  for(const name of [...shared?['product-engine']:[],'product-engine-proxy','push-fanout','transcribe-chat-audio'])cp.execFileSync(cli,['functions','deploy',name,'--project-ref',c.crmProjectRef,'--use-api'],{cwd:temp,stdio:'pipe'});
  console.log('STAGING: proxy plus two disabled stubs deployed. No production ref or sender function used.');
 }finally{if(!path.resolve(temp).startsWith(path.resolve(os.tmpdir())+path.sep+'dtg-staging-functions-'))throw Error('Temporary cleanup path refused');fs.rmSync(temp,{recursive:true,force:true});}
}
if(require.main===module){try{deploy();}catch(e){console.error('STAGING deployment failed: '+(e.status?'CLI failed; inspect staging-only logs':e.message));process.exitCode=1;}}
module.exports={deploy};
