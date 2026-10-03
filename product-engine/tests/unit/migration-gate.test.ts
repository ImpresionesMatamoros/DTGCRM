import { describe, expect, it } from 'vitest';
import { authorize, roleFor, type Actor } from '@/admin/permissions';
import pack from '@/decisions/commercial-print.pack.json';
import { evaluateMigrationItem, migrationGate, waiversFor } from '@/migration/gate';
import type { CommercialPrintGate, GateItem } from '@/quality/gate';
import type { ItemReadiness } from '@/quality/types';

const readiness = (over: Partial<ItemReadiness> = {}): ItemReadiness =>
  ({
    candidateId: 'c1',
    legacyId: 'X-1',
    name: 'X',
    category: 'impresos_papel',
    reviewStatus: 'APPROVED',
    review: { state: 'READY', reasons: [] },
    domain: { state: 'READY', reasons: [] },
    pricing: { state: 'QUOTE_ONLY', reasons: [] },
    publication: { state: 'BLOCKED', reasons: [] },
    openDecisions: [],
    findingCount: 0,
    readyIgnoringBarrier: true,
    dataClass: 'REAL',
    ...over,
  }) as ItemReadiness;

const gateItem = (over: Partial<GateItem> = {}, r: ItemReadiness | null = readiness()): GateItem =>
  ({
    legacyId: 'X-1',
    name: 'X',
    family: 'f',
    staged: true,
    candidateId: 'c1',
    readiness: r,
    status: { state: 'DEFINED', value: 'ACTIVE' },
    saleUnit: { state: 'DEFINED', value: 'PIECE' },
    category: { state: 'DEFINED', value: 'impresos_papel' },
    price: { state: 'QUOTE_ONLY', evidenceObservations: 0, priceCandidates: 0 },
    options: { candidates: 0, unresolved: 0 },
    presentations: { candidates: 0, unresolved: 0 },
    provenance: { state: 'OK', candidates: 1, broken: 0 },
    openDecisions: r?.openDecisions ?? [],
    blockers: { domain: [], option: [], pricing: [], decision: [], publication: [] },
    canMigrate: true,
    ...over,
  }) as GateItem;

const ownerDecision = (id: string) => ({
  kind: 'OWNER_DECISION' as const,
  code: id,
  label: `${id} — x`,
  decisionIds: [id],
});

describe('item-aware migration gate', () => {
  it('waives only decisions whose subject is a market outside the permit', () => {
    expect(waiversFor(['USA']).map((w) => w.decisionId)).toEqual(['D-022']);
    expect(waiversFor(['USA', 'MX'])).toEqual([]);
    expect(waiversFor(['MX'])).toEqual([]);
  });

  it('an item with a clean gate is publishable', () => {
    expect(evaluateMigrationItem(gateItem(), []).verdict).toBe('PUBLISHABLE');
  });

  it('D-022 blocks until it is waived for a USA-only permit', () => {
    const r = readiness({
      openDecisions: ['D-022'],
      publication: { state: 'BLOCKED', reasons: [ownerDecision('D-022')] },
    });
    expect(evaluateMigrationItem(gateItem({}, r), []).verdict).toBe('BLOCKED');
    const waived = evaluateMigrationItem(gateItem({}, r), waiversFor(['USA']));
    expect(waived.verdict).toBe('PUBLISHABLE');
    expect(waived.waivedDecisions).toEqual(['D-022']);
  });

  it('a waiver never hides an unrelated open decision (D-001)', () => {
    const r = readiness({
      openDecisions: ['D-001', 'D-022'],
      publication: { state: 'BLOCKED', reasons: [ownerDecision('D-001'), ownerDecision('D-022')] },
    });
    const v = evaluateMigrationItem(gateItem({}, r), waiversFor(['USA']));
    expect(v.verdict).toBe('BLOCKED');
    expect(v.openDecisions).toEqual(['D-001']);
    expect(v.reasons.join(' ')).toMatch(/D-001/);
  });

  it.each([
    ['review not ready', readiness({ review: { state: 'NEEDS_RESOLUTION', reasons: [] } })],
    ['domain blocked', readiness({ domain: { state: 'BLOCKED', reasons: [] } })],
    ['pricing blocked', readiness({ pricing: { state: 'BLOCKED', reasons: [] } })],
    ['pricing draft only', readiness({ pricing: { state: 'DRAFT_ONLY', reasons: [] } })],
    ['not approved', readiness({ reviewStatus: 'WARNING' })],
  ])('blocks when %s', (_n, r) => {
    expect(evaluateMigrationItem(gateItem({}, r), []).verdict).toBe('BLOCKED');
  });

  it('blocks without category, with broken provenance, or when not staged', () => {
    expect(
      evaluateMigrationItem(gateItem({ category: { state: 'MISSING', value: null } }), []).verdict,
    ).toBe('BLOCKED');
    expect(
      evaluateMigrationItem(
        gateItem({ provenance: { state: 'BROKEN', candidates: 1, broken: 1 } }),
        [],
      ).verdict,
    ).toBe('BLOCKED');
    expect(
      evaluateMigrationItem(gateItem({ staged: false, readiness: null }, null), []).verdict,
    ).toBe('BLOCKED');
  });

  it('QUOTE_ONLY is a valid state for a published item (no automatic price needed)', () => {
    const v = evaluateMigrationItem(gateItem(), []);
    expect(v.pricing).toBe('QUOTE_ONLY');
    expect(v.verdict).toBe('PUBLISHABLE');
  });

  it('counts scoped / publishable / blocked over the whole scope', () => {
    const items = [
      gateItem({ legacyId: 'A' }),
      gateItem({ legacyId: 'B', staged: false, readiness: null }, null),
    ];
    const g = migrationGate({ items } as unknown as CommercialPrintGate, ['USA']);
    expect([g.scoped, g.publishable, g.blocked]).toEqual([2, 1, 1]);
  });

  it('the scope is the 21-item Commercial Print pack', () => {
    expect(pack.items).toHaveLength(21);
  });
});

describe('migration permissions', () => {
  const as = (role: Actor['role']): Actor => ({ name: 'x', source: 'env', role });

  it('nobody holds migration.approve / migration.publish by default', () => {
    for (const role of [
      'local_dev',
      'local_price_authorizer',
      'local_decision_recorder',
      'local_owner',
    ] as const) {
      expect(authorize(as(role), 'migration.approve')?.code).toBe('FORBIDDEN');
      expect(authorize(as(role), 'migration.publish')?.code).toBe('FORBIDDEN');
    }
  });

  it('only an actor listed in DTG_MIGRATION_OWNERS is the migration owner', () => {
    expect(roleFor('martin', undefined, undefined, 'martin')).toBe('local_migration_owner');
    expect(roleFor('jonathan', undefined, undefined, 'martin')).toBe('local_dev');
    expect(authorize(as('local_migration_owner'), 'migration.approve')).toBeNull();
    expect(authorize(as('local_migration_owner'), 'migration.publish')).toBeNull();
  });
});

describe('already published items', () => {
  it('stay PUBLISHED even if a decision is later superseded', () => {
    const r = readiness({
      reviewStatus: 'PUBLISHED',
      openDecisions: ['D-001'],
      publication: { state: 'BLOCKED', reasons: [ownerDecision('D-001')] },
    });
    const v = evaluateMigrationItem(gateItem({}, r), []);
    expect(v.verdict).toBe('PUBLISHED');
    expect(v.reasons).toEqual([]);
    const g = migrationGate({ items: [gateItem({}, r)] } as unknown as CommercialPrintGate, [
      'USA',
    ]);
    expect([g.publishable, g.published, g.blocked]).toEqual([1, 1, 0]);
  });
});
