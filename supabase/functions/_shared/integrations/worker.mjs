import { IntegrationError, fail, messageMetadata, vendorEligibility, buildMime, seal, unseal, retryDelay } from './core.mjs';
import { eq } from './store.mjs';
import { readLimited } from './google.mjs';
const T = n => `dtg_${n}`;
const date = () => new Date().toISOString();

export class IntegrationWorker {
  constructor(service) { this.s = service; this.db = service.admin; }
  async context(actor, ticket = null, inbox = null, send = false) {
    const c = await this.db.rpc('dtg_actor_context', { p_actor: actor, p_ticket: ticket, p_inbox: inbox, p_send: send });
    if (!c?.active || !c.ticket_visible || !c.inbox_allowed) fail('ACTOR_PERMISSION_REVOKED', 403); return c;
  }
  async persist(job, payload) {
    const changed = await this.db.update(T('integration_jobs'), [eq('id', job.id), eq('lease_token', job.lease_token), eq('state', 'running'), ['lease_until','gt',date()]],
      { payload: { sealed: await seal(payload, this.s.key(), `job:${job.id}`) }, lease_until:new Date(Date.now()+240000).toISOString() });
    if (!changed.length) fail('JOB_LEASE_LOST', 409);
  }
  async finish(job, state, error = null, next = null) {
    return this.db.update(T('integration_jobs'), [eq('id', job.id), eq('lease_token', job.lease_token)],
      { state, last_error: error, failure_count: error ? (job.failure_count || 0) + 1 : 0, next_attempt_at: next || date(), lease_until: null, lease_token: null, completed_at: state === 'done' ? date() : null });
  }
  async run() {
    await this.s.active(); await this.scheduleExpirations(); await this.scheduleSync();
    const jobs = await this.db.rpc('dtg_claim_job'); if (!jobs?.length) return { processed: 0 };
    const job = jobs[0]; this.s.actor = job.actor_id;
    try {
      const p = await unseal(job.payload.sealed, this.s.key(), `job:${job.id}`);
      if (job.kind !== 'revoke_grant') await this.context(job.actor_id, job.ticket_id, job.inbox_id, ['send_email','vendor_delivery'].includes(job.kind));
      if (job.kind === 'sync_email') { const c = await this.context(job.actor_id); if (!c.is_admin) fail('FORBIDDEN', 403); }
      const handlers = { send_email: 'send', sync_email: 'sync', preview: 'preview', vendor_delivery: 'deliver', revoke_grant: 'revoke' };
      const more = await this[handlers[job.kind]](job, p);
      await this.finish(job, more ? 'retry' : 'done', null, more ? new Date(Date.now()+1000).toISOString() : null);
      await this.s.audit(`${job.kind}.${more ? 'continued' : 'done'}`, {}, { operation_id: job.id, ticket_id: job.ticket_id, inbox_id: job.inbox_id });
      return { processed: 1, operation_id: job.id, state: more ? 'retry' : 'done' };
    } catch (e) {
      const code = e.code || 'INTEGRATION_FAILED';
      const uncertain = code === 'UNKNOWN_SEND_RESULT' || code === 'SEND_RECONCILIATION_REQUIRED' || code === 'GRANT_RECONCILIATION_REQUIRED';
      const retry = e.retryable && (job.failure_count || 0) < 7;
      await this.finish(job, uncertain ? 'unknown' : retry ? 'retry' : 'failed', code, retry ? new Date(Date.now()+retryDelay(job.attempt,e.retryAfter)).toISOString() : null);
      if (job.kind === 'vendor_delivery') {
        const p = await unseal(job.payload.sealed,this.s.key(),`job:${job.id}`);
        await this.db.update(T('vendor_deliveries'),[eq('id',p.delivery_id)],{last_error:code,email_state:uncertain?'unknown':retry?'queued':'failed'});
      }
      if (job.kind === 'preview' && !retry) {
        const p = await unseal(job.payload.sealed,this.s.key(),`job:${job.id}`);
        await this.db.update(T('files'),[eq('id',p.file_id)],{preview_state:'failed'});
      }
      if (job.kind === 'sync_email') {
        const connection=await this.s.connection();if(connection)await this.db.update(T('google_connections'),[eq('id',connection.id)],{last_error:code});
      }
      await this.s.audit(`${job.kind}.${uncertain?'unknown':retry?'retry':'failed'}`, { error: code }, { operation_id: job.id, ticket_id: job.ticket_id, inbox_id: job.inbox_id });
      return { processed: 1, operation_id: job.id, state: uncertain ? 'unknown' : retry ? 'retry' : 'failed', error: code };
    }
  }
  async recordMessage(g, id, explicitInbox = null, ticket = null) {
    const connection = await this.s.connection(), boxes = await this.db.list(T('email_inboxes'));
    const m = messageMetadata(await g.getEmail(id), boxes), classifications = m.inboxes; delete m.inboxes;
    const row = await this.db.upsert(T('email_messages'), { ...m, connection_id: connection.id }, 'connection_id,external_message_id');
    if (explicitInbox && !classifications.some(x=>x.inbox_id===explicitInbox)) {
      const box=boxes.find(x=>x.id===explicitInbox); if(box) classifications.push({inbox_id:box.id,delivered_alias:box.email_alias,evidence:['crm-command']});
    }
    for(const c of classifications) await this.db.upsert(T('email_message_inboxes'), { message_id:row.id,...c },'message_id,inbox_id');
    if(ticket) {
      const t=await this.db.one('tickets',[eq('id',ticket)]);
      await this.db.upsert(T('email_links'),{message_id:row.id,ticket_id:ticket,customer_id:t?.cliente_id||null,linked_by:this.s.actor},'message_id,ticket_id');
    }
    // Automatic customer links only for one exact, accessible match. No ticket guessing.
    if(!ticket && row.direction==='inbound') {
      const {extractEmails}=await import('./core.mjs'); const from=extractEmails(row.from_address);
      if(from.length===1) {
        const cs=await this.db.list('clientes',[eq('email',from[0]),['archived_at','is',null]],{limit:2});
        if(cs.length===1) {
          const old=await this.db.one(T('email_links'),[eq('message_id',row.id),eq('customer_id',cs[0].id),['ticket_id','is',null]]);
          if(!old) await this.db.insert(T('email_links'),{message_id:row.id,customer_id:cs[0].id,linked_by:this.s.actor});
        }
      }
    }
    return row;
  }
  async sendRaw(job,p,g,box,input,ticket=null) {
    const cfg=await this.s.policy();
    if(!box?.active || box.verification_status!=='accepted') fail('ALIAS_NOT_VERIFIED',409);
    const aliases=(await g.listAliases()).sendAs||[];
    if(!aliases.some(a=>a.sendAsEmail.toLowerCase()===box.email_alias&&a.verificationStatus==='accepted')) fail('ALIAS_NOT_VERIFIED',409);
    if(p.external_message_id) { await this.recordMessage(g,p.external_message_id,box.id,ticket); return p.external_message_id; }
    if(p.sending) {
      const found=await g.findSent(`<dtg-${job.id}@${cfg.domain}>`);
      if(found.messages?.length) {p.external_message_id=found.messages[0].id;await this.persist(job,p);await this.recordMessage(g,p.external_message_id,box.id,ticket);return p.external_message_id;}
      if(!p.confirm_resend) fail('SEND_RECONCILIATION_REQUIRED',409);
    }
    const raw=buildMime(input,box,job.id,cfg.domain); p.sending=true; p.confirm_resend=false; await this.persist(job,p);
    let result;
    try {result=await g.sendEmail(raw,input.thread_id||null);}
    catch(e) {
      if(e.code!=='UNKNOWN_SEND_RESULT') {p.sending=false;await this.persist(job,p);} throw e;
    }
    p.external_message_id=result.id; await this.persist(job,p);
    await this.recordMessage(g,result.id,box.id,ticket); return result.id;
  }
  async send(job,p) { const g=await this.s.google(),box=await this.db.one(T('email_inboxes'),[eq('id',p.inbox_id)]); await this.sendRaw(job,p,g,box,p,job.ticket_id); return false; }
  async sync(job,p) {
    const g=await this.s.google(),c=await this.s.connection(),cfg=await this.s.policy();
    let state=await this.s.privateGet(`sync:${c.id}`) || {cursor:null};
    if(!state.cursor || state.mode==='full') {
      if(!state.full_start) {state={mode:'full',full_start:(await g.profile()).historyId,page:null};await this.s.privateSet(`sync:${c.id}`,state);}
      const batch=await g.listMessages(state.page,cfg.sync_query);
      for(const m of batch.messages||[]) {try{await this.recordMessage(g,m.id);}catch(e){if(e.code!=='MISSING_EXTERNAL')throw e;}}
      if(batch.nextPageToken) {state.page=batch.nextPageToken;await this.s.privateSet(`sync:${c.id}`,state);return true;}
      state={cursor:state.full_start};await this.s.privateSet(`sync:${c.id}`,state);
      // Run history from the cursor captured BEFORE initial listing, closing the arrival gap.
      return true;
    }
    let batch;
    try{batch=await g.history(state.cursor,state.page);}
    catch(e){if(e.code==='MISSING_EXTERNAL'){await this.s.privateSet(`sync:${c.id}`,{cursor:null});return true;}throw e;}
    const ids=new Set();
    for(const h of batch.history||[]) {
      for(const kind of ['messagesAdded','labelsAdded','labelsRemoved']) for(const x of h[kind]||[]) ids.add(x.message.id);
      for(const x of h.messagesDeleted||[]) await this.db.update(T('email_messages'),[eq('connection_id',c.id),eq('external_message_id',x.message.id)],{sync_status:'missing_external'});
    }
    for(const id of ids) {try{await this.recordMessage(g,id);}catch(e){if(e.code!=='MISSING_EXTERNAL')throw e;}}
    if(batch.nextPageToken) {state.page=batch.nextPageToken;await this.s.privateSet(`sync:${c.id}`,state);return true;}
    await this.s.privateSet(`sync:${c.id}`,{cursor:batch.historyId||state.cursor});
    await this.db.update(T('google_connections'),[eq('id',c.id)],{last_sync_at:date(),last_error:null});return false;
  }
  async preview(job,p) {
    const f=await this.db.one(T('files'),[eq('id',p.file_id)]); if(!f||f.availability!=='available')fail('FILE_UNAVAILABLE',409);
    const asset=await this.db.one(T('assets'),[eq('id',f.asset_id)]);await this.context(job.actor_id,asset.origin_ticket_id);
    if(f.preview_state==='ready')return false;
    // Client-generated JPEG is registered separately. Drive's own raster thumbnail
    // is best effort; no full-file rendering in Edge Functions.
    if(f.storage_provider!=='GOOGLE_DRIVE') {await this.db.update(T('files'),[eq('id',f.id)],{preview_state:'unsupported'});return false;}
    const meta=await (await this.s.google()).stat(f.drive_file_id);
    if(!meta.thumbnailLink) {if(job.attempt<3) throw new IntegrationError('PREVIEW_PENDING',503,true);await this.db.update(T('files'),[eq('id',f.id)],{preview_state:'unsupported'});return false;}
    const url=new URL(meta.thumbnailLink);
    if(url.protocol!=='https:' || !(url.hostname==='googleusercontent.com'||url.hostname.endsWith('.googleusercontent.com')))fail('PREVIEW_HOST_REJECTED',502);
    const res=await this.s.fetcher(url,{signal:AbortSignal.timeout(20000),redirect:'error'});
    if(!res.ok)throw new IntegrationError('PREVIEW_UNAVAILABLE',503,true);
    const bytes=await readLimited(res,1048576);
    const mime=(res.headers.get('content-type')||'').split(';')[0];
    if(!['image/jpeg','image/png','image/webp'].includes(mime))fail('PREVIEW_TYPE_REJECTED',502);
    const path=`${f.id}/drive-preview.${mime==='image/jpeg'?'jpg':mime==='image/png'?'png':'webp'}`;
    try{await this.s.storage.upload('dtg-previews',path,bytes,mime);}catch(e){if(!await this.s.storage.stat('dtg-previews',path))throw e;}
    await this.db.update(T('files'),[eq('id',f.id)],{thumbnail_path:path,preview_state:'ready'});return false;
  }
  async driveDeliveryCopy(job,p,f,g) {
    if(f.storage_provider==='GOOGLE_DRIVE')return f.drive_file_id;
    const key=`delivery-copy:${f.id}`; let copy=await this.s.privateGet(key);
    if(!copy){copy={id:await g.generateFileId()};await this.s.privateSet(key,copy);}
    try{const meta=await g.stat(copy.id);if(!meta.trashed&&Number(meta.size)===Number(f.size_bytes))return copy.id;}catch(e){if(e.code!=='MISSING_EXTERNAL')throw e;}
    if(!copy.uri){copy.uri=await g.beginUpload(copy.id,f.filename,f.mime_type,Number(f.size_bytes),this.s.env.GOOGLE_DRIVE_PARENT_ID||null);await this.s.privateSet(key,copy);}
    const status=await g.uploadStatus(copy.uri,Number(f.size_bytes)); if(status.complete)return copy.id;
    const bytes=await this.s.storage.download('dtg-originals',f.storage_key,52428800);
    let offset=status.offset;
    while(offset<bytes.length){await this.persist(job,p);const end=Math.min(offset+4194304,bytes.length),r=await g.uploadChunk(copy.uri,bytes.slice(offset,end),offset,bytes.length);if(r.offset<=offset)fail('UPLOAD_STALLED',409);offset=r.offset;}
    return copy.id;
  }
  async deliver(job,p) {
    const d=await this.db.one(T('vendor_deliveries'),[eq('id',p.delivery_id)]);
    if(!d||d.revoked_at||Date.parse(d.access_expires_at)<=Date.now())fail('ACCESS_EXPIRED',409);
    const f=await this.db.one(T('files'),[eq('id',d.file_id)]),asset=await this.db.one(T('assets'),[eq('id',f.asset_id)]);
    await this.context(d.actor_id,asset.origin_ticket_id);
    const usage=await this.db.one(T('asset_usages'),[eq('file_id',f.id),eq('ticket_id',d.ticket_id)]);
    const ctx=await this.context(job.actor_id,d.ticket_id,d.inbox_id,true);
    vendorEligibility(f,usage||{},ctx.is_admin,d.override_reason);
    const vendor=await this.db.one(T('vendors'),[eq('id',d.vendor_id)]);if(!vendor?.active)fail('VENDOR_UNAVAILABLE',409);
    const g=await this.s.google(),driveId=await this.driveDeliveryCopy(job,p,f,g),meta=await g.stat(driveId);
    if(meta.trashed) {await this.db.update(T('files'),[eq('id',f.id)],{availability:'missing_external'});fail('MISSING_EXTERNAL',404);}
    if(Number(meta.size)!==Number(f.size_bytes)||(f.checksum&&meta.md5Checksum!==f.checksum))fail('ORIGINAL_CHANGED_EXTERNALLY',409);
    // Parent ACL can expose siblings. Managed folder must remain owner-only.
    for(const parent of meta.parents||[]){const perms=(await g.listPermissions(parent)).permissions||[];if(perms.some(x=>x.role!=='owner'))fail('PARENT_SHARING_UNSAFE',409);}
    const perms=(await g.listPermissions(driveId)).permissions||[];
    if(perms.some(x=>['anyone','domain','group'].includes(x.type)))fail('BROAD_SHARING_DETECTED',409);
    let grant=await this.db.one(T('vendor_grants'),[eq('file_id',f.id),eq('recipient_email',d.recipient_email)]);
    const existing=perms.find(x=>x.type==='user'&&x.emailAddress?.toLowerCase()===d.recipient_email);
    if(existing&&existing.role!=='reader')fail('EXISTING_ACCESS_TOO_BROAD',409);
    if(!grant) {
      if(existing)fail('PREEXISTING_VENDOR_ACCESS',409);
      grant=await this.db.insert(T('vendor_grants'),{file_id:f.id,drive_file_id:driveId,recipient_email:d.recipient_email,expires_at:d.access_expires_at,state:'pending',managed:true});
    }
    await this.db.update(T('vendor_deliveries'),[eq('id',d.id)],{grant_id:grant.id});
    const expires=Date.parse(grant.expires_at)>Date.parse(d.access_expires_at)?grant.expires_at:d.access_expires_at;
    let permission=existing;
    if(permission&&grant.permission_id!==permission.id) {
      // Lost response to permission creation cannot prove ownership. Do not adopt
      // an external permission, email a misleading link, or revoke it automatically.
      fail('GRANT_RECONCILIATION_REQUIRED',409);
    }
    if(!permission) {
      try{permission=await g.grant(driveId,d.recipient_email,expires);}
      catch(e){if(e.retryable)fail('GRANT_RECONCILIATION_REQUIRED',409);throw e;}
      await this.db.update(T('vendor_grants'),[eq('id',grant.id)],{permission_id:permission.id,state:'granted',expires_at:expires,confirmed_at:date()});
    } else if(Date.parse(permission.expirationTime||0)<Date.parse(expires)) {
      permission=await g.extend(driveId,permission.id,expires);
      await this.db.update(T('vendor_grants'),[eq('id',grant.id)],{state:'granted',expires_at:expires,confirmed_at:date()});
    }
    // Require native expiry; no silent fallback with a false exact-expiry promise.
    const confirmed=((await g.listPermissions(driveId)).permissions||[]).find(x=>x.id===permission.id);
    if(!confirmed?.expirationTime||Math.abs(Date.parse(confirmed.expirationTime)-Date.parse(expires))>1000)fail('NATIVE_EXPIRY_UNCONFIRMED',409);
    const box=await this.db.one(T('email_inboxes'),[eq('id',d.inbox_id)]);
    await this.db.update(T('vendor_deliveries'),[eq('id',d.id)],{email_state:'sending',last_error:null});
    const link=meta.webViewLink||`https://drive.google.com/file/d/${encodeURIComponent(driveId)}/view`;
    const messageId=await this.sendRaw(job,p,g,box,{to:[d.recipient_email],subject:`Archivo de producción — ${f.filename}`,body:`Hola ${vendor.name},\n\nArchivo: ${f.filename}\nVersión: ${f.version}\n\n${link}\n\nAcceso de lectura hasta ${d.access_expires_at}.`},d.ticket_id);
    await this.db.update(T('vendor_deliveries'),[eq('id',d.id)],{email_state:'sent',external_message_id:messageId,last_error:null});return false;
  }
  async scheduleExpirations() {
    const expired=await this.db.list(T('vendor_grants'),[['expires_at','lte',date()],['state','in',['granted','revoke_pending']]],{limit:50});
    for(const grant of expired) {
      const scope=`vendor:${grant.file_id}:${grant.recipient_email}`;
      const jobs=await this.db.list(T('integration_jobs'),[eq('scope_key',scope),eq('kind','revoke_grant'),['state','in',['queued','running','retry']]],{limit:1});
      if(jobs.length)continue;
      const saved=this.s.actor;this.s.actor=null;
      await this.s.enqueue('revoke_grant',scope,{grant_id:grant.id},crypto.randomUUID());this.s.actor=saved;
    }
  }
  async scheduleSync() {
    const connection=await this.s.connection();if(connection?.state!=='connected'||!connection.connected_by)return;
    if(connection.last_sync_at&&Date.now()-Date.parse(connection.last_sync_at)<60000)return;
    const existing=await this.db.list(T('integration_jobs'),[eq('kind','sync_email'),['state','in',['queued','running','retry']]],{limit:1});if(existing.length)return;
    const failed=await this.db.list(T('integration_jobs'),[eq('kind','sync_email'),eq('state','failed')],{order:'created_at',limit:1});
    if(failed.length&&(!connection.last_sync_at||Date.parse(failed[0].created_at)>Date.parse(connection.last_sync_at)))return;
    const context=await this.db.rpc('dtg_actor_context',{p_actor:connection.connected_by});if(!context?.active||!context.is_admin)return;
    const saved=this.s.actor;this.s.actor=connection.connected_by;await this.s.enqueue('sync_email','gmail-sync',{},crypto.randomUUID());this.s.actor=saved;
  }
  async revoke(job,p) {
    const grant=await this.db.one(T('vendor_grants'),[eq('id',p.grant_id)]);if(!grant||!grant.managed)fail('UNMANAGED_PERMISSION',409);
    const active=await this.db.list(T('vendor_deliveries'),[eq('grant_id',grant.id),['revoked_at','is',null],['access_expires_at','gt',date()]],{limit:1});
    if(active.length)return false;
    if(!grant.permission_id) {await this.db.update(T('vendor_grants'),[eq('id',grant.id)],{state:'revoked',confirmed_at:date()});return false;}
    await this.db.update(T('vendor_grants'),[eq('id',grant.id)],{state:'revoke_pending'});
    const g=await this.s.google();
    try{await g.revoke(grant.drive_file_id,grant.permission_id);}catch(e){if(e.code!=='MISSING_EXTERNAL')throw e;}
    let remaining=[];try{remaining=(await g.listPermissions(grant.drive_file_id)).permissions||[];}catch(e){if(e.code!=='MISSING_EXTERNAL')throw e;}
    if(remaining.some(x=>x.id===grant.permission_id))throw new IntegrationError('REVOCATION_UNCONFIRMED',503,true);
    await this.db.update(T('vendor_grants'),[eq('id',grant.id)],{state:Date.parse(grant.expires_at)<=Date.now()?'expired':'revoked',confirmed_at:date()});return false;
  }
}
