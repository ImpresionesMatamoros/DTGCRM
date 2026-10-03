import type { PoolClient } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import {
  bulkApplyHandler,
  bulkPreviewHandler,
  recordDecisionHandler,
  saveDraftHandler,
} from '@/admin/handlers';
import { loadFixtureEnvelopeJson } from '../fixtures/import-envelopes';
import { ACTOR, must, rollbackRunner } from './admin-helpers';
import { pool, withRollback } from './helpers';
import { candidatesOf, scalar, stageAndValidate } from './import-helpers';

afterAll(() => pool.end());

async function xbannerItems(c: PoolClient) {
  const r = await stageAndValidate(c, loadFixtureEnvelopeJson('x-banner'));
  const items = await candidatesOf(c, r.batchId, 'CATALOG_ITEM');
  expect(items).toHaveLength(3);
  return { batchId: r.batchId, items };
}

const draftOf = async (c: PoolClient, id: string) =>
  (await c.query('select resolution from import_candidate where id = $1', [id])).rows[0].resolution;

describe('bulk resolution', () => {
  it('updates compatible candidates after an explicit preview, with audit and metadata', async () => {
    await withRollback(async (c) => {
      const { items } = await xbannerItems(c);
      const ids = items.map((i) => i.id);
      const preview = must(
        await bulkPreviewHandler(c, ACTOR, {
          candidateIds: ids,
          kind: 'CATALOG_ITEM',
          changes: { decorationPolicy: 'NONE' },
        }),
      );
      expect(preview.plan.counts).toMatchObject({
        selected: 3,
        affected: 3,
        unresolved: 3,
        same: 0,
        different: 0,
      });
      // Previewing writes nothing.
      for (const id of ids) expect(await draftOf(c, id)).toBeNull();

      const applied = must(
        await bulkApplyHandler(rollbackRunner(c), ACTOR, {
          candidateIds: ids,
          kind: 'CATALOG_ITEM',
          changes: { decorationPolicy: 'NONE' },
          planSha256: preview.plan.planSha256,
          overwrite: false,
          reason: 'displays no se decoran',
        }),
      );
      expect(applied).toMatchObject({ written: 3, candidates: 3 });
      for (const id of ids) expect(await draftOf(c, id)).toEqual({ decorationPolicy: 'NONE' });
      const op = (
        await c.query('select * from review_bulk_operation where id = $1', [
          applied.bulkOperationId,
        ])
      ).rows[0];
      expect(op).toMatchObject({
        actor: 'martin@test',
        kind: 'CATALOG_ITEM',
        changes: { decorationPolicy: 'NONE' },
        overwrite_confirmed: false,
        origin: 'UI_BULK',
        reason: 'displays no se decoran',
      });
      expect(op.candidate_ids.sort()).toEqual([...ids].sort());
      const events = (
        await c.query(
          'select candidate_id, action, field, new_value, origin, actor from review_event where bulk_operation_id = $1',
          [applied.bulkOperationId],
        )
      ).rows;
      expect(events).toHaveLength(3);
      expect(events.every((e) => e.origin === 'UI_BULK' && e.field === 'decorationPolicy')).toBe(
        true,
      );
      expect(
        await scalar(
          c,
          "select count(*)::int n from change_event where table_name = 'import_candidate' and context = 'admin:review.bulk_apply' and entity_key = any($1)",
          [ids],
        ),
      ).toBe(3);
    });
  });

  it('warns about different existing values and never overwrites them without confirmation', async () => {
    await withRollback(async (c) => {
      const { items } = await xbannerItems(c);
      const ids = items.map((i) => i.id);
      const tx = rollbackRunner(c);
      must(
        await saveDraftHandler(tx, ACTOR, {
          candidateId: ids[0]!,
          set: { decorationPolicy: 'OPTIONAL' },
        }),
      );
      const req = {
        candidateIds: ids,
        kind: 'CATALOG_ITEM',
        changes: { decorationPolicy: 'NONE' },
      };
      const preview = must(await bulkPreviewHandler(c, ACTOR, req));
      expect(preview.plan.counts).toMatchObject({ unresolved: 2, different: 1, affected: 2 });
      const different = preview.plan.entries.find((e) => e.classification === 'DIFFERENT')!;
      expect(different).toMatchObject({
        candidateId: ids[0],
        current: 'OPTIONAL',
        currentOrigin: 'DRAFT',
        next: 'NONE',
      });

      must(
        await bulkApplyHandler(tx, ACTOR, {
          ...req,
          planSha256: preview.plan.planSha256,
          overwrite: false,
        }),
      );
      expect(await draftOf(c, ids[0]!)).toEqual({ decorationPolicy: 'OPTIONAL' }); // untouched
      expect(await draftOf(c, ids[1]!)).toEqual({ decorationPolicy: 'NONE' });

      // Explicit confirmation overwrites the different one (new preview: the state changed).
      const again = must(await bulkPreviewHandler(c, ACTOR, req));
      expect(again.plan.counts).toMatchObject({ unresolved: 0, same: 2, different: 1 });
      must(
        await bulkApplyHandler(tx, ACTOR, {
          ...req,
          planSha256: again.plan.planSha256,
          overwrite: true,
        }),
      );
      expect(await draftOf(c, ids[0]!)).toEqual({ decorationPolicy: 'NONE' });
      const ev = (
        await c.query(
          "select old_value, new_value from review_event where candidate_id = $1 and origin = 'UI_BULK'",
          [ids[0]],
        )
      ).rows;
      expect(ev).toEqual([{ old_value: 'OPTIONAL', new_value: 'NONE' }]);
    });
  });

  it('skips blocked, approved and other-kind candidates and refuses a stale preview', async () => {
    await withRollback(async (c) => {
      const { batchId, items } = await xbannerItems(c);
      const option = (await candidatesOf(c, batchId, 'OPTION'))[0]!;
      const [blocked, approved, plain] = items;
      await c.query(
        `update import_candidate set review_status = 'BLOCKED', blocking_reasons = '{EMPTY_NAME}' where id = $1`,
        [blocked!.id],
      );
      const tx = rollbackRunner(c);
      // A blocked candidate cannot be edited individually either.
      const edit = await saveDraftHandler(tx, ACTOR, {
        candidateId: blocked!.id,
        set: { decorationPolicy: 'NONE' },
      });
      expect(edit.ok).toBe(false);
      must(
        await saveDraftHandler(tx, ACTOR, {
          candidateId: approved!.id,
          set: {
            decorationPolicy: 'NONE',
            target: { mode: 'LINK_EXISTING', entityId: approved!.id },
          },
        }),
      );
      await c.query(
        `update import_candidate set review_status = 'APPROVED', approved_by = 'x', approved_at = now(),
                approval_sha256 = repeat('0', 64) where id = $1`,
        [approved!.id],
      );
      const req = {
        candidateIds: [blocked!.id, approved!.id, plain!.id, option.id],
        kind: 'CATALOG_ITEM',
        changes: { decorationPolicy: 'NONE' },
      };
      const preview = must(await bulkPreviewHandler(c, ACTOR, req));
      expect(preview.plan.counts.skipped).toEqual({
        BLOCKED: 1,
        APPROVED_LOCKED: 1,
        OTHER_KIND: 1,
      });
      expect(preview.plan.counts.affected).toBe(1);

      // Someone edits the plain candidate after the preview: applying the old preview is refused.
      must(
        await saveDraftHandler(tx, ACTOR, {
          candidateId: plain!.id,
          set: { decorationPolicy: 'OPTIONAL' },
        }),
      );
      const stale = await bulkApplyHandler(tx, ACTOR, {
        ...req,
        planSha256: preview.plan.planSha256,
        overwrite: true,
      });
      expect(stale.ok).toBe(false);
      if (!stale.ok) expect(stale.errors[0]!.code).toBe('STALE_PREVIEW');
      expect(await draftOf(c, plain!.id)).toEqual({ decorationPolicy: 'OPTIONAL' });
      expect(
        await scalar(
          c,
          'select count(*)::int n from review_bulk_operation where candidate_ids && $1::uuid[]',
          [req.candidateIds],
        ),
      ).toBe(0);
    });
  });

  it('rejects fields that are not bulk-compatible and invalid values', async () => {
    await withRollback(async (c) => {
      const { items } = await xbannerItems(c);
      const ids = items.map((i) => i.id);
      for (const changes of [
        { canonicalName: 'Nuevo nombre' }, // single-candidate field
        { target: { mode: 'CREATE' } },
        { status: 'LIVE' },
        {},
      ]) {
        const r = await bulkPreviewHandler(c, ACTOR, {
          candidateIds: ids,
          kind: 'CATALOG_ITEM',
          changes,
        });
        expect(r.ok, JSON.stringify(changes)).toBe(false);
      }
    });
  });

  it('accepts candidate ids coming from a decision group (STEP 05C hook)', async () => {
    await withRollback(async (c) => {
      const { items } = await xbannerItems(c);
      const req = {
        candidateIds: items.map((i) => i.id),
        kind: 'CATALOG_ITEM',
        changes: { decorationPolicy: 'NONE' },
      };
      const preview = must(await bulkPreviewHandler(c, ACTOR, req));
      // STEP 08: a decision-group operation needs the owner's recorded answer behind it.
      const refused = await bulkApplyHandler(rollbackRunner(c), ACTOR, {
        ...req,
        planSha256: preview.plan.planSha256,
        overwrite: false,
        decisionGroup: 'D-001',
      });
      expect(refused).toMatchObject({ ok: false, errors: [{ code: 'DECISION_NOT_ANSWERED' }] });
      const recorder = { ...ACTOR, role: 'local_decision_recorder' as const };
      must(
        await recordDecisionHandler(rollbackRunner(c), recorder, {
          decisionId: 'D-001',
          summary: 'Respuesta de prueba del owner',
        }),
      );
      const applied = must(
        await bulkApplyHandler(rollbackRunner(c), ACTOR, {
          ...req,
          planSha256: preview.plan.planSha256,
          overwrite: false,
          decisionGroup: 'D-001',
        }),
      );
      const op = (
        await c.query('select origin, origin_ref from review_bulk_operation where id = $1', [
          applied.bulkOperationId,
        ])
      ).rows[0];
      expect(op).toEqual({ origin: 'DECISION_GROUP', origin_ref: 'D-001' });
      expect(
        await scalar(
          c,
          "select count(*)::int n from review_event where bulk_operation_id = $1 and origin = 'DECISION_GROUP'",
          [applied.bulkOperationId],
        ),
      ).toBe(3);
    });
  });
});
