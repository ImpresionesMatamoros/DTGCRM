import { describe, expect, it } from 'vitest';
import { parseImportEnvelope, type ImportEnvelope } from '@/import/contract';
import { FIXTURE_ENVELOPES, loadFixtureEnvelopeJson } from '../fixtures/import-envelopes';

function ok(input: unknown): ImportEnvelope {
  const r = parseImportEnvelope(input);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.envelope;
}

function errorsOf(input: unknown): string {
  const r = parseImportEnvelope(input);
  expect(r.ok).toBe(false);
  return r.ok ? '' : JSON.stringify(r.errors);
}

type Json = Record<string, unknown> & {
  candidates: Record<string, unknown>[];
  records: Record<string, unknown>[];
  issues: Record<string, unknown>[];
  historical_prices: Record<string, unknown>[];
  import_batch: Record<string, unknown>;
};

const load = (n: (typeof FIXTURE_ENVELOPES)[number]) => loadFixtureEnvelopeJson(n) as Json;

describe('ImportEnvelope v1 (Zod bridge)', () => {
  it.each(FIXTURE_ENVELOPES)('accepts the controlled fixture %s', (name) => {
    const env = ok(load(name));
    expect(env.contract).toBe('dtg.import-envelope');
    expect(env.import_batch.data_class).toBe('FIXTURE');
    expect(env.import_batch.source_role).toBe('PRIMARY_RC');
    expect(env.provenance.profile).toBeNull();
  });

  it('rejects input that is not an envelope, with structured errors', () => {
    const r = parseImportEnvelope({ hello: 'world' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBeGreaterThan(0);
    expect(parseImportEnvelope(null).ok).toBe(false);
  });

  it('rejects an unsupported major version', () => {
    const env = load('magnets');
    env.contract_version = '2.0.0';
    expect(errorsOf(env)).toContain('major version 1');
  });

  it('rejects unknown fields (strict contract)', () => {
    const env = load('magnets');
    env.import_batch.catalog_item_id = '6f1c3c7e-8a0e-5d4b-9c61-0d7a5e2b4f10';
    expect(errorsOf(env)).toContain('catalog_item_id');
  });

  it('rejects a candidate that references a record outside the envelope', () => {
    const env = load('magnets');
    (env.candidates[0]!.record_ids as string[]).push('ffffffffffffffffffffffff');
    expect(errorsOf(env)).toContain('unknown record');
  });

  it('rejects historical evidence smuggled in as a price candidate', () => {
    const env = load('x-banner');
    const h = env.historical_prices[0] as { record_id: string; data: unknown };
    env.candidates.push({
      candidate_id: 'abcdefabcdefabcdefabcdef',
      kind: 'price',
      record_ids: [h.record_id],
      data: h.data,
      workflow_state: 'PENDING_REVIEW',
      publishable: false,
      validation_state: 'VALID',
      issue_ids: [],
      review: [],
    });
    (env.import_batch.candidate_counts as Record<string, number>).price = 1;
    env.import_batch.candidate_count = env.candidates.length;
    const errors = errorsOf(env);
    expect(errors).toContain('historical');
  });

  it('rejects a publishable candidate and a non-boolean required flag', () => {
    const env = load('cotton-t-shirt');
    const option = env.candidates.find((c) => c.kind === 'option')!;
    (option.data as Record<string, unknown>).required = 'false';
    expect(errorsOf(env)).toContain('required');
    const env2 = load('cotton-t-shirt');
    env2.candidates[0]!.publishable = true;
    expect(errorsOf(env2)).toContain('publishable');
  });

  it('rejects cells coming from another workbook', () => {
    const env = load('dtf-transfer');
    const cells = env.records[0]!.source as Record<string, unknown>[];
    cells[0]!.workbook_sha256 = 'a'.repeat(64);
    expect(errorsOf(env)).toContain('another workbook');
  });

  it('rejects inconsistent counts', () => {
    const env = load('yard-sign');
    env.import_batch.record_count = 1;
    expect(errorsOf(env)).toContain('record_count');
  });

  it('preserves raw value, normalized value, formula and cell coordinates', () => {
    const env = ok(load('premium-business-card'));
    for (const r of env.records) {
      for (const c of r.source) {
        expect(c.workbook_sha256).toBe(env.import_batch.source_sha256);
        expect(c.source_cell).toMatch(/^[A-Z]+[0-9]+$/);
        expect(c).toHaveProperty('raw_value');
        expect(c).toHaveProperty('normalized_value');
        expect(c).toHaveProperty('cached_value');
      }
    }
    // Formula cells keep the formula text and no normalized value.
    const formulas = env.records.flatMap((r) => r.source).filter((c) => c.formula !== null);
    expect(formulas.length).toBeGreaterThan(0);
    for (const c of formulas) expect(c.normalized_value).toBeNull();
  });

  it('keeps unknown required flags as null', () => {
    const env = ok(load('cotton-t-shirt'));
    const options = env.candidates.filter((c) => c.kind === 'option');
    expect(options.length).toBeGreaterThan(0);
    for (const o of options) if (o.kind === 'option') expect(o.data.required).toBeNull();
  });
});
