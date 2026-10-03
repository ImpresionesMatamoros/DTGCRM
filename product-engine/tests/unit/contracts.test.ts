import { describe, expect, it } from 'vitest';
import { parsePriceRequest, priceResultToWire, PriceResultWireSchema } from '@/api/contracts';
import { resolvePrice } from '@/pricing/resolve';
import { AS_OF, itemId, sliceSnapshot } from '../fixtures/slice';

describe('wire contract v1', () => {
  it('parses a snake_case request into the domain request', () => {
    const r = parsePriceRequest({
      catalog_item_id: itemId('camiseta_algodon'),
      market: 'USA',
      quantity: 12,
      distribution: [
        { selections: [{ option_key: 'talla', value_codes: ['L'] }], quantity: 9 },
        { selections: [{ option_key: 'talla', value_codes: ['3XL'] }], quantity: 3 },
      ],
      decorations: [{ method_key: 'DTF' }],
    });
    expect(r).toEqual({
      catalogItemId: itemId('camiseta_algodon'),
      market: 'USA',
      quantity: 12,
      distribution: [
        { quantity: 9, selections: [{ optionKey: 'talla', valueCodes: ['L'] }] },
        { quantity: 3, selections: [{ optionKey: 'talla', valueCodes: ['3XL'] }] },
      ],
      decorations: [{ methodKey: 'DTF' }],
    });
  });

  it('rejects malformed input (unknown fields, bad quantity, unknown market)', () => {
    const base = { catalog_item_id: itemId('flyers'), market: 'USA', quantity: 100 };
    expect(() => parsePriceRequest({ ...base, quantity: 0 })).toThrow();
    expect(() => parsePriceRequest({ ...base, quantity: 1.5 })).toThrow();
    expect(() => parsePriceRequest({ ...base, market: 'CA' })).toThrow();
    expect(() => parsePriceRequest({ ...base, price_override: 1 })).toThrow();
  });

  it('serializes money as decimal strings with currency; derived MXN keeps its USD source', () => {
    const result = resolvePrice(
      parsePriceRequest({
        catalog_item_id: itemId('tarjeta_premium'),
        market: 'MX',
        quantity: 500,
        selections: [{ option_key: 'caras', value_codes: ['2'] }],
      }),
      sliceSnapshot(),
      AS_OF,
    );
    const wire = priceResultToWire(result);
    expect(PriceResultWireSchema.parse(wire)).toEqual(wire);
    if (wire.status !== 'RESOLVED') throw new Error('expected RESOLVED');
    expect(wire.total).toEqual({ amount: '1386.00', currency: 'MXN' });
    expect(wire.derivation?.source_total).toEqual({ amount: '120.00', currency: 'USD' });
    expect(wire.effective_at).toBe('2026-10-01T12:00:00.000Z');
    expect(JSON.stringify(wire)).not.toMatch(/"amount":\d/); // never a bare JS number
  });

  it('serializes QUOTE_ONLY with known adjustments and no total', () => {
    const result = resolvePrice(
      parsePriceRequest({
        catalog_item_id: itemId('camiseta_algodon'),
        market: 'USA',
        quantity: 3,
        distribution: [
          { selections: [{ option_key: 'talla', value_codes: ['3XL'] }], quantity: 3 },
        ],
      }),
      sliceSnapshot(),
      AS_OF,
    );
    const wire = priceResultToWire(result);
    expect(wire.status).toBe('QUOTE_ONLY');
    if (wire.status !== 'QUOTE_ONLY') return;
    expect(wire.known_adjustments[0]?.amount).toEqual({ amount: '9.00', currency: 'USD' });
    expect('total' in wire).toBe(false);
  });
});
