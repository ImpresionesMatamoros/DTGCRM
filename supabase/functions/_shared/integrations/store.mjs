import { IntegrationError } from './core.mjs';

export class Store {
  constructor(client) { this.client = client; }
  filters(query, where = []) { for (const [key, op, value] of where) query = query[op](key, value); return query; }
  async result(query) { const { data, error } = await query; if (error) throw new IntegrationError('DATABASE_OPERATION_FAILED', 503, true); return data; }
  async list(table, where = [], options = {}) {
    let q = this.filters(this.client.from(table).select(options.select || '*'), where);
    if (options.order) q = q.order(options.order, { ascending: !!options.ascending });
    return this.result(q.limit(options.limit || 100));
  }
  async one(table, where = [], select = '*') { return this.result(this.filters(this.client.from(table).select(select), where).maybeSingle()); }
  async insert(table, value) { return this.result(this.client.from(table).insert(value).select().single()); }
  async upsert(table, value, conflict) { return this.result(this.client.from(table).upsert(value, { onConflict: conflict }).select().single()); }
  async update(table, where, value) { return this.result(this.filters(this.client.from(table).update(value), where).select()); }
  async remove(table, where) { return this.result(this.filters(this.client.from(table).delete(), where)); }
  async rpc(name, args) { return this.result(this.client.rpc(name, args)); }
}
export const eq = (key, value) => [key, 'eq', value];

export class SupabaseStorageAdapter {
  constructor(client) { this.client = client; }
  async upload(bucket, key, bytes, mime) {
    const r = await this.client.storage.from(bucket).upload(key, bytes, { contentType: mime, upsert: false });
    if (r.error) throw new IntegrationError('STORAGE_UPLOAD_FAILED', 503, true);
    return key;
  }
  async stat(bucket, key) {
    const parent = key.slice(0, key.lastIndexOf('/')), name = key.slice(key.lastIndexOf('/') + 1);
    const r = await this.client.storage.from(bucket).list(parent, { search: name, limit: 100 });
    if (r.error) throw new IntegrationError('STORAGE_UNAVAILABLE', 503, true);
    const file = r.data.find(x => x.name === name);
    if (!file) throw new IntegrationError('MISSING_EXTERNAL', 404);
    return { size: Number(file.metadata?.size), mime_type: file.metadata?.mimetype };
  }
  async signedUrl(bucket, key) {
    const r = await this.client.storage.from(bucket).createSignedUrl(key, 300);
    if (r.error) throw new IntegrationError('STORAGE_UNAVAILABLE', 503, true);
    return r.data.signedUrl;
  }
  async download(bucket, key, max) {
    const meta = await this.stat(bucket, key); if (!Number.isSafeInteger(meta.size) || meta.size > max) throw new IntegrationError('PAYLOAD_TOO_LARGE', 413);
    const r = await this.client.storage.from(bucket).download(key); if (r.error) throw new IntegrationError('STORAGE_UNAVAILABLE', 503, true);
    return new Uint8Array(await r.data.arrayBuffer());
  }
  async delete(bucket, key) {
    const r = await this.client.storage.from(bucket).remove([key]); if (r.error) throw new IntegrationError('STORAGE_UNAVAILABLE', 503, true);
  }
}
