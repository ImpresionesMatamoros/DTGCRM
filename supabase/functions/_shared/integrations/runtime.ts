import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { IntegrationService } from './service.mjs';
import { IntegrationWorker } from './worker.mjs';
import { Store, SupabaseStorageAdapter } from './store.mjs';
import { IntegrationError, fail, crmOrigins } from './core.mjs';
import { readLimited } from './google.mjs';

export function environment() {
  return Object.fromEntries(['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','INTEGRATION_ENCRYPTION_KEY',
    'GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GOOGLE_REDIRECT_URI','GOOGLE_DRIVE_PARENT_ID','INTEGRATION_WORKER_SECRET','CRM_ORIGIN','CRM_ORIGINS'].map(k=>[k,Deno.env.get(k)||'']));
}
export function cors(req: Request, env: Record<string,string>) {
  const origin=req.headers.get('origin');
  const allowed=crmOrigins(env);
  if(origin && !allowed.includes(origin)) fail('ORIGIN_FORBIDDEN',403);
  return { 'Access-Control-Allow-Origin':origin||allowed[0]||'null','Access-Control-Allow-Headers':'authorization, apikey, x-client-info, content-type',
    'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Vary':'Origin','Cache-Control':'no-store','X-Content-Type-Options':'nosniff' };
}
export async function service(req: Request | null = null) {
  const env=environment();
  if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)fail('BACKEND_NOT_CONFIGURED',503);
  const adminClient=createClient(env.SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const admin=new Store(adminClient);
  try {const saved=await admin.rpc('dtg_workspace_secrets');for(const [key,value] of Object.entries(saved||{}))if(!env[key])env[key]=String(value);} catch {/* Additive deployment: absent Vault migration leaves environment setup usable. */}
  let user: Store | null=null,actor:string|null=null;
  if(req) {
    const bearer=req.headers.get('authorization')||'';
    if(!bearer.startsWith('Bearer ')||!env.SUPABASE_ANON_KEY)fail('AUTH_REQUIRED',401);
    const client=createClient(env.SUPABASE_URL,env.SUPABASE_ANON_KEY,{global:{headers:{Authorization:bearer}},auth:{persistSession:false,autoRefreshToken:false}});
    const auth=await client.auth.getUser(bearer.slice(7));if(auth.error||!auth.data.user)fail('AUTH_REQUIRED',401);
    user=new Store(client);actor=auth.data.user!.id;
    if(!await user.rpc('is_active_member'))fail('FORBIDDEN',403);
  }
  return new IntegrationService({admin,user,actor,storage:new SupabaseStorageAdapter(adminClient),env});
}
export async function jsonBody(req: Request, limit=150000) {
  const bytes=await readLimited(req,limit);
  try{return JSON.parse(new TextDecoder().decode(bytes));}catch{fail('INVALID_JSON');}
}
export function errorReply(err: unknown, headers: Record<string,string> = {}) {
  const known=err instanceof IntegrationError;
  // Never log provider bodies, tokens, SQL errors, signed links or request payloads.
  console.error('[dtg-integrations]',known?err.code:'INTERNAL_ERROR');
  return Response.json({error:known?err.code:'INTERNAL_ERROR'}, {status:known?err.status:500,headers});
}
export { IntegrationWorker };
