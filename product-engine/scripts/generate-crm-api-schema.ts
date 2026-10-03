/**
 * Writes the JSON Schema of the CRM-facing API v1 from the Zod source of truth.
 *   pnpm crm-api:schema          → regenerate contracts/crm-api.v1.schema.json
 *   pnpm crm-api:schema --check  → fail if the committed file is out of date (CI)
 * The CRM integration harness validates REAL responses against this artefact, so
 * the two repositories share one generated schema instead of hand-written copies.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import {
  CONTRACT_VERSION,
  ErrorResponseSchema,
  ItemDetailResponseSchema,
  ItemListResponseSchema,
  PriceResultWireSchema,
  ResolveEnvelopeSchema,
} from '../src/api/crm-contracts';

const target = join(import.meta.dirname, '..', 'contracts', 'crm-api.v1.schema.json');
const out = (s: z.ZodType) => z.toJSONSchema(s, { io: 'output', unrepresentable: 'any' });
const inp = (s: z.ZodType) => z.toJSONSchema(s, { io: 'input', unrepresentable: 'any' });

const schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://dtg.local/contracts/crm-api.v1.schema.json',
  title: 'DTG Product Engine — CRM API v1',
  description:
    'Wire contracts of GET /api/v1/catalog/items, GET /api/v1/catalog/items/{id-or-public-code}, POST /api/v1/pricing/resolve. Generated from src/api/crm-contracts.ts and src/api/contracts.ts.',
  contract_version: CONTRACT_VERSION,
  $defs: {
    ItemListResponse: out(ItemListResponseSchema),
    ItemDetailResponse: out(ItemDetailResponseSchema),
    ResolveRequest: inp(ResolveEnvelopeSchema),
    PriceResult: out(PriceResultWireSchema),
    ErrorResponse: out(ErrorResponseSchema),
  },
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
    console.error('✗ contracts/crm-api.v1.schema.json is out of date (pnpm crm-api:schema)');
    process.exit(1);
  }
  console.log('✓ contracts/crm-api.v1.schema.json');
} else {
  writeFileSync(target, text);
  console.log('wrote contracts/crm-api.v1.schema.json');
}
