import type { Pool, PoolClient } from 'pg';
import type { Queryable } from '../client';

/**
 * Admin transactions. Every admin mutation runs in one transaction that first
 * sets `dtg.actor` / `dtg.context` (transaction-local), so the change_event
 * trigger (0014) attributes each domain or staging row change to the person.
 */

export async function setActorContext(db: Queryable, actor: string, context: string) {
  await db.query("select set_config('dtg.actor', $1, true), set_config('dtg.context', $2, true)", [
    actor,
    context,
  ]);
}

export type TxRunner = <T>(
  actor: string,
  context: string,
  fn: (db: PoolClient) => Promise<T>,
) => Promise<T>;

/** Commits when `fn` resolves, rolls back when it throws. */
export function poolTxRunner(pool: Pool): TxRunner {
  return async (actor, context, fn) => {
    const c = await pool.connect();
    try {
      await c.query('begin');
      await setActorContext(c, actor, context);
      const out = await fn(c);
      await c.query('commit');
      return out;
    } catch (e) {
      await c.query('rollback');
      throw e;
    } finally {
      c.release();
    }
  };
}

/** Business outcome that must roll the transaction back but is not a crash. */
export class RollbackWith<T> extends Error {
  constructor(readonly value: T) {
    super('rollback');
  }
}
