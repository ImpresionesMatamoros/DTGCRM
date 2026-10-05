import test from 'node:test';
import assert from 'node:assert/strict';
import { selectStorage, classifyMessage, messageMetadata, vendorEligibility, buildMime, base64url, unbase64url, seal, unseal, expiry, retryDelay, IntegrationError, crmOrigins, mailReadiness } from '../supabase/functions/_shared/integrations/core.mjs';
import { GoogleAdapter, readLimited } from '../supabase/functions/_shared/integrations/google.mjs';
import { IntegrationService } from '../supabase/functions/_shared/integrations/service.mjs';
import { IntegrationWorker } from '../supabase/functions/_shared/integrations/worker.mjs';
import { MemoryStore, scenario } from './integration-fixture.mjs';
import { createHash } from 'node:crypto';

const policy={threshold_bytes:26214400,max_file_bytes:2147483648,drive_extensions:['ai','psd','tiff','eps','raw'],drive_mime_types:['image/tiff'],drive_purposes:['print_ready','production_source','gang_sheet']};
const operation='10000000-0000-4000-8000-000000000001';
const inbox={id:operation,email_alias:'sales@956print.com',active:true,default_from_name:'956 Print',default_signature:'Gracias'};
test('routing boundaries, production purpose, MIME and 500 MiB originals',()=>{
  const input={filename:'proof.pdf',mime_type:'application/pdf',size_bytes:26214400};
  assert.equal(selectStorage(input,policy),'SUPABASE');assert.equal(selectStorage({...input,size_bytes:26214401},policy),'GOOGLE_DRIVE');
  assert.equal(selectStorage({...input,filename:'original.AI',size_bytes:10},policy),'GOOGLE_DRIVE');
  assert.equal(selectStorage({...input,production_source_file:true},policy),'GOOGLE_DRIVE');
  assert.equal(selectStorage({...input,purpose:'print_ready'},policy),'GOOGLE_DRIVE');
  assert.equal(selectStorage({...input,mime_type:'image/tiff',size_bytes:1},policy),'GOOGLE_DRIVE');
  assert.equal(selectStorage({...input,size_bytes:500*1048576},policy),'GOOGLE_DRIVE');
  assert.throws(()=>selectStorage({...input,size_bytes:-1},policy));assert.throws(()=>selectStorage({...input,filename:'../x.pdf'},policy));
});
test('single Gmail message classified into multiple inboxes without inventing BCC',()=>{
  const boxes=[inbox,{...inbox,id:'b',email_alias:'orders@956print.com'}];
  const m={id:'g1',threadId:'t1',internalDate:'1700000000000',labelIds:['INBOX'],payload:{headers:[{name:'To',value:'Sales <sales@956print.com>, orders@956print.com'},{name:'Bcc',value:'billing@956print.com'}],parts:[{mimeType:'application/pdf',filename:'art.pdf'}]}};
  assert.equal(classifyMessage(m,boxes).matches.length,2);assert.equal(classifyMessage({...m,payload:{headers:[]}},boxes).matches.length,0);
  const metadata=messageMetadata(m,boxes);assert.equal(metadata.has_attachments,true);assert.equal(metadata.direction,'inbound');assert.equal('bcc_addresses' in metadata,false);
  assert.equal(classifyMessage({...m,labelIds:['SENT'],payload:{headers:[{name:'From',value:'sales@956print.com'}]}},boxes).matches.length,1);
});
test('production approval binds exact version and usage; override requires admin and reason',()=>{
  const file={id:'v3',stage:'Print Ready',availability:'available'};
  assert.deepEqual(vendorEligibility(file,{production_approved:true,approved_file_id:'v3'},false),{override:false,reason:null});
  assert.throws(()=>vendorEligibility(file,{production_approved:true,approved_file_id:'v2'},false),/PRODUCTION/);
  assert.throws(()=>vendorEligibility({...file,availability:'uploading'},{},true,'urgent'),/UNAVAILABLE/);
  assert.throws(()=>vendorEligibility(file,{},true,''),/PRODUCTION/);
  assert.equal(vendorEligibility(file,{},true,'Approved exception').override,true);
});
test('MIME aliases, Unicode, signature and header injection',()=>{
  const raw=buildMime({to:['client@example.com'],subject:'Diseño',body:'Hola'},inbox,operation,'956print.com');
  const decoded=new TextDecoder().decode(unbase64url(raw));assert.match(decoded,/From: .*<sales@956print.com>/);assert.match(decoded,/Message-ID: <dtg-/);
  assert.match(atob(decoded.split('\r\n\r\n')[1].replace(/\r\n/g,'')),/Hola/);
  assert.throws(()=>buildMime({to:['a@example.com'],subject:'Good\r\nBcc: bad@evil.com',body:'x'},inbox,operation,'956print.com'),/HEADER/);
  assert.throws(()=>buildMime({to:['bad@example.com\n'],subject:'x',body:'x'}, {...inbox,email_alias:'x@evil.com'},operation,'956print.com'),/DOMAIN/);
});
test('AES-GCM binds encrypted state to context and rejects tampering',async()=>{
  const key=base64url(crypto.getRandomValues(new Uint8Array(32))),value={refresh_token:'private',bcc:['private@example.com']};
  const encrypted=await seal(value,key,'job:1');assert.ok(!encrypted.includes('private'));assert.deepEqual(await unseal(encrypted,key,'job:1'),value);
  await assert.rejects(unseal(encrypted,key,'job:2'));await assert.rejects(unseal(encrypted+'x',key,'job:1'));
});
test('native expiry bounds and retry-after',()=>{assert.throws(()=>expiry(0));assert.throws(()=>expiry(8761));assert.equal(expiry(1,0),'1970-01-01T01:00:00.000Z');assert.equal(retryDelay(2,'60',()=>0),60000);});
test('Drive resumable offset uses confirmed Range instead of sent length',async()=>{
  const g=new GoogleAdapter('private',async()=>new Response(null,{status:308,headers:{Range:'bytes=0-262143'}}));
  assert.deepEqual(await g.uploadChunk('https://www.googleapis.com/upload/drive/v3/files?upload_id=1',new Uint8Array(524288),0,1000000),{offset:262144,complete:false});
  assert.equal((await g.uploadStatus('https://www.googleapis.com/upload/drive/v3/files?upload_id=1',1000000)).offset,262144);
});
test('send timeout becomes unknown and never retries POST in adapter',async()=>{
  let calls=0;const g=new GoogleAdapter('private',async()=>{calls++;throw new Error('timeout');});await assert.rejects(g.sendEmail('raw'),/UNKNOWN_SEND_RESULT/);assert.equal(calls,1);
});
test('bounded streams enforce limit even without Content-Length',async()=>{
  const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array(8));c.enqueue(new Uint8Array(8));c.close();}});
  await assert.rejects(readLimited(new Response(stream),10),/PAYLOAD_TOO_LARGE/);
});
test('Drive requests have specific reader permission, native expiration and no notification duplication',async()=>{
  let request;const g=new GoogleAdapter('token',async(u,o)=>{request={u,o};return Response.json({id:'p1'});});
  await g.grant('file1','vendor@example.com','2027-01-01T00:00:00Z');const body=JSON.parse(request.o.body);
  assert.deepEqual(body,{type:'user',role:'reader',emailAddress:'vendor@example.com',expirationTime:'2027-01-01T00:00:00Z'});assert.match(request.u,/sendNotificationEmail=false/);
});
test('ticket still readable and reusable metadata intact while Google is down',async()=>{
  const {s,ids,db}=scenario();s.google=async()=>{throw new IntegrationError('PROVIDER_UNAVAILABLE',503,true);};
  assert.equal((await s.ticket(ids.ticket)).id,ids.ticket);assert.equal((await s.listFiles({ticket_id:ids.ticket})).length,1);
  await assert.rejects(s.getFileAccess({file_id:ids.file,preview:true}).then(x=>{if(!x.url)throw new Error('No preview');}));
  assert.equal(db.tables.dtg_files[0].availability,'available');
});
test('reuse links the existing physical file and resets context approval',async()=>{
  const {s,ids,db}=scenario();const result=await s.reuseFile({file_id:ids.file,ticket_id:ids.newTicket});
  assert.equal(result.file_id,ids.file);assert.equal(result.production_approved,false);assert.equal(db.tables.dtg_files.length,1);
  await s.reuseFile({file_id:ids.file,ticket_id:ids.newTicket});assert.equal(db.tables.dtg_asset_usages.length,2);
});
test('outbox command double-click returns one durable operation and encrypted recipients',async()=>{
  const {s,ids,db}=scenario();const input={inbox_id:ids.inbox,ticket_id:ids.ticket,idempotency_key:crypto.randomUUID(),to:['client@example.com'],bcc:['secret@example.com'],subject:'Proof',body:'Hi'};
  const a=await s.sendEmail(input),b=await s.sendEmail(input);assert.equal(a.operation_id,b.operation_id);assert.equal(db.tables.dtg_integration_jobs.length,1);assert.ok(!JSON.stringify(db.tables.dtg_integration_jobs).includes('secret@example.com'));
});
test('worker reconciles uncertain send before attempting another POST',async()=>{
  const {s,ids,db,google}=scenario();const op=await s.sendEmail({inbox_id:ids.inbox,ticket_id:ids.ticket,idempotency_key:crypto.randomUUID(),to:['c@example.com'],subject:'x',body:'x'});
  let calls=0;google.sendEmail=async()=>{calls++;throw new IntegrationError('UNKNOWN_SEND_RESULT',409);};
  const worker=new IntegrationWorker(s);assert.equal((await worker.run()).state,'unknown');assert.equal(calls,1);
  const job=db.tables.dtg_integration_jobs.find(x=>x.id===op.operation_id);job.state='retry';google.findSent=async()=>({messages:[{id:'sent1'}]});
  assert.equal((await worker.run()).state,'done');assert.equal(calls,1);assert.equal(db.tables.dtg_email_messages.length,1);
});
test('vendor reader grant persists if email fails, then reconciles without granting twice',async()=>{
  const {s,ids,db,google}=scenario();let grants=0,sends=0;
  const grantOriginal=google.grant;google.grant=async(...args)=>{grants++;return grantOriginal(...args);};
  google.sendEmail=async()=>{sends++;throw new IntegrationError('UNKNOWN_SEND_RESULT',409);};
  const op=await s.sendToVendor({ticket_id:ids.ticket,file_id:ids.file,vendor_id:ids.vendor,inbox_id:ids.inbox,idempotency_key:crypto.randomUUID()});
  const worker=new IntegrationWorker(s);assert.equal((await worker.run()).state,'unknown');assert.equal(grants,1);assert.equal(db.tables.dtg_vendor_grants[0].state,'granted');assert.equal(db.tables.dtg_vendor_deliveries[0].email_state,'unknown');
  const job=db.tables.dtg_integration_jobs.find(x=>x.id===op.operation_id);job.state='retry';google.findSent=async()=>({messages:[{id:'sent1'}]});
  assert.equal((await worker.run()).state,'done');assert.equal(grants,1);assert.equal(sends,1);assert.equal(db.tables.dtg_vendor_deliveries[0].email_state,'sent');
});
test('revocation does not remove permission needed by another active delivery',async()=>{
  const {s,ids,db,google}=scenario(),worker=new IntegrationWorker(s);let revoked=0;google.revoke=async()=>{revoked++;};
  const grant={id:crypto.randomUUID(),file_id:ids.file,recipient_email:'v@example.com',drive_file_id:'d1',permission_id:'p1',managed:true,expires_at:new Date(Date.now()+3600000).toISOString(),state:'granted'};
  db.tables.dtg_vendor_grants=[grant];db.tables.dtg_vendor_deliveries=[{id:crypto.randomUUID(),grant_id:grant.id,revoked_at:null,access_expires_at:grant.expires_at}];
  await worker.revoke({}, {grant_id:grant.id});assert.equal(revoked,0);assert.equal(grant.state,'granted');
});
test('worker rechecks actor and production approval after queueing',async()=>{
  const {s,ids,db}=scenario();await s.sendToVendor({ticket_id:ids.ticket,file_id:ids.file,vendor_id:ids.vendor,inbox_id:ids.inbox,idempotency_key:crypto.randomUUID()});
  db.tables.dtg_asset_usages[0].production_approved=false;db.admin=false;const result=await new IntegrationWorker(s).run();assert.equal(result.state,'failed');assert.equal(db.tables.dtg_vendor_grants?.length||0,0);
});
test('classifies cursor invalidation as resync without destroying known metadata',async()=>{
  const {s,db,google,ids}=scenario();await s.privateSet('sync:'+ids.connection,{cursor:'old'});google.history=async()=>{throw new IntegrationError('MISSING_EXTERNAL',404);};
  const worker=new IntegrationWorker(s);const more=await worker.sync({},{});assert.equal(more,true);assert.equal((await s.privateGet('sync:'+ids.connection)).cursor,null);
});
test('500 MiB upload streams bounded chunks, resumes a lost response and registers one original',async()=>{
  const {s,ids,db,google}=scenario();let offset=0,complete=false,lost=false,largest=0;
  const hash=createHash('md5');let checksum;
  google.generateFileId=async()=> 'large-original';google.beginUpload=async()=> 'https://www.googleapis.com/upload/drive/v3/files?upload_id=test';
  const priorStat=google.stat;google.stat=async(id)=>{if(id!=='large-original')return priorStat(id);if(!complete)throw new IntegrationError('MISSING_EXTERNAL',404);return{id,size:offset,md5Checksum:checksum};};
  google.uploadStatus=async()=>({offset,complete});
  google.uploadChunk=async(uri,bytes,start,total)=>{
    assert.equal(start,offset);largest=Math.max(largest,bytes.byteLength);hash.update(bytes);offset+=bytes.byteLength;
    if(offset===total){complete=true;checksum=hash.digest('hex');}
    if(!lost&&offset>=8388608){lost=true;throw new IntegrationError('PROVIDER_UNAVAILABLE',503,true);}
    return{offset,complete};
  };
  const input={ticket_id:ids.ticket,idempotency_key:crypto.randomUUID(),filename:'500mb.ai',mime_type:'application/postscript',purpose:'production_source',size_bytes:500*1048576};
  let session=await s.beginUpload(input);assert.equal(session.provider,'GOOGLE_DRIVE');
  assert.equal((await s.beginUpload(input)).file_id,session.file_id);
  const chunk=new Uint8Array(4194304);chunk.fill(71);
  while(session.confirmed_offset<input.size_bytes){
    try{session=await s.uploadChunk({session_id:session.session_id,offset:session.confirmed_offset},chunk.subarray(0,Math.min(chunk.length,input.size_bytes-session.confirmed_offset)));}
    catch(e){assert.equal(e.code,'PROVIDER_UNAVAILABLE');session=await s.resumeUpload({session_id:session.session_id});}
  }
  const final=await s.completeUpload({session_id:session.session_id});assert.equal(final.state,'complete');assert.equal(largest,4194304);assert.equal(offset,500*1048576);
  assert.equal(db.tables.dtg_files.filter(f=>f.drive_file_id==='large-original').length,1);
  assert.equal(db.tables.dtg_files.find(f=>f.id===session.file_id).checksum,checksum);
  assert.equal(db.tables.dtg_integration_jobs.filter(j=>j.kind==='preview').length,1);
});
test('same idempotency key with different email does not silently send previous content',async()=>{
  const {s,ids}=scenario(),input={inbox_id:ids.inbox,idempotency_key:crypto.randomUUID(),to:['c@example.com'],subject:'A',body:'A'};
  await s.sendEmail(input);await assert.rejects(s.sendEmail({...input,subject:'B'}),/IDEMPOTENCY_CONFLICT/);
});
test('revocation outage stays pending and is not reported as revoked',async()=>{
  const {s,ids,db,google}=scenario(),worker=new IntegrationWorker(s);
  db.tables.dtg_vendor_grants=[{id:crypto.randomUUID(),file_id:ids.file,recipient_email:'v@example.com',drive_file_id:'d1',permission_id:'p1',managed:true,expires_at:new Date(Date.now()-1000).toISOString(),state:'granted'}];
  google.revoke=async()=>{throw new IntegrationError('PROVIDER_UNAVAILABLE',503,true);};
  await assert.rejects(worker.revoke({}, {grant_id:db.tables.dtg_vendor_grants[0].id}),/PROVIDER_UNAVAILABLE/);assert.equal(db.tables.dtg_vendor_grants[0].state,'revoke_pending');
});

test('mail setup reports only missing names and origin override stays exact',()=>{
 assert.deepEqual(crmOrigins({}),['https://impresionesmatamoros.github.io','https://crm.956print.com']);
 assert.deepEqual(crmOrigins({CRM_ORIGINS:'https://crm.956print.com, https://staging.example.com'}),['https://crm.956print.com','https://staging.example.com']);
 assert.equal(mailReadiness({},null).configured,false);
 const env=Object.fromEntries(mailReadiness({},null).missing.map(k=>[k,'secret-value']));
 assert.deepEqual(mailReadiness(env,{state:'connected'}),{configured:true,missing:[],connected:true});
 assert(!JSON.stringify(mailReadiness(env,null)).includes('secret-value'));
});
test('reply resolves trusted thread metadata and rejects unreadable original',async()=>{
 const {s,ids,db}=scenario(); const id=crypto.randomUUID();db.tables.dtg_email_messages=[{id,connection_id:ids.connection,subject:'Pedido',thread_id:'trusted-thread',rfc_message_id:'<original@example.com>'}];
 const input={inbox_id:ids.inbox,to:['client@example.com'],subject:'Re: Pedido',body:'Hola',reply_message_id:id,thread_id:'forged',in_reply_to:'forged',idempotency_key:crypto.randomUUID()};
 const op=await s.sendEmail(input);const job=db.tables.dtg_integration_jobs.find(x=>x.id===op.operation_id);const payload=await unseal(job.payload.sealed,s.env.INTEGRATION_ENCRYPTION_KEY,'job:'+job.id);
 assert.equal(payload.subject,'Pedido');assert.equal(payload.thread_id,'trusted-thread');assert.equal(payload.in_reply_to,'<original@example.com>');
 await assert.rejects(s.sendEmail({...input,reply_message_id:crypto.randomUUID(),idempotency_key:crypto.randomUUID()}),/THREAD_UNAVAILABLE/);
});

test('admin cannot enable mail before backend setup and Google consent',async()=>{
 const {s}=scenario();await assert.rejects(s.configure({enabled:true}),/SECRETS_NOT_CONFIGURED/);
 for(const k of mailReadiness({},null).missing)s.env[k]='configured';
 s.connection=async()=>null;await assert.rejects(s.configure({enabled:true}),/GOOGLE_NOT_CONNECTED/);
});

test('verified aliases are discovered and never reassigned to another account silently',async()=>{
 const {s,db,ids}=scenario();const other=crypto.randomUUID();await db.insert('dtg_google_connections',{id:other,singleton:false,state:'connected',account_email:'jona@956print.com'});
 await s.validateAliases({listAliases:async()=>({sendAs:[{sendAsEmail:'hello@956print.com',verificationStatus:'accepted'}]})},ids.connection);
 const hello=await db.one('dtg_email_inboxes',[['email_alias','eq','hello@956print.com']]);assert.equal(hello.connection_id,ids.connection);assert.equal(hello.verification_status,'accepted');
 await s.validateAliases({listAliases:async()=>({sendAs:[{sendAsEmail:'hello@956print.com',verificationStatus:'accepted'},{sendAsEmail:'jona@956print.com',verificationStatus:'accepted'}]})},other);
 assert.equal((await db.one('dtg_email_inboxes',[['id','eq',hello.id]])).connection_id,ids.connection);
 assert.equal((await db.one('dtg_email_inboxes',[['email_alias','eq','jona@956print.com']])).connection_id,other);
});
test('OAuth token selection follows each real account and each send snapshots that account',async()=>{
 const {s,db,ids}=scenario();const second=crypto.randomUUID();await db.insert('dtg_google_connections',{id:second,singleton:false,state:'connected',account_email:'jona@956print.com'});
 await s.privateSet('google:'+ids.connection,{access_token:'primary-test',refresh_token:'test',expires_at:Date.now()+3600000});await s.privateSet('google:'+second,{access_token:'second-test',refresh_token:'test',expires_at:Date.now()+3600000});
 const real=new IntegrationService({admin:db,user:db,actor:ids.actor,storage:{},env:s.env,googleFactory:token=>({token})});assert.equal((await real.google(second)).token,'second-test');assert.equal((await real.google()).token,'primary-test');
 const newBox=await db.insert('dtg_email_inboxes',{connection_id:second,email_alias:'jona@956print.com',active:true,verification_status:'accepted',default_from_name:'Jonathan'});
 const op=await s.sendEmail({inbox_id:newBox.id,to:['test@example.com'],subject:'Prueba',body:'Hola',idempotency_key:crypto.randomUUID()});const job=await db.one('dtg_integration_jobs',[['id','eq',op.operation_id]]);const p=await unseal(job.payload.sealed,s.env.INTEGRATION_ENCRYPTION_KEY,'job:'+job.id);assert.equal(p.connection_id,second);
});
test('drafts are encrypted and private even from another admin',async()=>{
 const {s,ids,db}=scenario();const d=await s.saveMailDraft({draft:{inbox_id:ids.inbox,subject:'Draft',to:'test@example.com',body:'private draft'}});const row=await db.one('dtg_mail_drafts',[['id','eq',d.id]]);assert(!row.encrypted_payload.includes('private draft'));assert.equal((await s.getMailDraft({draft_id:d.id})).draft.body,'private draft');
 s.actor=crypto.randomUUID();assert.deepEqual(await s.listMailDrafts(),[]);await assert.rejects(s.getMailDraft({draft_id:d.id}),/DRAFT_UNAVAILABLE/);await assert.rejects(s.saveMailDraft({draft_id:d.id,draft:{body:'overwrite'}}),/DRAFT_UNAVAILABLE/);
 await s.deleteMailDraft({draft_id:d.id});assert(await db.one('dtg_mail_drafts',[['id','eq',d.id]]));
});
test('explicit processing claims only the owner operation and cannot drive another user queue',async()=>{
 const {s,db,ids}=scenario();const op=await s.sendEmail({inbox_id:ids.inbox,to:['test@example.com'],subject:'Prueba',body:'Hola',idempotency_key:crypto.randomUUID()});assert.equal((await s.processMailOperation({operation_id:op.operation_id})).state,'done');
 const other=await s.sendEmail({inbox_id:ids.inbox,to:['test@example.com'],subject:'Otro',body:'Hola',idempotency_key:crypto.randomUUID()});s.actor=crypto.randomUUID();db.admin=false;await assert.rejects(s.processMailOperation({operation_id:other.operation_id}),/FORBIDDEN/);assert.equal((await db.one('dtg_integration_jobs',[['id','eq',other.operation_id]])).state,'queued');
});

test('primary Gmail sender has no custom alias verification status',async()=>{
 const {s,db,ids}=scenario();const c=await db.one('dtg_google_connections',[['id','eq',ids.connection]]);
 await s.validateAliases({listAliases:async()=>({sendAs:[{sendAsEmail:c.account_email,isPrimary:true}]})},ids.connection);
 const b=await db.one('dtg_email_inboxes',[['email_alias','eq',c.account_email]]);assert.equal(b.verification_status,'accepted');
});
