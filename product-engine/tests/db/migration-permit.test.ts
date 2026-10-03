import type { PoolClient } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { itemId } from '../../data/dev-slice';
import { recordDecisionAnswer } from '@/db/admin/decision-answers';
import {
  createMigrationPermit,
  publishUnderPermit,
  revokeMigrationPermit,
  type PermitInput,
} from '@/db/migration/permit';
import { loadCatalogSnapshot } from '@/db/catalog-snapshot';
import { PUBLICATION_ENABLED_FOR, publishCandidate } from '@/db/import/publish';
import { approveCandidate, rejectCandidate } from '@/db/import/review';
import { resolvePrice } from '@/pricing/resolve';
import { loadFixtureEnvelopeJson } from '../fixtures/import-envelopes';
import { expectDbError, pool, withRollback } from './helpers';
import { asNewVersion, asReal, scalar, stageAndValidate } from './import-helpers';

afterAll(() => pool.end());

const PREMIUM = itemId('tarjeta_premium');
const VALID_FROM = '2026-09-15T00:00:00+00:00';
const AS_OF = new Date('2026-10-01T12:00:00Z');
const PERMIT: PermitInput = {
  scopeKey: 'commercial-print-mvp',
  scopeLabel: 'test scope',
  markets: ['USA'],
  reason: 'test: owner approves the scoped REAL publication',
  decisionIds: ['D-001'],
};

async function seededDefinition(c: PoolClient, sides: string) {
  return (
    await c.query(
      `select d.id from price_definition d join price_condition pc on pc.price_definition_id = d.id
         join option_value v on v.id = pc.option_value_id
        where d.item_id = $1 and v.code = $2 and d.status = 'AUTHORIZED'`,
      [PREMIUM, sides],
    )
  ).rows[0].id as string;
}

/** Stages the real v1.2 premium-card envelope as REAL data and resolves + approves every candidate. */
async function stagedAndApproved(c: PoolClient) {
  const r = await stageAndValidate(c, asReal(loadFixtureEnvelopeJson('premium-business-card')));
  const approve = async (id: string, resolution: unknown) => {
    const a = await approveCandidate(c, id, { reviewer: 'preparer', resolution });
    if (!a.ok) throw new Error(JSON.stringify(a.errors));
  };
  const all = (
    await c.query('select id, kind, proposal from import_candidate where batch_id = $1', [
      r.batchId,
    ])
  ).rows as { id: string; kind: string; proposal: Record<string, unknown> }[];
  for (const k of all) {
    if (k.kind === 'CATALOG_ITEM')
      await approve(k.id, {
        status: 'ACTIVE',
        saleUnit: 'PIECE',
        decorationPolicy: 'NONE',
        categoryKey: 'impresos_papel',
        target: { mode: 'LINK_EXISTING', entityId: PREMIUM },
      });
    else if (k.kind === 'OPTION')
      await approve(k.id, {
        definition: { mode: 'EXISTING', key: 'caras' },
        isRequired: true,
        selectionMode: 'SINGLE',
        isDistributable: false,
        values: Object.fromEntries(
          (k.proposal.values as { recordKey: string; label: string }[]).map((v) => [
            v.recordKey,
            { mode: 'EXISTING', code: v.label },
          ]),
        ),
      });
    else if (k.kind === 'PRICE') {
      const sides = (k.proposal.conditions as { value: string }[])[0]!.value;
      await approve(k.id, {
        validFrom: VALID_FROM,
        target: { mode: 'LINK_EXISTING', entityId: await seededDefinition(c, sides) },
      });
    } else {
      const rej = await rejectCandidate(c, k.id, {
        reviewer: 'preparer',
        reason: 'inherent process',
      });
      if (!rej.ok) throw new Error(JSON.stringify(rej.errors));
    }
  }
  return { batchId: r.batchId, all };
}

async function answers(c: PoolClient, withAuthority = true) {
  const d1 = await recordDecisionAnswer(
    c,
    { decisionId: 'D-001', summary: 'OD-01 test', covers: ['MIG1-O-009'] },
    'martin',
  );
  expect(d1.ok).toBe(true);
  if (withAuthority) {
    const d16 = await recordDecisionAnswer(
      c,
      { decisionId: 'D-016', summary: 'OD-05/OD-07 test' },
      'martin',
    );
    expect(d16.ok).toBe(true);
  }
}

describe('migration permit (STEP 09)', () => {
  it('the platform barrier stays closed: REAL data cannot publish without a permit', async () => {
    expect(PUBLICATION_ENABLED_FOR).toEqual(['FIXTURE']);
    await withRollback(async (c) => {
      const { all } = await stagedAndApproved(c);
      const item = all.find((k) => k.kind === 'CATALOG_ITEM')!;
      const res = await publishCandidate(c, item.id, { publisher: 'martin' });
      expect(!res.ok && res.errors.map((e) => e.code)).toEqual(['NOT_PUBLISHABLE_IN_THIS_STEP']);
      const bogus = await publishCandidate(c, item.id, {
        publisher: 'martin',
        permitId: '00000000-0000-4000-8000-000000000001',
      });
      expect(bogus.ok).toBe(false);
      expect(PUBLICATION_ENABLED_FOR).toEqual(['FIXTURE']);
    });
  });

  it('a permit needs the owner authority answer (D-016) and at least one publishable item', async () => {
    await withRollback(async (c) => {
      await stagedAndApproved(c);
      await answers(c, false);
      const r = await createMigrationPermit(c, PERMIT, 'martin', AS_OF);
      expect(!r.ok && r.errors[0]!.code).toBe('DECISION_NOT_ANSWERED');
    });
    await withRollback(async (c) => {
      await answers(c, true); // nothing staged
      const r = await createMigrationPermit(c, PERMIT, 'martin', AS_OF);
      expect(!r.ok && r.errors[0]!.code).toBe('NOTHING_PUBLISHABLE');
    });
  });

  it('scoped publication: only permitted items, with audit, provenance, idempotency and price regression', async () => {
    await withRollback(async (c) => {
      const { batchId, all } = await stagedAndApproved(c);
      await answers(c);
      const created = await createMigrationPermit(c, PERMIT, 'martin', AS_OF);
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      expect(created.created).toBe(true);
      const permit = created.permit;
      // 21 scoped; this test staged one. Out-of-market decision D-022 is waived, nothing else is.
      expect(permit.scopedLegacyIds).toHaveLength(21);
      expect(permit.waivedDecisions.map((w) => w.decisionId)).toEqual(['D-022']);
      expect(permit.decisionRefs.map((d) => d.decisionId).sort()).toEqual(['D-001', 'D-016']);
      expect([...new Set(permit.included.map((i) => i.itemLegacyId))]).toEqual(['MIG1-O-009']);
      const approvedIds = (
        await c.query(
          "select id from import_candidate where batch_id = $1 and review_status <> 'REJECTED'",
          [batchId],
        )
      ).rows.map((r) => r.id as string);
      expect(permit.included.map((i) => i.candidateId).sort()).toEqual(approvedIds.sort());

      // idempotent re-approval
      const again = await createMigrationPermit(c, PERMIT, 'martin', AS_OF);
      expect(again.ok && again.created).toBe(false);

      const before = await scalar(
        c,
        'select (select count(*) from catalog_item) + (select count(*) from price_definition) + (select count(*) from option_value) as n',
      );
      const pub = await publishUnderPermit(c, permit.id, 'martin', AS_OF);
      expect(pub.ok).toBe(true);
      if (!pub.ok) return;
      expect(pub.items).toHaveLength(1);
      expect(pub.items[0]).toMatchObject({
        ok: true,
        alreadyPublished: false,
        publicCode: 'DTG-00002',
      });
      expect(pub.items[0]!.catalogItemId).toBe(PREMIUM);
      // linked, nothing duplicated
      expect(
        await scalar(
          c,
          'select (select count(*) from catalog_item) + (select count(*) from price_definition) + (select count(*) from option_value) as n',
        ),
      ).toBe(before);

      // audit: one row per candidate, with actor and outcome
      const rows = (
        await c.query(
          'select actor, item_legacy_id, outcome from migration_publication where permit_id = $1',
          [permit.id],
        )
      ).rows;
      expect(rows).toHaveLength(permit.included.length);
      expect(rows.every((r) => r.actor === 'martin' && r.item_legacy_id === 'MIG1-O-009')).toBe(
        true,
      );
      expect(
        await scalar(
          c,
          "select count(*)::int n from change_event where table_name = 'migration_publication'",
        ),
      ).toBe(rows.length);

      // provenance: catalog item ← link ← candidate ← record ← workbook cell
      const prov = (
        await c.query(
          `select count(*)::int as n from import_candidate_link l
             join import_candidate_source cs on cs.candidate_id = l.candidate_id
             join import_record r on r.id = cs.record_id
            where l.entity_id = $1 and r.source_cells -> 0 ->> 'source_cell' is not null`,
          [PREMIUM],
        )
      ).rows[0].n;
      expect(prov).toBeGreaterThan(0);
      expect(all.length).toBeGreaterThan(prov > 0 ? 0 : 99);

      // idempotent: publishing again creates nothing
      const second = await publishUnderPermit(c, permit.id, 'martin', AS_OF);
      expect(second.ok && second.items[0]!.alreadyPublished).toBe(true);
      expect(
        await scalar(c, 'select count(*)::int n from migration_publication where permit_id = $1', [
          permit.id,
        ]),
      ).toBe(rows.length);

      // pricing regression through the real engine (unchanged by the migration)
      const r500 = resolvePrice(
        {
          catalogItemId: PREMIUM,
          market: 'USA',
          quantity: 500,
          selections: [{ optionKey: 'caras', valueCodes: ['2'] }],
        } as never,
        await loadCatalogSnapshot(c),
        AS_OF,
      );
      expect(r500.status === 'RESOLVED' && r500.total.amount.toFixed(2)).toBe('120.00');
      const r750 = resolvePrice(
        {
          catalogItemId: PREMIUM,
          market: 'USA',
          quantity: 750,
          selections: [{ optionKey: 'caras', valueCodes: ['2'] }],
        } as never,
        await loadCatalogSnapshot(c),
        AS_OF,
      );
      expect(r750.status).toBe('QUOTE_ONLY');
    });
  });

  it('a candidate outside the permit stays refused, even with a valid permit id', async () => {
    await withRollback(async (c) => {
      const { all } = await stagedAndApproved(c);
      await answers(c);
      const created = await createMigrationPermit(c, PERMIT, 'martin', AS_OF);
      if (!created.ok) throw new Error('permit');
      // another REAL batch (magnets) is staged and approved but NOT in the permit
      const m = await stageAndValidate(
        c,
        asNewVersion(asReal(loadFixtureEnvelopeJson('magnets')), 'b'.repeat(64)),
      );
      const [magnet] = (
        await c.query(
          "select id from import_candidate where batch_id = $1 and kind = 'CATALOG_ITEM'",
          [m.batchId],
        )
      ).rows;
      const a = await approveCandidate(c, magnet.id, {
        reviewer: 'preparer',
        resolution: {
          status: 'ACTIVE',
          decorationPolicy: 'NONE',
          target: { mode: 'LINK_EXISTING', entityId: itemId('imanes_par') },
        },
      });
      expect(a.ok).toBe(true);
      const res = await publishCandidate(c, magnet.id, {
        publisher: 'martin',
        permitId: created.permit.id,
      });
      expect(res.ok).toBe(false);
      expect(!res.ok && res.errors[0]!.message).toMatch(
        /not included in an active migration permit/,
      );
      expect(
        await scalar(
          c,
          "select count(*)::int n from import_candidate where id = $1 and review_status = 'PUBLISHED'",
          [magnet.id],
        ),
      ).toBe(0);
      void all;
    });
  });

  it('a revoked permit publishes nothing', async () => {
    await withRollback(async (c) => {
      await stagedAndApproved(c);
      await answers(c);
      const created = await createMigrationPermit(c, PERMIT, 'martin', AS_OF);
      if (!created.ok) throw new Error('permit');
      const rev = await revokeMigrationPermit(c, created.permit.id, 'martin', 'test revoke');
      expect(rev.ok).toBe(true);
      const pub = await publishUnderPermit(c, created.permit.id, 'martin', AS_OF);
      expect(!pub.ok && pub.errors[0]!.code).toMatch(/PERMIT_(NOT_ACTIVE|SUPERSEDED)/);
      const [one] = created.permit.included;
      const res = await publishCandidate(c, one!.candidateId, {
        publisher: 'martin',
        permitId: created.permit.id,
      });
      expect(res.ok).toBe(false);
    });
  });

  it('permits and publications are append-only and guarded in the database', async () => {
    await withRollback(async (c) => {
      await stagedAndApproved(c);
      await answers(c);
      const created = await createMigrationPermit(c, PERMIT, 'martin', AS_OF);
      if (!created.ok) throw new Error('permit');
      const id = created.permit.id;
      await expectDbError(
        c,
        "update migration_permit set reason = 'x' where id = $1",
        [id],
        /immutable|append|cannot|forbid/i,
      );
      await expectDbError(
        c,
        'delete from migration_permit where id = $1',
        [id],
        /append|delete|forbid|cannot/i,
      );
      await expectDbError(
        c,
        'delete from migration_permit_item where permit_id = $1',
        [id],
        /append|delete|forbid|cannot/i,
      );
      // a publication row for a candidate the permit does not include is refused at commit time
      const other = (
        await c.query('select id from import_candidate where id <> all($1) limit 1', [
          created.permit.included.map((i) => i.candidateId),
        ])
      ).rows[0];
      if (other) {
        await c.query('savepoint g');
        await c.query(
          "insert into migration_publication (permit_id, candidate_id, item_legacy_id, actor, outcome) values ($1, $2, 'X', 'a', '{}')",
          [id, other.id],
        );
        await expect(c.query('set constraints all immediate')).rejects.toThrow(
          /not included in an active migration permit/,
        );
        await c.query('rollback to savepoint g');
      }
    });
  });
});
