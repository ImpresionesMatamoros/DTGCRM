// Thin Edge hosting adapter. STEP 10 handlers, contracts and pricing are unchanged.
import { Pool } from 'npm:pg@8.23.0';
import { Buffer } from 'node:buffer';
import { listItems,getItem,resolve,authorize,errorResponse,jsonResponse,loadCatalogSnapshot,loadPresentations } from './engine.js';
import { PROJECT_REF,PROJECT_URL,runtimeConfig } from './runtime-config.ts';
(globalThis as any).Buffer=Buffer;
let pool:Pool|undefined;
async function database(password:string){
 if(pool)return pool;
 const raw=Deno.env.get('SUPABASE_DB_URL');if(!raw)throw Error('Database connection unavailable');
 const url=new URL(raw);
 const direct=url.hostname==='db.'+PROJECT_REF+'.supabase.co';
 const pooled=url.hostname.endsWith('.pooler.supabase.com')&&decodeURIComponent(url.username).endsWith('.'+PROJECT_REF);
 if(!direct&&!pooled)throw Error('Database destination refused');
 url.username=pooled?'dtg_pe_runtime.'+PROJECT_REF:'dtg_pe_runtime';url.password=password;
 url.searchParams.delete('sslmode');
 const candidate=new Pool({connectionString:url.toString(),max:2,connectionTimeoutMillis:5000,ssl:{rejectUnauthorized:true}});
 try{const check=await candidate.query('select current_user as role,current_schema() as schema');if(check.rows[0]?.role!=='dtg_pe_runtime'||check.rows[0]?.schema!=='dtg_pe')throw Error('Database role or schema mismatch');pool=candidate;return pool;}catch(e){await candidate.end();throw e;}
}
Deno.serve(async(req:Request)=>{
 try{
  if(Deno.env.get('SUPABASE_URL')!==PROJECT_URL)return errorResponse(503,'INTERNAL','Staging isolation required');
  const secrets=await runtimeConfig();
  const env={NODE_ENV:'production',PRODUCT_ENGINE_API_TOKENS:secrets.token};
  const denied=authorize(req,env);if(denied)return denied;
  const path=new URL(req.url).pathname.replace(/^\/product-engine(?=\/|$)/,'').replace(/^\/functions\/v1\/product-engine(?=\/|$)/,'');
  if(path==='/api/v1/health'&&req.method==='GET')return jsonResponse({service:'dtg-product-engine',status:'ok',environment:'staging'});
  const db=await database(secrets.password),deps={loadSnapshot:()=>loadCatalogSnapshot(db),loadPresentations:()=>loadPresentations(db),now:()=>new Date(),env};
  if(path==='/api/v1/catalog/items'&&req.method==='GET')return listItems(req,deps);
  const item=path.match(/^\/api\/v1\/catalog\/items\/([^/]+)$/);if(item&&req.method==='GET')return getItem(req,decodeURIComponent(item[1]),deps);
  if(path==='/api/v1/pricing/resolve'&&req.method==='POST')return resolve(req,deps);
  return new Response('Not found',{status:404});
 }catch(e){console.error('Staging engine unavailable:',e instanceof Error?e.message:'runtime error');return errorResponse(503,'INTERNAL','Staging engine unavailable');}
});
