/**
 * Records REAL responses of a running Product Engine API (CRM-facing v1) into the file the CRM
 * repo replays in its own offline QA, and validates each one against the generated JSON schema's
 * source of truth (the zod schemas). usage:
 *   PE_BASE_URL=http://localhost:3910 PE_TOKEN=... tsx tools/step10/record-fixtures.ts <out.json>
 */
import { writeFileSync } from 'node:fs';
import {
  ErrorResponseSchema,
  ItemDetailResponseSchema,
  ItemListResponseSchema,
  PriceResultWireSchema,
} from '../../src/api/crm-contracts';
import { itemId } from '../../data/dev-slice';

const base = process.env.PE_BASE_URL ?? 'http://localhost:3910';
const token = process.env.PE_TOKEN ?? '';
const out = process.argv[2];
if (!out) throw new Error('output path required');

interface Entry {
  name: string;
  request: { method: 'GET' | 'POST'; path: string; body?: unknown };
  response: { status: number; contract_version: string | null; body: unknown };
}
const entries: Entry[] = [];

async function rec(
  name: string,
  method: 'GET' | 'POST',
  path: string,
  body: unknown,
  check: (b: unknown) => void,
) {
  const res = await fetch(base + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  check(json);
  entries.push({
    name,
    request: { method, path, ...(body ? { body } : {}) },
    response: {
      status: res.status,
      contract_version: res.headers.get('x-dtg-contract-version'),
      body: json,
    },
  });
}

const premium = itemId('tarjeta_premium');
const magnets = itemId('imanes_par');
const flyers = itemId('flyers');
const priceReq = (id: string, quantity: number, selections?: unknown[]) => ({
  request: { catalog_item_id: id, market: 'USA', quantity, ...(selections ? { selections } : {}) },
});
const list = (b: unknown) => void ItemListResponseSchema.parse(b);
const detail = (b: unknown) => void ItemDetailResponseSchema.parse(b);
const price = (b: unknown) => void PriceResultWireSchema.parse(b);
const err = (b: unknown) => void ErrorResponseSchema.parse(b);

async function main() {
  for (const q of ['bu', 'bus', 'business', 'tarjeta', 'imanes', 'zzzz']) {
    await rec(
      `search:${q}`,
      'GET',
      `/api/v1/catalog/items?q=${q}&market=USA&limit=8`,
      undefined,
      list,
    );
  }
  await rec('detail:premium', 'GET', `/api/v1/catalog/items/${premium}`, undefined, detail);
  await rec('detail:magnets', 'GET', `/api/v1/catalog/items/${magnets}`, undefined, detail);
  await rec('detail:flyers', 'GET', `/api/v1/catalog/items/${flyers}`, undefined, detail);
  await rec('detail:unknown', 'GET', '/api/v1/catalog/items/DTG-99999', undefined, err);
  const caras = (v: string) => [{ option_key: 'caras', value_codes: [v] }];
  await rec(
    'price:premium-500-2',
    'POST',
    '/api/v1/pricing/resolve',
    priceReq(premium, 500, caras('2')),
    price,
  );
  await rec(
    'price:premium-750-2',
    'POST',
    '/api/v1/pricing/resolve',
    priceReq(premium, 750, caras('2')),
    price,
  );
  await rec(
    'price:premium-500-invalid',
    'POST',
    '/api/v1/pricing/resolve',
    priceReq(premium, 500, caras('9')),
    price,
  );
  await rec('price:magnets-1', 'POST', '/api/v1/pricing/resolve', priceReq(magnets, 1), price);
  await rec('price:magnets-2', 'POST', '/api/v1/pricing/resolve', priceReq(magnets, 2), price);
  await rec(
    'price:flyers-1000',
    'POST',
    '/api/v1/pricing/resolve',
    priceReq(flyers, 1000, [
      { option_key: 'papel', value_codes: ['Premium'] },
      { option_key: 'caras', value_codes: ['2'] },
      { option_key: 'tamano_papel', value_codes: ['Media carta'] },
    ]),
    price,
  );
  writeFileSync(
    out,
    JSON.stringify(
      { recorded_from: 'real Product Engine API v1', contract_version: '1', entries },
      null,
      2,
    ) + '\n',
  );
  console.log(`recorded ${entries.length} responses → ${out}`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
