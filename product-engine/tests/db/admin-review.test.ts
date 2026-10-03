import { afterAll, describe, expect, it } from 'vitest';
import { itemId } from '../../data/dev-slice';
import { approveHandler, rejectHandler, saveDraftHandler, withdrawHandler } from '@/admin/handlers';
import { candidateDetail, listReviewCandidates, reviewFacets } from '@/db/admin/review';
import { loadFixtureEnvelopeJson } from '../fixtures/import-envelopes';
import { ACTOR, must, rollbackRunner } from './admin-helpers';
import { expectDbError, pool, withRollback } from './helpers';
import { candidate, scalar, stageAndValidate } from './import-helpers';

afterAll(() => pool.end());

const PREMIUM = itemId('tarjeta_premium');

describe('review inbox', () => {
  it('loads staged candidates with server-side filters, search and pagination', async () => {
    await withRollback(async (c) => {
      const r = await stageAndValidate(c, loadFixtureEnvelopeJson('premium-business-card'));
      const all = await listReviewCandidates(c, { batchId: r.batchId });
      expect(all.total).toBe(6);
      expect(all.rows.map((x) => x.kind).sort()).toEqual([
        'CATALOG_ITEM',
        'DECORATION',
        'DECORATION',
        'OPTION',
        'PRICE',
        'PRICE',
      ]);
      const item = all.rows.find((x) => x.kind === 'CATALOG_ITEM')!;
      expect(item.label).toBe('Tarjeta Premium / Gloss'); // the Excel name, never the domain name
      expect(item.sheet).toBe('OFERTAS');
      expect(item.row).toBeGreaterThan(1);
      expect(item.openFields.sort()).toEqual(['decorationPolicy', 'status']);
      expect(item.summary.find((s) => s.field === 'status')).toMatchObject({ state: 'UNRESOLVED' });

      expect((await listReviewCandidates(c, { batchId: r.batchId, kind: 'OPTION' })).total).toBe(1);
      expect(
        (await listReviewCandidates(c, { batchId: r.batchId, catalogStatus: 'unresolved' })).total,
      ).toBe(1);
      expect(
        (await listReviewCandidates(c, { batchId: r.batchId, catalogStatus: 'resolved' })).total,
      ).toBe(0);
      // “has price” = the candidate's item has price candidates (all six belong to MIG1-O-009).
      expect((await listReviewCandidates(c, { batchId: r.batchId, hasPrice: true })).total).toBe(6);
      expect((await listReviewCandidates(c, { batchId: r.batchId, hasPrice: false })).total).toBe(
        0,
      );
      expect((await listReviewCandidates(c, { batchId: r.batchId, q: 'premium' })).total).toBe(6);
      expect((await listReviewCandidates(c, { batchId: r.batchId, sheet: 'PRECIOS' })).total).toBe(
        2,
      );
      expect(
        (await listReviewCandidates(c, { batchId: r.batchId, ids: [item.id] })).rows.map(
          (x) => x.id,
        ),
      ).toEqual([item.id]);
      const page = await listReviewCandidates(c, { batchId: r.batchId }, 2, 4);
      expect(page.rows).toHaveLength(2);
      expect(page.total).toBe(6);
      const facets = await reviewFacets(c, r.batchId);
      expect(facets.sheets.map((s) => s.sheet)).toContain('OFERTAS');
    });
  });
});

describe('candidate review and resolution', () => {
  it('shows unresolved fields as unresolved and keeps them so until a person decides', async () => {
    await withRollback(async (c) => {
      const r = await stageAndValidate(c, loadFixtureEnvelopeJson('premium-business-card'));
      const item = await candidate(c, r.batchId, 'CATALOG_ITEM:MIG1-O-009');
      const d = (await candidateDetail(c, item.id))!;
      const field = (f: string) => d.fields.find((x) => x.field === f)!;
      expect(field('status').state).toBe('UNRESOLVED');
      expect(field('status').value).toBeUndefined();
      expect(field('decorationPolicy').state).toBe('UNRESOLVED');
      expect(field('itemType')).toMatchObject({ state: 'SOURCE', value: 'PRODUCT' });
      expect(d.records[0]!.cells.length).toBeGreaterThan(0);
      expect(d.records[0]!.cells[0]).toMatchObject({ source_sheet: 'OFERTAS' });

      const tx = rollbackRunner(c);
      must(
        await saveDraftHandler(tx, ACTOR, {
          candidateId: item.id,
          set: { decorationPolicy: 'NONE' },
        }),
      );
      const after = (await candidateDetail(c, item.id))!;
      expect(after.openFields).toEqual(['status']);
      expect(after.fields.find((x) => x.field === 'status')!.state).toBe('UNRESOLVED');
      const approve = await approveHandler(tx, ACTOR, { candidateId: item.id });
      expect(approve.ok).toBe(false);
      if (!approve.ok) expect(approve.errors.map((e) => e.field)).toEqual(['status']);
    });
  });

  it('persists a draft resolution with a field-level audit trail and actor attribution', async () => {
    await withRollback(async (c) => {
      const r = await stageAndValidate(c, loadFixtureEnvelopeJson('premium-business-card'));
      const item = await candidate(c, r.batchId, 'CATALOG_ITEM:MIG1-O-009');
      const tx = rollbackRunner(c);
      const saved = must(
        await saveDraftHandler(tx, ACTOR, {
          candidateId: item.id,
          set: { status: 'ACTIVE', decorationPolicy: 'NONE' },
          reason: 'catálogo vigente 2026',
        }),
      );
      expect(saved.changed).toBe(2);
      const d = (await candidateDetail(c, item.id))!;
      expect(d.draft).toEqual({ status: 'ACTIVE', decorationPolicy: 'NONE' });
      expect(d.reviewStatus).toBe('WARNING'); // saving a draft never approves
      expect(d.openFields).toEqual([]);
      const events = (
        await c.query(
          'select action, field, old_value, new_value, actor, reason, origin from review_event where candidate_id = $1 order by field',
          [item.id],
        )
      ).rows;
      expect(events).toEqual([
        {
          action: 'SET',
          field: 'decorationPolicy',
          old_value: null,
          new_value: 'NONE',
          actor: 'martin@test',
          reason: 'catálogo vigente 2026',
          origin: 'UI_SINGLE',
        },
        {
          action: 'SET',
          field: 'status',
          old_value: null,
          new_value: 'ACTIVE',
          actor: 'martin@test',
          reason: 'catálogo vigente 2026',
          origin: 'UI_SINGLE',
        },
      ]);
      const change = (
        await c.query(
          `select changed_by, context from change_event where table_name = 'import_candidate' and entity_key = $1
            order by id desc limit 1`,
          [item.id],
        )
      ).rows[0];
      expect(change).toEqual({ changed_by: 'martin@test', context: 'admin:review.save_draft' });

      // Clearing a field is explicit and audited too.
      must(await saveDraftHandler(tx, ACTOR, { candidateId: item.id, clear: ['status'] }));
      expect((await candidateDetail(c, item.id))!.openFields).toEqual(['status']);
      expect(
        await scalar(
          c,
          "select count(*)::int n from review_event where candidate_id = $1 and action = 'CLEAR'",
          [item.id],
        ),
      ).toBe(1);
    });
  });

  it('rejects invalid resolutions on the server and writes nothing', async () => {
    await withRollback(async (c) => {
      const r = await stageAndValidate(c, loadFixtureEnvelopeJson('premium-business-card'));
      const item = await candidate(c, r.batchId, 'CATALOG_ITEM:MIG1-O-009');
      const option = await candidate(c, r.batchId, 'OPTION:MIG1-OP-002');
      const tx = rollbackRunner(c);
      for (const bad of [
        { candidateId: item.id, set: { status: 'LIVE' } },
        { candidateId: item.id, set: { customerSupplied: true } },
        { candidateId: option.id, set: { isRequired: 'yes' } },
        { candidateId: item.id, set: { categoryKey: 'Not A Key' } },
        { candidateId: 'not-a-uuid', set: { status: 'ACTIVE' } },
      ]) {
        const res = await saveDraftHandler(tx, ACTOR, bad);
        expect(res.ok, JSON.stringify(bad)).toBe(false);
      }
      expect(
        await scalar(c, 'select count(*)::int n from review_event where candidate_id = any($1)', [
          [item.id, option.id],
        ]),
      ).toBe(0);
      expect(
        (await c.query('select resolution from import_candidate where id = $1', [item.id])).rows[0]
          .resolution,
      ).toBeNull();
    });
  });

  it('previews through the real domain adapter (incomplete, adapter error, ok)', async () => {
    await withRollback(async (c) => {
      const r = await stageAndValidate(c, loadFixtureEnvelopeJson('premium-business-card'));
      const item = await candidate(c, r.batchId, 'CATALOG_ITEM:MIG1-O-009');
      const tx = rollbackRunner(c);
      const first = (await candidateDetail(c, item.id))!.preview;
      expect(first.state).toBe('ADAPTER_ERRORS');
      expect(first.errors.map((e) => e.code).sort()).toEqual([
        'UNRESOLVED_FIELD',
        'UNRESOLVED_FIELD',
      ]);

      must(
        await saveDraftHandler(tx, ACTOR, {
          candidateId: item.id,
          set: { status: 'ACTIVE', decorationPolicy: 'NONE', target: { mode: 'CREATE' } },
        }),
      );
      const dup = (await candidateDetail(c, item.id))!.preview;
      expect(dup.state).toBe('ADAPTER_ERRORS');
      expect(dup.errors.map((e) => e.code)).toEqual(['LINEAGE_EXISTS']); // the seeded item already has MIG1-O-009

      must(
        await saveDraftHandler(tx, ACTOR, {
          candidateId: item.id,
          set: { target: { mode: 'LINK_EXISTING', entityId: PREMIUM } },
        }),
      );
      const ok = (await candidateDetail(c, item.id))!;
      expect(ok.preview.state).toBe('OK');
      expect(ok.preview.ops.map((o) => o.op)).toContain('LINK');
      expect(ok.lineageMatches.map((m) => m.id)).toEqual([PREMIUM]);

      const option = await candidate(c, r.batchId, 'OPTION:MIG1-OP-002');
      must(
        await saveDraftHandler(tx, ACTOR, { candidateId: option.id, set: { isRequired: true } }),
      );
      const incomplete = (await candidateDetail(c, option.id))!.preview;
      expect(incomplete.state).toBe('INCOMPLETE');
    });
  });

  it('Option required = null stays unresolved until true/false is chosen (no silent false)', async () => {
    await withRollback(async (c) => {
      const r = await stageAndValidate(c, loadFixtureEnvelopeJson('premium-business-card'));
      const option = await candidate(c, r.batchId, 'OPTION:MIG1-OP-002');
      expect(option.proposal.required).toBeNull();
      const before = (await candidateDetail(c, option.id))!.fields.find(
        (f) => f.field === 'isRequired',
      )!;
      expect(before.state).toBe('UNRESOLVED');
      expect(before.value).toBeUndefined();
      must(
        await saveDraftHandler(rollbackRunner(c), ACTOR, {
          candidateId: option.id,
          set: { isRequired: false },
        }),
      );
      const after = (await candidateDetail(c, option.id))!.fields.find(
        (f) => f.field === 'isRequired',
      )!;
      expect(after).toMatchObject({ state: 'REVIEWED', value: false });
    });
  });

  it('approve, locked while approved, withdraw with reason, reject with reason', async () => {
    await withRollback(async (c) => {
      const r = await stageAndValidate(c, loadFixtureEnvelopeJson('premium-business-card'));
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
      const approved = must(await approveHandler(tx, ACTOR, { candidateId: item.id }));
      expect(approved.approvalSha256).toMatch(/^[0-9a-f]{64}$/);
      expect((await candidateDetail(c, item.id))!.approval.by).toBe('martin@test');

      const locked = await saveDraftHandler(tx, ACTOR, {
        candidateId: item.id,
        set: { status: 'PLANNED' },
      });
      expect(locked.ok).toBe(false);
      if (!locked.ok) expect(locked.errors[0]!.code).toBe('NOT_EDITABLE');

      expect((await withdrawHandler(tx, ACTOR, { candidateId: item.id, reason: ' ' })).ok).toBe(
        false,
      );
      const withdrawn = must(
        await withdrawHandler(tx, ACTOR, { candidateId: item.id, reason: 'revisar precio' }),
      );
      expect(withdrawn.reviewStatus).toBe('WARNING');
      const d = (await candidateDetail(c, item.id))!;
      expect(d.approval.sha256).toBeNull();
      expect(d.draft).toMatchObject({ status: 'ACTIVE' }); // the draft survives the withdrawal

      expect((await rejectHandler(tx, ACTOR, { candidateId: item.id })).ok).toBe(false);
      must(await rejectHandler(tx, ACTOR, { candidateId: item.id, reason: 'duplicado' }));
      const actions = (
        await c.query('select action from review_event where candidate_id = $1 order by id', [
          item.id,
        ])
      ).rows.map((x) => x.action);
      expect(actions).toEqual(['SET', 'SET', 'SET', 'APPROVE', 'WITHDRAW_APPROVAL', 'REJECT']);
      await expectDbError(
        c,
        'delete from review_event where candidate_id = $1',
        [item.id],
        /cannot be deleted/,
      );
      await expectDbError(
        c,
        "update review_event set actor = 'x' where candidate_id = $1",
        [item.id],
        /immutable/,
      );
    });
  });

  it('category is an explicit resolution: never inferred, unknown or conflicting keys are refused', async () => {
    await withRollback(async (c) => {
      const r = await stageAndValidate(c, loadFixtureEnvelopeJson('premium-business-card'));
      const item = await candidate(c, r.batchId, 'CATALOG_ITEM:MIG1-O-009');
      const tx = rollbackRunner(c);
      const base = {
        status: 'ACTIVE',
        decorationPolicy: 'NONE',
        target: { mode: 'LINK_EXISTING', entityId: PREMIUM },
      };
      must(await saveDraftHandler(tx, ACTOR, { candidateId: item.id, set: base }));
      const d0 = (await candidateDetail(c, item.id))!;
      expect(d0.fields.find((f) => f.field === 'categoryKey')).toMatchObject({ state: 'NOT_SET' });
      expect(d0.preview.state).toBe('OK'); // no category needed to approve
      expect(d0.preview.ops.some((o) => o.op === 'ASSIGN_CATEGORY')).toBe(false); // never inferred

      must(
        await saveDraftHandler(tx, ACTOR, {
          candidateId: item.id,
          set: { categoryKey: 'no_existe' },
        }),
      );
      expect((await candidateDetail(c, item.id))!.preview.errors.map((e) => e.code)).toEqual([
        'CATEGORY_NOT_FOUND',
      ]);
      const current = (
        await c.query(
          'select c.key from catalog_item_category ic join category c on c.id = ic.category_id where ic.item_id = $1 and ic.is_primary',
          [PREMIUM],
        )
      ).rows[0]?.key as string | undefined;
      const other = current === 'playeras_textiles' ? 'impresos_papel' : 'playeras_textiles';
      must(
        await saveDraftHandler(tx, ACTOR, { candidateId: item.id, set: { categoryKey: other } }),
      );
      const conflict = (await candidateDetail(c, item.id))!.preview;
      if (current) expect(conflict.errors.map((e) => e.code)).toEqual(['CATEGORY_CONFLICT']);
      else expect(conflict.ops.some((o) => o.op === 'ASSIGN_CATEGORY')).toBe(true);
    });
  });
});
