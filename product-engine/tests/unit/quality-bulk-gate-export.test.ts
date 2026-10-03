import { beforeEach, describe, expect, it } from 'vitest';
import { OWNER_DECISIONS } from '@/decisions/reference';
import {
  bulkSummary,
  entriesToWrite,
  offeredFields,
  planBulk,
  type BulkCandidate,
} from '@/review/bulk';
import { DECISION_APPLICATIONS, validateAnswer } from '@/quality/decision-actions';
import { runQuality } from '@/quality/engine';
import { buildExport, findingsToCsv, FINDINGS_CSV_COLUMNS } from '@/quality/export';
import {
  applyFindingFilters,
  filterQuery,
  findingFacets,
  parseFindingFilters,
} from '@/quality/filter';
import { commercialPrintGate } from '@/quality/gate';
import { computeReadiness } from '@/quality/readiness';
import { input, item, option, price, resetIds, resolvedItem } from './quality-helpers';

beforeEach(resetIds);

const bulk = (c: ReturnType<typeof item>): BulkCandidate => ({
  id: c.id,
  kind: c.kind,
  reviewStatus: c.reviewStatus,
  proposal: c.proposal,
  draft: c.resolution,
});

describe('field-compatible bulk operations', () => {
  it('offers only fields valid for every selected candidate', () => {
    const items = [bulk(item('A')), bulk(item('B'))];
    const offered = offeredFields(items);
    expect(offered.kind).toBe('CATALOG_ITEM');
    const names = offered.fields.map((f) => f.field);
    expect(names).toEqual(
      expect.arrayContaining(['status', 'saleUnit', 'categoryKey', 'decorationPolicy']),
    );
    expect(names).not.toContain('isRequired'); // Option.required never on catalog items
    expect(names).not.toContain('customerSuppliedItem'); // PRODUCT items
  });

  it('offers customer-supplied only when every selected item is a SERVICE', () => {
    const s = (id: string) => bulk(item(id, { itemType: 'SERVICE', itemTypeEvidence: 'SERVICE' }));
    expect(offeredFields([s('A'), s('B')]).fields.map((f) => f.field)).toContain(
      'customerSuppliedItem',
    );
    expect(offeredFields([s('A'), bulk(item('P'))]).fields.map((f) => f.field)).not.toContain(
      'customerSuppliedItem',
    );
  });

  it('a mixed-kind selection offers nothing', () => {
    expect(offeredFields([bulk(item('A')), bulk(option('A'))])).toMatchObject({
      kind: null,
      fields: [],
      reason: 'MIXED_KINDS',
    });
  });

  it('STRICT refuses an incompatible selection; the default planner still skips (STEP 06 behaviour)', () => {
    const cs = [bulk(item('A')), bulk(option('A'))];
    const strict = planBulk(cs, 'CATALOG_ITEM', { status: 'ACTIVE' }, { strict: true });
    expect(strict).toMatchObject({ ok: false, code: 'INCOMPATIBLE_SELECTION' });
    const lenient = planBulk(cs, 'CATALOG_ITEM', { status: 'ACTIVE' });
    expect(lenient.ok).toBe(true);
    // Option.required on items: the field does not exist for that kind
    expect(
      planBulk([bulk(item('A'))], 'CATALOG_ITEM', { isRequired: true }, { strict: true }).ok,
    ).toBe(false);
  });

  it('preview summary separates would-change / same / other value / not-applicable / blocked', () => {
    const a = item('A');
    const same = item('B', {}, { resolution: { status: 'ACTIVE' } });
    const other = item('C', {}, { resolution: { status: 'RETIRED' } });
    const blocked = item('D', {}, { reviewStatus: 'BLOCKED' });
    const opt = option('A');
    const plan = planBulk([a, same, other, blocked, opt].map(bulk), 'CATALOG_ITEM', {
      status: 'ACTIVE',
    });
    if (!plan.ok) throw new Error('plan');
    expect(bulkSummary(plan.plan)).toEqual({
      selected: 5,
      wouldChange: 1,
      alreadySame: 1,
      hasOtherValue: 1,
      notApplicable: 1,
      blocked: 1,
      overwriteNeeded: 1,
    });
    // different values are written only with the confirmation
    expect(entriesToWrite(plan.plan, false)).toHaveLength(1);
    expect(entriesToWrite(plan.plan, true)).toHaveLength(2);
  });
});

describe('decision answers (pure validation)', () => {
  const d001 = OWNER_DECISIONS.find((d) => d.id === 'D-001')!;
  it('only decisions that map onto a bulk field have an applicable form', () => {
    expect(Object.keys(DECISION_APPLICATIONS).sort()).toEqual([
      'D-001',
      'D-002',
      'D-003',
      'D-010',
      'D-013',
    ]);
  });
  it('accepts a matrix answer inside the decision scope', () => {
    const legacy = d001.affected.slice(0, 2).map((a) => a.legacyId);
    expect(
      validateAnswer({
        decisionId: 'D-001',
        summary: 'ok',
        assignments: [{ value: 'ACTIVE', legacyIds: legacy }],
      }),
    ).toEqual({ ok: true });
  });
  it('rejects items outside the scope, invalid values, duplicated assignment and non-applicable decisions', () => {
    const legacy = d001.affected[0]!.legacyId;
    const bad = validateAnswer({
      decisionId: 'D-001',
      summary: 'x',
      assignments: [
        { value: 'ACTIVE', legacyIds: ['NOT-IN-SCOPE', legacy] },
        { value: 'MAYBE', legacyIds: [legacy] },
      ],
    });
    expect(bad.ok).toBe(false);
    const paths = bad.ok ? [] : bad.errors.map((e) => e.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        'assignments.0.legacyIds',
        'assignments.1.value',
        'assignments.1.legacyIds',
      ]),
    );
    expect(
      validateAnswer({
        decisionId: 'D-016',
        summary: 'x',
        assignments: [{ value: 1, legacyIds: ['a'] }],
      }).ok,
    ).toBe(false);
    expect(validateAnswer({ decisionId: 'D-999', summary: 'x' }).ok).toBe(false);
  });
});

describe('issue queue filters', () => {
  const run = () =>
    runQuality(
      input([
        item(
          'A',
          {},
          {
            batch: { id: 'b', sourceFile: 'wb.xlsx', dataClass: 'REAL', sourceRole: 'PRIMARY_RC' },
          },
        ),
        option('A'),
        price('A'),
      ]),
    ).findings;
  it('filters by rule, severity, kind, remediation, bulk and text; ignores invalid params', () => {
    const f = run();
    expect(applyFindingFilters(f, parseFindingFilters({ rule: 'DQ-CATALOG-002' }))).toHaveLength(1);
    expect(
      applyFindingFilters(f, parseFindingFilters({ kind: 'OPTION' })).every(
        (x) => x.candidateKind === 'OPTION',
      ),
    ).toBe(true);
    const bulkYes = applyFindingFilters(f, parseFindingFilters({ bulk: 'yes' }));
    expect(bulkYes.every((x) => x.remediation === 'BULK_RESOLVABLE')).toBe(true);
    expect(
      applyFindingFilters(f, parseFindingFilters({ severity: 'WARNING' })).every(
        (x) => x.severity === 'WARNING',
      ),
    ).toBe(true);
    expect(parseFindingFilters({ rule: "x'; drop table", severity: 'NOPE' })).toEqual({
      rule: undefined,
      severity: undefined,
      kind: undefined,
      category: undefined,
      decision: undefined,
      bulk: undefined,
      remediation: undefined,
      area: undefined,
      workbook: undefined,
      reviewStatus: undefined,
      dimension: undefined,
      q: undefined,
    });
    expect(filterQuery({ severity: 'BLOCKER', bulk: true })).toBe('?severity=BLOCKER&bulk=yes');
  });
  it('facets list what is filterable', () => {
    const facets = findingFacets(run());
    expect(facets.rules.length).toBeGreaterThan(3);
    expect(facets.workbooks).toEqual(['wb.xlsx']);
  });
});

describe('export', () => {
  it('JSON contains findings (not only a summary) with stable keys and rule versions', () => {
    const inp = input([item('A'), option('A')]);
    const run = runQuality(inp);
    const out = buildExport(inp, run);
    expect(out.findings).toHaveLength(run.findings.length);
    expect(out.meta.rules.every((r) => r.code.startsWith('DQ-') && r.version >= 1)).toBe(true);
    expect(out.meta.generatedAt).toBe(inp.asOf);
    expect(JSON.parse(JSON.stringify(out)).findings[0].key).toBe(run.findings[0]!.key);
  });
  it('CSV has a header, one row per finding and quotes commas', () => {
    const run = runQuality(input([item('A', { name: 'Tarjeta, "premium"' })]));
    const csv = findingsToCsv(run.findings);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe(FINDINGS_CSV_COLUMNS.join(','));
    expect(lines).toHaveLength(run.findings.length + 1);
    expect(csv).toContain('"Tarjeta, ""premium"""');
  });
});

describe('Commercial Print gate', () => {
  it('lists exactly the 21 family items, explains each blocker and publishes nothing', () => {
    const inp = input([resolvedItem('MIG1-O-008', {}), item('MIG2-O-036'), price('MIG2-O-036')]);
    const run = runQuality(inp);
    const gate = commercialPrintGate(inp, run.findings, computeReadiness(inp, run.findings));
    expect(gate.items).toHaveLength(21);
    expect(gate.totals.total).toBe(21);
    expect(gate.totals.staged).toBe(2);
    const done = gate.items.find((i) => i.legacyId === 'MIG1-O-008')!;
    expect(done.staged).toBe(true);
    expect(done.status.state).toBe('DEFINED');
    expect(done.openDecisions).toContain('D-001');
    expect(done.blockers.publication.some((b) => b.includes('BARRIER'))).toBe(true);
    const pending = gate.items.find((i) => i.legacyId === 'MIG2-O-036')!;
    expect(pending.status.state).toBe('MISSING');
    expect(pending.blockers.domain.join(' ')).toContain('DQ-CATALOG-002');
    // nothing is migratable while REAL publication stays disabled and decisions stay open
    expect(gate.items.filter((i) => i.canMigrate)).toEqual([]);
    expect(gate.totals.publicationReadyIgnoringBarrier).toBe(0);
    // not-staged items are reported, not invented
    expect(gate.items.filter((i) => !i.staged)).toHaveLength(19);
  });
});
