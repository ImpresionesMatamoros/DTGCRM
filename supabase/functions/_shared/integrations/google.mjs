import { IntegrationError, normalizeProviderError } from './core.mjs';

export class GoogleAdapter {
  constructor(token, fetcher = fetch) { this.token = token; this.fetch = fetcher; }
  async request(url, options = {}) {
    let res;
    try { res = await this.fetch(url, { ...options, headers: { Authorization: `Bearer ${this.token}`, ...options.headers }, signal: AbortSignal.timeout(45000) }); }
    catch { throw new IntegrationError('PROVIDER_UNAVAILABLE', 503, true); }
    if (!res.ok) throw normalizeProviderError(res);
    return res.status === 204 ? null : res.json();
  }
  gmail(path, options) { return this.request(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, options); }
  getEmail(id, format = 'full') { return this.gmail(`messages/${encodeURIComponent(id)}?format=${format}`); }
  getThread(id) { return this.gmail(`threads/${encodeURIComponent(id)}?format=full`); }
  listAliases() { return this.gmail('settings/sendAs'); }
  modifyEmail(id,change) {return this.gmail('messages/'+encodeURIComponent(id)+'/modify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(change)});}
  profile() { return this.gmail('profile'); }
  listMessages(pageToken, query) {
    const q = new URLSearchParams({ maxResults: '50' }); if (pageToken) q.set('pageToken', pageToken); if (query) q.set('q', query);
    return this.gmail(`messages?${q}`);
  }
  history(cursor, pageToken) {
    const q = new URLSearchParams({ startHistoryId: cursor, maxResults: '50' }); if (pageToken) q.set('pageToken', pageToken);
    return this.gmail(`history?${q}`);
  }
  async sendEmail(raw, threadId) {
    // A failed HTTP response/network interruption after POST may mean Gmail sent it.
    // Callers reconcile; they MUST NOT automatically repeat this POST.
    try { return await this.gmail('messages/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ raw, ...(threadId ? { threadId } : {}) }) }); }
    catch (e) { if (e.retryable) throw new IntegrationError('UNKNOWN_SEND_RESULT', 409); throw e; }
  }
  findSent(messageId) { return this.listMessages(null, `in:sent rfc822msgid:${messageId}`); }
  drive(path, options) { return this.request(`https://www.googleapis.com/drive/v3/${path}`, options); }
  generateFileId() { return this.drive('files/generateIds?count=1&space=drive&type=files').then(x => x.ids[0]); }
  stat(id) { return this.drive(`files/${encodeURIComponent(id)}?fields=id,name,mimeType,size,md5Checksum,trashed,webViewLink,thumbnailLink,parents`); }
  async beginUpload(id, name, mime, size, parent) {
    const res = await this.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,size,md5Checksum', {
      method: 'POST', headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json', 'X-Upload-Content-Type': mime, 'X-Upload-Content-Length': String(size) },
      body: JSON.stringify({ id, name, mimeType: mime, ...(parent ? { parents: [parent] } : {}), appProperties: { dtg_managed: 'true' } }), signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw normalizeProviderError(res);
    const uri = res.headers.get('location');
    if (!uri || !uri.startsWith('https://www.googleapis.com/upload/drive/')) throw new IntegrationError('INVALID_UPLOAD_SESSION', 502);
    return uri;
  }
  async uploadChunk(uri, bytes, offset, total) {
    const res = await this.fetch(uri, { method: 'PUT', headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/octet-stream', 'Content-Range': `bytes ${offset}-${offset + bytes.byteLength - 1}/${total}` }, body: bytes, signal: AbortSignal.timeout(60000) });
    if (res.status === 308) return { offset: Number((res.headers.get('range') || '').match(/-(\d+)$/)?.[1] ?? -1) + 1, complete: false };
    if (!res.ok) throw normalizeProviderError(res);
    return { offset: total, complete: true, file: await res.json() };
  }
  async uploadStatus(uri, total) {
    const res = await this.fetch(uri, { method: 'PUT', headers: { Authorization: `Bearer ${this.token}`, 'Content-Range': `bytes */${total}` }, signal: AbortSignal.timeout(30000) });
    if (res.status === 308) return { offset: Number((res.headers.get('range') || '').match(/-(\d+)$/)?.[1] ?? -1) + 1, complete: false };
    if (!res.ok) throw normalizeProviderError(res);
    return { offset: total, complete: true, file: await res.json() };
  }
  listPermissions(id) { return this.drive(`files/${encodeURIComponent(id)}/permissions?fields=permissions(id,type,role,emailAddress,expirationTime,permissionDetails)&pageSize=100`); }
  grant(id, emailAddress, expirationTime) {
    return this.drive(`files/${encodeURIComponent(id)}/permissions?sendNotificationEmail=false&fields=id,type,role,emailAddress,expirationTime`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'user', role: 'reader', emailAddress, expirationTime }) });
  }
  extend(id, permissionId, expirationTime) {
    return this.drive(`files/${encodeURIComponent(id)}/permissions/${encodeURIComponent(permissionId)}?fields=id,expirationTime`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expirationTime }) });
  }
  revoke(id, permissionId) { return this.drive(`files/${encodeURIComponent(id)}/permissions/${encodeURIComponent(permissionId)}`, { method: 'DELETE' }); }
  async download(id, maxBytes) {
    const res = await this.fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`, { headers: { Authorization: `Bearer ${this.token}` }, signal: AbortSignal.timeout(45000) });
    if (!res.ok) throw normalizeProviderError(res);
    return readLimited(res, maxBytes);
  }
}

export async function readLimited(response, limit) {
  if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw new IntegrationError('PAYLOAD_TOO_LARGE', 413); }
  const reader = response.body.getReader(), blocks = []; let size = 0;
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > limit) throw new IntegrationError('PAYLOAD_TOO_LARGE', 413); blocks.push(value); }
  } finally { await reader.cancel(); }
  const all = new Uint8Array(size); let p = 0; for (const block of blocks) { all.set(block, p); p += block.length; } return all;
}
