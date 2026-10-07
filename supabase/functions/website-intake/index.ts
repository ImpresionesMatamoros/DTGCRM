import { service, IntegrationWorker, errorReply } from '../_shared/integrations/runtime.ts';
import { digest, fail } from '../_shared/integrations/core.mjs';
import { readLimited } from '../_shared/integrations/google.mjs';
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { staff, portal } from './operations.ts';
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
async function operationKey(reference:string,role:string){const h=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(reference+':'+role))),v=>v.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;}
Deno.serve(async req=>{
 if(new URL(req.url).pathname.endsWith('/staff'))return staff(req);
 try{
  if(req.method!=='POST')fail('METHOD_NOT_ALLOWED',405);
  const s=await service(),config=await s.admin.one('dtg_website_gateway',[['id','eq',true]]);
  const token=req.headers.get('x-dtg-website-token')||'';
  if(!config||token.length<40||await digest(token)!==config.token_hash)fail('AUTH_REQUIRED',401);
  const path=new URL(req.url).pathname;
  if(path.includes('/portal/'))return await portal(req,s,config,path);
  if(path.endsWith('/track')){
   const data=JSON.parse(new TextDecoder().decode(await readLimited(req,2048)));
   if(typeof data.reference!=='string'||typeof data.email!=='string')fail('INVALID_REQUEST');
   const row=await s.admin.one('dtg_website_requests',[['reference','eq',data.reference.trim().toUpperCase()],['email','eq',data.email.trim().toLowerCase()]]);
   return row?reply({reference:row.reference,status:row.status,updated_at:row.updated_at}):reply({error:'not_found'},404);
  }
  const bytes=await readLimited(req,21*1024*1024);
  const form=await new Request(req.url,{method:'POST',headers:{'Content-Type':req.headers.get('Content-Type')||''},body:bytes}).formData();
  const d=JSON.parse(String(form.get('metadata')||''));
  if(!/^DTG-[0-9A-F-]{36}$/.test(d.reference)||!d.name||d.name.length>100||!/^\S+@\S+\.\S+$/.test(d.email)||d.email.length>254||!d.project||d.project.length>4000||!['en','es'].includes(d.language))fail('INVALID_REQUEST');
  d.email=d.email.trim().toLowerCase();
  const uploads=form.getAll('files').filter((v):v is File=>v instanceof File&&v.size>0);
  if(uploads.length>5||uploads.reduce((a,f)=>a+f.size,0)>20*1024*1024)fail('FILE_TOO_LARGE',413);
  const client=createClient(s.env.SUPABASE_URL,s.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
  const files=[];
  for(const [i,file] of uploads.entries()){
   const ext=file.name.split('.').pop()?.toLowerCase();const mime=({pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp'} as Record<string,string>)[ext||''];
   if(!mime||file.type!==mime)fail('INVALID_FILE',415);
   const head=new Uint8Array(await file.slice(0,12).arrayBuffer());
   const valid=ext==='pdf'?new TextDecoder().decode(head.slice(0,5))==='%PDF-':ext==='png'?[137,80,78,71,13,10,26,10].every((v,k)=>head[k]===v):ext==='webp'?new TextDecoder().decode(head.slice(0,4))==='RIFF'&&new TextDecoder().decode(head.slice(8,12))==='WEBP':head[0]===255&&head[1]===216&&head[2]===255;
   if(!valid)fail('INVALID_FILE',415);
   const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer())),v=>v.toString(16).padStart(2,'0')).join('');
   files.push({name:file.name.slice(0,180),size:file.size,mime,path:`${d.reference}/${i}-${hash}.${ext}`});
  }
  const payloadHash=await digest(JSON.stringify({name:d.name,email:d.email,phone:d.phone,product:d.product,project:d.project,language:d.language,files}));
  const old=await s.admin.one('dtg_website_requests',[['reference','eq',d.reference]]);
  if(old&&old.payload_hash!==payloadHash)fail('IDEMPOTENCY_CONFLICT',409);
  for(const [i,file] of uploads.entries()){
   const result=await client.storage.from('dtg-website-files').upload(files[i].path,file,{contentType:files[i].mime,upsert:false});
   if(result.error&&String(result.error.statusCode)!=='409')fail('FILE_STORAGE_FAILED',503);
  }
  const linked=await Promise.all(files.map(async f=>{const r=await client.storage.from('dtg-website-files').createSignedUrl(f.path,7*86400,{download:f.name});if(r.error)fail('FILE_LINK_FAILED',503);return {...f,url:r.data.signedUrl};}));
  if(!old){const r=await client.from('dtg_website_requests').upsert({reference:d.reference,payload_hash:payloadHash,name:d.name,email:d.email,phone:d.phone||'',product:d.product||'',project:d.project,language:d.language,files:linked},{onConflict:'reference',ignoreDuplicates:true});if(r.error)fail('REQUEST_STORAGE_FAILED',503);}
  const saved=await s.admin.one('dtg_website_requests',[['reference','eq',d.reference]]);if(!saved||saved.payload_hash!==payloadHash)fail('IDEMPOTENCY_CONFLICT',409);
  const actor=await s.admin.one('profiles',[['id','eq',config.actor_id]]);if(!actor?.active||actor.role!=='admin')fail('AUTOMATION_ACTOR_UNAVAILABLE',503);
  s.actor=config.actor_id;s.user=s.admin;
  const inbox=await s.admin.one('dtg_email_inboxes',[['email_alias','eq','hello@956print.com']]);if(!inbox)fail('CENTRAL_INBOX_UNAVAILABLE',503);
  const summary=`${d.product?d.product+'\n':''}${d.project}\n\n${files.length} ${d.language==='es'?'archivo(s) recibido(s)':'file(s) received'}`;
  const spanish=d.language==='es';
  const customerBody=spanish?`Hola ${d.name},\n\nRecibimos tu solicitud ${d.reference}.\n\nResumen:\n${summary}\n\nNuestro objetivo es responder en un día hábil. Esta confirmación no establece precio ni fecha de producción o entrega.\n\nPuedes responder a este correo o consultar https://956print.com/track?reference=${d.reference} usando tu correo.\n\nDesign To Go · 956print.com`:`Hi ${d.name},\n\nWe received your request ${d.reference}.\n\nSummary:\n${summary}\n\nWe aim to respond within one business day. This confirmation does not establish a price or production/delivery date.\n\nReply to this email or visit https://956print.com/track?reference=${d.reference} with your email.\n\nDesign To Go · 956print.com`;
  const signed=saved.files.map((f:{name:string,url:string})=>`${f.name}: ${f.url}`);
  const ops=[];
  ops.push(await s.sendEmail({inbox_id:inbox.id,to:[d.email],subject:`${spanish?'Solicitud recibida':'Request received'} · ${d.reference}`,body:customerBody,idempotency_key:await operationKey(d.reference,'customer')}));
  ops.push(await s.sendEmail({inbox_id:inbox.id,to:['hello@956print.com'],subject:`Solicitud web · ${d.reference}`,body:`Solicitud recibida desde 956print.com\n\nReferencia: ${d.reference}\nCliente: ${d.name}\nCorreo: ${d.email}\nTeléfono: ${d.phone||'No indicado'}\nIdioma: ${d.language}\n\n${summary}\n\nArchivos privados (enlaces válidos 7 días):\n${signed.join('\n')||'Sin archivos'}\n\nResponder al cliente: ${d.email}\nObjetivo de primera respuesta: un día hábil.\nCRM: https://crm.956print.com`,idempotency_key:await operationKey(d.reference,'staff')}));
  EdgeRuntime.waitUntil((async()=>{for(const op of ops)await new IntegrationWorker(s).run(op.operation_id);})());
  return reply({reference:d.reference,status:old?.status||'received',email:'queued'},201);
 }catch(e){return errorReply(e);}
});
