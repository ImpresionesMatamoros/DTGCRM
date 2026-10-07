import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { service, cors, errorReply, IntegrationWorker } from '../_shared/integrations/runtime.ts';
import { digest, fail } from '../_shared/integrations/core.mjs';
import { readLimited } from '../_shared/integrations/google.mjs';
const response=(body:unknown,status=200,headers:Record<string,string>={})=>Response.json(body,{status,headers:{'Cache-Control':'no-store',...headers}});
export const randomToken=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,'0')).join('');
export async function staff(req:Request){
 let headers:Record<string,string>={};
 try{
  headers=cors(req,{CRM_ORIGIN:'https://crm.956print.com'});
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(req.method!=='POST')fail('METHOD_NOT_ALLOWED',405);
  const s=await service(req),client=s.user.client;
  const d=JSON.parse(new TextDecoder().decode(await readLimited(req,8192)));
  if(d.action==='list'){
   const result=await client.from('dtg_website_requests').select('*').order('created_at',{ascending:false}).limit(100);
   if(result.error)fail('REQUESTS_UNAVAILABLE',503);
   // Old signed links are never trusted as the download interface.
   return response({requests:result.data.map((r:Record<string,unknown>)=>({...r,files:(r.files as Record<string,unknown>[]).map(({url,...f})=>f)}))},200,headers);
  }
  const r=await s.user.one('dtg_website_requests',[['reference','eq',d.reference]]);if(!r)fail('REQUEST_UNAVAILABLE',404);
  if(r.ticket_id)await s.ticket(r.ticket_id);
  if(d.action==='details'){
   const matches=await client.from('clientes').select('id,nombre,email,empresa').is('archived_at',null).is('merged_into',null).ilike('email',r.email.replace(/[%_]/g,'\\$&')).limit(20);
   const comments=await client.from('dtg_website_comments').select('id,body,created_at').eq('reference',r.reference).order('created_at');
   return response({customers:matches.data||[],comments:comments.data||[]},200,headers);
  }
  if(d.action==='convert'){
   const result=await client.rpc('dtg_review_website_request',{p_reference:r.reference,p_customer:d.customer_id||null,p_portal:d.portal===true});
   if(result.error) return response({error:/CHOOSE_EXISTING_CUSTOMER/.test(result.error.message)?'CHOOSE_EXISTING_CUSTOMER':/EMAIL_MISMATCH/.test(result.error.message)?'CUSTOMER_EMAIL_MISMATCH':'REVIEW_FAILED'},409,headers);
   return response(result.data,200,headers);
  }
  if(d.action==='status'){
   await s.requireAdmin();if(!['received','working','finished'].includes(d.status))fail('INVALID_STATUS');
   await s.user.update('dtg_website_requests',[['reference','eq',r.reference]],{status:d.status,updated_at:new Date().toISOString()});return response({ok:true},200,headers);
  }
  if(d.action==='file'){
   const file=r.files[Number(d.index)];if(!Number.isInteger(d.index)||!file)fail('FILE_UNAVAILABLE',404);
   return response({url:await s.storage.signedUrl('dtg-website-files',file.path)},200,headers);
  }
  fail('ACTION_UNAVAILABLE',404);
 }catch(e){return errorReply(e,headers);}
}

export async function portal(req:Request,s:any,config:any,path:string){
 const d=JSON.parse(new TextDecoder().decode(await readLimited(req,8192)));
 const client=createClient(s.env.SUPABASE_URL,s.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
 const action=path.split('/').pop();
 const activateActor=async()=>{const actor=await s.admin.one('profiles',[['id','eq',config.actor_id]]);if(!actor?.active||actor.role!=='admin')fail('AUTOMATION_UNAVAILABLE',503);s.actor=config.actor_id;s.user=s.admin;};
 const queue=async(to:string,subject:string,body:string,key:string)=>{await activateActor();const inbox=await s.admin.one('dtg_email_inboxes',[['email_alias','eq','hello@956print.com']]);if(!inbox)fail('CENTRAL_INBOX_UNAVAILABLE',503);const op=await s.sendEmail({inbox_id:inbox.id,to:[to],subject,body,idempotency_key:key});EdgeRuntime.waitUntil(new IntegrationWorker(s).run(op.operation_id));};
 if(action==='login'){
  if(typeof d.email!=='string'||d.email.length>254||!/^\S+@\S+\.\S+$/.test(d.email))fail('INVALID_EMAIL');
  const account=await s.admin.one('dtg_customer_portal_accounts',[['email','eq',d.email.trim().toLowerCase()],['active','eq',true]]);
  if(account){
   const recent=await client.from('dtg_customer_portal_tokens').select('token_hash').eq('account_id',account.id).eq('kind','login').gt('created_at',new Date(Date.now()-60000).toISOString()).limit(1);
   if(!recent.data?.length){
    const token=randomToken();await s.admin.insert('dtg_customer_portal_tokens',{token_hash:await digest(token),account_id:account.id,kind:'login',expires_at:new Date(Date.now()+15*60000).toISOString()});
    await queue(account.email,'Tu acceso a Design To Go',`Abre tu historial de proyectos:\nhttps://956print.com/account#${token}\n\nEl enlace funciona una sola vez y vence en 15 minutos. No lo compartas. Si no solicitaste acceso, ignora este mensaje.\n\nDesign To Go · 956print.com`,crypto.randomUUID());
   }
  }
  return response({sent:true},202);
 }
 if(action==='verify'){
  if(typeof d.token!=='string'||! /^[a-f0-9]{64}$/.test(d.token))fail('LOGIN_UNAVAILABLE',401);
  const session=randomToken();const result=await client.rpc('dtg_consume_portal_login',{p_hash:await digest(d.token),p_session:await digest(session)});
  if(result.error)fail('LOGIN_UNAVAILABLE',401);
  return response({session},200); // Worker sets an HttpOnly cookie and removes this field from public JSON.
 }
 if(typeof d.session!=='string'||! /^[a-f0-9]{64}$/.test(d.session))fail('AUTH_REQUIRED',401);
 const token=await s.admin.one('dtg_customer_portal_tokens',[['token_hash','eq',await digest(d.session)],['kind','eq','session']]);
 if(!token||token.used_at||Date.parse(token.expires_at)<=Date.now())fail('AUTH_REQUIRED',401);
 const account=await s.admin.one('dtg_customer_portal_accounts',[['id','eq',token.account_id],['active','eq',true]]);if(!account)fail('AUTH_REQUIRED',401);
 if(action==='logout'){await s.admin.update('dtg_customer_portal_tokens',[['token_hash','eq',token.token_hash]],{used_at:new Date().toISOString()});return response({ok:true});}
 const owned=async(reference:string)=>{const r=await s.admin.one('dtg_website_requests',[['reference','eq',reference],['customer_id','eq',account.customer_id],['email','eq',account.email],['disposition','eq','linked']]);if(!r)fail('PROJECT_UNAVAILABLE',404);return r;};
 if(action==='history'){
  const rows=await client.from('dtg_website_requests').select('reference,product,project,status,created_at,files,source_reference').eq('customer_id',account.customer_id).eq('email',account.email).eq('disposition','linked').order('created_at',{ascending:false}).limit(100);
  if(rows.error)fail('HISTORY_UNAVAILABLE',503);
  return response({email:account.email,projects:rows.data.map(r=>({...r,files:r.files.map((f:any,index:number)=>({index,name:f.name,size:f.size}))}))});
 }
 const r=await owned(d.reference);
 if(action==='file'){
  const file=r.files[d.index];if(!Number.isInteger(d.index)||!file)fail('FILE_UNAVAILABLE',404);
  return response({url:await s.storage.signedUrl('dtg-website-files',file.path)});
 }
 if(action==='comment'){
  if(typeof d.body!=='string'||!d.body.trim()||d.body.length>2000||! /^[0-9a-f-]{36}$/i.test(d.key))fail('INVALID_COMMENT');
  const old=await s.admin.one('dtg_website_comments',[['id','eq',d.key]]);if(old&&(old.account_id!==account.id||old.reference!==r.reference||old.body!==d.body.trim()))fail('IDEMPOTENCY_CONFLICT',409);
  const result=await client.from('dtg_website_comments').upsert({id:d.key,reference:r.reference,account_id:account.id,body:d.body.trim()},{onConflict:'id',ignoreDuplicates:true});if(result.error)fail('COMMENT_UNAVAILABLE',503);
  await queue('hello@956print.com',`Comentario del cliente · ${r.reference}`,`Cliente: ${account.email}\nReferencia: ${r.reference}\n\n${d.body.trim()}\n\nRevisar en Solicitudes web del CRM.`,d.key);return response({ok:true},201);
 }
 if(action==='reorder'){
  if(typeof d.changes!=='string'||d.changes.length>2000||! /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(d.key))fail('INVALID_REORDER');
  const reference='DTG-'+d.key.toUpperCase();const fingerprint=await digest(JSON.stringify({source:r.reference,account:account.id,changes:d.changes.trim()}));
  const existing=await s.admin.one('dtg_website_requests',[['reference','eq',reference]]);if(existing&&existing.payload_hash!==fingerprint)fail('IDEMPOTENCY_CONFLICT',409);
  const project=`Repetir proyecto ${r.reference}.\n${r.project}\n\nCambios solicitados: ${d.changes.trim()||'Sin cambios indicados.'}`.slice(0,4000);
  if(!existing){const result=await client.from('dtg_website_requests').upsert({reference,payload_hash:fingerprint,name:r.name,email:account.email,phone:r.phone,product:r.product,project,language:r.language,files:r.files,source_reference:r.reference},{onConflict:'reference',ignoreDuplicates:true});if(result.error)fail('REQUEST_UNAVAILABLE',503);}
  const saved=await s.admin.one('dtg_website_requests',[['reference','eq',reference]]);if(saved.payload_hash!==fingerprint)fail('IDEMPOTENCY_CONFLICT',409);
  await queue('hello@956print.com',`Recompra solicitada · ${reference}`,`Cliente: ${account.email}\nNueva referencia: ${reference}\nProyecto anterior: ${r.reference}\n\n${project}\n\nRevisar en Solicitudes web del CRM. No reutilizar precio o fecha anteriores.`,d.key);
  const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(d.key+':customer')));const hex=Array.from(bytes,v=>v.toString(16).padStart(2,'0')).join('');const receiptKey=`${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
  await queue(account.email,`Solicitud recibida · ${reference}`,`Recibimos tu solicitud de repetir el proyecto ${r.reference}.\nReferencia: ${reference}\n\n${project}\n\nResponderemos normalmente en un día hábil. Confirmaremos nuevamente precio y fecha.\nhttps://956print.com/track?reference=${reference}`,receiptKey);
  return response({reference},201);
 }
 fail('ACTION_UNAVAILABLE',404);
}
