import type { Pool } from 'pg';
import { createPool } from '@/db/client';
import { poolTxRunner, type TxRunner } from '@/db/admin/tx';

/** One pool per server process (survives dev hot reloads). Server-only module. */
const g = globalThis as unknown as { __dtgAdminPool?: Pool };

export function adminPool(): Pool {
  g.__dtgAdminPool ??= createPool();
  return g.__dtgAdminPool;
}

export function adminTx(): TxRunner {
  return poolTxRunner(adminPool());
}
