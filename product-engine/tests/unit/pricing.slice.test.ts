import { describe, expect, it } from 'vitest';
import { resolvePrice } from '@/pricing/resolve';
import type { PriceResult } from '@/pricing/result';
import { AS_OF, REF, req, sliceSnapshot } from '../fixtures/slice';

/** Vertical slice cases from STEP 03 (PRICING-ENGINE-CONTRACT §5) on REAL authorized data. */

const amount = (r: PriceResult) =>
  r.status === 'RESOLVED' ? `${r.total.amount.toFixed(2)} ${r.total.currency}` : r.status;

describe('pricing — vertical slice with real authorized prices', () => {
  const s = sliceSnapshot();

  it('E1 Tarjeta Premium · 2 caras · 500 → 120.00 USD (exact matrix point)', () => {
    const r = resolvePrice(
      req('tarjeta_premium', {
        market: 'USA',
        quantity: 500,
        selections: [{ optionKey: 'caras', valueCodes: ['2'] }],
      }),
      s,
      AS_OF,
    );
    expect(r.status).toBe('RESOLVED');
    if (r.status !== 'RESOLVED') return;
    expect(amount(r)).toBe('120.00 USD');
    expect(r.policy).toMatchObject({ market: 'USA', priceBookCode: 'USA_MASTER', basis: 'MASTER' });
    const base = r.breakdown.find((l) => l.kind === 'BASE');
    expect(base?.amount?.currency).toBe('USD');
    expect(base?.source.breakQuantity).toBe(500);
    expect(base?.source.priceDefinitionId).toBeDefined();
    expect(r.derivation).toBeNull();
    expect(r.effectiveAt).toBe(AS_OF.toISOString());
  });

  it('E2 Flyer Premium · 2 caras · media carta · 1000 → 400.00 USD', () => {
    const r = resolvePrice(
      req('flyers', {
        market: 'USA',
        quantity: 1000,
        selections: [
          { optionKey: 'papel', valueCodes: ['Premium'] },
          { optionKey: 'caras', valueCodes: ['2'] },
          { optionKey: 'tamano_papel', valueCodes: ['Media carta'] },
        ],
      }),
      s,
      AS_OF,
    );
    expect(amount(r)).toBe('400.00 USD');
  });

  it('E8 Flyer Bond · 2 caras has no tariff → QUOTE_ONLY, not invented and not INVALID', () => {
    const r = resolvePrice(
      req('flyers', {
        market: 'USA',
        quantity: 100,
        selections: [
          { optionKey: 'papel', valueCodes: ['Bond'] },
          { optionKey: 'caras', valueCodes: ['2'] },
          { optionKey: 'tamano_papel', valueCodes: ['Carta'] },
        ],
      }),
      s,
      AS_OF,
    );
    expect(r.status).toBe('QUOTE_ONLY');
    if (r.status === 'QUOTE_ONLY') expect(r.reasonCode).toBe('NO_AUTHORIZED_BASE_PRICE');
  });

  it('E4 México derived with default factor: 120 USD × 0.70 × 16.5 = 1386.00 MXN, with formula provenance', () => {
    const r = resolvePrice(
      req('tarjeta_premium', {
        market: 'MX',
        quantity: 500,
        selections: [{ optionKey: 'caras', valueCodes: ['2'] }],
      }),
      s,
      AS_OF,
    );
    expect(r.status).toBe('RESOLVED');
    if (r.status !== 'RESOLVED') return;
    expect(amount(r)).toBe('1386.00 MXN');
    expect(r.policy).toMatchObject({
      market: 'MX',
      basis: 'DERIVED',
      factor: '0.70',
      factorSource: 'DEFAULT',
    });
    expect(r.derivation).toMatchObject({
      sourcePriceBookCode: 'USA_MASTER',
      factor: '0.70',
      factorSource: 'DEFAULT',
      fx: '16.50',
      fxParameterId: REF.fxUsdMxn,
      rounding: 'HALF_UP_2',
    });
    expect(
      `${r.derivation?.sourceTotal.amount.toFixed(2)} ${r.derivation?.sourceTotal.currency}`,
    ).toBe('120.00 USD');
    const last = r.breakdown.at(-1);
    expect(last?.kind).toBe('MARKET_DERIVATION');
    expect(last?.amount?.currency).toBe('MXN');
  });

  it('E6 quantity 750 is not in the exact matrix → QUOTE_ONLY without interpolation', () => {
    const r = resolvePrice(
      req('tarjeta_premium', {
        market: 'USA',
        quantity: 750,
        selections: [{ optionKey: 'caras', valueCodes: ['2'] }],
      }),
      s,
      AS_OF,
    );
    expect(r.status).toBe('QUOTE_ONLY');
    if (r.status !== 'QUOTE_ONLY') return;
    expect(r.reasonCode).toBe('QUANTITY_NOT_IN_MATRIX');
    expect(r.detail).toContain('100, 250, 500, 1000, 1500, 2000, 2500, 3000, 4000, 5000');
    expect('total' in r).toBe(false);
  });

  it('E3 Camiseta 9 L + 3 3XL without base price → QUOTE_ONLY with known surcharge +9 USD on 3 units', () => {
    const r = resolvePrice(
      req('camiseta_algodon', {
        market: 'USA',
        quantity: 12,
        distribution: [
          { selections: [{ optionKey: 'talla', valueCodes: ['L'] }], quantity: 9 },
          { selections: [{ optionKey: 'talla', valueCodes: ['3XL'] }], quantity: 3 },
        ],
        decorations: [{ methodKey: 'DTF' }],
      }),
      s,
      AS_OF,
    );
    expect(r.status).toBe('QUOTE_ONLY');
    if (r.status !== 'QUOTE_ONLY') return;
    expect(r.reasonCode).toBe('NO_AUTHORIZED_BASE_PRICE');
    expect(r.knownAdjustments).toHaveLength(1);
    const adj = r.knownAdjustments[0]!;
    expect(adj).toMatchObject({ kind: 'RULE', quantity: 3, source: { ruleCode: 'size_3xl' } });
    expect(`${adj.amount?.amount.toFixed(2)} ${adj.amount?.currency}`).toBe('9.00 USD');
    expect(r.explanation.join(' ')).toContain('no se suma');
  });

  it('historical unauthorized prices never resolve (X-Banner 65/85/120 USD stay evidence)', () => {
    const r = resolvePrice(
      req('xbanner_completo', {
        market: 'USA',
        quantity: 1,
        selections: [{ optionKey: 'tamano_display', valueCodes: ['24x63'] }],
      }),
      s,
      AS_OF,
    );
    expect(r.status).toBe('QUOTE_ONLY');
    if (r.status === 'QUOTE_ONLY') expect(r.reasonCode).toBe('NO_AUTHORIZED_BASE_PRICE');
  });

  it('E10 Imanes: 1 par = 65.00 USD (FIXED, never 32.50 per piece); 2 pares → QUOTE_ONLY (P1-03)', () => {
    expect(amount(resolvePrice(req('imanes_par', { market: 'USA', quantity: 1 }), s, AS_OF))).toBe(
      '65.00 USD',
    );
    const two = resolvePrice(req('imanes_par', { market: 'USA', quantity: 2 }), s, AS_OF);
    expect(two.status === 'QUOTE_ONLY' && two.reasonCode).toBe(
      'FIXED_PRICE_QUANTITY_NOT_AUTHORIZED',
    );
    expect(amount(resolvePrice(req('imanes_par', { market: 'MX', quantity: 1 }), s, AS_OF))).toBe(
      '750.75 MXN',
    );
  });

  it('E9 Gorra has no size option: a 3XL configuration is rejected (surcharge cannot leak)', () => {
    const r = resolvePrice(
      req('gorra', {
        market: 'USA',
        quantity: 1,
        selections: [{ optionKey: 'talla', valueCodes: ['3XL'] }],
      }),
      s,
      AS_OF,
    );
    expect(r.status).toBe('INVALID');
    if (r.status === 'INVALID') expect(r.errors.map((e) => e.code)).toContain('OPTION_NOT_ALLOWED');
  });

  it('E11 optional component that is not ACTIVE cannot be selected (yard sign + CANDIDATE stake)', () => {
    const r = resolvePrice(
      req('yard_sign', {
        market: 'USA',
        quantity: 1,
        optionalComponents: [
          { catalogItemId: s.items.find((i) => i.canonicalName.startsWith('Estaca'))!.id },
        ],
      }),
      s,
      AS_OF,
    );
    expect(r.status).toBe('INVALID');
    if (r.status === 'INVALID') expect(r.errors[0]?.code).toBe('OPTIONAL_COMPONENT_NOT_ACTIVE');
  });

  it('service on customer-owned item requires a decoration and never adds a blank', () => {
    const none = resolvePrice(
      req('aplicacion_dtf_cliente', { market: 'USA', quantity: 10 }),
      s,
      AS_OF,
    );
    expect(none.status === 'INVALID' && none.errors.map((e) => e.code)).toEqual([
      'DECORATION_REQUIRED',
    ]);
    const dtf = resolvePrice(
      req('aplicacion_dtf_cliente', {
        market: 'USA',
        quantity: 10,
        decorations: [{ methodKey: 'DTF' }],
      }),
      s,
      AS_OF,
    );
    expect(dtf.status).toBe('QUOTE_ONLY'); // no sale unit / price yet: never invented
    const embroidery = resolvePrice(
      req('aplicacion_dtf_cliente', {
        market: 'USA',
        quantity: 10,
        decorations: [{ methodKey: 'EMBROIDERY' }],
      }),
      s,
      AS_OF,
    );
    expect(embroidery.status === 'INVALID' && embroidery.errors[0]?.code).toBe(
      'METHOD_NOT_COMPATIBLE',
    );
  });

  it('items with unset status or CANDIDATE are not quotable', () => {
    const inv = resolvePrice(req('invitacion_evento', { market: 'USA', quantity: 100 }), s, AS_OF);
    expect(inv.status === 'INVALID' && inv.errors[0]).toMatchObject({
      code: 'ITEM_NOT_ACTIVE',
      detail: 'UNSET',
    });
    const dtf = resolvePrice(req('dtf_transfer', { market: 'USA', quantity: 1 }), s, AS_OF);
    expect(dtf.status === 'INVALID' && dtf.errors[0]).toMatchObject({
      code: 'ITEM_NOT_ACTIVE',
      detail: 'CANDIDATE',
    });
  });
});

describe('pricing — effective dating uses the explicit asOf (ADR-0009)', () => {
  const s = sliceSnapshot();
  const premium500 = (market: 'USA' | 'MX') =>
    req('tarjeta_premium', {
      market,
      quantity: 500,
      selections: [{ optionKey: 'caras', valueCodes: ['2'] }],
    });

  it('before the authorization date no price exists', () => {
    const r = resolvePrice(premium500('USA'), s, new Date('2026-09-01T00:00:00Z'));
    expect(r.status === 'QUOTE_ONLY' && r.reasonCode).toBe('NO_AUTHORIZED_BASE_PRICE');
  });

  it('México needs an FX parameter effective at asOf', () => {
    const r = resolvePrice(premium500('MX'), s, new Date('2026-09-20T00:00:00Z'));
    expect(r.status === 'QUOTE_ONLY' && r.reasonCode).toBe('FX_PARAMETER_MISSING');
  });

  it('same request + snapshot + asOf ⇒ identical result', () => {
    const a = resolvePrice(premium500('MX'), s, AS_OF);
    const b = resolvePrice(premium500('MX'), structuredClone(s), new Date(AS_OF.getTime()));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('asOf is mandatory', () => {
    // @ts-expect-error asOf is required by the signature
    expect(() => resolvePrice(premium500('USA'), s)).toThrow(TypeError);
    expect(() => resolvePrice(premium500('USA'), s, new Date('invalid'))).toThrow(TypeError);
  });
});
