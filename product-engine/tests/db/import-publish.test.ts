import type { PoolClient } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { itemId } from '../../data/dev-slice';
import { loadCatalogSnapshot } from '@/db/catalog-snapshot';
import { traceCandidate, traceEntity } from '@/db/import/provenance';
import { previewCandidate, publishCandidate } from '@/db/import/publish';
import { approveCandidate, rejectCandidate } from '@/db/import/review';
import { resolvePrice } from '@/pricing/resolve';
import { loadFixtureEnvelopeJson } from '../fixtures/import-envelopes';
import { expectDbError, pool, withRollback } from './helpers';
import {
  asNewVersion,
  asReal,
  candidate,
  candidatesOf,
  scalar,
  stageAndValidate,
  syntheticFixture,
} from './import-helpers';

afterAll(() => pool.end());

const AS_OF = new Date('2026-10-01T12:00:00Z');
const VALID_FROM = '2026-10-01T00:00:00Z';
const PREMIUM = itemId('tarjeta_premium');

async function approveOk(c: PoolClient, id: string, resolution: unknown) {
  const r = await approveCandidate(c, id, { reviewer: 'owner@test', resolution });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r;
}

async function publishOk(c: PoolClient, id: string) {
  const r = await publishCandidate(c, id, { publisher: 'owner@test' });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r;
}

/** caras option: map each source value (label 1/2) to the existing value code. */
function carasResolution(proposal: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const values = Object.fromEntries(
    (proposal.values as { recordKey: string; label: string }[]).map((v) => [
      v.recordKey,
      { mode: 'EXISTING', code: v.label },
    ]),
  );
  return {
    definition: { mode: 'EXISTING', key: 'caras' },
    isRequired: true,
    selectionMode: 'SINGLE',
    isDistributable: false,
    values,
    ...extra,
  };
}

async function seededPremiumDefinition(c: PoolClient, sides: '1' | '2') {
  return (
    await c.query(
      `select d.id from price_definition d
         join price_condition pc on pc.price_definition_id = d.id
         join option_value v on v.id = pc.option_value_id
        where d.item_id = $1 and v.code = $2 and d.status = 'AUTHORIZED'`,
      [PREMIUM, sides],
    )
  ).rows[0].id as string;
}

describe('approval', () => {
  it('requires a reviewer and a resolution for every unknown field', async () => {
    await withRollback(async (c) => {
      const r = await stageAndValidate(c, loadFixtureEnvelopeJson('premium-business-card'));
      const item = await candidate(c, r.batchId, 'CATALOG_ITEM:MIG1-O-009');
      const missing = await approveCandidate(c, item.id, {
        reviewer: 'owner@test',
        resolution: {},
      });
      expect(missing.ok).toBe(false);
      if (!missing.ok)
        expect(missing.errors.map((e) => e.field).sort()).toEqual(['decorationPolicy', 'status']);
      expect((await approveCandidate(c, item.id, { reviewer: ' ', resolution: {} })).ok).toBe(
        false,
      );
      const invalid = await approveCandidate(c, item.id, {
        reviewer: 'x',
        resolution: { status: 'LIVE' },
      });
      expect(invalid.ok).toBe(false);
      const ok = await approveOk(c, item.id, {
        status: 'ACTIVE',
        decorationPolicy: 'NONE',
        target: { mode: 'LINK_EXISTING', entityId: PREMIUM },
      });
      expect(ok.approvalSha256).toMatch(/^[0-9a-f]{64}$/);
      await expectDbError(
        c,
        "update import_candidate set approved_by = 'someone else' where id = $1",
        [item.id],
        /re-approved/,
      );
    });
  });

  it('there is no automatic approval or publication: staging leaves every candidate unapproved', async () => {
    await withRollback(async (c) => {
      const r = await stageAndValidate(c, loadFixtureEnvelopeJson('x-banner'));
      expect(
        await scalar(
          c,
          "select count(*)::int n from import_candidate where batch_id = $1 and review_status in ('APPROVED','PUBLISHED')",
          [r.batchId],
        ),
      ).toBe(0);
    });
  });
});

describe('controlled publication', () => {
  it('REAL batches cannot write to the domain in STEP 05B', async () => {
    await withRollback(async (c) => {
      const r = await stageAndValidate(c, asReal(loadFixtureEnvelopeJson('premium-business-card')));
      const item = await candidate(c, r.batchId, 'CATALOG_ITEM:MIG1-O-009');
      await approveOk(c, item.id, {
        status: 'ACTIVE',
        decorationPolicy: 'NONE',
        target: { mode: 'LINK_EXISTING', entityId: PREMIUM },
      });
      const res = await publishCandidate(c, item.id, { publisher: 'owner@test' });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.errors.map((e) => e.code)).toEqual(['NOT_PUBLISHABLE_IN_THIS_STEP']);
      expect(
        await scalar(
          c,
          'select count(*)::int n from import_candidate_link where candidate_id = $1',
          [item.id],
        ),
      ).toBe(0);
      // …but the adapter can still preview it (dry run, no writes).
      expect((await previewCandidate(c, item.id)).ok).toBe(true);
    });
  });

  it('real v1.2 fixture reconciles with the seeded slice: item, option and both matrices link to existing rows', async () => {
    await withRollback(async (c) => {
      const domain = await scalar(
        c,
        'select (select count(*) from catalog_item) + (select count(*) from price_definition) as n',
      );
      const r = await stageAndValidate(c, loadFixtureEnvelopeJson('premium-business-card'));
      const item = await candidate(c, r.batchId, 'CATALOG_ITEM:MIG1-O-009');
      await approveOk(c, item.id, {
        status: 'ACTIVE',
        decorationPolicy: 'NONE',
        target: { mode: 'LINK_EXISTING', entityId: PREMIUM },
      });
      const pi = await publishOk(c, item.id);
      expect(pi.links).toEqual([
        {
          role: 'catalog_item',
          entityType: 'catalog_item',
          entityId: PREMIUM,
          linkKind: 'LINKED_EXISTING',
        },
      ]);
      expect(pi.publicCode).toBeNull();

      const [option] = await candidatesOf(c, r.batchId, 'OPTION');
      await approveOk(c, option!.id, carasResolution(option!.proposal));
      const po = await publishOk(c, option!.id);
      expect(po.links.every((l) => l.linkKind === 'LINKED_EXISTING')).toBe(true);

      for (const p of await candidatesOf(c, r.batchId, 'PRICE')) {
        const sides = (p.proposal.conditions as { value: '1' | '2' }[])[0]!.value;
        // Without an explicit target the adapter refuses to create a duplicate definition.
        const dup = await previewCandidate(c, p.id, { validFrom: VALID_FROM });
        expect(!dup.ok && dup.errors.map((e) => e.code)).toEqual(['PRICE_DEFINITION_EXISTS']);
        const target = await seededPremiumDefinition(c, sides);
        await approveOk(c, p.id, {
          validFrom: VALID_FROM,
          target: { mode: 'LINK_EXISTING', entityId: target },
        });
        const pp = await publishOk(c, p.id);
        expect(pp.links).toEqual([
          {
            role: 'price_definition',
            entityType: 'price_definition',
            entityId: target,
            linkKind: 'LINKED_EXISTING',
          },
        ]);
      }
      expect(
        await scalar(
          c,
          'select (select count(*) from catalog_item) + (select count(*) from price_definition) as n',
        ),
      ).toBe(domain);
    });
  });

  it('magnets: the FIXED price reconciles only with an explicit max quantity (P1-03, no extrapolation)', async () => {
    await withRollback(async (c) => {
      const r = await stageAndValidate(c, loadFixtureEnvelopeJson('magnets'));
      const magnets = itemId('imanes_par');
      const item = await candidate(c, r.batchId, 'CATALOG_ITEM:MIGF-O-015');
      await approveOk(c, item.id, {
        status: 'ACTIVE',
        decorationPolicy: 'NONE',
        target: { mode: 'LINK_EXISTING', entityId: magnets },
      });
      await publishOk(c, item.id);
      const [price] = await candidatesOf(c, r.batchId, 'PRICE');
      expect(price!.unresolved_fields).toEqual(['validFrom', 'maxQuantity']);
      const seeded = (
        await c.query("select id from price_definition where item_id = $1 and model = 'FIXED'", [
          magnets,
        ])
      ).rows[0].id;
      const wrong = await previewCandidate(c, price!.id, {
        validFrom: VALID_FROM,
        maxQuantity: 2,
        target: { mode: 'LINK_EXISTING', entityId: seeded },
      });
      expect(!wrong.ok && wrong.errors.map((e) => e.code)).toEqual([
        'PRICE_MISMATCH_WITH_EXISTING',
      ]);
      await approveOk(c, price!.id, {
        validFrom: VALID_FROM,
        maxQuantity: 1,
        target: { mode: 'LINK_EXISTING', entityId: seeded },
      });
      const res = await publishOk(c, price!.id);
      expect(res.links[0]).toMatchObject({ entityId: seeded, linkKind: 'LINKED_EXISTING' });
      expect(res.notes.join(' ')).toContain('fixed attribute');
    });
  });

  it('a controlled TEST fixture creates new rows; the public code is assigned only at publication; prices stay DRAFT', async () => {
    await withRollback(async (c) => {
      const json = syntheticFixture('premium-business-card', { 'MIG1-O-009': 'FIXTURE-O-009' });
      const r = await stageAndValidate(c, json);
      const item = await candidate(c, r.batchId, 'CATALOG_ITEM:FIXTURE-O-009');
      expect(JSON.stringify(item.proposal)).not.toMatch(/DTG-\d{5}/);
      await approveOk(c, item.id, { status: 'CANDIDATE', decorationPolicy: 'NONE' });
      const pi = await publishOk(c, item.id);
      expect(pi.publicCode).toMatch(/^DTG-\d{5}$/);
      expect(Number(pi.publicCode!.slice(4))).toBeGreaterThan(16);
      const newId = pi.links[0]!.entityId;
      const legacy = (
        await c.query(
          "select source_locator from source_reference where entity_id = $1 and source_kind = 'LEGACY_ID'",
          [newId],
        )
      ).rows;
      expect(legacy).toEqual([{ source_locator: 'FIXTURE-O-009' }]);

      const [option] = await candidatesOf(c, r.batchId, 'OPTION');
      // The price cannot be published before its option (condition mapping).
      const prices = await candidatesOf(c, r.batchId, 'PRICE');
      await approveOk(c, prices[0]!.id, { validFrom: VALID_FROM });
      const early = await publishCandidate(c, prices[0]!.id, { publisher: 'owner@test' });
      expect(!early.ok && early.errors.map((e) => e.code)).toEqual(['CONDITION_UNMAPPED']);
      expect(
        await scalar(
          c,
          "select count(*)::int n from import_issue where candidate_id = $1 and origin = 'ADAPTER'",
          [prices[0]!.id],
        ),
      ).toBe(1);

      await approveOk(c, option!.id, carasResolution(option!.proposal));
      expect(
        (await publishOk(c, option!.id)).links.find((l) => l.role === 'item_option')?.linkKind,
      ).toBe('CREATED');

      const before = await loadCatalogSnapshot(c);
      for (const [i, p] of prices.entries()) {
        if (i > 0) await approveOk(c, p.id, { validFrom: VALID_FROM });
        const pp = await publishOk(c, p.id);
        expect(pp.links[0]!.linkKind).toBe('CREATED');
        expect(pp.notes.join(' ')).toContain('DRAFT');
      }
      const drafts = (
        await c.query(
          'select status, count(*)::int n from price_definition where item_id = $1 group by 1',
          [newId],
        )
      ).rows;
      expect(drafts).toEqual([{ status: 'DRAFT', n: 2 }]);
      expect(
        await scalar(
          c,
          'select count(*)::int n from price_break b join price_definition d on d.id = b.price_definition_id where d.item_id = $1',
          [newId],
        ),
      ).toBe(20);
      // DRAFT never reaches pricing: the snapshot is unchanged and the item is not priceable.
      const after = await loadCatalogSnapshot(c);
      expect(after.priceDefinitions.length).toBe(before.priceDefinitions.length);
      const result = resolvePrice(
        {
          catalogItemId: newId,
          market: 'USA',
          quantity: 500,
          selections: [{ optionKey: 'caras', valueCodes: ['2'] }],
        },
        after,
        AS_OF,
      );
      expect(result.status).not.toBe('RESOLVED');

      // Published is terminal: publishing again is refused.
      const again = await publishCandidate(c, item.id, { publisher: 'owner@test' });
      expect(!again.ok && again.errors.map((e) => e.code)).toEqual(['NOT_APPROVED']);
    });
  });

  it('reimport after publication never duplicates: CREATE is refused, LINK_EXISTING reconciles', async () => {
    await withRollback(async (c) => {
      const v1 = syntheticFixture('dtf-transfer', { 'MIG1-O-015': 'FIXTURE-O-015' });
      const a = await stageAndValidate(c, v1);
      const itemA = await candidate(c, a.batchId, 'CATALOG_ITEM:FIXTURE-O-015');
      await approveOk(c, itemA.id, { status: 'CANDIDATE', decorationPolicy: 'NONE' });
      const created = (await publishOk(c, itemA.id)).links[0]!.entityId;

      const b = await stageAndValidate(c, asNewVersion(v1, 'd'.repeat(64)));
      expect(b.previousBatchId).toBe(a.batchId);
      const itemB = await candidate(c, b.batchId, 'CATALOG_ITEM:FIXTURE-O-015');
      expect(itemB.lineage_status).toBe('UNCHANGED');
      expect(itemB.previous_candidate_id).toBe(itemA.id);
      // Approval of A does not carry over to B.
      expect(itemB.review_status).toBe('WARNING');
      await approveOk(c, itemB.id, {
        status: 'CANDIDATE',
        decorationPolicy: 'NONE',
        target: { mode: 'CREATE' },
      });
      const dup = await publishCandidate(c, itemB.id, { publisher: 'owner@test' });
      expect(!dup.ok && dup.errors.map((e) => e.code)).toEqual(['LINEAGE_EXISTS']);
      await rejectCandidate(c, itemB.id, {
        reviewer: 'owner@test',
        reason: 'duplicate of published item',
      });
      expect(
        await scalar(
          c,
          "select count(*)::int n from source_reference where source_kind = 'LEGACY_ID' and source_locator = 'FIXTURE-O-015'",
        ),
      ).toBe(1);

      const c2 = await stageAndValidate(c, asNewVersion(v1, 'c'.repeat(64)));
      const itemC = await candidate(c, c2.batchId, 'CATALOG_ITEM:FIXTURE-O-015');
      await approveOk(c, itemC.id, {
        status: 'CANDIDATE',
        decorationPolicy: 'NONE',
        target: { mode: 'LINK_EXISTING', entityId: created },
      });
      expect((await publishOk(c, itemC.id)).links[0]).toMatchObject({
        entityId: created,
        linkKind: 'LINKED_EXISTING',
      });
      expect(
        await scalar(
          c,
          "select count(*)::int n from catalog_item where canonical_name = 'DTF Transfer' or id = $1",
          [created],
        ),
      ).toBeGreaterThanOrEqual(1);
      expect((await traceEntity(c, 'catalog_item', created)).map((t) => t.batch.id)).toEqual([
        a.batchId,
        c2.batchId,
      ]);
    });
  });

  it('decoration: Blank/Personalizada → OPTIONAL policy; capability needs a confirmed method', async () => {
    await withRollback(async (c) => {
      const r = await stageAndValidate(
        c,
        syntheticFixture('cotton-t-shirt', { 'MIG1-O-004': 'FIXTURE-O-004' }),
      );
      const item = await candidate(c, r.batchId, 'CATALOG_ITEM:FIXTURE-O-004');
      await approveOk(c, item.id, { status: 'CANDIDATE', decorationPolicy: 'NONE' });
      const id = (await publishOk(c, item.id)).links[0]!.entityId;
      const decorations = await candidatesOf(c, r.batchId, 'DECORATION');
      const policy = decorations.find((d) => d.proposal.subtype === 'POLICY')!;
      const dtf = decorations.find(
        (d) =>
          d.proposal.subtype === 'METHOD_ASSOCIATION' && d.proposal.suggestedMethodKey === 'DTF',
      )!;
      await approveOk(c, dtf.id, { methodKey: 'DTF' });
      const early = await publishCandidate(c, dtf.id, { publisher: 'owner@test' });
      expect(!early.ok && early.errors.map((e) => e.code)).toEqual(['DECORATION_POLICY_NONE']);
      await approveOk(c, policy.id, {});
      await publishOk(c, policy.id);
      expect(
        (await c.query('select decoration_policy from catalog_item where id = $1', [id])).rows[0]
          .decoration_policy,
      ).toBe('OPTIONAL');
      await publishOk(c, dtf.id);
      const caps = (
        await c.query(
          'select m.key from decoration_capability dc join decoration_method m on m.id = dc.method_id where dc.item_id = $1',
          [id],
        )
      ).rows;
      expect(caps).toEqual([{ key: 'DTF' }]);
      // No "Blank"/"Personalizada" option was created.
      expect(
        await scalar(
          c,
          "select count(*)::int n from option_value where lower(code) in ('blank','personalizada')",
        ),
      ).toBe(0);
    });
  });

  it('composition + historical evidence: X-Banner complete → stand + graphic; historical prices stay evidence', async () => {
    await withRollback(async (c) => {
      const map = {
        'MIG1-O-003': 'FIXTURE-O-003',
        'MIG1-O-021': 'FIXTURE-O-021',
        'OWN-O-003': 'FIXTURE-OWN-O-003',
      };
      const r = await stageAndValidate(c, syntheticFixture('x-banner', map));
      const ids: Record<string, string> = {};
      for (const legacy of Object.values(map)) {
        const cand = await candidate(c, r.batchId, `CATALOG_ITEM:${legacy}`);
        const resolution: Record<string, unknown> = {
          status: 'CANDIDATE',
          decorationPolicy: 'NONE',
        };
        if (cand.proposal.itemType === null) resolution.itemType = 'PRODUCT';
        await approveOk(c, cand.id, resolution);
        ids[legacy] = (await publishOk(c, cand.id)).links[0]!.entityId;
      }
      const parent = ids['FIXTURE-O-003']!;
      const hist = (
        await c.query(
          "select source_locator, payload from source_reference where entity_id = $1 and source_kind = 'HISTORICAL_PRICE_EVIDENCE' order by 1",
          [parent],
        )
      ).rows;
      expect(hist).toHaveLength(3);
      expect(
        await scalar(c, 'select count(*)::int n from price_definition where item_id = $1', [
          parent,
        ]),
      ).toBe(0);

      for (const comp of await candidatesOf(c, r.batchId, 'COMPOSITION')) {
        await approveOk(c, comp.id, {});
        await publishOk(c, comp.id);
      }
      const lines = (
        await c.query(
          'select child_item_id, quantity, role from composition_line where parent_item_id = $1 order by child_item_id',
          [parent],
        )
      ).rows;
      expect(lines.map((l) => [l.quantity, l.role])).toEqual([
        [1, 'INCLUDED'],
        [1, 'INCLUDED'],
      ]);
      expect(new Set(lines.map((l) => l.child_item_id))).toEqual(
        new Set([ids['FIXTURE-O-021'], ids['FIXTURE-OWN-O-003']]),
      );
    });
  });

  it('two-layer provenance works in both directions (Excel cell ↔ domain entity)', async () => {
    await withRollback(async (c) => {
      const r = await stageAndValidate(c, loadFixtureEnvelopeJson('premium-business-card'));
      const item = await candidate(c, r.batchId, 'CATALOG_ITEM:MIG1-O-009');
      await approveOk(c, item.id, {
        status: 'ACTIVE',
        decorationPolicy: 'NONE',
        target: { mode: 'LINK_EXISTING', entityId: PREMIUM },
      });
      await publishOk(c, item.id);
      const [option] = await candidatesOf(c, r.batchId, 'OPTION');
      await approveOk(c, option!.id, carasResolution(option!.proposal));
      await publishOk(c, option!.id);
      const price = (await candidatesOf(c, r.batchId, 'PRICE')).find(
        (p) => (p.proposal.conditions as { value: string }[])[0]!.value === '2',
      )!;
      const def = await seededPremiumDefinition(c, '2');
      await approveOk(c, price.id, {
        validFrom: VALID_FROM,
        target: { mode: 'LINK_EXISTING', entityId: def },
      });
      await publishOk(c, price.id);

      // Domain → Excel: price definition → candidate → PRECIOS rows → cell holding 120.
      const [trace] = await traceEntity(c, 'price_definition', def);
      expect(trace!.candidateId).toBe(price.id);
      expect(trace!.batch).toMatchObject({
        sourceFile: 'Design_To_Go_Catalog_v1.2_RC_MANGO_TANGO.xlsx',
        parserVersion: '0.1.0',
      });
      const observations = trace!.records.filter((x) => x.role === 'OBSERVATION');
      expect(observations).toHaveLength(10);
      const cells = observations.flatMap((o) => o.cells);
      expect(cells.some((cell) => cell.source_sheet === 'PRECIOS' && cell.raw_value === 120)).toBe(
        true,
      );
      for (const cell of cells) expect(cell.workbook_sha256).toMatch(/^[0-9a-f]{64}$/);

      // Excel → domain: candidate → link → entity; and the domain keeps EXCEL_ROW references back.
      const forward = await traceCandidate(c, price.id);
      expect(forward!.links).toEqual([
        {
          role: 'price_definition',
          entityType: 'price_definition',
          entityId: def,
          linkKind: 'LINKED_EXISTING',
        },
      ]);
      const refs = (
        await c.query(
          "select payload from source_reference where entity_id = $1 and source_kind = 'EXCEL_ROW' and payload ? 'importCandidateId'",
          [def],
        )
      ).rows;
      expect(refs).toHaveLength(10);
      expect(refs.every((x) => x.payload.importCandidateId === price.id)).toBe(true);
    });
  });

  it('status of a candidate cannot be forced: PUBLISHED needs a domain link, terminal states are final', async () => {
    await withRollback(async (c) => {
      const r = await stageAndValidate(c, loadFixtureEnvelopeJson('dtf-transfer'));
      const item = await candidate(c, r.batchId, 'CATALOG_ITEM:MIG1-O-015');
      await expectDbError(
        c,
        "insert into import_candidate_link (candidate_id, role, entity_type, entity_id, link_kind) values ($1, 'catalog_item', 'catalog_item', $2, 'CREATED')",
        [item.id, itemId('dtf_transfer')],
        /APPROVED candidate/,
      );
      await approveOk(c, item.id, {
        status: 'CANDIDATE',
        decorationPolicy: 'NONE',
        target: { mode: 'LINK_EXISTING', entityId: itemId('dtf_transfer') },
      });
      await expectDbError(
        c,
        "update import_candidate set review_status = 'PUBLISHED', published_by = 'x', published_at = now() where id = $1",
        [item.id],
        /without a domain link/,
      );
      await rejectCandidate(c, item.id, { reviewer: 'owner@test', reason: 'test' });
      await expectDbError(
        c,
        "update import_candidate set review_status = 'WARNING' where id = $1",
        [item.id],
        /terminal/,
      );
    });
  });
});
