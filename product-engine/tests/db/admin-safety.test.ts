import { afterAll, describe, expect, it } from 'vitest';
import { itemId } from '../../data/dev-slice';
import {
  approveHandler,
  bulkApplyHandler,
  bulkPreviewHandler,
  createItemHandler,
  publishFixtureHandler,
  saveDraftHandler,
  updateItemHandler,
} from '@/admin/handlers';
import { authorize } from '@/admin/permissions';
import { PUBLICATION_ENABLED_FOR, publishCandidate } from '@/db/import/publish';
import { loadFixtureEnvelopeJson } from '../fixtures/import-envelopes';
import { ACTOR, must, rollbackRunner, uniqueSha } from './admin-helpers';
import { pool, withRollback } from './helpers';
import {
  asNewVersion,
  asReal,
  candidate,
  scalar,
  stageAndValidate,
  syntheticFixture,
} from './import-helpers';

afterAll(() => pool.end());

const PREMIUM = itemId('tarjeta_premium');

describe('admin safety', () => {
  it('REAL publication stays disabled (service, handler and STEP 05B guard)', async () => {
    expect(PUBLICATION_ENABLED_FOR).toEqual(['FIXTURE']);
    await withRollback(async (c) => {
      const env = asNewVersion(
        asReal(loadFixtureEnvelopeJson('premium-business-card')),
        uniqueSha('real-publish'),
      );
      const r = await stageAndValidate(c, env);
      const item = await candidate(c, r.batchId, 'CATALOG_ITEM:MIG1-O-009');
      const tx = rollbackRunner(c);
      must(
        await saveDraftHandler(tx, ACTOR, {
          candidateId: item.id,
          set: {
            status: 'ACTIVE',
            decorationPolicy: 'NONE',
            target: { mode: 'LINK_EXISTING', entityId: PREMIUM },
          },
        }),
      );
      must(await approveHandler(tx, ACTOR, { candidateId: item.id })); // approve is allowed…
      const res = await publishFixtureHandler(tx, ACTOR, { candidateId: item.id });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.errors[0]!.code).toBe('REAL_PUBLICATION_DISABLED');
      const direct = await publishCandidate(c, item.id, { publisher: 'bypass' });
      expect(direct.ok).toBe(false);
      if (!direct.ok)
        expect(direct.errors.map((e) => e.code)).toContain('NOT_PUBLISHABLE_IN_THIS_STEP');
      expect(
        await scalar(
          c,
          'select count(*)::int n from import_candidate_link where candidate_id = $1',
          [item.id],
        ),
      ).toBe(0);
    });
  });

  it('FIXTURE publication still works, one approved candidate at a time', async () => {
    await withRollback(async (c) => {
      const r = await stageAndValidate(
        c,
        syntheticFixture('yard-sign', { 'MIG1-O-020': 'FIXTURE-S06-001' }),
      );
      const item = await candidate(c, r.batchId, 'CATALOG_ITEM:FIXTURE-S06-001');
      const tx = rollbackRunner(c);
      const notApproved = await publishFixtureHandler(tx, ACTOR, { candidateId: item.id });
      expect(notApproved.ok).toBe(false);
      must(
        await saveDraftHandler(tx, ACTOR, {
          candidateId: item.id,
          set: {
            decorationPolicy: 'NONE',
            target: { mode: 'CREATE' },
            categoryKey: 'banderas_displays',
          },
        }),
      );
      must(await approveHandler(tx, ACTOR, { candidateId: item.id }));
      const published = must(await publishFixtureHandler(tx, ACTOR, { candidateId: item.id }));
      expect(published.publicCode).toMatch(/^DTG-\d{5}$/);
      const created = (
        await c.query(
          `select i.id, c.key from import_candidate_link l join catalog_item i on i.id = l.entity_id
             left join catalog_item_category ic on ic.item_id = i.id and ic.is_primary
             left join category c on c.id = ic.category_id
            where l.candidate_id = $1 and l.role = 'catalog_item'`,
          [item.id],
        )
      ).rows[0];
      expect(created.key).toBe('banderas_displays'); // the explicit category resolution reached the domain
      expect(
        (
          await c.query(
            'select action from review_event where candidate_id = $1 order by id desc limit 1',
            [item.id],
          )
        ).rows[0].action,
      ).toBe('PUBLISH');
    });
  });

  it('no client-side bypass: every handler validates actor, capability and input on the server', async () => {
    await withRollback(async (c) => {
      const r = await stageAndValidate(c, loadFixtureEnvelopeJson('premium-business-card'));
      const item = await candidate(c, r.batchId, 'CATALOG_ITEM:MIG1-O-009');
      const tx = rollbackRunner(c);
      const anon = await saveDraftHandler(tx, null, {
        candidateId: item.id,
        set: { status: 'ACTIVE' },
      });
      expect(anon.ok).toBe(false);
      if (!anon.ok) expect(anon.errors[0]!.code).toBe('ACTOR_REQUIRED');
      for (const res of [
        await approveHandler(tx, null, { candidateId: item.id }),
        await createItemHandler(tx, null, {
          name: 'x',
          kind: 'PRODUCT',
          status: 'ACTIVE',
          decorationPolicy: 'NONE',
        }),
        await updateItemHandler(tx, null, { id: PREMIUM, patch: { name: 'x' } }),
        await bulkPreviewHandler(c, null, {
          candidateIds: [item.id],
          kind: 'CATALOG_ITEM',
          changes: { status: 'ACTIVE' },
        }),
      ]) {
        expect(res.ok).toBe(false);
      }
      // Extra keys, forged status transitions and forged plans are refused.
      expect(
        (
          await saveDraftHandler(tx, ACTOR, {
            candidateId: item.id,
            set: {},
            reviewStatus: 'APPROVED',
          })
        ).ok,
      ).toBe(false);
      expect(
        (
          await approveHandler(tx, ACTOR, {
            candidateId: item.id,
            resolution: { status: 'ACTIVE' },
          })
        ).ok,
      ).toBe(false);
      const forged = await bulkApplyHandler(tx, ACTOR, {
        candidateIds: [item.id],
        kind: 'CATALOG_ITEM',
        changes: { decorationPolicy: 'NONE' },
        planSha256: '0'.repeat(64),
        overwrite: true,
      });
      expect(forged.ok).toBe(false);
      if (!forged.ok) expect(forged.errors[0]!.code).toBe('STALE_PREVIEW');
      // Approving an item whose required fields are open is refused whatever the client believes.
      const approve = await approveHandler(tx, ACTOR, { candidateId: item.id });
      expect(approve.ok).toBe(false);
      expect(
        await scalar(
          c,
          "select count(*)::int n from import_candidate where id = $1 and review_status = 'APPROVED'",
          [item.id],
        ),
      ).toBe(0);
      // Price authorization is not granted to anyone in STEP 06.
      expect(authorize(ACTOR, 'price.authorize')?.code).toBe('FORBIDDEN');
    });
  });
});
