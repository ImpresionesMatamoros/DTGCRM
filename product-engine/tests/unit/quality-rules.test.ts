import { beforeEach, describe, expect, it } from 'vitest';
import { OWNER_DECISIONS } from '@/decisions/reference';
import { diffRuns, inventory, runQuality, summarize } from '@/quality/engine';
import { computeReadiness } from '@/quality/readiness';
import { RULES } from '@/quality/rules';
import type { DataQualityFinding } from '@/quality/types';
import {
  decoration,
  input,
  item,
  option,
  presentation,
  price,
  relation,
  resetIds,
  resolvedItem,
} from './quality-helpers';

beforeEach(resetIds);

const codes = (fs: readonly DataQualityFinding[]) => fs.map((f) => f.ruleCode);
const affected = (id: string) =>
  OWNER_DECISIONS.find((d) => d.id === id)!.affected.map((a) => a.legacyId);

describe('rule catalogue', () => {
  it('has unique, stable DQ-<AREA>-NNN codes and documented severities', () => {
    const seen = new Set<string>();
    for (const r of RULES) {
      expect(r.code).toMatch(/^DQ-[A-Z]+-\d{3}$/);
      expect(seen.has(r.code), r.code).toBe(false);
      seen.add(r.code);
      expect(['BLOCKER', 'WARNING', 'INFO']).toContain(r.severity);
      expect(r.version).toBeGreaterThanOrEqual(1);
      expect(r.description.length).toBeGreaterThan(10);
    }
  });

  it('every bulk-resolvable rule names a real bulk field', async () => {
    const { FIELD_DEFS } = await import('@/review/fields');
    for (const r of RULES.filter((x) => x.bulk)) {
      const def = FIELD_DEFS[r.bulk!.kind].find((d) => d.field === r.bulk!.field);
      expect(def?.bulk, r.code).toBe(true);
    }
  });
});

describe('deterministic findings', () => {
  it('gives identical findings for the same input and independent of candidate order', () => {
    const cs = [item('A-1'), item('A-2', { status: 'ACTIVE' }), option('A-1'), price('A-1')];
    const a = runQuality(input(cs));
    const b = runQuality(input([...cs].reverse()));
    expect(b.findings.map((f) => f.key)).toEqual(a.findings.map((f) => f.key));
    expect(runQuality(input(cs))).toEqual(a);
  });

  it('never reports the same key twice', () => {
    const run = runQuality(
      input([item('A-1'), item('A-2'), option('A-1'), decoration('A-1', 'X1')]),
    );
    expect(new Set(run.findings.map((f) => f.key)).size).toBe(run.findings.length);
  });
});

describe('unresolved stays unresolved (nothing defaults)', () => {
  it('flags status/itemType/sale unit/decoration policy and invents none', () => {
    const c = item('A-1', { itemType: null, itemTypeEvidence: null });
    const f = runQuality(input([c])).findings;
    expect(codes(f)).toEqual(
      expect.arrayContaining([
        'DQ-CATALOG-001',
        'DQ-CATALOG-002',
        'DQ-CATALOG-003',
        'DQ-CATALOG-004',
        'DQ-CATALOG-005',
      ]),
    );
    // the candidate was not mutated: still unknown
    expect(c.resolution).toBeNull();
  });

  it('an explicit null sale unit ("no unit") is a decision, not a missing value', () => {
    const c = item('A-1', {}, { resolution: { saleUnit: null } });
    expect(codes(runQuality(input([c])).findings)).not.toContain('DQ-CATALOG-003');
  });

  it('customer-supplied semantics only apply to services', () => {
    const product = item('A-1');
    const service = item('A-2', {
      itemType: 'SERVICE',
      itemTypeEvidence: 'SERVICE',
      customerSuppliedEvidence: true,
    });
    const f = runQuality(input([product, service])).findings.filter(
      (x) => x.ruleCode === 'DQ-CATALOG-006',
    );
    expect(f.map((x) => x.itemLegacyId)).toEqual(['A-2']);
  });

  it('a REJECTED candidate raises no findings', () => {
    expect(runQuality(input([item('A-1', {}, { reviewStatus: 'REJECTED' })])).findings).toEqual([]);
  });
});

describe('option rules', () => {
  it('flags required/definition/selection/distribution/values while open', () => {
    const f = runQuality(input([item('A-1'), option('A-1', 'color')])).findings.filter(
      (x) => x.candidateKind === 'OPTION',
    );
    expect(codes(f)).toEqual(
      expect.arrayContaining([
        'DQ-OPTION-001',
        'DQ-OPTION-002',
        'DQ-OPTION-003',
        'DQ-OPTION-004',
        'DQ-OPTION-005',
      ]),
    );
  });

  it('detects a duplicated option on the same item and repeated source values', () => {
    const f = runQuality(
      input([
        item('A-1'),
        option('A-1', 'Tamaño'),
        option('A-1', 'tamano'),
        option('A-2', 'x', {
          values: [
            { recordKey: 'a'.repeat(24), label: 'Rojo', measurement: null },
            { recordKey: 'b'.repeat(24), label: ' rojo ', measurement: null },
          ],
        }),
      ]),
    ).findings;
    expect(codes(f)).toContain('DQ-OPTION-007');
    expect(codes(f)).toContain('DQ-OPTION-008');
  });

  it('detects a definition created twice with different meaning, an existing definition and incompatible value shapes', () => {
    const def = (key: string, valueKind: string) => ({
      mode: 'CREATE',
      key,
      label: key,
      valueKind,
      unit: null,
      scope: 'ITEM',
    });
    const f = runQuality(
      input([
        item('A-1'),
        option('A-1', 'a', {}, { resolution: { definition: def('nuevo', 'ENUM') } }),
        option('A-1', 'b', {}, { resolution: { definition: def('nuevo', 'QUANTITY') } }),
        option('A-1', 'c', {}, { resolution: { definition: def('tamano_papel', 'ENUM') } }),
        option(
          'A-1',
          'd',
          {},
          {
            resolution: {
              definition: def('medida', 'DIMENSIONS'),
              values: {
                ['c'.repeat(24)]: { mode: 'CREATE', code: 'x', label: 'x', spec: { value: 3 } },
              },
            },
          },
        ),
      ]),
    ).findings;
    expect(codes(f)).toEqual(expect.arrayContaining(['DQ-OPTION-006', 'DQ-OPTION-010']));
  });
});

describe('decoration, composition and presentation rules', () => {
  it('flags unclassified method, unknown method, orphan association and duplicates', () => {
    const f = runQuality(
      input([
        item('A-1'),
        decoration('A-1', 'X1', 'M-1', { resolution: { methodKey: 'NOPE' } }),
        decoration('A-1', 'X2', 'M-1', { resolution: { methodKey: 'NOPE' } }),
        decoration('GHOST', 'X3'),
      ]),
    ).findings;
    expect(codes(f)).toEqual(
      expect.arrayContaining(['DQ-DECOR-001', 'DQ-DECOR-002', 'DQ-DECOR-003', 'DQ-DECOR-004']),
    );
  });

  it('flags missing ends, unusable child and circular relations', () => {
    const f = runQuality(
      input([
        item('A'),
        item('B'),
        relation('A', 'B'),
        relation('B', 'A'),
        relation('A', null),
        relation('A', 'GHOST'),
      ]),
    ).findings;
    expect(codes(f)).toEqual(expect.arrayContaining(['DQ-COMP-001', 'DQ-COMP-002', 'DQ-COMP-003']));
    expect(f.filter((x) => x.ruleCode === 'DQ-COMP-003').length).toBe(2);
  });

  it('flags unmapped, itemless, duplicate and double-default presentations', () => {
    const f = runQuality(
      input([
        item('A'),
        presentation('A', 'Caja'),
        presentation('A', 'Caja'),
        presentation(null, 'Huérfana'),
        presentation('A', 'X1', { resolution: { locale: 'es', isDefault: true } }),
        presentation('A', 'X2', { resolution: { locale: 'es', isDefault: true } }),
      ]),
    ).findings;
    expect(codes(f)).toEqual(
      expect.arrayContaining([
        'DQ-PRES-001',
        'DQ-PRES-002',
        'DQ-PRES-003',
        'DQ-PRES-004',
        'DQ-PRES-005',
      ]),
    );
  });
});

describe('provenance', () => {
  it('detects a broken chain: no records, or records without sheet/row/cell', () => {
    const f = runQuality(
      input([
        item('A', {}, { provenance: { records: 0, recordsWithCell: 0 } }),
        item('B', {}, { provenance: { records: 2, recordsWithCell: 1 } }),
        item('C'),
      ]),
    ).findings;
    expect(f.filter((x) => x.ruleCode === 'DQ-PROV-001').map((x) => x.itemLegacyId)).toEqual(['A']);
    expect(f.filter((x) => x.ruleCode === 'DQ-PROV-002').map((x) => x.itemLegacyId)).toEqual(['B']);
  });

  it('flags a domain item with neither source evidence nor an audit actor', () => {
    const f = runQuality(
      input([], {
        domainItems: [
          {
            id: 'i1',
            publicCode: 'DTG-00001',
            legacyId: null,
            saleUnit: 'PIECE',
            traceable: false,
            marketPolicies: [],
          },
          {
            id: 'i2',
            publicCode: 'DTG-00002',
            legacyId: null,
            saleUnit: 'PIECE',
            traceable: true,
            marketPolicies: [],
          },
        ],
      }),
    ).findings;
    expect(f.filter((x) => x.ruleCode === 'DQ-PROV-003')).toHaveLength(1);
  });
});

describe('pricing rules and historical evidence', () => {
  it('evidence without a PriceDefinition is flagged; with an AUTHORIZED one it is not', () => {
    const cs = [item('A'), price('A')];
    expect(codes(runQuality(input(cs)).findings)).toContain('DQ-PRICE-001');
    const f = runQuality(
      input(cs, {
        domainDefinitions: [
          {
            id: 'd1',
            itemId: 'i1',
            legacyId: 'A',
            status: 'AUTHORIZED',
            currency: 'USD',
            model: 'EXACT_QUANTITY_MATRIX',
            validFrom: '2026-01-01T00:00:00Z',
            validTo: null,
            breakQuantities: [100],
            sourceKinds: [],
            clashesWith: [],
          },
        ],
      }),
    ).findings;
    expect(codes(f)).not.toContain('DQ-PRICE-001');
  });

  it('flags DRAFT definitions, uncovered quantities, missing currency, unit and overlap', () => {
    const p = price('A', { currency: null }, {});
    const f = runQuality(
      input([item('A'), p, price('B')], {
        domainDefinitions: [
          {
            id: 'd1',
            itemId: 'i1',
            legacyId: 'A',
            status: 'DRAFT',
            currency: 'USD',
            model: 'FIXED',
            validFrom: '2026-01-01T00:00:00Z',
            validTo: null,
            breakQuantities: [],
            sourceKinds: [],
            clashesWith: [],
          },
          {
            id: 'd2',
            itemId: 'i2',
            legacyId: 'B',
            status: 'AUTHORIZED',
            currency: 'USD',
            model: 'EXACT_QUANTITY_MATRIX',
            validFrom: '2026-01-01T00:00:00Z',
            validTo: null,
            breakQuantities: [50],
            sourceKinds: [],
            clashesWith: ['d9'],
          },
        ],
      }),
    ).findings;
    expect(codes(f)).toEqual(
      expect.arrayContaining([
        'DQ-PRICE-002',
        'DQ-PRICE-003',
        'DQ-PRICE-004',
        'DQ-PRICE-007',
        'DQ-PRICE-008',
      ]),
    );
  });

  it('historical evidence is NOT a defect while it stays evidence', () => {
    const f = runQuality(
      input([resolvedItem('A')], {
        historicalPriceLegacyIds: ['A-P-9'],
        historicalCountByItemLegacy: { A: 3 },
      }),
    ).findings;
    expect(f.filter((x) => x.area === 'PRICING')).toEqual([]);
  });

  it('…but a current price candidate fed by a historical observation IS a blocker', () => {
    const f = runQuality(
      input([item('A'), price('A')], { historicalPriceLegacyIds: ['A-P-1'] }),
    ).findings;
    const hit = f.find((x) => x.ruleCode === 'DQ-PRICE-006');
    expect(hit?.severity).toBe('BLOCKER');
  });

  it('a definition backed by HISTORICAL_PRICE_EVIDENCE is flagged', () => {
    const f = runQuality(
      input([], {
        domainDefinitions: [
          {
            id: 'd1',
            itemId: 'i1',
            legacyId: 'A',
            status: 'AUTHORIZED',
            currency: 'USD',
            model: 'FIXED',
            validFrom: '2026-01-01T00:00:00Z',
            validTo: null,
            breakQuantities: [1],
            sourceKinds: ['HISTORICAL_PRICE_EVIDENCE'],
            clashesWith: [],
          },
        ],
      }),
    ).findings;
    expect(codes(f)).toContain('DQ-PRICE-006');
  });
});

describe('owner decisions are not technical errors', () => {
  it('an open D-008 on an affected item is OWNER_DECISION_REQUIRED and disappears only with an explicit answer', () => {
    const legacy = affected('D-008')[0]!;
    const cs = [resolvedItem(legacy)];
    const open = runQuality(input(cs)).findings.find((f) => f.ruleCode === 'DQ-PRICE-010');
    expect(open).toMatchObject({ remediation: 'OWNER_DECISION_REQUIRED', severity: 'BLOCKER' });
    expect(open?.decisions).toEqual([{ id: 'D-008', status: 'OPEN' }]);
    const answered = runQuality(
      input(cs, {
        decisionAnswers: [
          {
            id: 'a1',
            decisionId: 'D-008',
            summary: 'x',
            actor: 'martin',
            answeredAt: '2026-10-01T00:00:00Z',
            coverage: [legacy],
          },
        ],
      }),
    ).findings;
    expect(codes(answered)).not.toContain('DQ-PRICE-010');
  });

  it('only items in the decision scope are linked (nothing inferred)', () => {
    const f = runQuality(input([resolvedItem('NOT-IN-ANY-DECISION')])).findings;
    expect(f.filter((x) => x.decisions.length > 0)).toEqual([]);
  });

  it('D-022 keeps HALF_UP_2 labelled PROVISIONAL TECHNICAL BEHAVIOR and VAT unresolved', () => {
    const legacy = affected('D-022')[0]!;
    const f = runQuality(input([resolvedItem(legacy)])).findings;
    const iva = f.find((x) => x.ruleCode === 'DQ-PRICE-014');
    const half = f.find((x) => x.ruleCode === 'DQ-PRICE-016');
    expect(iva?.remediation).toBe('OWNER_DECISION_REQUIRED');
    expect(half?.severity).toBe('INFO');
    expect(JSON.stringify(half?.evidence)).toContain('PROVISIONAL TECHNICAL BEHAVIOR');
  });

  it('D-016 appears on items that carry price evidence', () => {
    const legacy = affected('D-016')[0]!;
    const f = runQuality(input([resolvedItem(legacy), price(legacy)])).findings;
    expect(codes(f)).toContain('DQ-PRICE-013');
  });

  it('a field finding linked to an open decision is OWNER_DECISION_REQUIRED; once answered it is BULK_RESOLVABLE', () => {
    const legacy = affected('D-001')[0]!;
    const cs = [item(legacy)];
    const f1 = runQuality(input(cs)).findings.find((f) => f.ruleCode === 'DQ-CATALOG-002')!;
    expect(f1.remediation).toBe('OWNER_DECISION_REQUIRED');
    const f2 = runQuality(
      input(cs, {
        decisionAnswers: [
          {
            id: 'a1',
            decisionId: 'D-001',
            summary: 'matriz',
            actor: 'martin',
            answeredAt: '2026-10-01T00:00:00Z',
            coverage: [legacy],
          },
        ],
      }),
    ).findings.find((f) => f.ruleCode === 'DQ-CATALOG-002')!;
    expect(f2.remediation).toBe('BULK_RESOLVABLE');
    expect(f2.decisions[0]).toMatchObject({
      id: 'D-001',
      status: 'ANSWERED',
      answeredBy: 'martin',
    });
  });
});

describe('a valid domain object gets no false blocker', () => {
  it('a fully resolved item is READY for review and domain; publication is held only by the barrier', () => {
    const cs = [resolvedItem('Z-1')];
    const run = runQuality(input(cs));
    expect(run.findings.filter((f) => f.severity === 'BLOCKER')).toEqual([]);
    const [r] = computeReadiness(input(cs), run.findings);
    expect(r!.review.state).toBe('READY');
    expect(r!.domain.state).toBe('READY');
    expect(r!.pricing.state).toBe('QUOTE_ONLY');
    expect(r!.readyIgnoringBarrier).toBe(true);
    expect(r!.publication.state).toBe('BLOCKED');
    expect(r!.publication.reasons.map((x) => x.kind)).toEqual(['BARRIER']);
  });

  it('with the barrier lifted for FIXTURE data the same item can be READY', () => {
    const cs = [
      resolvedItem('Z-1', {
        batch: { id: 'b', sourceFile: 'f', dataClass: 'FIXTURE', sourceRole: 'PRIMARY_RC' },
      }),
    ];
    const [r] = computeReadiness(input(cs), runQuality(input(cs)).findings);
    expect(r!.publication.state).toBe('READY');
  });
});

describe('readiness explains itself', () => {
  it('lists reasons per dimension, with decisions, and no single score', () => {
    const legacy = affected('D-001')[0]!;
    const cs = [item(legacy), price(legacy)];
    const [r] = computeReadiness(input(cs), runQuality(input(cs)).findings);
    expect(r!.review.state).toBe('NEEDS_RESOLUTION');
    expect(r!.review.reasons.length).toBeGreaterThan(0);
    expect(r!.domain.state).toBe('BLOCKED');
    expect(r!.domain.reasons.map((x) => x.code)).toContain('REVIEW_INCOMPLETE');
    expect(r!.publication.state).toBe('BLOCKED');
    const decisionReasons = r!.publication.reasons.filter((x) => x.decisionIds);
    expect(decisionReasons.map((x) => x.code)).toEqual(expect.arrayContaining(['D-001', 'D-016']));
    expect(JSON.stringify(r)).not.toMatch(/score|percent/i);
  });
});

describe('inventory, summary and before/after', () => {
  it('inventory has one row per rule with counts and bulk flags', () => {
    const inv = inventory(runQuality(input([item('A'), item('B')])).findings);
    expect(inv).toHaveLength(RULES.length);
    const status = inv.find((r) => r.ruleCode === 'DQ-CATALOG-002')!;
    expect(status).toMatchObject({ affected: 2, bulkField: 'CATALOG_ITEM.status' });
  });

  it('197 unresolved statuses → after an explicit answer N remain; other blockers are NOT hidden', () => {
    const many = Array.from({ length: 197 }, (_, i) => item(`S-${i}`));
    const before = runQuality(input(many));
    const count = (run: typeof before, code: string) =>
      run.findings.filter((f) => f.ruleCode === code).length;
    expect(count(before, 'DQ-CATALOG-002')).toBe(197);
    // the owner decides 150 of them (explicit assignment); 47 stay open
    const decided = many.map((c, i) => (i < 150 ? { ...c, resolution: { status: 'ACTIVE' } } : c));
    const after = runQuality(input(decided));
    expect(count(after, 'DQ-CATALOG-002')).toBe(47);
    // nothing else got better or worse by magic
    expect(count(after, 'DQ-CATALOG-005')).toBe(197);
    expect(count(after, 'DQ-CATALOG-003')).toBe(197);
    const d = diffRuns(before, after);
    expect(d.resolved).toHaveLength(150);
    expect(d.appeared).toHaveLength(0);
    expect(summarize(input(decided), after.findings).candidates.resolved).toBe(0);
  });
});

describe('answers cover only the items they list (STEP 09)', () => {
  const [a, b] = affected('D-001');
  const answer = (coverage: 'ALL' | string[], decisionId = 'D-001') => ({
    id: 'a1',
    decisionId,
    summary: 'respuesta',
    actor: 'martin',
    answeredAt: '2026-10-01T00:00:00Z',
    coverage,
  });

  it('a partial answer settles the listed item and leaves the others OPEN', () => {
    const f = runQuality(
      input([item(a!), item(b!)], { decisionAnswers: [answer([a!])] }),
    ).findings.filter((x) => x.ruleCode === 'DQ-CATALOG-002');
    const byItem = Object.fromEntries(f.map((x) => [x.itemLegacyId, x]));
    expect(byItem[a!]?.remediation).toBe('BULK_RESOLVABLE');
    expect(byItem[b!]?.remediation).toBe('OWNER_DECISION_REQUIRED');
    expect(byItem[b!]?.decisions).toEqual([{ id: 'D-001', status: 'OPEN' }]);
  });

  it('a GLOBAL_POLICY answer (D-016) settles its whole scope', () => {
    const legacy = affected('D-016')[0]!;
    const cs = [resolvedItem(legacy), price(legacy)];
    expect(codes(runQuality(input(cs)).findings)).toContain('DQ-PRICE-013');
    const done = runQuality(input(cs, { decisionAnswers: [answer('ALL', 'D-016')] })).findings;
    expect(codes(done)).not.toContain('DQ-PRICE-013');
  });
});
