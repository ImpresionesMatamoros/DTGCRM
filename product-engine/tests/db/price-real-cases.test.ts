import { afterAll, describe, expect, it } from 'vitest';
import { itemId } from '../../data/dev-slice';
import { loadCatalogSnapshot } from '@/db/catalog-snapshot';
import { resolvePrice } from '@/pricing/resolve';
import { pool, withRollback } from './helpers';

afterAll(() => pool.end());
const NOW = new Date('2026-10-01T12:00:00Z');

const price = async (key: Parameters<typeof itemId>[0], req: Record<string, unknown>) =>
  withRollback(async (c) =>
    resolvePrice(
      { catalogItemId: itemId(key), market: 'USA', quantity: 1, ...req } as never,
      await loadCatalogSnapshot(c),
      NOW,
    ),
  );

/** STEP 07 §32 "real cases" against the seeded database (the same data the admin shows). */
describe('real pricing cases (database snapshot)', () => {
  it('Premium Business Card · 2 sides × 500 = 120.00 USD', async () => {
    const r = await price('tarjeta_premium', {
      quantity: 500,
      selections: [{ optionKey: 'caras', valueCodes: ['2'] }],
    });
    expect(r.status === 'RESOLVED' && r.total.amount.toFixed(2)).toBe('120.00');
  });

  it('Premium Flyer · half-letter · 2 sides × 1000 = 400.00 USD', async () => {
    const r = await price('flyers', {
      quantity: 1000,
      selections: [
        { optionKey: 'caras', valueCodes: ['2'] },
        { optionKey: 'papel', valueCodes: ['Premium'] },
        { optionKey: 'tamano_papel', valueCodes: ['Media carta'] },
      ],
    });
    expect(r.status === 'RESOLVED' && r.total.amount.toFixed(2)).toBe('400.00');
  });

  it('quantity 750 is QUOTE_ONLY — never interpolated', async () => {
    const r = await price('tarjeta_premium', {
      quantity: 750,
      selections: [{ optionKey: 'caras', valueCodes: ['2'] }],
    });
    expect(r.status === 'QUOTE_ONLY' && r.reasonCode).toBe('QUANTITY_NOT_IN_MATRIX');
  });

  it('magnets: one pair = 65 USD; several pairs stay QUOTE_ONLY (D-010 open, no 2 × 65)', async () => {
    const one = await price('imanes_par', { quantity: 1 });
    expect(one.status === 'RESOLVED' && one.total.amount.toFixed(2)).toBe('65.00');
    for (const quantity of [2, 3, 10]) {
      const many = await price('imanes_par', { quantity });
      expect(many.status === 'QUOTE_ONLY' && many.reasonCode).toBe(
        'FIXED_PRICE_QUANTITY_NOT_AUTHORIZED',
      );
    }
  });

  it('apparel: 9 L + 3 × 3XL → surcharge only on the 3 units (3 × 3 = 9 USD)', async () => {
    const r = await price('camiseta_algodon', {
      quantity: 12,
      distribution: [
        { selections: [{ optionKey: 'talla', valueCodes: ['L'] }], quantity: 9 },
        { selections: [{ optionKey: 'talla', valueCodes: ['3XL'] }], quantity: 3 },
      ],
      decorations: [{ methodKey: 'DTF' }],
    });
    expect(r.status).toBe('QUOTE_ONLY'); // no authorized apparel base price yet
    if (r.status !== 'QUOTE_ONLY') return;
    expect(r.knownAdjustments).toHaveLength(1);
    expect(r.knownAdjustments[0]).toMatchObject({ quantity: 3, source: { ruleCode: 'size_3xl' } });
    expect(r.knownAdjustments[0]!.amount?.amount.toFixed(2)).toBe('9.00');
  });

  it('D-008: 2XL/3XL rules are assigned ONLY to the confirmed apparel items (nothing broader)', async () => {
    await withRollback(async (c) => {
      const rows = (
        await c.query(
          `select r.code, i.public_code from price_rule r join price_rule_assignment a on a.price_rule_id = r.id
             join catalog_item i on i.id = a.item_id where r.code in ('size_2xl', 'size_3xl') order by 1, 2`,
        )
      ).rows;
      expect(rows).toEqual([
        { code: 'size_2xl', public_code: 'DTG-00005' },
        { code: 'size_2xl', public_code: 'DTG-00006' },
        { code: 'size_3xl', public_code: 'DTG-00005' },
        { code: 'size_3xl', public_code: 'DTG-00006' },
      ]);
    });
  });

  it('Mexico (provisional technical behaviour): 120 × 0.70 × 16.5 = 1386.00 MXN, HALF_UP_2', async () => {
    const r = await price('tarjeta_premium', {
      market: 'MX',
      quantity: 500,
      selections: [{ optionKey: 'caras', valueCodes: ['2'] }],
    });
    expect(r.status === 'RESOLVED' && r.total.amount.toFixed(2)).toBe('1386.00');
    if (r.status === 'RESOLVED')
      expect(r.derivation).toMatchObject({ factor: '0.70', fx: '16.50', rounding: 'HALF_UP_2' });
  });
});

describe('historical evidence and unresolved yard-sign data stay out of active pricing', () => {
  it('no price_definition is backed by historical evidence; evidence cannot be authorized from the admin API', async () => {
    await withRollback(async (c) => {
      const n = (
        await c.query(
          `select count(*)::int as n from source_reference where entity_type = 'price_definition'
              and source_kind = 'HISTORICAL_PRICE_EVIDENCE'`,
        )
      ).rows[0].n;
      expect(n).toBe(0);
    });
    const api = await import('@/db/admin/price-admin');
    expect(Object.keys(api).filter((k) => /historical|evidence/i.test(k))).toEqual([]);
  });

  it('Yard Sign (D-011: 1=$25, 6=$20, 12=$18) has NO price definition and quotes only', async () => {
    await withRollback(async (c) => {
      const n = (
        await c.query('select count(*)::int as n from price_definition where item_id = $1', [
          itemId('yard_sign'),
        ])
      ).rows[0].n;
      expect(n).toBe(0);
    });
    for (const quantity of [1, 6, 12]) {
      const r = await price('yard_sign', { quantity });
      expect(r.status).toBe('QUOTE_ONLY');
    }
  });

  it('X-Banner historical prices (65/85/120) never resolve', async () => {
    const r = await price('xbanner_completo', {
      quantity: 1,
      selections: [{ optionKey: 'tamano_display', valueCodes: ['24x63'] }],
    });
    expect(r.status).toBe('QUOTE_ONLY');
  });
});
