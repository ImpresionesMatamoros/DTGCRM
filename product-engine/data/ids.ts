import { createHash } from 'node:crypto';

/**
 * Deterministic UUIDs (RFC 4122 v5) for seed data, so the in-memory snapshot used
 * by unit tests and the database seeded from the same dataset share identities.
 * Runtime-created rows use gen_random_uuid() in PostgreSQL.
 */
const NAMESPACE = '6f1c3c7e-8a0e-5d4b-9c61-0d7a5e2b4f10';

function toBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replace(/-/g, ''), 'hex');
}

export function seedId(name: string): string {
  const hash = createHash('sha1').update(toBytes(NAMESPACE)).update(name, 'utf8').digest();
  const b = Buffer.from(hash.subarray(0, 16));
  b[6] = ((b[6] as number) & 0x0f) | 0x50; // version 5
  b[8] = ((b[8] as number) & 0x3f) | 0x80; // RFC 4122 variant
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
