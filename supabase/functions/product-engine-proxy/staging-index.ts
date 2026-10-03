// Dedicated shared-project laboratory entrypoint; original proxy handle is retained.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { handle } from './handler.js';
import { PROJECT_REF,PROJECT_URL,runtimeConfig } from './runtime-config.ts';
Deno.serve(async(req:Request)=>{
 const env={...Deno.env.toObject(),DTG_ENVIRONMENT:'staging',STAGING_CRM_PROJECT_REF:PROJECT_REF,STAGING_PE_ORIGIN:PROJECT_URL,STAGING_DATABASE_ISOLATION:'shared-staging-project',STAGING_PE_SCHEMA:'dtg_pe',PRODUCT_ENGINE_BASE_URL:PROJECT_URL+'/functions/v1/product-engine',PRODUCT_ENGINE_TIMEOUT_MS:'10000'};
 try{if(req.method==='POST'&&req.headers.get('Authorization'))env.PRODUCT_ENGINE_API_TOKEN=(await runtimeConfig()).token;}catch{return new Response(JSON.stringify({error:{code:'PE_NOT_CONFIGURED',message:'Catálogo no disponible'}}),{status:503,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});}
 return handle(req,{env,verifyUser:async(token:string)=>{
  if(Deno.env.get('SUPABASE_URL')!==PROJECT_URL)return false;
  const key=Deno.env.get('SUPABASE_ANON_KEY');if(!key)return false;
  const sb=createClient(PROJECT_URL,key,{global:{headers:{Authorization:'Bearer '+token}}});
  const {data,error}=await sb.auth.getUser(token);if(error||!data.user)return false;
  const active=await sb.rpc('is_active_member');return !active.error&&active.data===true;
 }});
});
