import { describe, expect, it } from 'vitest';
import type { PriceCondition, PriceDefinition } from '@/domain/pricing-model';
import {
  analyzeAuthorizationConflicts,
  conditionsCompatible,
  intervalsOverlap,
} from '@/pricing/conflicts';
import { overlayDraft } from '@/pricing/overlay';
import type { CatalogSnapshot } from '@/domain/snapshot';

const opt = (def: string, val: string): PriceCondition => ({
  id: `${def}-${val}`,
  kind: 'OPTION_VALUE',
  optionDefinitionId: def,
  optionValueId: val,
});
const NOW = new Date('2026-10-01T00:00:00Z');
let n = 0;
const def = (over: Partial<PriceDefinition> & { conditions?: PriceCondition[] }): PriceDefinition =>
  ({
    id: `d${++n}`,
    itemId: 'item',
    priceBookId: 'book',
    component: 'ITEM',
    status: 'AUTHORIZED',
    validFrom: '2026-01-01T00:00:00Z',
    validTo: null,
    version: 1,
    supersedesId: null,
    authorizedBy: 'x',
    authorizedAt: '2026-01-01T00:00:00Z',
    conditions: [],
    model: 'EXACT_QUANTITY_MATRIX',
    breaks: [{ quantity: 100, amount: '10.00', amountBasis: 'TOTAL' }],
    ...over,
  }) as PriceDefinition;

describe('conflict analysis (pure)', () => {
  it('interval overlap is half-open [from, to)', () => {
    const a = { validFrom: '2026-01-01T00:00:00Z', validTo: '2026-02-01T00:00:00Z' };
    expect(intervalsOverlap(a, { validFrom: '2026-02-01T00:00:00Z', validTo: null })).toBe(false);
    expect(intervalsOverlap(a, { validFrom: '2026-01-31T23:59:59Z', validTo: null })).toBe(true);
  });

  it('compatibility: shared option with disjoint values is incompatible; different options are compatible', () => {
    expect(conditionsCompatible([opt('caras', '1')], [opt('caras', '2')])).toBe(false);
    expect(conditionsCompatible([opt('caras', '1')], [opt('papel', 'x')])).toBe(true);
    expect(conditionsCompatible([opt('caras', '1'), opt('caras', '2')], [opt('caras', '2')])).toBe(
      true,
    );
  });

  it('equal specificity + compatible ⇒ tie (blocking); strictly more specific ⇒ info only', () => {
    const existing = def({ conditions: [opt('caras', '2')] });
    const tie = def({ status: 'DRAFT', conditions: [opt('papel', 'x')] });
    expect(
      analyzeAuthorizationConflicts(tie, [existing], { now: NOW }).blocking.map((c) => c.kind),
    ).toEqual(['SPECIFICITY_TIE']);
    const specific = def({ status: 'DRAFT', conditions: [opt('caras', '2'), opt('papel', 'x')] });
    const r = analyzeAuthorizationConflicts(specific, [existing], { now: NOW });
    expect(r.canAuthorize).toBe(true);
    expect(r.info.map((c) => c.kind)).toEqual(['PRECEDENCE']);
  });

  it('a successor replaces its predecessor: only starting in the future and after it', () => {
    const head = def({ conditions: [opt('caras', '2')], validFrom: '2026-06-01T00:00:00Z' });
    const ok = def({
      status: 'DRAFT',
      supersedesId: head.id,
      version: 2,
      conditions: head.conditions,
      validFrom: '2026-11-01T00:00:00Z',
    });
    expect(analyzeAuthorizationConflicts(ok, [head], { now: NOW }).canAuthorize).toBe(true);
    const past = { ...ok, validFrom: '2026-09-01T00:00:00Z' } as PriceDefinition;
    expect(
      analyzeAuthorizationConflicts(past, [head], { now: NOW }).blocking.map((c) => c.kind),
    ).toContain('RETROACTIVE_SUPERSESSION');
    const before = { ...ok, validFrom: '2026-05-01T00:00:00Z' } as PriceDefinition;
    expect(
      analyzeAuthorizationConflicts(before, [head], { now: NOW }).blocking.map((c) => c.kind),
    ).toContain('PREDECESSOR_WINDOW');
  });

  it('a draft with duplicate breaks or no breaks is DEFINITION_INVALID', () => {
    const bad = def({
      status: 'DRAFT',
      breaks: [
        { quantity: 100, amount: '1.00', amountBasis: 'TOTAL' },
        { quantity: 100, amount: '2.00', amountBasis: 'TOTAL' },
      ],
    });
    const r = analyzeAuthorizationConflicts(bad, [], { now: NOW });
    expect(r.blocking[0]).toMatchObject({
      kind: 'DEFINITION_INVALID',
      issues: ['DUPLICATE_BREAK_QUANTITY'],
    });
  });
});

describe('draft overlay', () => {
  it('adds the draft as authorized and closes the predecessor at the draft start, without mutating the input', () => {
    const head = def({ conditions: [opt('caras', '2')] });
    const draft = def({
      status: 'DRAFT',
      supersedesId: head.id,
      version: 2,
      validFrom: '2026-11-01T00:00:00Z',
      authorizedBy: null,
      authorizedAt: null,
    });
    const snap = { priceDefinitions: [head] } as unknown as CatalogSnapshot;
    const out = overlayDraft(snap, draft);
    expect(snap.priceDefinitions).toEqual([head]);
    expect(snap.priceDefinitions[0]!.validTo).toBeNull();
    const closed = out.priceDefinitions.find((d) => d.id === head.id)!;
    expect(closed.validTo).toBe('2026-11-01T00:00:00Z');
    expect(out.priceDefinitions.find((d) => d.id === draft.id)!.status).toBe('AUTHORIZED');
  });
});
