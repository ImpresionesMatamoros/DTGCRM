import type { PoolClient } from 'pg';
import { parseImportEnvelope, type ImportEnvelope } from '@/import/contract';
import { stageEnvelope, validateBatch, type StageOptions } from '@/db/import/staging';
import { loadFixtureEnvelopeJson, type FixtureEnvelopeName } from '../fixtures/import-envelopes';

type Json = Record<string, unknown>;

/** Deep-replaces exact string values (and object keys are left alone). */
export function replaceValues<T>(value: T, map: Record<string, string>): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return map[v] ?? v;
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v as Json).map(([k, x]) => [k, walk(x)]));
    }
    return v;
  };
  return walk(value) as T;
}

export function parse(json: unknown): ImportEnvelope {
  const r = parseImportEnvelope(json);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.envelope;
}

/**
 * Controlled DEV/TEST fixture derived from a real one: legacy ids are
 * re-branded (`FIXTURE-…`) so publication creates new domain rows without
 * touching the seeded vertical slice.
 */
export function syntheticFixture(
  name: FixtureEnvelopeName,
  legacyMap: Record<string, string>,
): Json {
  const json = replaceValues(loadFixtureEnvelopeJson(name), legacyMap) as Json & {
    import_batch: Json;
  };
  json.import_batch.fixture_name = `${name} (synthetic TEST)`;
  return json;
}

/** Same envelope as if produced from another workbook version (new bytes ⇒ new hash). */
export function asNewVersion(json: Json, newSha: string): Json {
  const env = json as { import_batch: { source_sha256: string } };
  return replaceValues(json, { [env.import_batch.source_sha256]: newSha });
}

/** Turns a fixture into a REAL-class envelope (to test that REAL data cannot be published). */
export function asReal(json: Json): Json {
  const b = (json as { import_batch: Json }).import_batch;
  b.data_class = 'REAL';
  b.fixture_name = null;
  (b.parser_counts as Json).raw_records = (json as { records: unknown[] }).records.length;
  return json;
}

export async function stageAndValidate(c: PoolClient, json: unknown, options: StageOptions = {}) {
  const staged = await stageEnvelope(c, parse(json), options);
  const validation = await validateBatch(c, staged.batchId);
  return { ...staged, validation };
}

export async function candidate(c: PoolClient, batchId: string, lineageKey: string) {
  const r = (
    await c.query('select * from import_candidate where batch_id = $1 and lineage_key = $2', [
      batchId,
      lineageKey,
    ])
  ).rows;
  if (r.length !== 1) throw new Error(`expected one candidate ${lineageKey}, found ${r.length}`);
  return r[0] as Json & {
    id: string;
    proposal: Json;
    review_status: string;
    unresolved_fields: string[];
  };
}

export async function candidatesOf(c: PoolClient, batchId: string, kind: string) {
  return (
    await c.query(
      'select * from import_candidate where batch_id = $1 and kind = $2 order by lineage_key',
      [batchId, kind],
    )
  ).rows as (Json & { id: string; lineage_key: string; proposal: Json; review_status: string })[];
}

export const scalar = async (c: PoolClient, sql: string, params: unknown[] = []) =>
  (await c.query(sql, params)).rows[0]?.n as number;
