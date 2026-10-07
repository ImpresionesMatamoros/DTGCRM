import { fail, uuid, text, email, header, selectStorage, digest, unseal } from './core.mjs';
import { eq } from './store.mjs';

const T = n => `dtg_${n}`;
const categories = ['logos','corel','pdf','fotos','recursos','otros'];
const instant = () => new Date().toISOString();
export function uploadURI(value) {
  let u; try { u=new URL(value); } catch { fail('INVALID_UPLOAD_SESSION',502); }
  if(u.origin!=='https://www.googleapis.com'||!u.pathname.startsWith('/upload/drive/')||!u.searchParams.has('upload_id'))fail('INVALID_UPLOAD_SESSION',502);
  return u.href;
}
export function categoryFor(name,mime) {
  const ext=name.split('.').pop().toLowerCase();
  return ext==='cdr'?'corel':ext==='pdf'?'pdf':mime.startsWith('image/')?'fotos':'otros';
}
export const libraryMethods = {
  async libraryReadiness() {
    await this.active();const g=await this.google(),id=await g.generateFileId();
    const bytes=new Uint8Array(262169);bytes.fill(37);let created=false,folder=null;
    try{
      const origin=(this.env.CRM_ORIGIN||'https://crm.956print.com').split(',')[0];
      folder=await g.generateFileId();await g.createFolder(folder,'DTG pilot temporary validation',null);
      const folderPermissions=(await g.listPermissions(folder)).permissions||[];
      if(folderPermissions.some(p=>p.role!=='owner'))fail('LIBRARY_FOLDER_SHARED',409);
      const uri=await g.beginUpload(id,'DTG-pilot-readiness.bin','application/octet-stream',bytes.length,folder,origin);
      const preflight=await this.fetcher(uri,{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'PUT','Access-Control-Request-Headers':'content-range,content-type'},signal:AbortSignal.timeout(20000)});
      const chunk=await this.fetcher(uri,{method:'PUT',headers:{Origin:origin,'Content-Type':'application/octet-stream','Content-Range':`bytes 0-262143/${bytes.length}`},body:bytes.subarray(0,262144),signal:AbortSignal.timeout(30000)});
      if(chunk.status!==308||chunk.headers.get('access-control-allow-origin')!==origin)fail('DIRECT_CHUNK_REJECTED',409);
      const confirmed=await g.uploadStatus(uri,bytes.length);
      if(confirmed.offset!==262144)fail('DIRECT_OFFSET_UNCONFIRMED',409);
      const response=await this.fetcher(uri,{method:'PUT',headers:{Origin:origin,'Content-Type':'application/octet-stream','Content-Range':`bytes 262144-${bytes.length-1}/${bytes.length}`},body:bytes.subarray(262144),signal:AbortSignal.timeout(30000)});
      if(!response.ok)fail('DIRECT_UPLOAD_REJECTED',409);created=true;
      const meta=await g.stat(id),copy=await g.download(id,300000);
      const quota=await g.drive('about?fields=storageQuota');
      const report={direct_upload_without_owner_token:true,private_folder:true,parent_verified:meta.parents?.includes(folder),chunk_status:chunk.status,confirmed_offset:confirmed.offset,chunk_cors_origin:chunk.headers.get('access-control-allow-origin'),exact_bytes:Number(meta.size)===bytes.length&&copy.length===bytes.length&&bytes.every((b,i)=>b===copy[i]),cors_preflight_status:preflight.status,cors_origin:preflight.headers.get('access-control-allow-origin'),cors_methods:preflight.headers.get('access-control-allow-methods'),cors_headers:preflight.headers.get('access-control-allow-headers'),cors_upload_origin:response.headers.get('access-control-allow-origin'),storage_quota:quota.storageQuota,checked_at:instant()};
      await this.audit('library.readiness',report);return report;
    }finally{try{if(created)await g.drive(`files/${encodeURIComponent(id)}`,{method:'DELETE'});}finally{if(folder)await g.drive(`files/${encodeURIComponent(folder)}`,{method:'DELETE'});}}
  },
  async libraryPolicy() { const c=await this.active();if(!c.library_enabled)fail('LIBRARY_DISABLED',409);return c; },
  async libraryCustomer(id) { const canonical=await this.admin.rpc('dtg_canonical_customer',{p_id:uuid(id)});const c=canonical&&await this.user.one('clientes',[eq('id',canonical)]);if(!c)fail('CUSTOMER_UNAVAILABLE',404);return c; },
  async libraryStatus() {
    const cfg=await this.policy(),identity=await this.user.one(T('library_identities'),[eq('actor_id',this.actor)]);
    return {enabled:!!cfg.library_enabled,identity:identity?{email:identity.google_email,verified_at:identity.verified_at}:null,max_file_bytes:cfg.max_file_bytes,domain:cfg.domain};
  },
  async configureLibrary(input) {
    await this.requireAdmin();if(typeof input.enabled!=='boolean')fail('INVALID_POLICY');
    if(input.enabled){await this.active();await this.google();}
    await this.admin.update(T('integration_config'),[eq('id',true)],{library_enabled:input.enabled});
    await this.audit('library.configuration',{enabled:input.enabled});return this.libraryStatus();
  },
  async beginLibraryIdentity() {
    const cfg=await this.libraryPolicy();
    if(!this.env.GOOGLE_CLIENT_ID||!this.env.GOOGLE_CLIENT_SECRET||!this.env.GOOGLE_REDIRECT_URI)fail('OAUTH_NOT_CONFIGURED',503);
    const state=crypto.randomUUID()+crypto.randomUUID(),verifier=crypto.randomUUID()+crypto.randomUUID();
    await this.privateSet(`oauth:${await digest(state)}`,{actor:this.actor,verifier,purpose:'library_identity'},new Date(Date.now()+600000).toISOString());
    const q=new URLSearchParams({client_id:this.env.GOOGLE_CLIENT_ID,redirect_uri:this.env.GOOGLE_REDIRECT_URI,response_type:'code',scope:'openid email',prompt:'select_account',state,hd:cfg.domain,code_challenge:await digest(verifier),code_challenge_method:'S256'});
    return {url:`https://accounts.google.com/o/oauth2/v2/auth?${q}`};
  },
  async finishLibraryIdentity(code,saved) {
    this.actor=saved.actor;
    const member=await this.admin.rpc('dtg_actor_context',{p_actor:this.actor});if(!member?.active)fail('FORBIDDEN',403);
    const cfg=await this.libraryPolicy();
    const r=await this.fetcher('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({code:text(code,2000,true),client_id:this.env.GOOGLE_CLIENT_ID,client_secret:this.env.GOOGLE_CLIENT_SECRET,redirect_uri:this.env.GOOGLE_REDIRECT_URI,code_verifier:saved.verifier,grant_type:'authorization_code'}),signal:AbortSignal.timeout(20000)});
    const tokens=await r.json();if(!r.ok||!tokens.access_token)fail('OAUTH_EXCHANGE_FAILED',409);
    const response=await this.fetcher('https://openidconnect.googleapis.com/v1/userinfo',{headers:{Authorization:`Bearer ${tokens.access_token}`},signal:AbortSignal.timeout(20000)});
    const p=await response.json();if(!response.ok||p.email_verified!==true||p.hd!==cfg.domain||email(p.email).split('@')[1]!==cfg.domain||!p.sub)fail('WORKSPACE_DOMAIN_MISMATCH',403);
    const old=await this.admin.one(T('library_identities'),[eq('actor_id',this.actor)]);
    // A different Workspace identity needs administrative reconciliation of old Drive grants.
    if(old&&old.google_sub!==p.sub)fail('LIBRARY_IDENTITY_CHANGE_REQUIRES_ADMIN',409);
    const occupied=await this.admin.one(T('library_identities'),[eq('google_sub',p.sub)]);if(occupied&&occupied.actor_id!==this.actor)fail('WORKSPACE_IDENTITY_IN_USE',409);
    await this.admin.upsert(T('library_identities'),{actor_id:this.actor,google_sub:p.sub,google_email:email(p.email),verified_at:instant()},'actor_id');
    await this.audit('library.identity_verified');return {state:'identity_verified'};
  },
  async libraryFolder(g,scope,name,parent,connection) {
    let folder=await this.admin.one(T('library_folders'),[eq('scope_key',scope)]);
    if(!folder)folder=await this.admin.rpc('dtg_library_folder',{p_scope:scope,p_drive:await g.generateFileId(),p_parent:parent,p_connection:connection});
    if(folder.connection_id!==connection||folder.parent_id!==parent)fail('LIBRARY_FOLDER_CONNECTION_CHANGED',409);
    let meta;try{meta=await g.stat(folder.drive_id);}catch(e){if(e.code!=='MISSING_EXTERNAL')throw e;}
    if(!meta){try{await g.createFolder(folder.drive_id,name,parent);}catch(e){if(!e.retryable&&e.status!==409)throw e;}meta=await g.stat(folder.drive_id);}
    if(meta.trashed||meta.mimeType!=='application/vnd.google-apps.folder'||(parent&&!(meta.parents||[]).includes(parent)))fail('LIBRARY_FOLDER_CHANGED',409);
    const permissions=(await g.listPermissions(folder.drive_id)).permissions||[];
    if(permissions.some(p=>p.role!=='owner'))fail('LIBRARY_FOLDER_SHARED',409);
    return folder.drive_id;
  },
  async libraryParent(customer,ticket=null) {
    const g=await this.google(),connection=await this.connection();
    const root=await this.libraryFolder(g,'root','DTG CRM — Clientes',null,connection.id);
    const client=await this.libraryFolder(g,`customer:${customer.id}`,`${text(customer.nombre||customer.name||'Cliente',100)} — ${customer.id.slice(0,8)}`,root,connection.id);
    return this.libraryFolder(g,ticket?`ticket:${ticket.id}`:`resources:${customer.id}`,ticket?`Trabajo ${ticket.seq||ticket.id.slice(0,8)}`:'Marca y recursos',client,connection.id);
  },
  async beginLibraryUpload(input) {
    const cfg=await this.libraryPolicy(),ticket=input.ticket_id?await this.ticket(input.ticket_id):null;
    const customer=await this.libraryCustomer(ticket?ticket.cliente_id:input.customer_id),key=uuid(input.idempotency_key);
    if(input.customer_id&&uuid(input.customer_id)!==customer.id)fail('CUSTOMER_MISMATCH',403);
    selectStorage(input,cfg); // retain strict size, filename and MIME checks; all library originals use Drive
    const filename=header(input.filename,240),mime=header(input.mime_type||'application/octet-stream',150),sha=String(input.source_sha256||'');
    if(!/^[a-f0-9]{64}$/.test(sha))fail('FILE_HASH_REQUIRED');
    const category=input.category||categoryFor(filename,mime);if(!categories.includes(category))fail('INVALID_CATEGORY');
    let asset=null;if(input.asset_id){asset=await this.user.one(T('assets'),[eq('id',uuid(input.asset_id))]);if(!asset||await this.admin.rpc('dtg_canonical_customer',{p_id:asset.customer_id})!==customer.id||asset.origin_ticket_id!==(ticket?.id||null))fail('ASSET_SCOPE_MISMATCH',403);}
    const existing=await this.admin.one(T('upload_sessions'),[eq('actor_id',this.actor),eq('idempotency_key',key)]);
    if(existing){const {f,a}=await this.file(existing.file_id);if(f.filename!==filename||Number(f.size_bytes)!==Number(input.size_bytes)||f.source_sha256!==sha||await this.admin.rpc('dtg_canonical_customer',{p_id:a.customer_id})!==customer.id||a.origin_ticket_id!==(ticket?.id||null)||(input.asset_id&&f.asset_id!==input.asset_id))fail('IDEMPOTENCY_CONFLICT',409);return this.publicSession(existing,f);}
    const parent=await this.libraryParent(customer,ticket),g=await this.google();
    const meta={filename,mime_type:mime,size_bytes:Number(input.size_bytes),purpose:text(input.purpose||'reference',100,true),drive_file_id:await g.generateFileId(),drive_parent_id:parent,source_sha256:sha,category};
    const session=await this.admin.rpc('dtg_library_register_upload',{p_actor:this.actor,p_key:key,p_ticket:ticket?.id||null,p_customer:customer.id,p_asset:asset?.id||null,p_file:crypto.randomUUID(),p_meta:meta,p_policy:{...cfg,direct_transfer:true}});
    const f=await this.admin.one(T('files'),[eq('id',session.file_id)]);await this.audit('library.upload_reserved',{file_id:f.id},{ticket_id:ticket?.id});return this.publicSession(session,f);
  },
  async directUploadSession(input) {
    await this.libraryPolicy();return this.withUpload(input.session_id,async(s,f)=>{
      if(f.storage_provider!=='GOOGLE_DRIVE'||!s.policy_snapshot.direct_transfer)fail('DIRECT_TRANSFER_REQUIRED');
      if(s.state==='complete')return this.publicSession(s,f);
      const uri=await this.driveUploadSession(s,f,await this.google());
      return {...this.publicSession(s,f),upload_url:uploadURI(uri)};
    });
  },
  async listLibraryFiles(input) {
    const c=await this.libraryCustomer(input.customer_id);
    const ticket=input.ticket_id?await this.ticket(input.ticket_id):null;if(ticket&&ticket.cliente_id!==c.id)fail('CUSTOMER_MISMATCH',403);
    const category=input.category||'';if(category&&!categories.includes(category))fail('INVALID_CATEGORY');
    const rows=await this.user.rpc('dtg_library_list',{p_customer:c.id,p_before:input.before?new Date(input.before).toISOString():null,p_before_id:input.before_id?uuid(input.before_id):null,p_search:text(input.search||'',150),p_category:category,p_limit:50,p_ticket:ticket?.id||null});
    return {files:rows||[],has_more:(rows||[]).length===50};
  },
  async findLibraryDuplicate(input) {
    const c=await this.libraryCustomer(input.customer_id),sha=String(input.source_sha256||'');if(!/^[a-f0-9]{64}$/.test(sha))fail('INVALID_HASH');
    const rows=await this.user.list(T('files'),[eq('source_sha256',sha),eq('availability','available')],{limit:100});const found=[];
    for(const f of rows){const a=await this.user.one(T('assets'),[eq('id',f.asset_id)]);if(a&&await this.admin.rpc('dtg_canonical_customer',{p_id:a.customer_id})===c.id&&a.origin_ticket_id===(input.ticket_id||null))found.push({id:f.id,filename:f.filename,size_bytes:f.size_bytes,asset_id:f.asset_id});}
    return {files:found};
  },
  async requestLibraryPreview(input) {
    await this.libraryPolicy();const {f,a}=await this.file(input.file_id);if(f.availability!=='available')fail('FILE_UNAVAILABLE',409);
    return this.enqueue('preview',`preview:${f.id}`,{file_id:f.id},f.id,{ticket_id:a.origin_ticket_id});
  },
  async directFileAccess(input) {
    await this.libraryPolicy();const {f}=await this.file(input.file_id);if(f.availability!=='available'||f.storage_provider!=='GOOGLE_DRIVE')fail('FILE_UNAVAILABLE',409);
    const identity=await this.user.one(T('library_identities'),[eq('actor_id',this.actor)]);if(!identity)fail('WORKSPACE_IDENTITY_REQUIRED',409);
    const g=await this.google(),meta=await g.stat(f.drive_file_id);
    if(meta.trashed||Number(meta.size)!==Number(f.size_bytes)||(f.checksum&&meta.md5Checksum!==f.checksum)||(f.drive_parent_id&&!(meta.parents||[]).includes(f.drive_parent_id)))fail('ORIGINAL_CHANGED_EXTERNALLY',409);
    const permissions=(await g.listPermissions(f.drive_file_id)).permissions||[],connection=await this.connection();
    if(permissions.some(p=>p.type==='anyone'||p.type==='domain'||p.permissionDetails?.some(d=>d.inherited&&p.role!=='owner')))fail('UNSAFE_INHERITED_ACCESS',409);
    if(f.drive_parent_id){const root=await this.admin.one(T('library_folders'),[eq('scope_key','root')]);if(!root||root.connection_id!==connection.id)fail('LIBRARY_FOLDER_CHANGED',409);let parent=f.drive_parent_id,n=0,reached=false;while(parent&&n++<5){const pm=await g.stat(parent);if(pm.trashed||(await g.listPermissions(parent)).permissions?.some(p=>p.role!=='owner'))fail('LIBRARY_FOLDER_SHARED',409);if(parent===root.drive_id){reached=true;break;}parent=pm.parents?.[0]||null;}if(!reached)fail('LIBRARY_FOLDER_CHANGED',409);}
    if(identity.google_email!==connection.account_email){
      let record=await this.admin.one(T('library_grants'),[eq('file_id',f.id),eq('actor_id',this.actor)]);
      const existing=permissions.find(p=>p.type==='user'&&p.emailAddress?.toLowerCase()===identity.google_email);
      // Native expiry bounds access outside CRM; never silently take ownership of a pre-existing grant.
      if(existing&&(!record||existing.id!==record.permission_id))fail('LIBRARY_PREEXISTING_ACCESS',409);
      const expiry=new Date(Date.now()+3600000).toISOString();
      let grant;
      if(existing&&record&&Date.parse(record.expires_at)>Date.now()+300000)grant=existing;
      else if(existing)grant=await g.extend(f.drive_file_id,existing.id,expiry);
      else grant=await g.grant(f.drive_file_id,identity.google_email,expiry);
      if(!grant.expirationTime||Date.parse(grant.expirationTime)>Date.parse(expiry)+1000||Date.parse(grant.expirationTime)<Date.now())fail('NATIVE_EXPIRY_UNCONFIRMED',409);
      await this.admin.upsert(T('library_grants'),{file_id:f.id,actor_id:this.actor,google_email:identity.google_email,permission_id:grant.id,expires_at:grant.expirationTime},'file_id,actor_id');
    }
    return {url:`https://drive.google.com/file/d/${encodeURIComponent(f.drive_file_id)}/view`,download_url:`https://drive.google.com/uc?export=download&id=${encodeURIComponent(f.drive_file_id)}`,account_email:identity.google_email,direct:true};
  },
  async resolveThumbnails(input) {
    if(!Array.isArray(input.images)||input.images.length>40)fail('INVALID_THUMBNAIL_BATCH');const images=[];
    for(const i of input.images){try{
      const source=await this.authorizedThumbnail(i);
      const d=await this.admin.one(T('image_derivatives'),[eq('source_id',source.id),eq('variant',i.variant)]);
      images.push({key:i.key,url:d&&Date.parse(d.source_updated_at)===Date.parse(source.updated_at)?await this.storage.signedUrl('dtg-thumbnails',d.path,3600):null});
    }catch{images.push({key:i.key,url:null,denied:true});}}
    return {images};
  },
  async authorizedThumbnail(input) {
    const bucket=text(input.source_bucket,80,true),path=text(input.source_path,1500,true);
    if(!['ticket-files','chat-private','profile-avatars'].includes(bucket)||!['avatar','card'].includes(input.variant))fail('INVALID_THUMBNAIL');
    const check=await this.user.client.storage.from(bucket).createSignedUrl(path,60);if(check.error)fail('FILE_UNAVAILABLE',404);
    const data=await this.admin.rpc('dtg_thumbnail_source',{p_bucket:bucket,p_path:path});
    if(!data||!String(data.mime||'').startsWith('image/')||Number(data.size)>26214400)fail('FILE_UNAVAILABLE',404);return data;
  },
  async registerThumbnail(input,bytes) {
    const source=await this.authorizedThumbnail(input);
    const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
    const png=bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71;
    if(!bytes.length||bytes.length>131072||(!jpeg&&!png))fail('INVALID_THUMBNAIL');
    const mime=jpeg?'image/jpeg':'image/png',path=`${source.id}/${input.variant}/${crypto.randomUUID()}.${jpeg?'jpg':'png'}`;
    await this.storage.upload('dtg-thumbnails',path,bytes,mime);
    await this.admin.upsert(T('image_derivatives'),{source_id:source.id,source_bucket:input.source_bucket,source_path:input.source_path,source_updated_at:source.updated_at,variant:input.variant,path,size_bytes:bytes.length},'source_id,variant');
    return {url:await this.storage.signedUrl('dtg-thumbnails',path,3600)};
  }
};
