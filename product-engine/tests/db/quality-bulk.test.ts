import type { PoolClient } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import {
  bulkPreviewHandler,
  categoryApplyHandler,
  categoryPreviewHandler,
  decisionApplyHandler,
  decisionPreviewHandler,
  markDuplicateHandler,
  recordDecisionHandler,
  remediationApplyHandler,
  remediationPreviewHandler,
  saveDraftHandler,
} from '@/admin/handlers';
import { currentAnswer, decisionStates } from '@/db/admin/decision-answers';
import { duplicatePairs } from '@/db/admin/duplicates';
import { sourceCategories, mappingHistory } from '@/db/admin/category-mapping';
import { qualityReport } from '@/db/admin/quality';
import { PUBLICATION_ENABLED_FOR } from '@/db/import/publish';
import { commercialPrintGate } from '@/quality/gate';
import { loadFixtureEnvelopeJson } from '../fixtures/import-envelopes';
import { ACTOR, must, rollbackRunner } from './admin-helpers';
import { pool, withRollback } from './helpers';
import { candidatesOf, scalar, stageAndValidate } from './import-helpers';

afterAll(() => pool.end());

const RECORDER = { ...ACTOR, role: 'local_decision_recorder' as const };
const NOW = new Date('2026-10-01T00:00:00Z');

async function xbanner(c: PoolClient) {
  const r = await stageAndValidate(c, loadFixtureEnvelopeJson('x-banner'));
  return { batchId: r.batchId, items: await candidatesOf(c, r.batchId, 'CATALOG_ITEM') };
}
const byLegacy = (items: { id: string; proposal: Record<string, unknown> }[], legacy: string) =>
  items.find((i) => i.proposal.legacyId === legacy)!;
const draftOf = async (c: PoolClient, id: string) =>
  (await c.query('select resolution from import_candidate where id = $1', [id])).rows[0].resolution;

describe('owner decision answers', () => {
  it('every decision stays OPEN until a person records an answer — the app never answers', async () => {
    await withRollback(async (c) => {
      const states = await decisionStates(c);
      expect(states).toHaveLength(22);
      expect(states.every((s) => s.status === 'OPEN' && s.answer === null)).toBe(true);
      expect(await scalar(c, 'select count(*)::int n from owner_decision_answer')).toBe(0);
    });
  });

  it('recording needs the decision.record capability; the answer keeps actor, time, notes and history', async () => {
    await withRollback(async (c) => {
      const denied = await recordDecisionHandler(rollbackRunner(c), ACTOR, {
        decisionId: 'D-016',
        summary: 'x',
      });
      expect(denied).toMatchObject({ ok: false, errors: [{ code: 'FORBIDDEN' }] });

      const a1 = must(
        await recordDecisionHandler(rollbackRunner(c), RECORDER, {
          decisionId: 'D-016',
          summary: 'Sólo Martín autoriza precios',
          notes: 'dicho en persona',
        }),
      );
      expect(a1.revision).toBe(1);
      const a2 = must(
        await recordDecisionHandler(rollbackRunner(c), RECORDER, {
          decisionId: 'D-016',
          summary: 'Martín y un delegado',
        }),
      );
      expect(a2.revision).toBe(2);
      const cur = await currentAnswer(c, 'D-016');
      expect(cur).toMatchObject({
        summary: 'Martín y un delegado',
        actor: 'martin@test',
        revision: 2,
      });
      expect(
        await scalar(
          c,
          "select count(*)::int n from owner_decision_answer where decision_id = 'D-016'",
        ),
      ).toBe(2);
      // append-only
      await c.query('savepoint s');
      await expect(c.query("update owner_decision_answer set summary = 'x'")).rejects.toThrow();
      await c.query('rollback to savepoint s');
      // other decisions stay OPEN: no implicit answer
      const states = await decisionStates(c);
      expect(states.filter((s) => s.status === 'ANSWERED').map((s) => s.id)).toEqual(['D-016']);
      // audit trail names the actor
      expect(
        await scalar(
          c,
          "select count(*)::int n from change_event where table_name = 'owner_decision_answer' and changed_by = 'martin@test'",
        ),
      ).toBe(2);
    });
  });

  it('refuses an answer that points outside the decision scope or has no applicable form', async () => {
    await withRollback(async (c) => {
      const r = await recordDecisionHandler(rollbackRunner(c), RECORDER, {
        decisionId: 'D-002',
        summary: 'x',
        assignments: [{ value: 'PIECE', legacyIds: ['NOT-IN-SCOPE'] }],
      });
      expect(r).toMatchObject({ ok: false });
      expect(await scalar(c, 'select count(*)::int n from owner_decision_answer')).toBe(0);
    });
  });
});

describe('explicit answer → controlled bulk (D-002 sale unit)', () => {
  const answer = {
    decisionId: 'D-002',
    summary: 'Piezas para ambos',
    assignments: [{ value: 'PIECE', legacyIds: ['OWN-O-003', 'MIG1-O-021'] }],
  };

  it('previews, applies, records the decision behind the operation and the findings drop', async () => {
    await withRollback(async (c) => {
      const { batchId, items } = await xbanner(c);
      const before = await qualityReport(c, NOW, { batchId });
      const missing = (r: typeof before) =>
        r.run.findings.filter((f) => f.ruleCode === 'DQ-CATALOG-003').map((f) => f.itemLegacyId);
      expect(missing(before)).toEqual(expect.arrayContaining(['OWN-O-003', 'MIG1-O-021']));

      // nothing can be applied before the owner's answer exists
      const none = await decisionPreviewHandler(c, ACTOR, { decisionId: 'D-002', index: 0 });
      expect(none).toMatchObject({ ok: false });

      const rec = must(await recordDecisionHandler(rollbackRunner(c), RECORDER, answer));
      const pv = must(await decisionPreviewHandler(c, ACTOR, { decisionId: 'D-002', index: 0 }));
      expect(pv.summary).toMatchObject({
        selected: 2,
        wouldChange: 2,
        alreadySame: 0,
        notApplicable: 0,
      });
      // preview writes nothing
      for (const i of items) expect(await draftOf(c, i.id)).toBeNull();

      const applied = must(
        await decisionApplyHandler(rollbackRunner(c), ACTOR, {
          decisionId: 'D-002',
          index: 0,
          planSha256: pv.plan.planSha256,
          overwrite: false,
        }),
      );
      expect(applied.written).toBe(2);
      expect(await draftOf(c, byLegacy(items, 'OWN-O-003').id)).toMatchObject({
        saleUnit: 'PIECE',
      });
      expect(await draftOf(c, byLegacy(items, 'MIG1-O-003').id)).toBeNull(); // outside the answer: untouched
      const op = (
        await c.query(
          'select origin, origin_ref, decision_answer_id from review_bulk_operation where id = $1',
          [applied.bulkOperationId],
        )
      ).rows[0];
      expect(op).toEqual({
        origin: 'DECISION_GROUP',
        origin_ref: 'D-002',
        decision_answer_id: rec.answerId,
      });
      expect(
        await scalar(
          c,
          "select count(*)::int n from review_event where bulk_operation_id = $1 and origin = 'DECISION_GROUP'",
          [applied.bulkOperationId],
        ),
      ).toBe(2);

      const after = await qualityReport(c, NOW, { batchId });
      expect(missing(after)).not.toContain('OWN-O-003');
      expect(missing(after)).not.toContain('MIG1-O-021');
      // honest before/after: the other blockers did not move
      const count = (r: typeof before, code: string) =>
        r.run.findings.filter((f) => f.ruleCode === code).length;
      expect(count(after, 'DQ-CATALOG-005')).toBe(count(before, 'DQ-CATALOG-005'));
      expect(count(after, 'DQ-CATALOG-002')).toBe(count(before, 'DQ-CATALOG-002'));
    });
  });

  it('a stale preview is rejected; a different existing value needs the overwrite confirmation', async () => {
    await withRollback(async (c) => {
      const { items } = await xbanner(c);
      must(await recordDecisionHandler(rollbackRunner(c), RECORDER, answer));
      const target = byLegacy(items, 'OWN-O-003');
      const pv = must(await decisionPreviewHandler(c, ACTOR, { decisionId: 'D-002', index: 0 }));

      // someone edits a draft after the preview
      must(
        await saveDraftHandler(rollbackRunner(c), ACTOR, {
          candidateId: target.id,
          set: { saleUnit: 'SET' },
        }),
      );
      const stale = await decisionApplyHandler(rollbackRunner(c), ACTOR, {
        decisionId: 'D-002',
        index: 0,
        planSha256: pv.plan.planSha256,
        overwrite: false,
      });
      expect(stale).toMatchObject({ ok: false, errors: [{ code: 'STALE_PREVIEW' }] });

      const pv2 = must(await decisionPreviewHandler(c, ACTOR, { decisionId: 'D-002', index: 0 }));
      expect(pv2.summary).toMatchObject({ hasOtherValue: 1, wouldChange: 1, overwriteNeeded: 1 });
      const safe = must(
        await decisionApplyHandler(rollbackRunner(c), ACTOR, {
          decisionId: 'D-002',
          index: 0,
          planSha256: pv2.plan.planSha256,
          overwrite: false,
        }),
      );
      expect(safe.written).toBe(1);
      expect(await draftOf(c, target.id)).toMatchObject({ saleUnit: 'SET' }); // not silently overwritten
      const pv3 = must(await decisionPreviewHandler(c, ACTOR, { decisionId: 'D-002', index: 0 }));
      const forced = must(
        await decisionApplyHandler(rollbackRunner(c), ACTOR, {
          decisionId: 'D-002',
          index: 0,
          planSha256: pv3.plan.planSha256,
          overwrite: true,
        }),
      );
      expect(forced.written).toBe(1);
      expect(await draftOf(c, target.id)).toMatchObject({ saleUnit: 'PIECE' });
    });
  });
});

describe('field-compatible bulk through the handlers', () => {
  it('refuses a mixed selection in strict mode', async () => {
    await withRollback(async (c) => {
      const { batchId, items } = await xbanner(c);
      const opts = await candidatesOf(c, batchId, 'OPTION');
      const r = await bulkPreviewHandler(c, ACTOR, {
        candidateIds: [items[0]!.id, opts[0]!.id],
        kind: 'CATALOG_ITEM',
        changes: { decorationPolicy: 'NONE' },
        strict: true,
      });
      expect(r).toMatchObject({ ok: false, errors: [{ code: 'INCOMPATIBLE_SELECTION' }] });
      const lenient = await bulkPreviewHandler(c, ACTOR, {
        candidateIds: [items[0]!.id, opts[0]!.id],
        kind: 'CATALOG_ITEM',
        changes: { decorationPolicy: 'NONE' },
      });
      expect(lenient.ok).toBe(true);
    });
  });

  it('remediates one rule through the same planner (preview → apply) and revalidates', async () => {
    await withRollback(async (c) => {
      const { batchId } = await xbanner(c);
      const count = async () =>
        (await qualityReport(c, NOW, { batchId })).run.findings.filter(
          (f) => f.ruleCode === 'DQ-CATALOG-005',
        ).length;
      const before = await count();
      expect(before).toBe(3);
      const pv = must(
        await remediationPreviewHandler(c, ACTOR, { ruleCode: 'DQ-CATALOG-005', value: 'NONE' }),
      );
      expect(pv.summary.wouldChange).toBe(3);
      must(
        await remediationApplyHandler(rollbackRunner(c), ACTOR, {
          ruleCode: 'DQ-CATALOG-005',
          value: 'NONE',
          planSha256: pv.plan.planSha256,
          overwrite: false,
        }),
      );
      expect(await count()).toBe(0);
      // a rule without a bulk field cannot be remediated this way
      expect(
        await remediationPreviewHandler(c, ACTOR, { ruleCode: 'DQ-PROV-001', value: 'x' }),
      ).toMatchObject({ ok: false });
    });
  });
});

describe('category mapping', () => {
  it('lists source categories as evidence, previews impact, applies via bulk and keeps an audit trail', async () => {
    await withRollback(async (c) => {
      const { items } = await xbanner(c);
      const mine = items.filter((i) => i.proposal.categoryLegacy === 'MIG1-CAT-003');
      const n = mine.length;
      expect(n).toBeGreaterThan(0);
      const sources = await sourceCategories(c);
      const row = sources.find((s) => s.sourceCategory === 'MIG1-CAT-003')!;
      expect(row.candidates).toBe(n);
      expect(row.resolved).toBe(0); // nothing maps by name
      expect(row.recorded).toBeNull();

      const pv = must(
        await categoryPreviewHandler(c, ACTOR, {
          sourceCategory: 'MIG1-CAT-003',
          categoryKey: 'banderas_displays',
        }),
      );
      expect(pv.summary).toMatchObject({ selected: n, wouldChange: n });
      for (const i of items) expect(await draftOf(c, i.id)).toBeNull();

      const ap = must(
        await categoryApplyHandler(rollbackRunner(c), ACTOR, {
          sourceCategory: 'MIG1-CAT-003',
          categoryKey: 'banderas_displays',
          planSha256: pv.plan.planSha256,
          overwrite: false,
          reason: 'Banners son Banderas y Displays',
        }),
      );
      expect(ap.written).toBe(n);
      for (const i of mine)
        expect(await draftOf(c, i.id)).toMatchObject({ categoryKey: 'banderas_displays' });
      for (const i of items.filter((x) => !mine.includes(x)))
        expect(await draftOf(c, i.id)).toBeNull();
      const hist = await mappingHistory(c);
      expect(hist[0]).toMatchObject({
        sourceCategory: 'MIG1-CAT-003',
        categoryKey: 'banderas_displays',
        candidates: n,
        actor: 'martin@test',
        current: true,
        bulkOperationId: ap.bulkOperationId,
      });
      expect(
        await scalar(
          c,
          "select count(*)::int n from change_event where table_name = 'category_mapping' and changed_by = 'martin@test'",
        ),
      ).toBe(1);
      expect(
        (await sourceCategories(c)).find((s) => s.sourceCategory === 'MIG1-CAT-003')!.recorded,
      ).toMatchObject({ categoryKey: 'banderas_displays' });

      // re-mapping supersedes (history kept), and needs confirmation because the values now differ
      const pv2 = must(
        await categoryPreviewHandler(c, ACTOR, {
          sourceCategory: 'MIG1-CAT-003',
          categoryKey: 'impresos_papel',
        }),
      );
      expect(pv2.summary).toMatchObject({ hasOtherValue: n, wouldChange: 0 });
      const blocked = await categoryApplyHandler(rollbackRunner(c), ACTOR, {
        sourceCategory: 'MIG1-CAT-003',
        categoryKey: 'impresos_papel',
        planSha256: pv2.plan.planSha256,
        overwrite: false,
      });
      expect(blocked).toMatchObject({ ok: false, errors: [{ code: 'NOTHING_TO_APPLY' }] });
      must(
        await categoryApplyHandler(rollbackRunner(c), ACTOR, {
          sourceCategory: 'MIG1-CAT-003',
          categoryKey: 'impresos_papel',
          planSha256: pv2.plan.planSha256,
          overwrite: true,
        }),
      );
      const h2 = await mappingHistory(c);
      expect(h2.filter((m) => m.current)).toHaveLength(1);
      expect(h2).toHaveLength(2);
    });
  });

  it('refuses unknown categories and blank sources', async () => {
    await withRollback(async (c) => {
      await xbanner(c);
      expect(
        await categoryPreviewHandler(c, ACTOR, {
          sourceCategory: 'MIG1-CAT-003',
          categoryKey: 'inventada',
        }),
      ).toMatchObject({ ok: false });
      expect(
        await categoryPreviewHandler(c, ACTOR, {
          sourceCategory: 'NO-SUCH',
          categoryKey: 'impresos_papel',
        }),
      ).toMatchObject({ ok: false });
    });
  });
});

describe('duplicate review', () => {
  it('shows the pair side by side; MARK_DISTINCT / MARK_REVIEWED only mark — nothing is merged', async () => {
    await withRollback(async (c) => {
      const { items } = await xbanner(c);
      const pairs = await duplicatePairs(c, NOW);
      expect(pairs.length).toBeGreaterThan(0);
      const p = pairs[0]!;
      expect(p.sides[0].name).toBeTruthy();
      expect(p.sides[0].provenance?.workbook).toBeTruthy();
      expect(p.mark).toBeNull();

      const items0 = await scalar(c, 'select count(*)::int n from catalog_item');
      must(
        await markDuplicateHandler(rollbackRunner(c), ACTOR, {
          pairKey: p.pairKey,
          mark: 'REVIEWED',
          reason: 'revisado',
        }),
      );
      must(
        await markDuplicateHandler(rollbackRunner(c), ACTOR, {
          pairKey: p.pairKey,
          mark: 'DISTINCT',
        }),
      );
      const after = (await duplicatePairs(c, NOW)).find((x) => x.pairKey === p.pairKey)!;
      expect(after).toMatchObject({ mark: 'DISTINCT', markedBy: 'martin@test' });
      expect(await scalar(c, 'select count(*)::int n from quality_mark')).toBe(2);
      // no merge: no item changed, nothing was deleted
      expect(await scalar(c, 'select count(*)::int n from catalog_item')).toBe(items0);
      expect(
        await scalar(
          c,
          "select count(*)::int n from import_candidate where kind = 'CATALOG_ITEM' and batch_id = $1",
          [items[0]!.batch_id],
        ),
      ).toBe(items.length);
      expect(
        await markDuplicateHandler(rollbackRunner(c), ACTOR, { pairKey: 'X|Y', mark: 'DISTINCT' }),
      ).toMatchObject({ ok: false });
    });
  });
});

describe('quality report and Commercial Print gate on staged data', () => {
  it('computes findings and readiness, never publishes, and keeps the barrier', async () => {
    await withRollback(async (c) => {
      const r = await stageAndValidate(c, loadFixtureEnvelopeJson('premium-business-card'));
      const items0 = await scalar(c, 'select count(*)::int n from catalog_item');
      const report = await qualityReport(c, NOW, { batchId: r.batchId });
      expect(report.run.findings.length).toBeGreaterThan(0);
      expect(report.readiness.length).toBeGreaterThan(0);
      expect(report.input.batches).toHaveLength(1);
      const gate = commercialPrintGate(report.input, report.run.findings, report.readiness);
      expect(gate.items).toHaveLength(21);
      const card = gate.items.find((i) => i.legacyId === 'MIG1-O-009')!;
      expect(card.staged).toBe(true);
      expect(card.openDecisions).toContain('D-001');
      expect(gate.totals.staged).toBe(1);
      expect(PUBLICATION_ENABLED_FOR).toEqual(['FIXTURE']);
      expect(await scalar(c, 'select count(*)::int n from catalog_item')).toBe(items0);
      expect(
        await scalar(
          c,
          "select count(*)::int n from import_candidate where review_status = 'PUBLISHED'",
        ),
      ).toBe(0);
    });
  });
});
