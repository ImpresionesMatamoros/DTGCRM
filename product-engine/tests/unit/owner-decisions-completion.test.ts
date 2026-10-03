import { describe, expect, it } from 'vitest';
import pack from '@/decisions/commercial-print.pack.json';
import {
  CANONICAL,
  CANONICAL_IDS,
  COMPLETION_ANSWERS,
  DISPOSITION_SPECS,
  NON_PRODUCT_IDS,
} from '@/decisions/owner-decisions-v1';
import { OD01_ACTIVE } from '@/decisions/step09-owner-decisions';
import { decisionById } from '@/decisions/reference';
import { validateAnswer } from '@/quality/decision-actions';
import type { PriceDefinition } from '@/domain/pricing-model';
import { evaluateMigrationItem, isPublishableVerdict, migrationGate } from '@/migration/gate';
import type { CommercialPrintGate, GateItem } from '@/quality/gate';
import { resolvePrice } from '@/pricing/resolve';
import { AS_OF, REF, itemId, req, sliceSnapshot } from '../fixtures/slice';

/** STEP 09 completion · OWNER_DECISION_SPEC_v1.0 applied to the 16 previously blocked rows. */

const scope = pack.items.map((p) => p.legacyId);

describe('owner decisions v1.0 — canonicalization of the 21 source rows', () => {
  it('every scoped row has exactly one treatment: published before, canonical now, or non-product', () => {
    const treated = [...OD01_ACTIVE, ...CANONICAL_IDS, ...NON_PRODUCT_IDS];
    expect(new Set(treated).size).toBe(treated.length); // no row twice
    expect([...treated].sort()).toEqual([...scope].sort()); // all 21, none outside the scope
    expect(CANONICAL_IDS).toHaveLength(8);
    expect(NON_PRODUCT_IDS).toHaveLength(8);
  });

  it('invitations: Sencilla and Premium are canonical; the rest are alias / configuration / style / invalid legacy', () => {
    expect(CANONICAL['MIGF-O-008'].status).toBe('ACTIVE');
    expect(CANONICAL['MIGF-O-009'].status).toBe('ACTIVE');
    const by = Object.fromEntries(DISPOSITION_SPECS.map((d) => [d.itemLegacyId, d]));
    expect(by['MIGF-O-010']!.disposition).toBe('ALIAS'); // Invitación para evento
    expect(by['MIGF-O-011']!.disposition).toBe('CONFIGURATION'); // con sobre
    expect(by['MIGF-O-012']).toMatchObject({
      disposition: 'CONFIGURATION',
      canonicalLegacyIds: ['MIGF-O-009'],
    }); // con sello → Premium
    expect(by['MIGF-O-013']).toMatchObject({
      disposition: 'CONFIGURATION',
      canonicalLegacyIds: ['MIGF-O-009'],
    }); // con acrílico → Premium
    expect(by['MIGF-O-014']!.disposition).toBe('LEGACY_INVALID'); // Invitación especial
    expect(by['OWN-O-007']!.disposition).toBe('STYLE'); // formal
    expect(by['OWN-O-008']!.disposition).toBe('STYLE'); // casual
    expect(by['MIG2-O-046']!.disposition).toBe('LEGACY_INVALID'); // Tarjetas complementarias
  });

  it('invalid legacy rows have no canonical target; every other disposition points at a canonical product', () => {
    for (const d of DISPOSITION_SPECS) {
      if (d.disposition === 'LEGACY_INVALID') expect(d.canonicalLegacyIds).toEqual([]);
      else {
        expect(d.canonicalLegacyIds.length).toBeGreaterThan(0);
        for (const c of d.canonicalLegacyIds) expect(CANONICAL_IDS as string[]).toContain(c);
      }
    }
  });

  it('non-product rows never appear among the rows that become CatalogItems', () => {
    for (const l of NON_PRODUCT_IDS) expect(CANONICAL_IDS as string[]).not.toContain(l);
  });

  it('CANDIDATE rows are exactly Seating card and Thank-you card; everything else canonical is ACTIVE', () => {
    const cand = CANONICAL_IDS.filter((l) => CANONICAL[l].status === 'CANDIDATE').sort();
    expect(cand).toEqual(['MIG2-O-047', 'MIG2-O-048']);
    for (const l of CANONICAL_IDS.filter((x) => !cand.includes(x)))
      expect(CANONICAL[l].status).toBe('ACTIVE');
  });

  it('Poster / Tabloide 11×17 and Poster Gran Formato stay two distinct products (cardstock piece vs measured poster paper)', () => {
    const a = CANONICAL['MIG2-O-037'];
    const b = CANONICAL['MIG2-O-038'];
    expect(a.canonicalName).not.toBe(b.canonicalName);
    expect(a.saleUnit).toBe('PIECE');
    expect(b.saleUnit).toBe('SQ_FT');
    expect(b.canonicalName).not.toMatch(/banner/i);
  });

  it('the revised answers are valid against the decision reference, scoped to their decision, with no invented value', () => {
    for (const a of COMPLETION_ANSWERS) {
      expect(decisionById(a.decisionId), a.decisionId).toBeTruthy();
      const v = validateAnswer({
        decisionId: a.decisionId,
        summary: a.summary,
        notes: a.notes,
        ...(a.assignments ? { assignments: a.assignments as never } : {}),
        ...(a.covers ? { covers: a.covers } : {}),
      });
      expect(v, JSON.stringify(v)).toEqual({ ok: true });
    }
    const d001 = COMPLETION_ANSWERS.find((a) => a.decisionId === 'D-001')!;
    const active = d001.assignments!.find((a) => a.value === 'ACTIVE')!.legacyIds;
    const candidate = d001.assignments!.find((a) => a.value === 'CANDIDATE')!.legacyIds;
    for (const l of OD01_ACTIVE) expect(active).toContain(l); // earlier answers are kept
    expect(candidate.sort()).toEqual(['MIG2-O-047', 'MIG2-O-048']);
    expect(d001.covers!.sort()).toEqual([...NON_PRODUCT_IDS].sort());
    // tangible = PRODUCT: the newspaper is a PRODUCT (D-003)
    const d003 = COMPLETION_ANSWERS.find((a) => a.decisionId === 'D-003')!;
    expect(d003.assignments).toEqual([{ value: 'PRODUCT', legacyIds: ['OWN-MT-O-046'] }]);
    expect(CANONICAL['OWN-MT-O-046'].status).toBe('ACTIVE');
  });
});

const readiness = (over = {}) =>
  ({
    candidateId: 'c1',
    legacyId: 'X-1',
    name: 'X',
    category: 'impresos_papel',
    reviewStatus: 'REJECTED',
    review: { state: 'READY', reasons: [] },
    domain: { state: 'READY', reasons: [] },
    pricing: { state: 'QUOTE_ONLY', reasons: [] },
    publication: { state: 'BLOCKED', reasons: [] },
    openDecisions: [],
    findingCount: 0,
    readyIgnoringBarrier: true,
    dataClass: 'REAL',
    ...over,
  }) as never;
const gi = (legacyId: string, r: unknown = null): GateItem =>
  ({
    legacyId,
    name: legacyId,
    family: 'f',
    staged: r !== null,
    candidateId: null,
    readiness: r,
    status: { state: 'MISSING', value: null },
    saleUnit: { state: 'MISSING', value: null },
    category: { state: 'MISSING', value: null },
    price: { state: 'UNKNOWN', evidenceObservations: 0, priceCandidates: 0 },
    options: { candidates: 0, unresolved: 0 },
    presentations: { candidates: 0, unresolved: 0 },
    provenance: { state: 'OK', candidates: 1, broken: 0 },
    openDecisions: [],
    blockers: { domain: [], option: [], pricing: [], decision: [], publication: [] },
    canMigrate: false,
  }) as GateItem;

describe('migration gate with dispositions', () => {
  const disp = {
    itemLegacyId: 'MIGF-O-012',
    disposition: 'CONFIGURATION' as const,
    canonicalLegacyIds: ['MIGF-O-009'],
    detail: 'con sello',
    decisionId: 'D-018',
  };

  it('a disposed row is RESOLVED: not blocked, not publishable, never a product', () => {
    const v = evaluateMigrationItem(gi('MIGF-O-012'), [], disp);
    expect(v.verdict).toBe('RESOLVED');
    expect(isPublishableVerdict(v.verdict)).toBe(false);
    expect(v.reasons).toEqual([]);
    expect(v.disposition).toEqual(disp);
  });

  it('without a disposition the same unresolved row stays BLOCKED (nothing is resolved by absence)', () => {
    expect(evaluateMigrationItem(gi('MIGF-O-012'), []).verdict).toBe('BLOCKED');
  });

  it('a row already PUBLISHED is never downgraded by a disposition', () => {
    const v = evaluateMigrationItem(gi('X', readiness({ reviewStatus: 'PUBLISHED' })), [], disp);
    expect(v.verdict).toBe('PUBLISHED');
  });

  it('totals: resolved rows are counted apart from publishable and blocked', () => {
    const gate = {
      asOf: 'x',
      meta: pack.meta,
      totals: {} as never,
      items: [gi('A'), gi('MIGF-O-012'), gi('B')],
    } as CommercialPrintGate;
    const g = migrationGate(gate, ['USA'], [disp]);
    expect(g).toMatchObject({ scoped: 3, publishable: 0, resolved: 1, blocked: 2 });
  });
});

describe('invitation floor-tier semantics (greatest threshold ≤ quantity) on the existing TIERED model', () => {
  const THRESHOLDS = [12, 25, 50, 75, 100, 150, 200, 250, 300];
  const snap = () => {
    const s = sliceSnapshot();
    const tiered: PriceDefinition = {
      id: '00000000-0000-4000-8000-00000000f0a1',
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
      // synthetic FIXTURE amounts keyed by threshold: never stored, never real prices
      breaks: THRESHOLDS.map((q) => ({
        quantity: q,
        amount: `${q}.00`,
        amountBasis: 'TOTAL' as const,
      })),
    };
    s.priceDefinitions.push(tiered);
    return s;
  };
  const tierOf = (q: number) => {
    const r = resolvePrice(
      req('camiseta_algodon', {
        market: 'USA',
        quantity: q,
        distribution: [{ selections: [{ optionKey: 'talla', valueCodes: ['L'] }], quantity: q }],
      }),
      snap(),
      AS_OF,
    );
    if (r.status !== 'RESOLVED') return r.status;
    return r.breakdown.find((l) => l.kind === 'BASE')?.source.breakQuantity;
  };

  it.each([
    [24, 12],
    [25, 25],
    [48, 25],
    [50, 50],
    [74, 50],
    [299, 250],
    [300, 300],
    [301, 300], // above the last bracket: stays on 300 unless manually excepted
    [1000, 300],
  ])('quantity %i → tier %i', (q, tier) => {
    expect(tierOf(q)).toBe(tier);
  });

  it('below the minimum order quantity (12) there is no tier: QUOTE_ONLY, never an invented price', () => {
    expect(tierOf(11)).toBe('QUOTE_ONLY');
    expect(tierOf(1)).toBe('QUOTE_ONLY');
  });
});
