// Deterministic rules shared by Edge Functions and Node tests. No credentials here.
export class IntegrationError extends Error {
  constructor(code, status = 400, retryable = false) {
    super(code); this.code = code; this.status = status; this.retryable = retryable;
  }
}
export const fail = (code, status = 400) => { throw new IntegrationError(code, status); };
export const uuid = value => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''))) fail('INVALID_ID');
  return String(value);
};
export function email(value) {
  const s = String(value || '').trim().toLowerCase();
  if (s.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(s)) fail('INVALID_EMAIL');
  return s;
}
export function text(value, max = 500, required = false) {
  const s = String(value ?? '').trim();
  if (s.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(s) || (required && !s)) fail('INVALID_TEXT');
  return s;
}
export function header(value, max = 500) {
  const s = text(value, max); if (/[\r\n]/.test(s)) fail('INVALID_HEADER'); return s;
}
export function selectStorage(input, policy) {
  const size = Number(input.size_bytes);
  if (!Number.isSafeInteger(size) || size < 1 || size > Number(policy.max_file_bytes)) fail('INVALID_FILE_SIZE');
  const filename = header(input.filename, 240);
  if (!filename || /[\\/]/.test(filename)) fail('INVALID_FILENAME');
  const mime = header(input.mime_type || 'application/octet-stream', 150).toLowerCase();
  if (!/^[\w.+-]+\/[\w.+-]+$/.test(mime)) fail('INVALID_MIME');
  const ext = filename.split('.').pop().toLowerCase();
  const forced = !!input.production_source_file || policy.drive_extensions.includes(ext)
    || policy.drive_mime_types.includes(mime) || policy.drive_purposes.includes(input.purpose);
  return forced || size > Number(policy.threshold_bytes) ? 'GOOGLE_DRIVE' : 'SUPABASE';
}
export function classifyMessage(message, inboxes) {
  const headers = message.payload?.headers || [];
  const active = inboxes.filter(i => i.active);
  const sent = (message.labelIds || []).includes('SENT');
  const names = sent ? ['from'] : ['delivered-to', 'x-original-to', 'x-envelope-to', 'to', 'cc'];
  const result = [];
  for (const inbox of active) {
    const alias = email(inbox.email_alias);
    const evidence = headers.filter(h => names.includes(h.name.toLowerCase()) && extractEmails(h.value).includes(alias))
      .map(h => h.name.toLowerCase());
    if (evidence.length) result.push({ inbox_id: inbox.id, delivered_alias: alias, evidence });
  }
  return { direction: sent ? 'outbound' : 'inbound', matches: result };
}
export function extractEmails(value) {
  return [...new Set((String(value || '').match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || []).map(x => x.toLowerCase()))];
}
export function messageMetadata(message, inboxes) {
  const headers = message.payload?.headers || [];
  const get = name => headers.filter(h => h.name.toLowerCase() === name).map(h => h.value).join(', ');
  const c = classifyMessage(message, inboxes);
  const timestamp = Number(message.internalDate);
  if (!Number.isFinite(timestamp)) fail('INVALID_MESSAGE_DATE');
  const hasAttachments = p => !!p?.filename || (p?.parts || []).some(hasAttachments);
  return { external_message_id: message.id, thread_id: message.threadId,
    from_address: get('from'), to_addresses: extractEmails(get('to')), cc_addresses: extractEmails(get('cc')),
    // BCC is deliberately excluded from shared metadata. Envelope stays in Gmail.
    subject: get('subject').slice(0, 1000), direction: c.direction,
    received_at: c.direction === 'inbound' ? new Date(timestamp).toISOString() : null,
    sent_at: c.direction === 'outbound' ? new Date(timestamp).toISOString() : null,
    has_attachments: hasAttachments(message.payload), sync_status: 'synced',
    rfc_message_id: get('message-id') || null, inboxes: c.matches };
}
export function vendorEligibility(file, usage, isAdmin, overrideReason) {
  if (file.availability !== 'available') fail('FILE_UNAVAILABLE', 409);
  const approved = file.stage === 'Print Ready' && usage.production_approved && usage.approved_file_id === file.id;
  if (!approved && (!isAdmin || !text(overrideReason, 1000))) fail('PRODUCTION_APPROVAL_REQUIRED', 403);
  return { override: !approved, reason: approved ? null : text(overrideReason, 1000, true) };
}
export function expiry(durationHours, now = Date.now()) {
  const n = Number(durationHours);
  if (!Number.isFinite(n) || n < 1 || n > 8760) fail('INVALID_ACCESS_DURATION');
  return new Date(now + n * 3600000).toISOString();
}
export function retryDelay(attempt, retryAfter, random = Math.random) {
  const seconds = Number(retryAfter);
  const until = Date.parse(retryAfter || '');
  const requested = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : Number.isFinite(until) ? Math.max(0, until - Date.now()) : 0;
  return Math.max(requested, Math.min(3600000, 1000 * 2 ** Math.min(attempt, 12)) + Math.floor(random() * 1000));
}
export function base64url(bytes) {
  let s = ''; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
export function unbase64url(value) {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
}
export async function digest(value) { return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))); }
export async function seal(value, keyBase64, context) {
  const key = await crypto.subtle.importKey('raw', unbase64url(keyBase64), 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(context) }, key, new TextEncoder().encode(JSON.stringify(value)));
  return `${base64url(iv)}.${base64url(new Uint8Array(bytes))}`;
}
export async function unseal(value, keyBase64, context) {
  const [iv, cipher] = value.split('.');
  const key = await crypto.subtle.importKey('raw', unbase64url(keyBase64), 'AES-GCM', false, ['decrypt']);
  const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unbase64url(iv), additionalData: new TextEncoder().encode(context) }, key, unbase64url(cipher));
  return JSON.parse(new TextDecoder().decode(bytes));
}
export function buildMime(input, inbox, operationId, domain) {
  const from = email(inbox.email_alias);
  if (from.split('@')[1] !== domain.toLowerCase()) fail('ALIAS_DOMAIN_MISMATCH');
  const recipients = (values, required) => {
    if (!Array.isArray(values) || values.length > 50 || (required && !values.length)) fail('INVALID_RECIPIENTS');
    return values.map(email).join(', ');
  };
  const to = recipients(input.to, true), cc = recipients(input.cc || [], false), bcc = recipients(input.bcc || [], false);
  const encode = s => `=?UTF-8?B?${btoa(String.fromCharCode(...new TextEncoder().encode(s)))}?=`;
  const name = header(inbox.default_from_name || inbox.display_name, 120);
  const lines = [`From: ${encode(name)} <${from}>`, `To: ${to}`,
    `Subject: ${encode(header(input.subject, 300))}`, `Message-ID: <dtg-${uuid(operationId)}@${domain}>`,
    `MIME-Version: 1.0`, `Content-Type: text/plain; charset=UTF-8`, `Content-Transfer-Encoding: base64`];
  if (cc) lines.push(`Cc: ${cc}`); if (bcc) lines.push(`Bcc: ${bcc}`);
  if (input.in_reply_to) lines.push(`In-Reply-To: ${header(input.in_reply_to, 1000)}`, `References: ${header(input.references || input.in_reply_to, 2000)}`);
  const body = text(input.body, 100000, true) + (inbox.default_signature ? '\n\n' + text(inbox.default_signature, 5000) : '');
  const encoded = base64url(new TextEncoder().encode(body)).replace(/-/g, '+').replace(/_/g, '/');
  const padded = encoded + '='.repeat((4 - encoded.length % 4) % 4);
  return base64url(new TextEncoder().encode(lines.join('\r\n') + '\r\n\r\n' + padded.match(/.{1,76}/g).join('\r\n')));
}
export function normalizeProviderError(response) {
  const status = response.status;
  if (status === 401) return new IntegrationError('REAUTH_REQUIRED', 401);
  if (status === 404) return new IntegrationError('MISSING_EXTERNAL', 404);
  if (status === 429 || status >= 500) {
    const e = new IntegrationError(status === 429 ? 'RATE_LIMITED' : 'PROVIDER_UNAVAILABLE', 503, true);
    e.retryAfter = response.headers.get('retry-after'); return e;
  }
  return new IntegrationError(status === 403 ? 'PROVIDER_FORBIDDEN' : 'PROVIDER_REJECTED', 409);
}
