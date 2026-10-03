import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import type { PriceDefinition } from '@/domain/pricing-model';
import { resolvePrice } from '@/pricing/resolve';
import type { PriceResult } from '@/pricing/result';
import {
  AS_OF,
  REF,
  fixtureBaseCamiseta,
  fixtureConflictingSizeRule,
  fixtureDecorationPrice,
  fixtureFactorOverride,
  fixtureManualMx,
  fixtureYardSignWithStake,
  itemId,
  req,
  sliceSnapshot,
} from '../fixtures/slice';

/** Cases without real data yet: synthetic FIXTURE amounts, never seeded. */

const total = (r: PriceResult) =>
  r.status === 'RESOLVED' ? `${r.total.amount.toFixed(2)} ${r.total.currency}` : r.status;

const corrida = (market: 'USA' | 'MX' = 'USA') =>
  req('camiseta_algodon', {
    market,
    quantity: 12,
    distribution: [
      { selections: [{ optionKey: 'talla', valueCodes: ['L'] }], quantity: 9 },
      { selections: [{ optionKey: 'talla', valueCodes: ['3XL'] }], quantity: 3 },
    ],
  });

describe('size distribution (ADR-0001)', () => {
  it('volume uses quantity basis 12; the +3 surcharge applies only to the 3 × 3XL', () => {
    const s = sliceSnapshot();
    // FIXTURE tiered base: 1–11 → 12.00/u, 12+ → 10.00/u
    const tiered: PriceDefinition = {
      id: '00000000-0000-4000-8000-00000000f001',
      itemId: itemId('camiseta_algodon'),
      priceBookId: REF.bookUSA,
      component: 'ITEM',
      status: 'AUTHORIZED',
      validFrom: '2026-01-01T00:00:00Z',
      validTo: null,
      version: 1,
      supersedesId: null,
      authorizedBy: 'FIXTURE',
      authorizedAt: '2026-01-01T00:00:00Z',
      conditions: [],
      model: 'TIERED',
      breaks: [
        { quantity: 1, amount: '12.00', amountBasis: 'UNIT' },
        { quantity: 12, amount: '10.00', amountBasis: 'UNIT' },
      ],
    };
    s.priceDefinitions.push(tiered);
    const r = resolvePrice(corrida(), s, AS_OF);
    expect(r.status).toBe('RESOLVED');
    if (r.status !== 'RESOLVED') return;
    expect(total(r)).toBe('129.00 USD'); // 12 × 10.00 + 3 × 3.00
    const base = r.breakdown.find((l) => l.kind === 'BASE');
    expect(base?.quantity).toBe(12);
    expect(base?.source.breakQuantity).toBe(12);
    const rules = r.breakdown.filter((l) => l.kind === 'RULE');
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ quantity: 3, source: { ruleCode: 'size_3xl' } });
    expect(r.rulesApplied.map((a) => a.code)).toEqual(['size_3xl']);
  });

  it('blank vs decorated: same Product, decoration adds its own priced line (ADR-0004)', () => {
    const s = sliceSnapshot();
    fixtureBaseCamiseta(s, '10.00');
    fixtureDecorationPrice(s, '5.00');
    const blank = resolvePrice(corrida(), s, AS_OF);
    expect(total(blank)).toBe('129.00 USD');
    const decorated = resolvePrice({ ...corrida(), decorations: [{ methodKey: 'DTF' }] }, s, AS_OF);
    expect(total(decorated)).toBe('189.00 USD'); // + 12 × 5.00
    if (decorated.status === 'RESOLVED') {
      expect(decorated.breakdown.map((l) => l.kind)).toEqual(['BASE', 'DECORATION', 'RULE']);
    }
  });

  it('a decoration without an authorized price makes the whole line QUOTE_ONLY', () => {
    const s = sliceSnapshot();
    fixtureBaseCamiseta(s);
    const r = resolvePrice({ ...corrida(), decorations: [{ methodKey: 'EMBROIDERY' }] }, s, AS_OF);
    expect(r.status === 'QUOTE_ONLY' && r.reasonCode).toBe('NO_AUTHORIZED_DECORATION_PRICE');
    if (r.status === 'QUOTE_ONLY') expect(r.knownLines.map((l) => l.kind)).toEqual(['BASE']);
  });

  it('distribution rows may only vary distributable options and must add up', () => {
    const s = sliceSnapshot();
    const bad = resolvePrice(
      req('camiseta_algodon', {
        market: 'USA',
        quantity: 12,
        distribution: [{ selections: [{ optionKey: 'talla', valueCodes: ['L'] }], quantity: 10 }],
      }),
      s,
      AS_OF,
    );
    expect(bad.status === 'INVALID' && bad.errors.map((e) => e.code)).toEqual([
      'DISTRIBUTION_QTY_MISMATCH',
    ]);
  });
});

describe('México policies (ADR-0003)', () => {
  const premium = (quantity: number) =>
    req('tarjeta_premium', {
      market: 'MX',
      quantity,
      selections: [{ optionKey: 'caras', valueCodes: ['2'] }],
    });

  it('MANUAL policy with a matching manual price → MANUAL basis, MXN', () => {
    const s = sliceSnapshot();
    fixtureManualMx(s, '1500.00');
    const r = resolvePrice(premium(500), s, AS_OF);
    expect(total(r)).toBe('1500.00 MXN');
    expect(r.policy?.basis).toBe('MANUAL');
  });

  it('MANUAL policy without a matching manual configuration → QUOTE_ONLY, never falls back to derivation', () => {
    const s = sliceSnapshot();
    fixtureManualMx(s);
    const r = resolvePrice(premium(250), s, AS_OF);
    expect(r.status === 'QUOTE_ONLY' && r.reasonCode).toBe('MANUAL_MX_PRICE_MISSING');
  });

  it('MANUAL policy never converts USD rules: a USD surcharge without MX counterpart → QUOTE_ONLY', () => {
    const s = sliceSnapshot();
    s.itemMarketPolicies.push({
      itemId: itemId('camiseta_algodon'),
      marketId: REF.marketMX,
      pricingMode: 'MANUAL',
      factorOverride: null,
      isAvailable: true,
    });
    s.priceDefinitions.push({
      ...fixtureBaseCamiseta(sliceSnapshot()),
      id: '00000000-0000-4000-8000-00000000f007',
      priceBookId: REF.bookMX,
      amount: '150.00',
    } as PriceDefinition);
    const ok = resolvePrice(
      req('camiseta_algodon', {
        market: 'MX',
        quantity: 2,
        selections: [{ optionKey: 'talla', valueCodes: ['L'] }],
      }),
      s,
      AS_OF,
    );
    expect(total(ok)).toBe('300.00 MXN');
    const r = resolvePrice(corrida('MX'), s, AS_OF);
    expect(r.status === 'QUOTE_ONLY' && r.reasonCode).toBe('RULE_NOT_DEFINED_FOR_MARKET');
  });

  it('item factor override replaces the default factor', () => {
    const s = sliceSnapshot();
    fixtureFactorOverride(s, 'tarjeta_tradicional', '0.80');
    const r = resolvePrice(
      req('tarjeta_tradicional', {
        market: 'MX',
        quantity: 500,
        selections: [{ optionKey: 'caras', valueCodes: ['1'] }],
      }),
      s,
      AS_OF,
    );
    expect(total(r)).toBe('726.00 MXN'); // 55 × 0.80 × 16.5
    expect(r.policy).toMatchObject({ factor: '0.80', factorSource: 'ITEM' });
  });

  it('QUOTE_ONLY policy wins over any price', () => {
    const s = sliceSnapshot();
    s.itemMarketPolicies.push({
      itemId: itemId('imanes_par'),
      marketId: REF.marketMX,
      pricingMode: 'QUOTE_ONLY',
      factorOverride: null,
      isAvailable: true,
    });
    const r = resolvePrice(req('imanes_par', { market: 'MX', quantity: 1 }), s, AS_OF);
    expect(r.status === 'QUOTE_ONLY' && r.reasonCode).toBe('MARKET_POLICY_QUOTE_ONLY');
    expect(r.policy?.basis).toBe('POLICY_QUOTE_ONLY');
  });

  it('an item unavailable in a market is INVALID there', () => {
    const s = sliceSnapshot();
    s.itemMarketPolicies.push({
      itemId: itemId('imanes_par'),
      marketId: REF.marketMX,
      pricingMode: 'INHERIT',
      factorOverride: null,
      isAvailable: false,
    });
    const r = resolvePrice(req('imanes_par', { market: 'MX', quantity: 1 }), s, AS_OF);
    expect(r.status === 'INVALID' && r.errors[0]?.code).toBe('ITEM_NOT_AVAILABLE_IN_MARKET');
  });

  it('derived México applies surcharges in USD first, then converts the total', () => {
    const s = sliceSnapshot();
    fixtureBaseCamiseta(s, '10.00');
    const r = resolvePrice(corrida('MX'), s, AS_OF);
    expect(total(r)).toBe('1489.95 MXN'); // (120 + 9) × 0.70 × 16.5
  });
});

describe('ambiguity is reported, never silently resolved', () => {
  it('E7 two incompatible rules in the same exclusivity group → AMBIGUOUS', () => {
    const s = sliceSnapshot();
    fixtureBaseCamiseta(s);
    const conflicting = fixtureConflictingSizeRule(s);
    const r = resolvePrice(corrida(), s, AS_OF);
    expect(r.status).toBe('AMBIGUOUS');
    if (r.status !== 'AMBIGUOUS') return;
    expect(r.reasonCode).toBe('RULE_CONFLICT');
    expect(r.conflictingIds).toContain(conflicting.id);
  });

  it('two equally specific base definitions → AMBIGUOUS', () => {
    const s = sliceSnapshot();
    fixtureBaseCamiseta(s, '10.00');
    const dup = { ...fixtureBaseCamiseta(s, '11.00'), id: '00000000-0000-4000-8000-00000000f002' };
    s.priceDefinitions[s.priceDefinitions.length - 1] = dup;
    const r = resolvePrice(corrida(), s, AS_OF);
    expect(r.status === 'AMBIGUOUS' && r.reasonCode).toBe('BASE_DEFINITION_OVERLAP');
  });
});

describe('composition: each CatalogItem resolves its own market policy (ADR-0010)', () => {
  it('Yard Sign (default 0.70) + Stake (item factor 0.50) in México', () => {
    const s = sliceSnapshot();
    fixtureYardSignWithStake(s);
    const r = resolvePrice(
      req('yard_sign', {
        market: 'MX',
        quantity: 1,
        optionalComponents: [{ catalogItemId: itemId('estaca_yard_sign') }],
      }),
      s,
      AS_OF,
    );
    expect(r.status).toBe('RESOLVED');
    if (r.status !== 'RESOLVED') return;
    // 20 × 0.70 × 16.5 = 231.00 ; 2 × 0.50 × 16.5 = 16.50
    expect(total(r)).toBe('247.50 MXN');
    expect(r.policy).toMatchObject({ factor: '0.70', factorSource: 'DEFAULT' });
    expect(r.components).toHaveLength(1);
    const stake = r.components[0]!.result;
    expect(stake.policy).toMatchObject({ factor: '0.50', factorSource: 'ITEM' });
    expect(`${stake.total.amount.toFixed(2)} ${stake.total.currency}`).toBe('16.50 MXN');
    const line = r.breakdown.find((l) => l.kind === 'COMPONENT_OPTIONAL');
    expect(line?.amount?.currency).toBe('MXN');
  });

  it('included components are listed as content without their own amount', () => {
    const s = sliceSnapshot();
    s.priceDefinitions.push({
      id: '00000000-0000-4000-8000-00000000f003',
      itemId: itemId('xbanner_completo'),
      priceBookId: REF.bookUSA,
      component: 'ITEM',
      status: 'AUTHORIZED',
      validFrom: '2026-01-01T00:00:00Z',
      validTo: null,
      version: 1,
      supersedesId: null,
      authorizedBy: 'FIXTURE',
      authorizedAt: '2026-01-01T00:00:00Z',
      conditions: [],
      model: 'PER_UNIT',
      amount: '50.00',
      minQuantity: null,
      maxQuantity: null,
    });
    const r = resolvePrice(
      req('xbanner_completo', {
        market: 'USA',
        quantity: 2,
        selections: [{ optionKey: 'tamano_display', valueCodes: ['32x72'] }],
      }),
      s,
      AS_OF,
    );
    expect(total(r)).toBe('100.00 USD');
    if (r.status !== 'RESOLVED') return;
    const included = r.breakdown.filter((l) => l.kind === 'COMPONENT_INCLUDED');
    expect(included.map((l) => [l.label, l.quantity, l.amount])).toEqual([
      ['Estructura X-Banner', 2, null],
      ['Gráfica impresa X-Banner', 2, null],
    ]);
  });

  it('a component without price makes the parent QUOTE_ONLY (total never invented)', () => {
    const s = sliceSnapshot();
    fixtureYardSignWithStake(s);
    s.priceDefinitions = s.priceDefinitions.filter((d) => d.itemId !== itemId('estaca_yard_sign'));
    const r = resolvePrice(
      req('yard_sign', {
        market: 'USA',
        quantity: 1,
        optionalComponents: [{ catalogItemId: itemId('estaca_yard_sign') }],
      }),
      s,
      AS_OF,
    );
    expect(r.status === 'QUOTE_ONLY' && r.reasonCode).toBe('COMPONENT_NOT_PRICED');
  });
});

describe('other price models (FIXTURE)', () => {
  it('MEASURED: rate per ft² from inches, with minimum charge', () => {
    const s = sliceSnapshot();
    const item = s.items.find((i) => i.id === itemId('yard_sign'))!;
    item.saleUnit = 'SQ_FT';
    item.measurementSpec = { kind: 'AREA', unit: 'in' };
    s.priceDefinitions.push({
      id: '00000000-0000-4000-8000-00000000f004',
      itemId: item.id,
      priceBookId: REF.bookUSA,
      component: 'ITEM',
      status: 'AUTHORIZED',
      validFrom: '2026-01-01T00:00:00Z',
      validTo: null,
      version: 1,
      supersedesId: null,
      authorizedBy: 'FIXTURE',
      authorizedAt: '2026-01-01T00:00:00Z',
      conditions: [],
      model: 'MEASURED',
      rate: '3.00',
      rateUnit: 'SQ_FT',
      minCharge: '10.00',
    });
    const big = resolvePrice(
      req('yard_sign', {
        market: 'USA',
        quantity: 2,
        measurements: { width: 36, height: 72, unit: 'in' },
      }),
      s,
      AS_OF,
    );
    expect(total(big)).toBe('108.00 USD'); // 3 × 6 ft² × 3.00 × 2
    const small = resolvePrice(
      req('yard_sign', {
        market: 'USA',
        quantity: 1,
        measurements: { width: 12, height: 12, unit: 'in' },
      }),
      s,
      AS_OF,
    );
    expect(total(small)).toBe('10.00 USD');
    const missing = resolvePrice(req('yard_sign', { market: 'USA', quantity: 1 }), s, AS_OF);
    expect(missing.status === 'INVALID' && missing.errors[0]?.code).toBe('MEASUREMENT_REQUIRED');
  });

  it('REQUIRE_QUOTE rule forces quotation', () => {
    const s = sliceSnapshot();
    fixtureBaseCamiseta(s);
    s.priceRules.push({
      id: '00000000-0000-4000-8000-00000000f005',
      priceBookId: REF.bookUSA,
      code: 'FIXTURE_dtf_grande',
      label: 'FIXTURE DTF grande: variable',
      kind: 'REQUIRE_QUOTE',
      amount: null,
      exclusivityKey: null,
      status: 'AUTHORIZED',
      validFrom: '2026-01-01T00:00:00Z',
      validTo: null,
      version: 1,
      supersedesId: null,
      authorizedBy: 'FIXTURE',
      authorizedAt: '2026-01-01T00:00:00Z',
      conditions: [
        {
          id: '00000000-0000-4000-8000-00000000f006',
          kind: 'DECORATION_METHOD',
          decorationMethodId: REF.method.DTF,
        },
      ],
      itemIds: [itemId('camiseta_algodon')],
    });
    const r = resolvePrice({ ...corrida(), decorations: [{ methodKey: 'DTF' }] }, s, AS_OF);
    expect(r.status === 'QUOTE_ONLY' && r.reasonCode).toBe('RULE_REQUIRES_QUOTE');
  });
});

describe('every monetary value in a result carries its currency (ADR-0008)', () => {
  it('walks the result tree', () => {
    const s = sliceSnapshot();
    fixtureYardSignWithStake(s);
    const results = [
      resolvePrice(
        req('yard_sign', {
          market: 'MX',
          quantity: 1,
          optionalComponents: [{ catalogItemId: itemId('estaca_yard_sign') }],
        }),
        s,
        AS_OF,
      ),
      resolvePrice(corrida(), sliceSnapshot(), AS_OF),
    ];
    let checked = 0;
    const visit = (v: unknown): void => {
      if (v && typeof v === 'object') {
        const o = v as Record<string, unknown>;
        if (Decimal.isDecimal(o.amount)) {
          checked += 1;
          expect(['USD', 'MXN']).toContain(o.currency);
        }
        Object.values(o).forEach(visit);
      }
    };
    results.forEach(visit);
    expect(checked).toBeGreaterThan(5);
  });
});
