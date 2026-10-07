import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash,randomBytes} from 'node:crypto';
import {scenario} from './integration-fixture.mjs';
import {uploadURI,categoryFor} from '../supabase/functions/_shared/integrations/library.mjs';
import {GoogleAdapter} from '../supabase/functions/_shared/integrations/google.mjs';

test('direct session initiation carries the CRM origin so Google responds with browser CORS',async()=>{
 let headers;const g=new GoogleAdapter('server-only',async(url,o)=>{headers=o.headers;return new Response(null,{status:200,headers:{location:'https://www.googleapis.com/upload/drive/v3/files?upload_id=bounded'}});});
 await g.beginUpload('id','name.cdr','application/octet-stream',100,'parent','https://crm.956print.com');assert.equal(headers.Origin,'https://crm.956print.com');assert.equal(headers.Authorization,'Bearer server-only');
});
test('folder validation stops at the managed root and rejects moved or shared ancestors',async()=>{
 const {s,db,ids,google}=scenario();db.tables.dtg_integration_config[0].library_enabled=true;db.tables.dtg_library_identities=[{actor_id:ids.actor,google_email:'employee@956print.com'}];db.tables.dtg_library_folders=[{scope_key:'root',drive_id:'managed-root',connection_id:ids.connection}];db.tables.dtg_files[0].drive_parent_id='resources';
 const parents={d1:['resources'],resources:['customer'],'customer':['managed-root'],'managed-root':['unscoped-my-drive']};google.stat=async(id)=>{assert.notEqual(id,'unscoped-my-drive');return {size:500*1048576,parents:parents[id]};};
 const original=google.listPermissions;google.listPermissions=async(id)=>id==='d1'?original():({permissions:[{role:'owner'}]});assert.equal((await s.directFileAccess({file_id:ids.file})).direct,true);
 parents.customer=['outside'];parents.outside=[];await assert.rejects(()=>s.directFileAccess({file_id:ids.file}),{code:'LIBRARY_FOLDER_CHANGED'});
 parents.customer=['managed-root'];google.listPermissions=async(id)=>({permissions:id==='customer'?[{role:'reader',type:'domain'}]:[]});await assert.rejects(()=>s.directFileAccess({file_id:ids.file}),{code:'LIBRARY_FOLDER_SHARED'});
});

test('incremental hashes match reference with arbitrary chunk boundaries and bounded memory',()=>{
 const ctx=vm.createContext({Uint32Array,Uint8Array,DataView});vm.runInContext(fs.readFileSync(new URL('../library-hash.js',import.meta.url),'utf8'),ctx);
 for(const n of [0,1,55,56,63,64,65,1000,1048576]){const b=randomBytes(n),h=new ctx.DTGFileHash();for(let p=0;p<n;p+=137)h.update(b.subarray(p,p+137));assert.equal(h.hex(),createHash('sha256').update(b).digest('hex'));assert.equal(h.buffer.length,64);}
});
test('upload capabilities reject non-Google hosts, missing IDs and hostile origins',()=>{assert.equal(uploadURI('https://www.googleapis.com/upload/drive/v3/files?upload_id=test'),'https://www.googleapis.com/upload/drive/v3/files?upload_id=test');for(const u of ['https://evil.test/upload/drive/?upload_id=a','https://www.googleapis.com.evil.test/upload/drive/?upload_id=a','http://www.googleapis.com/upload/drive/?upload_id=a','https://www.googleapis.com/upload/drive/'])assert.throws(()=>uploadURI(u));assert.equal(categoryFor('DISEÑO.CDR','application/octet-stream'),'corel');});
test('direct session keeps tokens server-side and enforces owner, policy and file scope',async()=>{
 const {s,db,ids}=scenario();db.tables.dtg_integration_config[0].library_enabled=true;
 const session={id:crypto.randomUUID(),file_id:ids.file,actor_id:ids.actor,policy_snapshot:{direct_transfer:true},state:'pending',confirmed_offset:0,expires_at:new Date(Date.now()+3600000).toISOString()};db.tables.dtg_upload_sessions=[session];s.driveUploadSession=async()=> 'https://www.googleapis.com/upload/drive/v3/files?upload_id=bounded';
 const r=await s.directUploadSession({session_id:session.id});assert.equal(r.upload_url.includes('upload_id=bounded'),true);assert.equal('access_token' in r,false);assert.equal('refresh_token' in r,false);
 db.tables.dtg_upload_sessions[0].actor_id=crypto.randomUUID();await assert.rejects(()=>s.directUploadSession({session_id:session.id}),{code:'UPLOAD_UNAVAILABLE'});
});
test('file opens require verified individual Workspace identity; native expiry and no public grant',async()=>{
 const {s,db,ids,google}=scenario();db.tables.dtg_integration_config[0].library_enabled=true;
 await assert.rejects(()=>s.directFileAccess({file_id:ids.file}),{code:'WORKSPACE_IDENTITY_REQUIRED'});
 db.tables.dtg_library_identities=[{actor_id:ids.actor,google_email:'employee@956print.com',google_sub:'sub'}];
 const r=await s.directFileAccess({file_id:ids.file});assert.equal(r.direct,true);assert.match(r.download_url,/^https:\/\/drive.google.com\//);assert.equal(db.tables.dtg_library_grants[0].google_email,'employee@956print.com');assert(Date.parse(db.tables.dtg_library_grants[0].expires_at)<=Date.now()+3601000);
 google.listPermissions=async()=>({permissions:[{type:'anyone',role:'reader'}]});await assert.rejects(()=>s.directFileAccess({file_id:ids.file}),{code:'UNSAFE_INHERITED_ACCESS'});
});
test('wrong source version or parent blocks completion and preserves uploading record',async()=>{
 const {s,db,ids,google}=scenario();const f=db.tables.dtg_files[0];f.drive_parent_id='expected';f.availability='uploading';const session={id:crypto.randomUUID(),file_id:f.id,actor_id:ids.actor,policy_snapshot:{direct_transfer:true},state:'pending',expires_at:new Date(Date.now()+3600000).toISOString()};db.tables.dtg_upload_sessions=[session];google.stat=async()=>({size:f.size_bytes,parents:['wrong']});await assert.rejects(()=>s.completeUpload({session_id:session.id}),{code:'UPLOAD_INCOMPLETE'});assert.equal(f.availability,'uploading');
});
test('thumbnail registration cannot use service-role access in place of source RLS',async()=>{
 const {s}=scenario();let stored=false;s.user.client={storage:{from:()=>({createSignedUrl:async()=>({error:{message:'denied'}})})}};s.storage.upload=async()=>{stored=true;};await assert.rejects(()=>s.registerThumbnail({source_bucket:'chat-private',source_path:'private.jpg',variant:'card'},new Uint8Array([255,216,255])),{code:'FILE_UNAVAILABLE'});assert.equal(stored,false);
});
