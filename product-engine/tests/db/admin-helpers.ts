import type { PoolClient } from 'pg';
import { createHash } from 'node:crypto';
import type { Actor } from '@/admin/permissions';
import { setActorContext, type TxRunner } from '@/db/admin/tx';

export const ACTOR: Actor = { name: 'martin@test', source: 'env', role: 'local_dev' };

/** Runs admin handlers inside the test's rollback transaction (same actor context as production). */
export const rollbackRunner =
  (c: PoolClient): TxRunner =>
  async (actor, context, fn) => {
    await setActorContext(c, actor, context);
    return fn(c);
  };

/** A workbook hash nobody else uses, so REAL-class test batches never collide with real staging. */
export const uniqueSha = (label: string) =>
  createHash('sha256').update(`step06-test:${label}`).digest('hex');

export function must<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r as Extract<T, { ok: true }>;
}
