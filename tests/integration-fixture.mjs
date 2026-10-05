import { IntegrationService } from '../supabase/functions/_shared/integrations/service.mjs';
import { base64url } from '../supabase/functions/_shared/integrations/core.mjs';
export class MemoryStore {
  constructor(){this.tables={};this.admin=true;}
  matches(row,where){return where.every(([k,op,v])=>op==='eq'?row[k]===v:op==='is'?row[k]==v:op==='in'?v.includes(row[k]):op==='gt'?row[k]>v:op==='lte'?row[k]<=v:op==='lt'?row[k]<v:false);}
  async list(t,w=[],o={}){let rows=(this.tables[t]||[]).filter(r=>this.matches(r,w));if(o.order)rows.sort((a,b)=>(String(a[o.order]).localeCompare(String(b[o.order])))*(o.ascending?1:-1));return structuredClone(rows.slice(0,o.limit||100));}
  async one(t,w=[]){return(await this.list(t,w,{limit:1}))[0]||null;}
  async insert(t,row){const r={id:crypto.randomUUID(),created_at:new Date().toISOString(),state:'queued',attempt:0,next_attempt_at:new Date().toISOString(),revoked_at:null,production_approved:false,...structuredClone(row)};(this.tables[t]||=[]).push(r);return structuredClone(r);}
  async update(t,w,row){const changed=[];for(const r of this.tables[t]||[])if(this.matches(r,w)){Object.assign(r,structuredClone(row));changed.push(structuredClone(r));}return changed;}
  async upsert(t,row,conflict){const fields=conflict.split(','),old=(this.tables[t]||[]).find(r=>fields.every(k=>r[k]===row[k]));if(old){Object.assign(old,structuredClone(row));return structuredClone(old);}return this.insert(t,row);}
  async remove(t,w){this.tables[t]=(this.tables[t]||[]).filter(r=>!this.matches(r,w));}
  async rpc(name,args={}){
    if(name==='is_admin'||name==='is_active_member')return name==='is_admin'?this.admin:true;
    if(name==='dtg_canonical_customer')return args.p_id;
    if(name==='dtg_actor_context')return{active:true,is_admin:this.admin,ticket_visible:true,inbox_allowed:true};
    if(name==='dtg_claim_job'){const j=(this.tables.dtg_integration_jobs||[]).find(x=>['queued','retry'].includes(x.state)&&Date.parse(x.next_attempt_at)<=Date.now());if(!j)return[];j.state='running';j.attempt++;j.lease_token=crypto.randomUUID();j.lease_until=new Date(Date.now()+240000).toISOString();return[structuredClone(j)];}
    if(name==='dtg_register_upload'){
      const old=await this.one('dtg_upload_sessions',[['actor_id','eq',args.p_actor],['idempotency_key','eq',args.p_key]]);if(old)return old;
      const ticket=await this.one('tickets',[['id','eq',args.p_ticket]]);let asset=args.p_asset;
      if(!asset)asset=(await this.insert('dtg_assets',{customer_id:ticket.cliente_id,origin_ticket_id:ticket.id,name:args.p_meta.filename,purpose:args.p_meta.purpose,created_by:args.p_actor})).id;
      const files=await this.list('dtg_files',[['asset_id','eq',asset]]);
      await this.insert('dtg_files',{...args.p_meta,id:args.p_file,asset_id:asset,availability:'uploading',preview_state:'pending',stage:'Draft',version:files.length+1});
      await this.insert('dtg_asset_usages',{file_id:args.p_file,ticket_id:ticket.id,created_by:args.p_actor});
      return this.insert('dtg_upload_sessions',{file_id:args.p_file,actor_id:args.p_actor,idempotency_key:args.p_key,confirmed_offset:0,state:'pending',lease_until:null,policy_snapshot:args.p_policy,expires_at:new Date(Date.now()+86400000).toISOString()});
    }
    if(name==='dtg_claim_upload'){
      const s=(this.tables.dtg_upload_sessions||[]).find(x=>x.id===args.p_id&&x.actor_id===args.p_actor&&(!x.lease_until||Date.parse(x.lease_until)<Date.now()));
      if(!s)return[];s.lease_token=crypto.randomUUID();s.lease_until=new Date(Date.now()+120000).toISOString();return[structuredClone(s)];
    }
    if(name==='dtg_finalize_upload'){
      const s=this.tables.dtg_upload_sessions.find(x=>x.id===args.p_id),f=this.tables.dtg_files.find(x=>x.id===s.file_id);f.availability='available';f.checksum=args.p_checksum;s.state='complete';s.confirmed_offset=f.size_bytes;return null;
    }
    throw new Error('Missing fixture RPC '+name);
  }
}
export function scenario(){
  const db=new MemoryStore(),ids={actor:crypto.randomUUID(),ticket:crypto.randomUUID(),newTicket:crypto.randomUUID(),customer:crypto.randomUUID(),file:crypto.randomUUID(),asset:crypto.randomUUID(),inbox:crypto.randomUUID(),vendor:crypto.randomUUID(),connection:crypto.randomUUID()};
  db.tables.tickets=[{id:ids.ticket,cliente_id:ids.customer},{id:ids.newTicket,cliente_id:ids.customer}];db.tables.clientes=[{id:ids.customer,email:'client@example.com',archived_at:null}];
  db.tables.dtg_integration_config=[{id:true,enabled:true,domain:'956print.com',threshold_bytes:26214400,max_file_bytes:2147483648,drive_extensions:['ai'],drive_mime_types:[],drive_purposes:['production_source'],sync_query:'newer_than:90d'}];
  db.tables.dtg_google_connections=[{id:ids.connection,singleton:true,state:'connected',account_email:'martin@956print.com',last_sync_at:new Date().toISOString()}];
  db.tables.dtg_email_inboxes=[{id:ids.inbox,email_alias:'vendors@956print.com',default_from_name:'956 Print',active:true,verification_status:'accepted'}];
  db.tables.dtg_assets=[{id:ids.asset,customer_id:ids.customer,origin_ticket_id:ids.ticket}];
  db.tables.dtg_files=[{id:ids.file,asset_id:ids.asset,filename:'print.pdf',mime_type:'application/pdf',stage:'Print Ready',version:1,availability:'available',storage_provider:'GOOGLE_DRIVE',drive_file_id:'d1',size_bytes:500*1048576}];
  db.tables.dtg_asset_usages=[{id:crypto.randomUUID(),file_id:ids.file,ticket_id:ids.ticket,production_approved:true,approved_file_id:ids.file}];
  db.tables.dtg_vendors=[{id:ids.vendor,name:'Vendor',email:'vendor@example.com',active:true,default_access_hours:168}];
  const permissions=[];
  const google={stat:async()=>({id:'d1',size:500*1048576,webViewLink:'https://drive.google.com/file/d/d1/view',parents:[]}),listAliases:async()=>({sendAs:[{sendAsEmail:'vendors@956print.com',verificationStatus:'accepted'}]}),
    listPermissions:async()=>({permissions:structuredClone(permissions)}),grant:async(id,address,expires)=>{const p={id:'p1',emailAddress:address,role:'reader',type:'user',expirationTime:expires};permissions.push(p);return p;},
    extend:async(id,pid,expires)=>{const p=permissions.find(p=>p.id===pid);p.expirationTime=expires;return p;},
    revoke:async(id,pid)=>{const i=permissions.findIndex(p=>p.id===pid);if(i>=0)permissions.splice(i,1);},sendEmail:async()=>({id:'sent1'}),findSent:async()=>({messages:[]}),
    getEmail:async(id)=>({id,threadId:'thread1',internalDate:String(Date.now()),labelIds:['SENT'],payload:{headers:[{name:'From',value:'vendors@956print.com'},{name:'To',value:'vendor@example.com'},{name:'Subject',value:'Production'}]}}),profile:async()=>({historyId:'10'}),listMessages:async()=>({messages:[]}),history:async()=>({historyId:'11',history:[]})};
  const s=new IntegrationService({admin:db,user:db,actor:ids.actor,storage:{signedUrl:async()=>null},env:{INTEGRATION_ENCRYPTION_KEY:base64url(crypto.getRandomValues(new Uint8Array(32)))},googleFactory:()=>google});s.google=async()=>google;
  return{s,db,ids,google};
}
