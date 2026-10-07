import {service,errorReply} from '../_shared/integrations/runtime.ts';
import {fail} from '../_shared/integrations/core.mjs';
import {readLimited} from '../_shared/integrations/google.mjs';
const bucket='dtg-client-form-files',hex=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
Deno.serve(async req=>{
 const origin=req.headers.get('origin')||'',allowed=['https://956print.com','https://www.956print.com','https://crm.956print.com'];
 const headers={'Access-Control-Allow-Origin':allowed.includes(origin)?origin:allowed[0],'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS','Vary':'Origin','Cache-Control':'no-store'};
 const reply=(value:unknown,status=200)=>Response.json(value,{status,headers});
 try{
  if(origin&&!allowed.includes(origin))fail('ORIGIN_FORBIDDEN',403);
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(req.method!=='POST')fail('METHOD_NOT_ALLOWED',405);
  const isMultipart=(req.headers.get('content-type')||'').startsWith('multipart/form-data');
  const bytes=await readLimited(req,isMultipart?21*1024*1024:4096);
  const form=isMultipart?await new Request(req.url,{method:'POST',headers:{'Content-Type':req.headers.get('content-type')!},body:bytes}).formData():null;
  const data=form?{token:String(form.get('token')||''),batch:String(form.get('batch')||''),action:'upload'}:JSON.parse(new TextDecoder().decode(bytes));
  const s=await service(data.staff?req:null);
  let r;
  if(data.staff){
   r=await s.user!.one('client_form_requests',[['id','eq',data.request_id]],'id,ticket_id');if(!r)fail('FORM_UNAVAILABLE',404);await s.ticket(r.ticket_id);
  }else{
   if(typeof data.token!=='string'||!/^[a-f0-9]{64}$/.test(data.token))fail('FORM_UNAVAILABLE',404);
   r=await s.admin.one('client_form_requests',[['token_hash','eq',await hex(new TextEncoder().encode(data.token))]]);
   if(!r||r.revoked_at||Date.parse(r.expires_at)<=Date.now()||!r.order_snapshot)fail('FORM_UNAVAILABLE',404);
  }
  const batches=await s.admin.list('client_form_file_batches',[['request_id','eq',r.id],['state','eq','ready']]);
  const files=batches.flatMap((b:any)=>b.files.map((f:any,index:number)=>({...f,id:b.id+':'+index})));
  if(data.action==='list')return reply({files:files.map((f:any)=>({id:f.id,name:f.name,size:f.size,mime:f.mime}))});
  if(data.action==='download'){
   const file=files.find((f:any)=>f.id===data.file_id);if(!file)fail('FILE_UNAVAILABLE',404);
   return reply({url:await s.storage.signedUrl(bucket,file.path)});
  }
  if(data.staff||data.action!=='upload'||!form||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data.batch))fail('INVALID_REQUEST');
  const uploads=form.getAll('files').filter((f):f is File=>f instanceof File&&f.size>0);
  if(uploads.length<1||uploads.length>5||uploads.reduce((n,f)=>n+f.size,0)>20971520)fail('FILE_LIMIT',413);
  const manifest=[];
  for(const [i,file] of uploads.entries()){
   const ext=file.name.split('.').pop()?.toLowerCase(),mime=({pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp'} as any)[ext||''];
   if(!mime||file.type!==mime||file.name.length>180||/[\u0000-\u001f/\\]/.test(file.name))fail('INVALID_FILE',415);
   const head=new Uint8Array(await file.slice(0,12).arrayBuffer());
   const valid=ext==='pdf'?new TextDecoder().decode(head.slice(0,5))==='%PDF-':ext==='png'?[137,80,78,71,13,10,26,10].every((v,k)=>head[k]===v):ext==='webp'?new TextDecoder().decode(head.slice(0,4))==='RIFF'&&new TextDecoder().decode(head.slice(8,12))==='WEBP':head[0]===255&&head[1]===216&&head[2]===255;
   if(!valid)fail('INVALID_FILE',415);
   manifest.push({name:file.name,mime,size:file.size,sha256:await hex(new Uint8Array(await file.arrayBuffer())),path:r.id+'/'+data.batch+'/'+i+'.'+ext});
  }
  const reserve=await s.admin.client.rpc('client_form_reserve_files',{p_token:data.token,p_batch:data.batch,p_files:manifest,p_fingerprint:await hex(new TextEncoder().encode(JSON.stringify(manifest)))});
  if(reserve.error)fail(/FILE_LIMIT/.test(reserve.error.message)?'FILE_LIMIT':'UPLOAD_CONFLICT',409);
  for(const [i,file] of uploads.entries()){
   const result=await s.admin.client.storage.from(bucket).upload(manifest[i].path,file,{contentType:manifest[i].mime,upsert:false});
   if(result.error&&String(result.error.statusCode)!=='409')fail('UPLOAD_UNAVAILABLE',503);
  }
  await s.admin.update('client_form_file_batches',[['id','eq',data.batch],['request_id','eq',r.id]],{state:'ready'});
  return reply({received:manifest.length},201);
 }catch(e){return errorReply(e,headers);}
});
