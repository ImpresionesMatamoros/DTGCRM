import { Pool, types, type PoolClient } from 'pg';

// Keep NUMERIC as strings (never JS floats) and timestamps as ISO strings handled by the mapper.
types.setTypeParser(types.builtins.NUMERIC, (v) => v);
types.setTypeParser(types.builtins.INT8, (v) => v);

export function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set (see .env.example)');
  return url;
}

export function createPool(url = databaseUrl()): Pool {
  return new Pool({ connectionString: url, max: 5 });
}

export type Queryable = Pick<PoolClient, 'query'>;

let shared: Pool | undefined;
/** Process-wide pool for HTTP route handlers (one pool per server, never per request). */
export function sharedPool(): Pool {
  shared ??= createPool();
  return shared;
}
