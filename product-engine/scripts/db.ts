/**
 * Local database tooling (ADR-0012). Git is the only source of truth for the schema:
 * every structural change is a file in supabase/migrations, applied in order and
 * recorded with its checksum. LOCAL ONLY: refuses non-local hosts.
 *
 *   start | stop        docker compose up/stop (optional; any local PostgreSQL works)
 *   reset               drop + recreate the database in DATABASE_URL
 *   migrate             apply pending migrations (verifies checksums of applied ones)
 *   seed                load supabase/seeds/*.sql in order (one transaction)
 *   status              list applied / pending migrations
 *   rebuild             reset → migrate → seed
 */
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';

const ROOT = path.resolve(import.meta.dirname, '..');
const MIGRATIONS = path.join(ROOT, 'supabase/migrations');
const SEEDS = path.join(ROOT, 'supabase/seeds');

for (const f of ['.env.local', '.env']) {
  const p = path.join(ROOT, f);
  if (existsSync(p)) process.loadEnvFile(p);
}

function targetUrl(): URL {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL is not set. Copy .env.example to .env');
  const url = new URL(raw);
  if (!['localhost', '127.0.0.1', '::1', 'db'].includes(url.hostname)) {
    throw new Error(
      `Refusing to touch non-local database host "${url.hostname}" (STEP 04: local only).`,
    );
  }
  return url;
}

const dbName = (url: URL) => decodeURIComponent(url.pathname.replace(/^\//, ''));

function adminUrl(url: URL): string {
  const u = new URL(url.toString());
  u.pathname = `/${process.env.DATABASE_ADMIN_DB ?? 'postgres'}`;
  return u.toString();
}

async function withClient<T>(conn: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: conn });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const sqlFiles = (dir: string) =>
  readdirSync(dir)
    .filter((f) => /^\d{4}_[a-z0-9_.]+\.sql$/.test(f))
    .sort();

async function waitForDatabase(url: URL, seconds = 60): Promise<void> {
  for (let i = 0; i < seconds; i++) {
    try {
      await withClient(adminUrl(url), (c) => c.query('select 1'));
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error('Database did not become ready');
}

async function reset(): Promise<void> {
  const url = targetUrl();
  const name = dbName(url);
  await withClient(adminUrl(url), async (c) => {
    await c.query(`drop database if exists "${name}" with (force)`);
    await c.query(`create database "${name}"`);
  });
  console.log(`✓ reset database ${name}`);
}

async function migrate(): Promise<void> {
  const url = targetUrl();
  await withClient(url.toString(), async (c) => {
    await c.query(`create table if not exists schema_migrations (
      version text primary key, checksum text not null, applied_at timestamptz not null default now())`);
    const applied = new Map(
      (await c.query('select version, checksum from schema_migrations')).rows.map((r) => [
        r.version as string,
        r.checksum as string,
      ]),
    );
    let count = 0;
    for (const file of sqlFiles(MIGRATIONS)) {
      const sql = readFileSync(path.join(MIGRATIONS, file), 'utf8');
      const sum = sha256(sql);
      const prev = applied.get(file);
      if (prev) {
        if (prev !== sum) {
          throw new Error(
            `Migration ${file} changed after being applied. Create a new migration instead.`,
          );
        }
        continue;
      }
      await c.query('begin');
      try {
        await c.query(sql);
        await c.query('insert into schema_migrations (version, checksum) values ($1, $2)', [
          file,
          sum,
        ]);
        await c.query('commit');
      } catch (e) {
        await c.query('rollback');
        throw new Error(`Migration ${file} failed: ${(e as Error).message}`);
      }
      count++;
      console.log(`✓ applied ${file}`);
    }
    console.log(count === 0 ? '✓ schema up to date' : `✓ ${count} migration(s) applied`);
  });
}

async function seed(): Promise<void> {
  const url = targetUrl();
  await withClient(url.toString(), async (c) => {
    await c.query('begin');
    try {
      for (const file of sqlFiles(SEEDS)) {
        await c.query(readFileSync(path.join(SEEDS, file), 'utf8'));
        console.log(`✓ seeded ${file}`);
      }
      await c.query('commit');
    } catch (e) {
      await c.query('rollback');
      throw new Error(`Seeding failed: ${(e as Error).message}`);
    }
  });
}

async function status(): Promise<void> {
  const url = targetUrl();
  await withClient(url.toString(), async (c) => {
    const exists = (await c.query("select to_regclass('schema_migrations') as t")).rows[0]?.t;
    const applied = new Set<string>(
      exists
        ? (await c.query('select version from schema_migrations')).rows.map((r) => r.version)
        : [],
    );
    for (const f of sqlFiles(MIGRATIONS)) console.log(`${applied.has(f) ? '✓' : '·'} ${f}`);
  });
}

function compose(args: string): void {
  execSync(`docker compose ${args}`, { stdio: 'inherit', cwd: ROOT });
}

const commands: Record<string, () => Promise<void>> = {
  start: async () => {
    compose('up -d db');
    await waitForDatabase(targetUrl());
    console.log('✓ database ready');
  },
  stop: async () => compose('stop db'),
  reset,
  migrate,
  seed,
  status,
  rebuild: async () => {
    await reset();
    await migrate();
    await seed();
  },
};

const cmd = process.argv[2] ?? '';
const run = commands[cmd];
if (!run) {
  console.error(`Usage: tsx scripts/db.ts <${Object.keys(commands).join('|')}>`);
  process.exit(2);
}
run().catch((e: Error) => {
  console.error(`✗ ${e.message}`);
  process.exit(1);
});
