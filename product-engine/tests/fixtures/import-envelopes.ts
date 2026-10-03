import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseImportEnvelope, type ImportEnvelope } from '@/import/contract';

/**
 * Controlled FIXTURE envelopes: real STEP 05A subsets of the v1.2 workbook,
 * exported with `pnpm importer:envelopes --fixtures` (data_class = FIXTURE).
 * They are the only real-data envelopes allowed to reach publication (STEP 05B).
 */
export const FIXTURE_ENVELOPES = [
  'premium-business-card',
  'magnets',
  'x-banner',
  'cotton-t-shirt',
  'dtf-transfer',
  'yard-sign',
] as const;
export type FixtureEnvelopeName = (typeof FIXTURE_ENVELOPES)[number];

const cache = new Map<string, unknown>();

/** Raw JSON (unvalidated) — a fresh deep copy on every call so tests can mutate it. */
export function loadFixtureEnvelopeJson(name: FixtureEnvelopeName): Record<string, unknown> {
  if (!cache.has(name)) {
    const path = join(import.meta.dirname, 'import', `${name}.envelope.json`);
    cache.set(name, JSON.parse(readFileSync(path, 'utf8')));
  }
  return structuredClone(cache.get(name)) as Record<string, unknown>;
}

/** Parsed and validated fixture envelope. */
export function fixtureEnvelope(name: FixtureEnvelopeName): ImportEnvelope {
  const r = parseImportEnvelope(loadFixtureEnvelopeJson(name));
  if (!r.ok) throw new Error(`fixture ${name} is invalid: ${JSON.stringify(r.errors)}`);
  return r.envelope;
}

export interface RealPriceEvidence {
  source_sha256: string;
  price_candidates: unknown[];
  historical_prices: unknown[];
  records: { record_id: string; record_type: string; legacy_id: string | number | null }[];
}

/** Cell-free extract of the 131 real price candidates + 23 historical prices (v1.2). */
export function realPriceEvidence(): RealPriceEvidence {
  const path = join(import.meta.dirname, 'import', 'real-price-evidence.v1_2.json');
  return JSON.parse(readFileSync(path, 'utf8')) as RealPriceEvidence;
}
