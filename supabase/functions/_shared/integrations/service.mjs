import { IntegrationError, fail, uuid, email, text, header, selectStorage, messageMetadata, vendorEligibility, expiry, retryDelay, buildMime, digest, seal, unseal, mailReadiness, base64url } from './core.mjs';
import { eq } from './store.mjs';
import { GoogleAdapter, readLimited } from './google.mjs';

const T = name => `dtg_${name}`;
const now = () => new Date().toISOString();
export class IntegrationService {
  constructor({ admin, user, actor, storage, env, fetcher = fetch, googleFactory = null }) {
    Object.assign(this, { admin, user, actor, storage, env, fetcher });
    this.googleFactory = googleFactory || (token => new GoogleAdapter(token, fetcher));
  }
  async policy() { return await this.admin.one(T('integration_config'), [eq('id', true)]) || fail('INTEGRATIONS_NOT_CONFIGURED', 503); }
  async active() { const cfg = await this.policy(); if (!cfg.enabled) fail('INTEGRATIONS_DISABLED', 503); return cfg; }
  async isAdmin() { return !!(await this.user.rpc('is_admin')); }
  async requireAdmin() { if (!await this.isAdmin()) fail('FORBIDDEN', 403); }
  async ticket(id) { const t = await this.user.one('tickets', [eq('id', uuid(id))]); if (!t) fail('TICKET_UNAVAILABLE', 404); return t; }
  async file(id) {
    const f = await this.user.one(T('files'), [eq('id', uuid(id))]); if (!f) fail('FILE_UNAVAILABLE', 404);
    const a = await this.user.one(T('assets'), [eq('id', f.asset_id)]); if (!a) fail('FILE_UNAVAILABLE', 404); return { f, a };
  }
  async inbox(id, send = false) {
    const box = await this.user.one(T('email_inboxes'), [eq('id', uuid(id))]); if (!box || !box.active) fail('INBOX_UNAVAILABLE', 403);
    if (!await this.isAdmin()) {
      const grant = await this.user.one(T('email_inbox_access'), [eq('inbox_id', id), eq('user_id', this.actor)]);
      if (!grant?.can_read || (send && !grant.can_send)) fail('INBOX_FORBIDDEN', 403);
    }
    if (send && box.verification_status !== 'accepted') fail('ALIAS_NOT_VERIFIED', 409); return box;
  }
  async audit(kind, details = {}, scope = {}) {
    return this.admin.insert(T('integration_events'), { kind, details, actor_id: this.actor || null, ticket_id: scope.ticket_id || null, inbox_id: scope.inbox_id || null, operation_id: scope.operation_id || null });
  }
  key() { if (!this.env.INTEGRATION_ENCRYPTION_KEY) fail('SECRETS_NOT_CONFIGURED', 503); return this.env.INTEGRATION_ENCRYPTION_KEY; }
  async privateGet(key) { const r = await this.admin.one(T('integration_private'), [eq('key', key)]); return r ? unseal(r.encrypted_value, this.key(), key) : null; }
  async privateSet(key, value, expires_at = null) { return this.admin.upsert(T('integration_private'), { key, encrypted_value: await seal(value, this.key(), key), expires_at, updated_at: now() }, 'key'); }
  async connection(id=null) { return this.admin.one(T('google_connections'), id?[eq('id',uuid(id))]:[eq('singleton', true)]); }
  async google(connectionId=null) {
    const c = await this.connection(connectionId); if (!c || c.state !== 'connected') fail('GOOGLE_NOT_CONNECTED', 503);
    let secret = await this.privateGet(`google:${c.id}`); if (!secret?.refresh_token) fail('REAUTH_REQUIRED', 401);
    if (!secret.access_token || secret.expires_at < Date.now() + 60000) {
      let res;
      try { res = await this.fetcher('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ client_id: this.env.GOOGLE_CLIENT_ID, client_secret: this.env.GOOGLE_CLIENT_SECRET, refresh_token: secret.refresh_token, grant_type: 'refresh_token' }), signal: AbortSignal.timeout(20000) }); }
      catch { throw new IntegrationError('PROVIDER_UNAVAILABLE', 503, true); }
      const tokens = await res.json();
      if (!res.ok) {
        if (tokens.error === 'invalid_grant') { await this.admin.update(T('google_connections'), [eq('id', c.id)], { state: 'reauth_required', last_error: 'REAUTH_REQUIRED' }); fail('REAUTH_REQUIRED', 401); }
        throw new IntegrationError('TOKEN_REFRESH_FAILED', 503, true);
      }
      secret = { ...secret, ...tokens, expires_at: Date.now() + tokens.expires_in * 1000 };
      await this.privateSet(`google:${c.id}`, secret);
    }
    return this.googleFactory(secret.access_token);
  }
  async enqueue(kind, scopeKey, payload, idempotencyKey, scope = {}) {
    const key = uuid(idempotencyKey), fingerprint = await digest(JSON.stringify({ payload, ticket_id: scope.ticket_id || null, inbox_id: scope.inbox_id || null }));
    const old = await this.admin.one(T('integration_jobs'), [eq('idempotency_key', key)]);
    if (old) { if (old.actor_id !== this.actor || old.kind !== kind || old.request_fingerprint !== fingerprint) fail('IDEMPOTENCY_CONFLICT', 409); return { operation_id: old.id, state: old.state }; }
    const id = crypto.randomUUID();
    const value = { id, actor_id: this.actor, kind, scope_key: scopeKey, idempotency_key: key, request_fingerprint: fingerprint, ticket_id: scope.ticket_id || null, inbox_id: scope.inbox_id || null,
      payload: { sealed: await seal(payload, this.key(), `job:${id}`) } };
    try { await this.admin.insert(T('integration_jobs'), value); }
    catch (e) { const winner = await this.admin.one(T('integration_jobs'), [eq('idempotency_key', key)]); if (!winner || winner.actor_id !== this.actor || winner.kind !== kind || winner.request_fingerprint !== fingerprint) throw e; return { operation_id: winner.id, state: winner.state }; }
    await this.audit(`${kind}.queued`, {}, { ...scope, operation_id: id });
    return { operation_id: id, state: 'queued' };
  }
  async status() {
    const cfg = await this.policy(); const boxes = await this.user.list(T('email_inboxes'));
    const admin = await this.isAdmin();
    const allConnections=await this.admin.list(T('google_connections'));const connections=admin?allConnections:[];
    const connection = connections.find(c=>c.singleton)||null;
    const permissions=admin?[]:await this.user.list(T('email_inbox_access'),[eq('user_id',this.actor)]);
    for(const box of boxes){const grant=permissions.find(g=>g.inbox_id===box.id);const c=allConnections.find(c=>box.connection_id?c.id===box.connection_id:c.singleton);box.can_send=admin||!!grant?.can_send;box.connected=c?.state==='connected';box.account_email=c?.account_email||null;}
    return { enabled: cfg.enabled, domain: cfg.domain, setup: admin ? mailReadiness(this.env, connections.find(c=>c.state==='connected')) : null, connections: connections.map(c=>({id:c.id,account_email:c.account_email,state:c.state,last_sync_at:c.last_sync_at,singleton:c.singleton})), connection: connection && { state: connection.state, account_email: connection.account_email, last_sync_at: connection.last_sync_at, last_error: connection.last_error }, inboxes: boxes };
  }
  async configure(input) {
    await this.requireAdmin(); const patch = {};
    for (const k of ['drive_extensions','drive_mime_types','drive_purposes']) if (input[k] !== undefined) {
      if (!Array.isArray(input[k]) || input[k].length > 100) fail('INVALID_POLICY'); patch[k] = input[k].map(x => header(x, 150).toLowerCase());
    }
    if (input.threshold_bytes !== undefined) { const n = Number(input.threshold_bytes); if (!Number.isSafeInteger(n) || n < 1 || n > 52428800) fail('INVALID_THRESHOLD'); patch.threshold_bytes = n; }
    if (input.enabled !== undefined) { if (typeof input.enabled !== 'boolean') fail('INVALID_POLICY'); if (input.enabled) { const ready = mailReadiness(this.env, await this.connection()); if (!ready.configured) fail('SECRETS_NOT_CONFIGURED',503); if (!ready.connected) fail('GOOGLE_NOT_CONNECTED',503); } patch.enabled = input.enabled; }
    await this.admin.update(T('integration_config'), [eq('id', true)], patch); await this.audit('configuration.changed', { fields: Object.keys(patch) }); return this.status();
  }
  async beginOAuth(input={}) {
    await this.requireAdmin(); const cfg = await this.policy();
    if (!this.env.GOOGLE_CLIENT_ID || !this.env.GOOGLE_CLIENT_SECRET || !this.env.GOOGLE_REDIRECT_URI) fail('OAUTH_NOT_CONFIGURED', 503);
    const requested=input.account_email?email(input.account_email):null;if(requested&&requested.split('@')[1]!==cfg.domain)fail('WORKSPACE_DOMAIN_MISMATCH',403);
    const state = crypto.randomUUID() + crypto.randomUUID(), verifier = crypto.randomUUID() + crypto.randomUUID();
    const stateKey = `oauth:${await digest(state)}`;
    await this.privateSet(stateKey, { actor: this.actor, verifier, requested }, new Date(Date.now() + 600000).toISOString());
    const scopes = ['https://www.googleapis.com/auth/gmail.modify','https://www.googleapis.com/auth/gmail.send','https://www.googleapis.com/auth/gmail.settings.basic','https://www.googleapis.com/auth/drive.file'];
    const q = new URLSearchParams({ client_id: this.env.GOOGLE_CLIENT_ID, redirect_uri: this.env.GOOGLE_REDIRECT_URI, response_type: 'code', access_type: 'offline', prompt: 'consent select_account', ...(requested?{login_hint:requested}:{}), scope: scopes.join(' '), state, hd: cfg.domain, code_challenge: await digest(verifier), code_challenge_method: 'S256' });
    await this.audit('oauth.started'); return { url: `https://accounts.google.com/o/oauth2/v2/auth?${q}` };
  }
  async completeOAuth(code, state) {
    const key = `oauth:${await digest(text(state, 200, true))}`;
    const row = await this.admin.one(T('integration_private'), [eq('key', key)]);
    if (!row || Date.parse(row.expires_at) <= Date.now()) fail('OAUTH_STATE_INVALID', 403);
    // Atomic delete-return via RPC: one callback can consume a state.
    const claimed = await this.admin.rpc('dtg_consume_oauth_state', { p_key: key });
    if (!claimed) fail('OAUTH_STATE_INVALID', 403);
    const saved = await unseal(claimed, this.key(), key); this.actor = saved.actor;
    const member = await this.admin.rpc('dtg_actor_context', { p_actor: this.actor });
    if (!member?.active || !member.is_admin) fail('FORBIDDEN', 403);
    const cfg = await this.policy();
    const res = await this.fetcher('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ code: text(code, 2000, true), client_id: this.env.GOOGLE_CLIENT_ID, client_secret: this.env.GOOGLE_CLIENT_SECRET, redirect_uri: this.env.GOOGLE_REDIRECT_URI, code_verifier: saved.verifier, grant_type: 'authorization_code' }), signal: AbortSignal.timeout(20000) });
    const tokens = await res.json(); if (!res.ok || !tokens.access_token) fail('OAUTH_EXCHANGE_FAILED', 409);
    const granted = String(tokens.scope || '').split(' ');
    if (['gmail.modify','gmail.send','gmail.settings.basic','drive.file'].some(s => !granted.includes(`https://www.googleapis.com/auth/${s}`))) fail('OAUTH_SCOPES_INCOMPLETE', 403);
    const google = this.googleFactory(tokens.access_token), profile = await google.profile();
    if (email(profile.emailAddress).split('@')[1] !== cfg.domain) fail('WORKSPACE_DOMAIN_MISMATCH', 403);
    if(saved.requested&&saved.requested!==email(profile.emailAddress))fail('WORKSPACE_ACCOUNT_MISMATCH',409);
    const old = await this.admin.one(T('google_connections'),[eq('account_email',email(profile.emailAddress))]);
    const primary=await this.connection();
    const oldSecret = old ? await this.privateGet(`google:${old.id}`) : null;
    if (!tokens.refresh_token && !oldSecret?.refresh_token) fail('OAUTH_OFFLINE_ACCESS_REQUIRED', 409);
    const id = old?.id || crypto.randomUUID();
    // Persist disconnected metadata first; mark connected only after encrypted tokens exist.
    await this.admin.upsert(T('google_connections'), { id, singleton: old?old.singleton:!primary, account_email: email(profile.emailAddress), state: 'disconnected', scopes: granted, connected_by: this.actor }, 'id');
    await this.privateSet(`google:${id}`, { ...oldSecret, ...tokens, expires_at: Date.now() + tokens.expires_in * 1000 });
    await this.admin.update(T('google_connections'), [eq('id', id)], { state: 'connected', last_error: null });
    const primaryInbox = await this.admin.one(T('email_inboxes'), [eq('email_alias', email(profile.emailAddress))]);
    if (!primaryInbox) await this.admin.insert(T('email_inboxes'), { connection_id:id,email_alias: email(profile.emailAddress), display_name: 'Primary Inbox', logical_inbox: 'primary', purpose: 'general', default_from_name: '956 Print', active: true });
    await this.validateAliases(google,id); await this.audit('oauth.connected', { account: profile.emailAddress }); return { state: 'connected' };
  }
  async validateAliases(google = null, connectionId = null) {
    if(!google){await this.requireAdmin();let total=0;for(const c of await this.admin.list(T('google_connections'),[eq('state','connected')]))total+=(await this.validateAliases(await this.google(c.id),c.id)).validated;return{validated:total};}
    const g=google,connection=await this.connection(connectionId);if(!connection)fail('GOOGLE_NOT_CONNECTED',503);
    const aliases = (await g.listAliases()).sendAs || [];
    const cfg=await this.policy();
    for(const alias of aliases){const address=email(alias.sendAsEmail);if(address.split('@')[1]!==cfg.domain)continue;const old=await this.admin.one(T('email_inboxes'),[eq('email_alias',address)]);if(!old)await this.admin.insert(T('email_inboxes'),{connection_id:connection.id,email_alias:address,display_name:alias.displayName||address,logical_inbox:address.split('@')[0],purpose:'general',default_from_name:alias.displayName||'956 Print'});}
    const inboxes = await this.admin.list(T('email_inboxes'));
    for (const box of inboxes) {
      if(box.connection_id&&box.connection_id!==connection.id)continue;
      const remote = aliases.find(x => x.sendAsEmail.toLowerCase() === box.email_alias);
      await this.admin.update(T('email_inboxes'), [eq('id', box.id)], { connection_id:remote?connection.id:box.connection_id,verification_status: remote ? (remote.verificationStatus === 'accepted'||(remote.isPrimary===true&&remote.sendAsEmail.toLowerCase()===connection.account_email.toLowerCase())) ? 'accepted' : 'pending' : 'missing' });
    }
    return { validated: inboxes.length };
  }
  async disconnect(input={}) {
    await this.requireAdmin(); const c = await this.connection(input.connection_id||null); if (!c) return { state: 'disconnected' };
    await this.admin.update(T('google_connections'), [eq('id', c.id)], { state: 'disconnected' });
    await this.admin.update(T('email_inboxes'),[eq('connection_id',c.id)],{verification_status:'unverified'});
    await this.admin.remove(T('integration_private'), [eq('key', `google:${c.id}`)]); await this.audit('oauth.disconnected'); return { state: 'disconnected' };
  }
  async saveInbox(input) {
    await this.requireAdmin(); const cfg = await this.policy(), alias = email(input.email_alias);
    if (alias.split('@')[1] !== cfg.domain) fail('ALIAS_DOMAIN_MISMATCH');
    const old = await this.admin.one(T('email_inboxes'), [eq('email_alias', alias)]);
    const box = await this.admin.upsert(T('email_inboxes'), { ...(old ? { id: old.id } : {}), email_alias: alias, display_name: text(input.display_name, 120, true), logical_inbox: text(input.logical_inbox, 80, true), purpose: text(input.purpose, 80, true), default_from_name: header(input.default_from_name || input.display_name, 120), default_signature: text(input.default_signature, 5000), active: input.active !== false, verification_status: old?.verification_status || 'unverified' }, 'email_alias');
    await this.audit('inbox.configured', { inbox_id: box.id }); return box;
  }
  async setInboxAccess(input) {
    await this.requireAdmin(); const id = uuid(input.inbox_id), userId = uuid(input.user_id);
    const profile = await this.admin.one('profiles', [eq('id', userId)]); if (!profile?.active) fail('MEMBER_UNAVAILABLE');
    await this.admin.upsert(T('email_inbox_access'), { inbox_id: id, user_id: userId, can_read: !!input.can_read, can_send: !!input.can_read && !!input.can_send }, 'inbox_id,user_id');
    await this.audit('inbox.access_changed', { user_id: userId }, { inbox_id: id }); return { ok: true };
  }
  async sendEmail(input) {
    const cfg = await this.active(), box = await this.inbox(input.inbox_id, true);
    if (input.ticket_id) await this.ticket(input.ticket_id);
    // Resolve reply headers from an RLS-readable message, never browser-supplied metadata.
    if (input.reply_message_id) {
      const original = await this.user.one(T('email_messages'), [eq('id',uuid(input.reply_message_id))]);
      if (!original?.rfc_message_id || !original.thread_id || original.connection_id!==(box.connection_id||(await this.connection())?.id)) fail('THREAD_UNAVAILABLE',403);
      input = {...input, subject: original.subject || '(Sin asunto)', thread_id: original.thread_id, in_reply_to: original.rfc_message_id, references: original.rfc_message_id};
    }
    // Validate before accepting a durable command. Signature and alias revalidated in worker.
    buildMime(input, box, uuid(input.idempotency_key), cfg.domain);
    if (input.thread_id) {
      const messages = await this.user.list(T('email_messages'), [eq('connection_id',box.connection_id||(await this.connection())?.id),eq('thread_id', header(input.thread_id, 100))], { limit: 1 });
      if (!messages.length || !input.in_reply_to) fail('THREAD_UNAVAILABLE', 403);
    }
    return this.enqueue('send_email', `gmail-send`, { connection_id:box.connection_id||(await this.connection())?.id,inbox_id: box.id, to: input.to, cc: input.cc || [], bcc: input.bcc || [], subject: input.subject, body: input.body, thread_id: input.thread_id || null, in_reply_to: input.in_reply_to || null, references: input.references || null }, input.idempotency_key, { ticket_id: input.ticket_id, inbox_id: box.id });
  }
  async syncEmails(input) { await this.requireAdmin(); await this.active();const c=await this.connection(input.connection_id||null);if(c?.state!=='connected')fail('GOOGLE_NOT_CONNECTED',503);return this.enqueue('sync_email','gmail-sync:'+c.id,{connection_id:c.id},input.idempotency_key); }
  async getEmail(input) {
    const m = await this.user.one(T('email_messages'), [eq('id', uuid(input.message_id))]); if (!m) fail('EMAIL_UNAVAILABLE', 404);
    const message = await (await this.google(m.connection_id)).getEmail(m.external_message_id);
    if (!await this.isAdmin()) message.payload.headers = (message.payload?.headers || []).filter(h => h.name.toLowerCase() !== 'bcc');
    return { metadata: m, message };
  }
  async getThread(input) {
    const m = await this.user.one(T('email_messages'), [eq('id', uuid(input.message_id))]); if (!m) fail('EMAIL_UNAVAILABLE', 404);
    // Only authorized messages, never return unclassified/other-inbox members of a Gmail thread.
    const allowed = await this.user.list(T('email_messages'), [eq('connection_id',m.connection_id),eq('thread_id', m.thread_id)], { limit: 100 });
    const g = await this.google(m.connection_id); const thread = await g.getThread(m.thread_id);
    const messages = (thread.messages || []).filter(x => allowed.some(a => a.external_message_id === x.id));
    if (!await this.isAdmin()) for (const message of messages) if (message.payload) message.payload.headers = (message.payload.headers || []).filter(h => h.name.toLowerCase() !== 'bcc');
    return { id: m.thread_id, messages };
  }
  async attachEmail(input) {
    const m = await this.user.one(T('email_messages'), [eq('id', uuid(input.message_id))]); if (!m) fail('EMAIL_UNAVAILABLE', 404);
    const ticket = input.ticket_id ? await this.ticket(input.ticket_id) : null;
    let customer = ticket?.cliente_id || (input.customer_id ? uuid(input.customer_id) : null);
    if (customer && !await this.user.one('clientes', [eq('id', customer)])) fail('CUSTOMER_UNAVAILABLE', 404);
    if (!ticket && !customer) fail('LINK_REQUIRED');
    const old = await this.admin.one(T('email_links'), [eq('message_id', m.id), ticket ? eq('ticket_id', ticket.id) : eq('customer_id', customer)]);
    const link = old || await this.admin.insert(T('email_links'), { message_id: m.id, ticket_id: ticket?.id || null, customer_id: customer, linked_by: this.actor });
    await this.audit('email.linked', { message_id: m.id }, { ticket_id: ticket?.id }); return link;
  }
  async setEmailState(input) {
    await this.active();const box=await this.inbox(input.inbox_id,true),m=await this.user.one(T('email_messages'),[eq('id',uuid(input.message_id))]);if(!m||m.connection_id!==box.connection_id)fail('EMAIL_UNAVAILABLE',404);
    const link=await this.user.one(T('email_message_inboxes'),[eq('message_id',m.id),eq('inbox_id',box.id)]);if(!link)fail('INBOX_FORBIDDEN',403);
    const actions={read:{removeLabelIds:['UNREAD']},unread:{addLabelIds:['UNREAD']},star:{addLabelIds:['STARRED']},unstar:{removeLabelIds:['STARRED']},archive:{removeLabelIds:['INBOX']}};const change=actions[input.state];if(!change)fail('INVALID_ACTION');
    const result=await(await this.google(m.connection_id)).modifyEmail(m.external_message_id,change);await this.admin.update(T('email_messages'),[eq('id',m.id)],{label_ids:result.labelIds||[]});await this.audit('email.state_changed',{message_id:m.id,state:input.state},{inbox_id:box.id});return{message_id:m.id,label_ids:result.labelIds||[]};
  }
  async listEmails(input) {
    const box = await this.inbox(input.inbox_id);
    const where = [eq('inbox_id', box.id)];
    if (input.before) where.push(['occurred_at','lt',new Date(input.before).toISOString()]);
    return this.user.list(T('email_inbox_messages'), where, { order: 'occurred_at', limit: 50 });
  }
  async listLinkedEmails(input) {
    let where;
    if (input.ticket_id) { const t = await this.ticket(input.ticket_id); where = [eq('ticket_id', t.id)]; }
    else {
      const customer = uuid(input.customer_id);if (!await this.user.one('clientes',[eq('id',customer)])) fail('CUSTOMER_UNAVAILABLE',404);
      const family = await this.admin.rpc('dtg_customer_family',{p_id:customer});where=[['customer_id','in',family]];
    }
    if (input.before) where.push(['linked_at','lt',new Date(input.before).toISOString()]);
    const links = await this.user.list(T('email_links'),where,{order:'linked_at',limit:50});if(!links.length)return[];
    return this.user.list(T('email_messages'),[['id','in',links.map(x=>x.message_id)]],{order:'occurred_at',limit:50});
  }
  async saveVendor(input) {
    await this.requireAdmin(); const row = { name: text(input.name, 150, true), email: email(input.email), production_type: text(input.production_type, 100, true), default_access_hours: Number(input.default_access_hours || 168), active: input.active !== false, ops_provider_key: input.ops_provider_key ? text(input.ops_provider_key, 300, true) : null };
    expiry(row.default_access_hours);
    if (row.ops_provider_key && !row.ops_provider_key.startsWith('ops_provider_v1:')) fail('INVALID_PROVIDER_KEY');
    const result = input.id ? (await this.admin.update(T('vendors'), [eq('id', uuid(input.id))], row))[0] : await this.admin.insert(T('vendors'), row);
    await this.audit('vendor.saved', { vendor_id: result.id }); return result;
  }
  async listVendors() { return this.user.list(T('vendors'), [eq('active', true)], { order: 'name', ascending: true }); }
  async beginUpload(input) {
    const cfg = await this.active(), ticket = await this.ticket(input.ticket_id), key = uuid(input.idempotency_key);
    const existing = await this.admin.one(T('upload_sessions'), [eq('actor_id', this.actor), eq('idempotency_key', key)]);
    if (existing) {
      const { f } = await this.file(existing.file_id);
      const usage = await this.user.one(T('asset_usages'),[eq('file_id',f.id),eq('ticket_id',ticket.id)]);
      if (!usage || f.filename !== input.filename || Number(f.size_bytes) !== Number(input.size_bytes) || f.mime_type !== (input.mime_type || 'application/octet-stream') || (input.asset_id && f.asset_id !== input.asset_id)) fail('IDEMPOTENCY_CONFLICT',409);
      return this.publicSession(existing, f);
    }
    const provider = selectStorage(input, cfg), filename = header(input.filename, 240), mime = header(input.mime_type || 'application/octet-stream', 150);
    if (input.asset_id) {
      const a = await this.user.one(T('assets'), [eq('id', uuid(input.asset_id))]); if (!a) fail('ASSET_UNAVAILABLE', 404);
      const canonical = id => this.admin.rpc('dtg_canonical_customer', { p_id: id });
      if (!ticket.cliente_id || await canonical(ticket.cliente_id) !== await canonical(a.customer_id)) fail('CUSTOMER_MISMATCH');
    }
    const id = crypto.randomUUID(); let driveId = null;
    if (provider === 'GOOGLE_DRIVE') driveId = await (await this.google()).generateFileId();
    const meta = { filename, mime_type: mime, size_bytes: Number(input.size_bytes), purpose: text(input.purpose || 'reference', 100, true), storage_provider: provider, storage_key: provider === 'SUPABASE' ? `${id}/original` : null, drive_file_id: driveId };
    const session = await this.admin.rpc('dtg_register_upload', { p_actor: this.actor, p_key: key, p_ticket: ticket.id, p_asset: input.asset_id || null, p_file: id, p_meta: meta, p_policy: cfg });
    const f = await this.admin.one(T('files'), [eq('id', session.file_id)]);
    await this.audit('upload.reserved', { file_id: f.id, provider: f.storage_provider }, { ticket_id: ticket.id }); return this.publicSession(session, f);
  }
  publicSession(session, f) { return { session_id: session.id, file_id: f.id, asset_id: f.asset_id, provider: f.storage_provider, state: session.state, confirmed_offset: Number(session.confirmed_offset), size_bytes: Number(f.size_bytes), chunk_bytes: 4194304, expires_at: session.expires_at }; }
  async withUpload(id, fn) {
    const own = await this.user.one(T('upload_sessions'), [eq('id', uuid(id)), eq('actor_id', this.actor)]); if (!own) fail('UPLOAD_UNAVAILABLE', 404);
    const { f } = await this.file(own.file_id);
    const rows = await this.admin.rpc('dtg_claim_upload', { p_id: id, p_actor: this.actor });
    if (!rows?.length) fail('UPLOAD_BUSY_OR_EXPIRED', 409); const s = rows[0];
    try { return await fn(s, f); }
    finally { await this.admin.update(T('upload_sessions'), [eq('id', id), eq('lease_token', s.lease_token)], { lease_until: null, lease_token: null }); }
  }
  async driveUploadSession(s, f, google) {
    const k = `upload:${s.id}`; let uri = await this.privateGet(k);
    if (!uri) { uri = await google.beginUpload(f.drive_file_id, f.filename, f.mime_type, Number(f.size_bytes), this.env.GOOGLE_DRIVE_PARENT_ID || null); await this.privateSet(k, uri, s.expires_at); }
    return uri;
  }
  async uploadChunk(input, bytes) {
    await this.active();
    return this.withUpload(input.session_id, async (s, f) => {
      if (s.state === 'complete') {
        await this.enqueue('preview', `preview:${f.id}`, { file_id: f.id }, f.id);
        return this.publicSession(s, f);
      }
      const offset = Number(input.offset), total = Number(f.size_bytes);
      if (!Number.isSafeInteger(offset) || offset !== Number(s.confirmed_offset)) fail('UPLOAD_OFFSET_CONFLICT', 409);
      if (!bytes.byteLength || bytes.byteLength > 4194304 || offset + bytes.byteLength > total) fail('INVALID_CHUNK');
      if (f.storage_provider === 'SUPABASE') fail('USE_SMALL_UPLOAD');
      if (offset + bytes.byteLength < total && bytes.byteLength % 262144) fail('INVALID_CHUNK_ALIGNMENT');
      const g = await this.google(), uri = await this.driveUploadSession(s, f, g);
      let result;
      try { result = await g.uploadChunk(uri, bytes, offset, total); }
      catch (e) { await this.admin.update(T('upload_sessions'), [eq('id', s.id)], { last_error: e.code || 'UPLOAD_INTERRUPTED' }); throw e; }
      if (result.offset < offset || result.offset > total) fail('INVALID_PROVIDER_OFFSET', 502);
      await this.admin.update(T('upload_sessions'), [eq('id', s.id)], { confirmed_offset: result.offset, state: 'uploading', last_error: null });
      return this.publicSession({ ...s, confirmed_offset: result.offset, state: 'uploading' }, f);
    });
  }
  async smallUpload(input, bytes) {
    await this.active();
    return this.withUpload(input.session_id, async (s, f) => {
      if (s.state === 'complete') return this.publicSession(s, f);
      if (f.storage_provider !== 'SUPABASE' || bytes.byteLength !== Number(f.size_bytes)) fail('INVALID_SMALL_UPLOAD');
      // Existing object after a lost response is reconciled; immutable path is never overwritten.
      let exists = null; try { exists = await this.storage.stat('dtg-originals', f.storage_key); } catch (e) { if (e.code !== 'MISSING_EXTERNAL') throw e; }
      if (exists && exists.size !== bytes.byteLength) fail('STORAGE_SIZE_MISMATCH', 409);
      if (!exists) await this.storage.upload('dtg-originals', f.storage_key, bytes, f.mime_type);
      await this.admin.update(T('upload_sessions'), [eq('id', s.id)], { confirmed_offset: bytes.byteLength, state: 'uploading', last_error: null });
      return this.publicSession({ ...s, confirmed_offset: bytes.byteLength, state: 'uploading' }, f);
    });
  }
  async resumeUpload(input) {
    await this.active(); return this.withUpload(input.session_id, async (s, f) => {
      if (s.state === 'complete') return this.publicSession(s, f);
      let result = { offset: 0 };
      if (f.storage_provider === 'GOOGLE_DRIVE') {
        const g = await this.google();
        try { const meta = await g.stat(f.drive_file_id); if (!meta.trashed && Number(meta.size) === Number(f.size_bytes)) result.offset = Number(meta.size); }
        catch (e) { if (e.code !== 'MISSING_EXTERNAL') throw e; }
        if (!result.offset) {
          const uri = await this.privateGet(`upload:${s.id}`);
          if (uri) {
            try { result = await g.uploadStatus(uri, Number(f.size_bytes)); }
            catch (e) { if (e.code !== 'MISSING_EXTERNAL') throw e; await this.admin.remove(T('integration_private'), [eq('key', `upload:${s.id}`)]); result = { offset: 0 }; }
          }
        }
      } else { try { result.offset = (await this.storage.stat('dtg-originals', f.storage_key)).size; } catch (e) { if (e.code !== 'MISSING_EXTERNAL') throw e; } }
      await this.admin.update(T('upload_sessions'), [eq('id', s.id)], { confirmed_offset: result.offset, state: 'uploading' }); return this.publicSession({ ...s, confirmed_offset: result.offset, state: 'uploading' }, f);
    });
  }
  async completeUpload(input) {
    await this.active(); return this.withUpload(input.session_id, async (s, f) => {
      if (s.state === 'complete') return this.publicSession(s, f);
      const meta = f.storage_provider === 'GOOGLE_DRIVE' ? await (await this.google()).stat(f.drive_file_id) : await this.storage.stat('dtg-originals', f.storage_key);
      if (meta.trashed || Number(meta.size) !== Number(f.size_bytes)) fail('UPLOAD_INCOMPLETE', 409);
      await this.admin.rpc('dtg_finalize_upload', { p_id: s.id, p_checksum: meta.md5Checksum || null });
      await this.enqueue('preview', `preview:${f.id}`, { file_id: f.id }, f.id);
      const a = await this.admin.one(T('assets'), [eq('id', f.asset_id)]);
      await this.audit('file.available', { file_id: f.id, version: f.version }, { ticket_id: a.origin_ticket_id });
      return this.publicSession({ ...s, state: 'complete', confirmed_offset: Number(f.size_bytes) }, f);
    });
  }
  async listFiles(input) {
    const ticket = await this.ticket(input.ticket_id);
    const usages = await this.user.list(T('asset_usages'), [eq('ticket_id', ticket.id)], { order: 'created_at', limit: 100 });
    if (!usages.length) return [];
    const files = await this.user.list(T('files'), [['id','in',usages.map(u => u.file_id)]], { limit: 100 });
    return files.map(f => ({ ...f, usage: usages.find(u => u.file_id === f.id) }));
  }
  async customerHistory(input) {
    const c = await this.user.one('clientes', [eq('id', uuid(input.customer_id))]); if (!c) fail('CUSTOMER_UNAVAILABLE', 404);
    const family = await this.admin.rpc('dtg_customer_family', { p_id: c.id });
    // RPC is SECURITY INVOKER on the USER client: origin-ticket RLS remains authoritative.
    return this.user.rpc('dtg_customer_file_history', { p_clients: family, p_before: input.before ? new Date(input.before).toISOString() : null, p_limit: 50 });
  }
  async reuseFile(input) {
    const t = await this.ticket(input.ticket_id), { f, a } = await this.file(input.file_id);
    if (f.availability !== 'available' || !t.cliente_id || !a.customer_id) fail('FILE_NOT_REUSABLE', 409);
    if (await this.admin.rpc('dtg_canonical_customer', { p_id: t.cliente_id }) !== await this.admin.rpc('dtg_canonical_customer', { p_id: a.customer_id })) fail('CUSTOMER_MISMATCH', 403);
    const old = await this.admin.one(T('asset_usages'), [eq('file_id', f.id), eq('ticket_id', t.id)]);
    const usage = old || await this.admin.insert(T('asset_usages'), { file_id: f.id, ticket_id: t.id, created_by: this.actor });
    await this.audit('file.reused', { file_id: f.id }, { ticket_id: t.id }); return usage;
  }
  async setFileStage(input) {
    const { f, a } = await this.file(input.file_id), stage = input.stage;
    if (!['Draft','Proof','Approved','Print Ready','Archived'].includes(stage)) fail('INVALID_STAGE');
    if (f.availability !== 'available') fail('FILE_UNAVAILABLE', 409);
    if (stage === 'Approved' || stage === 'Print Ready') await this.requireAdmin();
    await this.admin.rpc('dtg_change_file_stage', { p_id: f.id, p_stage: stage });
    await this.audit('file.stage_changed', { file_id: f.id, stage }, { ticket_id: a.origin_ticket_id }); return { stage };
  }
  async setCurrentVersion(input) { const { f, a } = await this.file(input.file_id); if (f.availability !== 'available') fail('FILE_UNAVAILABLE', 409); await this.admin.update(T('assets'), [eq('id', a.id)], { current_file_id: f.id }); await this.audit('asset.current_changed', { asset_id: a.id, file_id: f.id }, { ticket_id: a.origin_ticket_id }); return { current_file_id: f.id }; }
  async approveForProduction(input) {
    await this.requireAdmin(); const t = await this.ticket(input.ticket_id), { f } = await this.file(input.file_id);
    if (f.stage !== 'Print Ready' || f.availability !== 'available') fail('PRINT_READY_REQUIRED', 409);
    const usage = await this.user.one(T('asset_usages'), [eq('ticket_id', t.id), eq('file_id', f.id)]); if (!usage) fail('USAGE_REQUIRED');
    await this.admin.rpc('dtg_approve_usage', { p_file: f.id, p_ticket: t.id, p_actor: this.actor });
    await this.audit('production.approved', { file_id: f.id }, { ticket_id: t.id }); return { production_approved: true };
  }
  async getFileAccess(input) {
    const { f } = await this.file(input.file_id); if (f.availability !== 'available') fail('FILE_UNAVAILABLE', 409);
    if (input.preview) return { url: f.thumbnail_path ? await this.storage.signedUrl('dtg-previews', f.thumbnail_path) : null };
    if (f.storage_provider === 'SUPABASE') return { url: await this.storage.signedUrl('dtg-originals', f.storage_key) };
    // Google ACL is intentionally NOT granted to every employee on read. Stream via authorized download endpoint.
    return { download_via_backend: true, file_id: f.id, filename: f.filename, size_bytes: Number(f.size_bytes) };
  }
  async previewUpload(input, bytes) {
    const { f, a } = await this.file(input.file_id);
    if (bytes.length > 1048576 || bytes.length < 12 || input.mime_type !== 'image/jpeg' || bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255) fail('INVALID_PREVIEW');
    const path = `${f.id}/${crypto.randomUUID()}.jpg`; await this.storage.upload('dtg-previews', path, bytes, 'image/jpeg');
    await this.admin.update(T('files'), [eq('id', f.id)], { thumbnail_path: path, preview_state: 'ready' });
    await this.audit('preview.registered', { file_id: f.id }, { ticket_id: a.origin_ticket_id }); return { preview_state: 'ready' };
  }
  async sendToVendor(input) {
    await this.active(); const t = await this.ticket(input.ticket_id), { f } = await this.file(input.file_id);
    const usage = await this.user.one(T('asset_usages'), [eq('ticket_id', t.id), eq('file_id', f.id)]); if (!usage) fail('USAGE_REQUIRED');
    const rule = vendorEligibility(f, usage, await this.isAdmin(), input.override_reason);
    const vendor = await this.user.one(T('vendors'), [eq('id', uuid(input.vendor_id))]); if (!vendor?.active) fail('VENDOR_UNAVAILABLE');
    const box = await this.inbox(input.inbox_id, true), key = uuid(input.idempotency_key);
    const old = await this.admin.one(T('vendor_deliveries'), [eq('id', key)]);
    if (old && (old.actor_id !== this.actor || old.ticket_id !== t.id || old.file_id !== f.id || old.vendor_id !== vendor.id)) fail('IDEMPOTENCY_CONFLICT', 409);
    const delivery = old || await this.admin.insert(T('vendor_deliveries'), { id: key, ticket_id: t.id, file_id: f.id, vendor_id: vendor.id, inbox_id: box.id, actor_id: this.actor, recipient_email: email(vendor.email), override_reason: rule.reason, access_expires_at: expiry(input.access_hours || vendor.default_access_hours) });
    return this.enqueue('vendor_delivery', `vendor:${f.id}:${delivery.recipient_email}`, { delivery_id: delivery.id }, key, { ticket_id: t.id, inbox_id: box.id });
  }
  async revokeVendorAccess(input) {
    const d = await this.user.one(T('vendor_deliveries'), [eq('id', uuid(input.delivery_id))]); if (!d) fail('DELIVERY_UNAVAILABLE', 404);
    await this.ticket(d.ticket_id); await this.requireAdmin();
    await this.admin.update(T('vendor_deliveries'), [eq('id', d.id)], { revoked_at: now() });
    if (!d.grant_id) return { revoked: true, pending_delivery_cancelled: true };
    const g = await this.admin.one(T('vendor_grants'), [eq('id', d.grant_id)]);
    return this.enqueue('revoke_grant', `vendor:${d.file_id}:${d.recipient_email}`, { grant_id: g.id }, input.idempotency_key, { ticket_id: d.ticket_id });
  }
  async resendVendorLink(input) {
    const d = await this.user.one(T('vendor_deliveries'), [eq('id', uuid(input.delivery_id))]); if (!d || d.revoked_at || Date.parse(d.access_expires_at) <= Date.now()) fail('ACCESS_EXPIRED', 409);
    await this.ticket(d.ticket_id); await this.inbox(d.inbox_id, true);
    return this.enqueue('vendor_delivery', `vendor:${d.file_id}:${d.recipient_email}`, { delivery_id: d.id, resend: true }, input.idempotency_key, { ticket_id: d.ticket_id, inbox_id: d.inbox_id });
  }
  async retryOperation(input) {
    const job = await this.admin.one(T('integration_jobs'), [eq('id', uuid(input.operation_id))]); if (!job) fail('OPERATION_UNAVAILABLE', 404);
    if (job.ticket_id) await this.ticket(job.ticket_id); if (job.inbox_id) await this.inbox(job.inbox_id, true);
    if (job.actor_id !== this.actor) await this.requireAdmin();
    if (!['failed','unknown'].includes(job.state)) fail('OPERATION_NOT_RETRYABLE', 409);
    if (job.state === 'unknown' && !input.confirm_resend) fail('CONFIRM_RESEND_REQUIRED', 409);
    const payload = await unseal(job.payload.sealed, this.key(), `job:${job.id}`);
    if (input.confirm_resend) payload.confirm_resend = true;
    await this.admin.update(T('integration_jobs'), [eq('id', job.id), eq('state', job.state)], { state: 'retry', next_attempt_at: now(), payload: { sealed: await seal(payload, this.key(), `job:${job.id}`) } });
    await this.audit('operation.retry_requested', { confirm_resend: !!input.confirm_resend }, { operation_id: job.id, ticket_id: job.ticket_id, inbox_id: job.inbox_id }); return { operation_id: job.id, state: 'retry' };
  }
  async saveMailSignature(input) {await this.requireAdmin();const b=await this.inbox(input.inbox_id);await this.admin.update(T('email_inboxes'),[eq('id',b.id)],{default_from_name:header(input.from_name,120),default_signature:text(input.signature||'',5000)});await this.audit('email.signature_changed',{}, {inbox_id:b.id});return{saved:true};}
  async listMailDrafts() { return (await this.admin.list(T('mail_drafts'),[eq('actor_id',this.actor)],{order:'updated_at',limit:50})).map(d=>({id:d.id,subject:d.subject,updated_at:d.updated_at})); }
  async saveMailDraft(input) {
    const d=input.draft||{},id=input.draft_id?uuid(input.draft_id):crypto.randomUUID();
    if(input.draft_id&&!await this.admin.one(T('mail_drafts'),[eq('id',id),eq('actor_id',this.actor)]))fail('DRAFT_UNAVAILABLE',404);
    const safe={};for(const k of ['to','cc','bcc'])safe[k]=text(d[k]||'',3000);
    safe.subject=text(d.subject||'',300);safe.body=text(d.body||'',100000);safe.reply_message_id=d.reply_message_id?uuid(d.reply_message_id):'';safe.inbox_id=d.inbox_id?uuid(d.inbox_id):'';safe.ticket_id=d.ticket_id?uuid(d.ticket_id):'';
    if(safe.inbox_id)await this.inbox(safe.inbox_id);if(safe.ticket_id)await this.ticket(safe.ticket_id);
    if(safe.reply_message_id&&!await this.user.one(T('email_messages'),[eq('id',safe.reply_message_id)]))fail('EMAIL_UNAVAILABLE',404);
    const row=await this.admin.upsert(T('mail_drafts'),{id,actor_id:this.actor,subject:safe.subject,encrypted_payload:await seal(safe,this.key(),'draft:'+this.actor+':'+id),updated_at:now()},'id');return{id:row.id};
  }
  async getMailDraft(input) { const row=await this.admin.one(T('mail_drafts'),[eq('id',uuid(input.draft_id)),eq('actor_id',this.actor)]);if(!row)fail('DRAFT_UNAVAILABLE',404);return{id:row.id,draft:await unseal(row.encrypted_payload,this.key(),'draft:'+this.actor+':'+row.id)}; }
  async deleteMailDraft(input) {await this.admin.remove(T('mail_drafts'),[eq('id',uuid(input.draft_id)),eq('actor_id',this.actor)]);return{deleted:true};}
  async configureMail(input) {
    await this.requireAdmin();
    if((await this.admin.list(T('google_connections'))).length)fail('OAUTH_ALREADY_CONFIGURED',409);
    const id=text(input.client_id,300,true),secret=text(input.client_secret,3000,true);if(!id.endsWith('.apps.googleusercontent.com'))fail('INVALID_OAUTH_CLIENT');
    const config={SUPABASE_URL:this.env.SUPABASE_URL,GOOGLE_CLIENT_ID:id,GOOGLE_CLIENT_SECRET:secret,GOOGLE_REDIRECT_URI:this.env.SUPABASE_URL+'/functions/v1/google-oauth-callback'};
    for(const key of ['INTEGRATION_ENCRYPTION_KEY','INTEGRATION_WORKER_SECRET'])config[key]=this.env[key]||base64url(crypto.getRandomValues(new Uint8Array(32)));
    await this.admin.rpc('dtg_workspace_configure_secrets',{p_config:config});
    const saved=await this.admin.rpc('dtg_workspace_secrets');for(const [key,value]of Object.entries(saved))if(!this.env[key])this.env[key]=value;
    await this.audit('mail.configured');return this.status();
  }
  async processMailOperation(input) {
    await this.active();const job=await this.admin.one(T('integration_jobs'),[eq('id',uuid(input.operation_id))]);
    if(!job||!['send_email','sync_email'].includes(job.kind))fail('OPERATION_UNAVAILABLE',404);
    if(job.actor_id!==this.actor)await this.requireAdmin();
    if(job.ticket_id)await this.ticket(job.ticket_id);if(job.inbox_id)await this.inbox(job.inbox_id,true);
    if(job.kind==='sync_email')await this.requireAdmin();
    const {IntegrationWorker}=await import('./worker.mjs');await new IntegrationWorker(this).run(job.id);return this.operationStatus({operation_id:job.id});
  }
  async operationStatus(input) {
    const job = await this.admin.one(T('integration_jobs'), [eq('id', uuid(input.operation_id))]); if (!job) fail('OPERATION_UNAVAILABLE', 404);
    if (job.ticket_id) await this.ticket(job.ticket_id); if (job.inbox_id) await this.inbox(job.inbox_id);
    if (job.actor_id !== this.actor) await this.requireAdmin();
    return { operation_id: job.id, kind: job.kind, state: job.state, attempt: job.attempt, last_error: job.last_error, next_attempt_at: job.next_attempt_at };
  }
  async reconcileGrant(input) {
    await this.requireAdmin();
    const grant = await this.admin.one(T('vendor_grants'), [eq('id', uuid(input.grant_id))]);
    if (!grant || grant.state !== 'pending' || !input.confirm_management) fail('GRANT_RECONCILIATION_REQUIRED', 409);
    await this.file(grant.file_id);
    const permission = ((await (await this.google()).listPermissions(grant.drive_file_id)).permissions || []).find(x => x.id === header(input.permission_id, 200));
    if (!permission || permission.type !== 'user' || permission.role !== 'reader' || permission.emailAddress?.toLowerCase() !== grant.recipient_email) fail('PERMISSION_MISMATCH', 409);
    if (!permission.expirationTime) fail('NATIVE_EXPIRY_UNCONFIRMED', 409);
    await this.admin.update(T('vendor_grants'), [eq('id', grant.id)], { permission_id: permission.id, state: 'granted', confirmed_at: now(), managed: true });
    await this.audit('grant.management_confirmed', { grant_id: grant.id, permission_id: permission.id }); return { state: 'granted' };
  }
}
