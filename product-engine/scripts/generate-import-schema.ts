/**
 * Writes the JSON Schema of ImportEnvelope v1 from the Zod source of truth.
 *   pnpm import:schema          → regenerate contracts/import-envelope.v1.schema.json
 *   pnpm import:schema --check  → fail if the committed file is out of date (CI)
 * Cross-reference checks (superRefine) are not expressible in JSON Schema; the
 * Zod parser remains authoritative.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { ImportEnvelopeSchema } from '../src/import/contract';

const target = join(import.meta.dirname, '..', 'contracts', 'import-envelope.v1.schema.json');
const schema = {
  ...z.toJSONSchema(ImportEnvelopeSchema, { io: 'input', unrepresentable: 'any' }),
  $id: 'https://dtg.local/contracts/import-envelope.v1.schema.json',
  title: 'DTG ImportEnvelope v1',
  description:
    'Neutral interchange contract Excel importer → Product Engine staging (STEP 05B). Generated from src/import/contract.ts.',
};
const text = JSON.stringify(schema, null, 2) + '\n';

if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(target, 'utf8');
  } catch {
    /* missing */
  }
  if (current !== text) {
    console.error('✗ contracts/import-envelope.v1.schema.json is out of date (pnpm import:schema)');
    process.exit(1);
  }
  console.log('✓ contracts/import-envelope.v1.schema.json');
} else {
  writeFileSync(target, text);
  console.log('wrote contracts/import-envelope.v1.schema.json');
}
