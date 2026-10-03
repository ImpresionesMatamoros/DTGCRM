import Decimal from 'decimal.js';
import { afterAll, describe, expect, it } from 'vitest';
import { itemId } from '../../data/dev-slice';
import { simulateHandler } from '@/admin/handlers';
import { itemPricing, listHistorical, listPricedItems } from '@/db/admin/pricing';
import { loadCatalogSnapshot } from '@/db/catalog-snapshot';
import { resolvePrice } from '@/pricing/resolve';
import { pool, withRollback } from './helpers';
import { loadFixtureEnvelopeJson } from '../fixtures/import-envelopes';
import { scalar, stageAndValidate } from './import-helpers';

afterAll(() => pool.end());

const AS_OF = new Date('2026-10-01T12:00:00Z');

describe('pricing viewer', () => {
  it('lists items with their current price definitions', async () => {
    await withRollback(async (c) => {
      const priced = await listPricedItems(c, { withPrices: true });
      expect(priced.rows.map((r) => r.publicCode)).toEqual([
        'DTG-00001',
        'DTG-00002',
        'DTG-00003',
        'DTG-00004',
      ]);
      expect(priced.rows.find((r) => r.publicCode === 'DTG-00003')).toMatchObject({
        definitions: 9,
        authorized: 9,
        draft: 0,
      });
    });
  });

  it('displays the quantity matrix exactly as stored, with conditions and provenance', async () => {
    await withRollback(async (c) => {
      const p = (await itemPricing(c, itemId('tarjeta_premium'), AS_OF))!;
      expect(p.definitions).toHaveLength(2);
      for (const d of p.definitions) {
        expect(d).toMatchObject({
          book: 'USA_MASTER',
          currency: 'USD',
          model: 'EXACT_QUANTITY_MATRIX',
          status: 'AUTHORIZED',
        });
        expect(d.conditions).toHaveLength(1);
        expect(d.conditions[0]!.optionKey).toBe('caras');
        expect(d.provenance.some((s) => s.sourceKind === 'EXCEL_ROW')).toBe(true);
        const stored = (
          await c.query(
            'select quantity, amount::text, amount_basis from price_break where price_definition_id = $1 order by quantity',
            [d.id],
          )
        ).rows.map((b) => ({
          quantity: b.quantity,
          amount: Number(b.amount).toFixed(2),
          amountBasis: b.amount_basis,
        }));
        expect(d.breaks).toEqual(stored);
        expect(d.breaks).toHaveLength(10);
      }
    });
  });

  it('shows the Mexico derivation computed by the pricing domain', async () => {
    await withRollback(async (c) => {
      const p = (await itemPricing(c, itemId('tarjeta_premium'), AS_OF))!;
      const snapshot = await loadCatalogSnapshot(c);
      const d = p.definitions[0]!;
      expect(d.mexico).toHaveLength(d.breaks.length);
      for (const [i, row] of d.mexico.entries()) {
        const br = d.breaks[i]!;
        expect(row).toMatchObject({
          quantity: br.quantity,
          status: 'RESOLVED',
          usaTotal: br.amount,
          factor: '0.70',
          factorSource: 'DEFAULT',
          fx: '16.50',
          rounding: 'HALF_UP_2',
        });
        // Same figure as calling the domain directly, and as USD × 0.70 × 16.50 rounded half-up.
        const direct = resolvePrice(
          {
            catalogItemId: itemId('tarjeta_premium'),
            market: 'MX',
            quantity: br.quantity,
            selections: [{ optionKey: 'caras', valueCodes: [d.conditions[0]!.valueCode!] }],
          },
          snapshot,
          AS_OF,
        );
        expect(direct.status).toBe('RESOLVED');
        if (direct.status === 'RESOLVED') expect(row.mxTotal).toBe(direct.total.amount.toFixed(2));
        expect(row.mxTotal).toBe(
          new Decimal(br.amount)
            .mul('0.70')
            .mul('16.50')
            .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
            .toFixed(2),
        );
      }
      expect(p.market.fx).toMatchObject({ value: '16.50' });
      expect(p.market.books.find((b) => b.code === 'MX_DERIVED')).toMatchObject({
        mode: 'DERIVED',
        defaultFactor: '0.70',
      });
    });
  });

  it('keeps historical prices separate and never among current definitions', async () => {
    await withRollback(async (c) => {
      const p = (await itemPricing(c, itemId('xbanner_completo'), AS_OF))!;
      expect(p.definitions).toHaveLength(0); // no current price
      expect(
        p.historical
          .filter((h) => h.origin === 'DOMAIN')
          .map((h) => h.amount)
          .sort(),
      ).toEqual(['120', '65', '85']);
      const all = await listHistorical(c);
      expect(all.filter((h) => h.origin === 'DOMAIN')).toHaveLength(6);
      // The snapshot used by pricing has no trace of them.
      const snapshot = await loadCatalogSnapshot(c);
      expect(snapshot.priceDefinitions.some((d) => d.itemId === itemId('xbanner_completo'))).toBe(
        false,
      );
    });
  });

  it('historical evidence is listed read-only and never becomes a current price', async () => {
    await withRollback(async (c) => {
      const before = await scalar(c, 'select count(*)::int n from price_definition');
      const r = await stageAndValidate(c, loadFixtureEnvelopeJson('x-banner'));
      const staged = (await listHistorical(c)).filter(
        (h) =>
          h.origin === 'STAGING' &&
          h.sourceFile === 'Design_To_Go_Catalog_v1.2_RC_MANGO_TANGO.xlsx',
      );
      expect(staged.length).toBeGreaterThanOrEqual(3);
      expect(
        await scalar(
          c,
          "select count(*)::int n from import_candidate where batch_id = $1 and kind = 'PRICE'",
          [r.batchId],
        ),
      ).toBe(0); // the three historical x-banner prices produced no PRICE candidate
      await itemPricing(c, itemId('xbanner_completo'), AS_OF);
      expect(await scalar(c, 'select count(*)::int n from price_definition')).toBe(before);
      // The database guard (historical record → PRICE candidate source) is covered in import-staging.test.ts.
      const sim = await simulateHandler(
        c,
        { itemId: itemId('xbanner_completo'), market: 'USA', quantity: 1, selections: [] },
        AS_OF,
      );
      expect(sim.ok).toBe(true);
      if (sim.ok) expect(sim.status).not.toBe('RESOLVED'); // a historical 65/85/120 is never offered
    });
  });

  it('simulates a configuration through resolvePrice and validates the input on the server', async () => {
    await withRollback(async (c) => {
      const ok = await simulateHandler(
        c,
        {
          itemId: itemId('tarjeta_premium'),
          market: 'MX',
          quantity: 100,
          selections: [{ optionKey: 'caras', valueCodes: ['1'] }],
        },
        AS_OF,
      );
      expect(ok.ok).toBe(true);
      if (ok.ok) {
        expect(ok.status).toBe('RESOLVED');
        expect(ok.derivation).toMatchObject({ factor: '0.70', fx: '16.50', rounding: 'HALF_UP_2' });
      }
      const bad = await simulateHandler(
        c,
        { itemId: 'x', market: 'CA', quantity: -1, selections: [] },
        AS_OF,
      );
      expect(bad.ok).toBe(false);
    });
  });
});
