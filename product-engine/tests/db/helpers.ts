import { existsSync } from 'node:fs';
import path from 'node:path';
import type { PoolClient } from 'pg';
import { createPool } from '@/db/client';

for (const f of ['.env.local', '.env']) {
  const p = path.resolve(import.meta.dirname, '../..', f);
  if (existsSync(p) && !process.env.DATABASE_URL) process.loadEnvFile(p);
}

export const pool = createPool();

/** Runs `fn` inside a transaction that is always rolled back: tests never leave traces. */
export async function withRollback<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    return await fn(c);
  } finally {
    await c.query('rollback');
    c.release();
  }
}

/** Expects the statement to fail with a message matching `pattern` (inside a savepoint). */
export async function expectDbError(
  c: PoolClient,
  sql: string,
  params: unknown[],
  pattern: RegExp,
): Promise<void> {
  await c.query('savepoint probe');
  let error: Error | null = null;
  try {
    await c.query(sql, params);
  } catch (e) {
    error = e as Error;
  }
  await c.query('rollback to savepoint probe');
  if (!error) throw new Error(`Expected failure matching ${pattern} for: ${sql}`);
  if (!pattern.test(error.message))
    throw new Error(`Unexpected error "${error.message}" (wanted ${pattern})`);
}
