import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { EnvelopeCandidateSchema, HistoricalPriceSchema, type RawRecord } from '@/import/contract';
import type { PriceProposal, Proposal } from '@/import/proposal';
import { BLOCKING, blockingReasons, unresolvedFields } from '@/import/requirements';
import { groupPrices, planStaging, type PlannedCandidate } from '@/import/staging-plan';
import { fixtureEnvelope, realPriceEvidence } from '../fixtures/import-envelopes';

const byKind = (cs: PlannedCandidate[], kind: Proposal['kind']) =>
  cs.filter((c) => c.kind === kind);
const price = (c: PlannedCandidate) => c.proposal as PriceProposal;

describe('staging plan (pure)', () => {
  it('is deterministic: same envelope ⇒ same keys, hashes and order', () => {
    const a = planStaging(fixtureEnvelope('premium-business-card'));
    const b = planStaging(fixtureEnvelope('premium-business-card'));
    expect(b).toEqual(a);
    expect(a.envelopeSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('keeps every record with raw + normalized payload and cells', () => {
    const env = fixtureEnvelope('x-banner');
    const plan = planStaging(env);
    expect(plan.records).toHaveLength(env.records.length);
    for (const [i, r] of plan.records.entries()) {
      expect(r.rawPayload).toEqual(env.records[i]!.raw_payload);
      expect(r.normalizedPayload).toEqual(env.records[i]!.normalized_payload);
      expect(r.sourceCells).toEqual(env.records[i]!.source);
    }
  });

  it('groups premium card prices into two exact matrices (1 and 2 sides), 10 breaks each, no 750', () => {
    const plan = planStaging(fixtureEnvelope('premium-business-card'));
    const prices = byKind(plan.candidates, 'PRICE');
    expect(prices).toHaveLength(2);
    for (const p of prices.map(price)) {
      expect(p.model).toBe('EXACT_QUANTITY_MATRIX');
      expect(p.currency).toBe('USD');
      expect(p.market).toBe('USA');
      expect(p.amountBasis).toBe('TOTAL');
      expect(p.observations.map((o) => o.quantity)).toEqual([
        100, 250, 500, 1000, 1500, 2000, 2500, 3000, 4000, 5000,
      ]);
      expect(p.observations.some((o) => o.quantity === 750)).toBe(false);
    }
    const twoSides = prices.map(price).find((p) => p.conditions[0]!.value === '2')!;
    expect(twoSides.observations.find((o) => o.quantity === 500)!.amount).toBe('120');
  });

  it('keeps the magnet FIXED price with unknown quantity (maxQuantity unresolved, never 1 by default)', () => {
    const plan = planStaging(fixtureEnvelope('magnets'));
    const [p] = byKind(plan.candidates, 'PRICE');
    expect(price(p!).model).toBe('FIXED');
    expect(price(p!).observations[0]!.quantity).toBeNull();
    expect(unresolvedFields(p!.proposal)).toContain('maxQuantity');
    const item = byKind(plan.candidates, 'CATALOG_ITEM')[0]!.proposal;
    if (item.kind !== 'CATALOG_ITEM') throw new Error('unexpected');
    expect(item.fixedAttributes.map((a) => a.optionLegacyId).sort()).toEqual(
      price(p!)
        .conditions.map((c) => c.optionLegacyId)
        .sort(),
    );
  });

  it('never turns historical price evidence into a PRICE candidate', () => {
    const env = fixtureEnvelope('x-banner');
    const plan = planStaging(env);
    const historical = new Set(
      plan.records.filter((r) => r.evidenceClass === 'HISTORICAL_PRICE').map((r) => r.recordKey),
    );
    expect(historical.size).toBe(env.historical_prices.length);
    expect(historical.size).toBeGreaterThan(0);
    const used = byKind(plan.candidates, 'PRICE').flatMap((c) => c.sources.map((s) => s.recordKey));
    for (const k of used) expect(historical.has(k)).toBe(false);
  });

  it('models X-Banner complete → stand + graphic as composition relations (no Component entity)', () => {
    const plan = planStaging(fixtureEnvelope('x-banner'));
    const relations = byKind(plan.candidates, 'COMPOSITION').map((c) => c.proposal);
    expect(relations).toHaveLength(2);
    for (const r of relations) {
      if (r.kind !== 'COMPOSITION' || r.subtype !== 'RELATION') throw new Error('unexpected');
      expect(r.parentLegacyId).toBe('MIG1-O-003');
      expect(r.role).toBe('INCLUDED');
      expect(r.quantity).toBe(1);
    }
    expect(
      byKind(plan.candidates, 'CATALOG_ITEM')
        .map((c) => (c.proposal as { legacyId: string }).legacyId)
        .sort(),
    ).toEqual(['MIG1-O-003', 'MIG1-O-021', 'OWN-O-003']);
  });

  it('turns Blank/Personalizada into an OPTIONAL decoration policy, never an option', () => {
    const plan = planStaging(fixtureEnvelope('cotton-t-shirt'));
    const policies = byKind(plan.candidates, 'DECORATION').filter(
      (c) => c.proposal.kind === 'DECORATION' && c.proposal.subtype === 'POLICY',
    );
    expect(policies).toHaveLength(1);
    const options = byKind(plan.candidates, 'OPTION').map(
      (c) => c.proposal as { name: string | null },
    );
    expect(
      options.some((o) =>
        ['modalidad', 'blank', 'personalizada'].includes((o.name ?? '').toLowerCase()),
      ),
    ).toBe(false);
  });

  it('suggests (never decides) decoration methods; production processes get no suggestion', () => {
    const plan = planStaging(fixtureEnvelope('cotton-t-shirt'));
    const methods = byKind(plan.candidates, 'DECORATION')
      .map((c) => c.proposal)
      .flatMap((p) => (p.kind === 'DECORATION' && p.subtype === 'METHOD_ASSOCIATION' ? [p] : []));
    expect(methods.length).toBeGreaterThan(0);
    for (const m of methods) expect(unresolvedFields(m)).toEqual(['methodKey']);
    const dtf = methods.find((m) => m.methodLabels[0] === 'DTF textil');
    expect(dtf?.suggestedMethodKey).toBe('DTF');
  });

  it('DTF Transfer is a PRODUCT catalog item, separate from the DTF method', () => {
    const plan = planStaging(fixtureEnvelope('dtf-transfer'));
    const item = byKind(plan.candidates, 'CATALOG_ITEM')[0]!.proposal;
    expect(item.kind === 'CATALOG_ITEM' && item.itemType).toBe('PRODUCT');
  });

  it('reports duplicate reviews as A/B + signals with autoMerge=false', () => {
    const plan = planStaging(fixtureEnvelope('x-banner'));
    const dup = plan.issues.filter((i) => i.code === 'IMPORT_DUPLICATE_REVIEW');
    expect(dup.length).toBeGreaterThan(0);
    for (const d of dup) {
      expect(d.detail?.autoMerge).toBe(false);
      expect((d.detail?.recordKeys as string[]).length).toBe(2);
      expect(d.detail?.kind).toBe('RELATIONSHIP_NOT_DUPLICATE');
    }
  });
});

describe('unresolved fields: unknown never becomes a default', () => {
  it('status null stays unresolved (never CANDIDATE); decoration policy always needs a decision', () => {
    const plan = planStaging(fixtureEnvelope('premium-business-card'));
    const item = byKind(plan.candidates, 'CATALOG_ITEM')[0]!.proposal;
    if (item.kind !== 'CATALOG_ITEM') throw new Error('unexpected');
    expect(item.status).toBeNull();
    expect(unresolvedFields(item)).toEqual(['status', 'decorationPolicy']);
    expect(unresolvedFields(item, { status: 'ACTIVE', decorationPolicy: 'NONE' })).toEqual([]);
  });

  it('required null stays unresolved until a person says true or false', () => {
    const plan = planStaging(fixtureEnvelope('cotton-t-shirt'));
    const option = byKind(plan.candidates, 'OPTION')[0]!.proposal;
    if (option.kind !== 'OPTION') throw new Error('unexpected');
    expect(option.required).toBeNull();
    expect(unresolvedFields(option)).toContain('isRequired');
    expect(unresolvedFields(option, { isRequired: false })).not.toContain('isRequired');
  });

  it('unknown item type (Clase blank) is unresolved; BUNDLE blocks', () => {
    const plan = planStaging(fixtureEnvelope('yard-sign'));
    const item = byKind(plan.candidates, 'CATALOG_ITEM')[0]!.proposal;
    if (item.kind !== 'CATALOG_ITEM') throw new Error('unexpected');
    const unknown = { ...item, itemType: null, itemTypeEvidence: null } as const;
    expect(unresolvedFields(unknown)).toContain('itemType');
    const bundle = { ...item, itemType: null, itemTypeEvidence: 'BUNDLE' } as const;
    expect(blockingReasons(bundle, 'WARNING', [])).toContain(BLOCKING.BUNDLE_NOT_SUPPORTED);
  });

  it('prices always need a Product Engine validity start', () => {
    const plan = planStaging(fixtureEnvelope('premium-business-card'));
    for (const c of byKind(plan.candidates, 'PRICE'))
      expect(unresolvedFields(c.proposal)).toEqual(['validFrom']);
  });
});

describe('blocking reasons', () => {
  const base = () =>
    price(byKind(planStaging(fixtureEnvelope('premium-business-card')).candidates, 'PRICE')[0]!);

  it('a clean authorized matrix is not blocked', () => {
    expect(
      blockingReasons(base(), 'WARNING', [{ code: 'IMPORT_UNMAPPED_OPTION', severity: 'WARNING' }]),
    ).toEqual([]);
  });

  it('blocks parser rejections and source errors', () => {
    expect(blockingReasons(base(), 'REJECTED', [])).toContain(BLOCKING.PARSER_REJECTED);
    expect(
      blockingReasons(base(), 'WARNING', [{ code: 'IMPORT_INVALID_MONEY', severity: 'ERROR' }]),
    ).toContain(BLOCKING.SOURCE_ERROR);
  });

  it('blocks prices not authorized in the source, MXN evidence and conflicting breaks', () => {
    const p = base();
    const pending = {
      ...p,
      observations: p.observations.map((o, i) =>
        i === 0 ? { ...o, authorizationEvidence: false } : o,
      ),
    };
    expect(blockingReasons(pending, 'VALID', [])).toContain(
      BLOCKING.PRICE_NOT_AUTHORIZED_IN_SOURCE,
    );
    expect(blockingReasons({ ...p, currency: 'MXN', market: 'MX' }, 'VALID', [])).toContain(
      BLOCKING.MX_PRICE_EVIDENCE_ONLY,
    );
    const conflict = {
      ...p,
      observations: [...p.observations, { ...p.observations[0]!, amount: '999' }],
    };
    expect(blockingReasons(conflict, 'VALID', [])).toContain(BLOCKING.PRICE_CONFLICT);
    expect(blockingReasons({ ...p, currency: null, market: null }, 'VALID', [])).toContain(
      BLOCKING.PRICE_CURRENCY_UNKNOWN,
    );
  });
});

describe('real v1.2 price evidence (131 current + 23 historical)', () => {
  const real = realPriceEvidence();
  const candidates = z.array(EnvelopeCandidateSchema).parse(real.price_candidates);
  const historical = z.array(HistoricalPriceSchema).parse(real.historical_prices);
  const index = new Map(real.records.map((r) => [r.record_id, r as unknown as RawRecord]));
  const prices = candidates.flatMap((c) => (c.kind === 'price' ? [c] : []));
  const groups = groupPrices(prices, index);

  it('131 observations → 14 PriceDefinition hypotheses (13 exact matrices + 1 FIXED), nothing lost', () => {
    expect(prices).toHaveLength(131);
    expect(groups).toHaveLength(14);
    const models = groups.map((g) => price(g).model);
    expect(models.filter((m) => m === 'EXACT_QUANTITY_MATRIX')).toHaveLength(13);
    expect(models.filter((m) => m === 'FIXED')).toHaveLength(1);
    const observed = groups
      .flatMap((g) => price(g).observations.map((o) => o.parserCandidateKey))
      .sort();
    expect(observed).toEqual(prices.map((p) => p.candidate_id).sort());
    expect(groups.reduce((n, g) => n + price(g).observations.length, 0)).toBe(131);
    const breaks = groups
      .filter((g) => price(g).model === 'EXACT_QUANTITY_MATRIX')
      .reduce((n, g) => n + price(g).observations.length, 0);
    expect(breaks).toBe(130);
  });

  it('groups by item and exact condition set (sides, paper, size), never by name', () => {
    const byItem: Record<string, number> = {};
    for (const g of groups)
      byItem[price(g).itemLegacyId] = (byItem[price(g).itemLegacyId] ?? 0) + 1;
    expect(byItem).toEqual({ 'MIG1-O-008': 2, 'MIG1-O-009': 2, 'MIG2-O-036': 9, 'MIGF-O-015': 1 });
    for (const g of groups) {
      const qs = price(g).observations.map((o) => o.quantity);
      expect(new Set(qs).size).toBe(qs.length); // one break per quantity
      expect(blockingReasons(price(g), 'WARNING', [])).toEqual([]);
    }
    const flyerKeys = groups
      .filter((g) => price(g).itemLegacyId === 'MIG2-O-036')
      .map((g) => g.lineageKey);
    expect(new Set(flyerKeys).size).toBe(9);
  });

  it('no interpolation: 750 is never a break; every amount carries USD', () => {
    for (const g of groups) {
      const p = price(g);
      expect(p.currency).toBe('USD');
      expect(p.observations.some((o) => o.quantity === 750)).toBe(false);
    }
  });

  it('the 23 historical prices are excluded from every group', () => {
    expect(historical).toHaveLength(23);
    const inGroups = new Set(groups.flatMap((g) => price(g).observations.map((o) => o.recordKey)));
    for (const h of historical) expect(inGroups.has(h.record_id)).toBe(false);
  });
});
