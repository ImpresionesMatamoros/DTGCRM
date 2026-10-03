import { afterAll, describe, expect, it } from 'vitest';
import { recordDecisionAnswer } from '@/db/admin/decision-answers';
import { currentDispositions, recordDisposition } from '@/db/migration/disposition';
import { loadCatalogSnapshot } from '@/db/catalog-snapshot';
import { resolvePrice } from '@/pricing/resolve';
import { expectDbError, pool, withRollback } from './helpers';

afterAll(() => pool.end());

const D018 = {
  decisionId: 'D-018',
  summary:
    'test: invitaciones canónicas Sencilla / Premium; el resto alias, configuración, estilo o legacy',
  covers: ['MIGF-O-008', 'MIGF-O-009', 'MIGF-O-010', 'MIGF-O-012', 'MIGF-O-014'],
};
const ALIAS = {
  itemLegacyId: 'MIGF-O-010',
  disposition: 'ALIAS' as const,
  canonicalLegacyIds: ['MIGF-O-008', 'MIGF-O-009'],
  detail: 'Invitación para evento: etiqueta genérica',
  decisionId: 'D-018',
  reason: 'test',
};

describe('candidate_disposition (0018)', () => {
  it('stores what a non-product row is and points at its canonical row; it is append-only and audited', async () => {
    await withRollback(async (c) => {
      expect((await recordDecisionAnswer(c, D018, 'martin')).ok).toBe(true);
      const r = await recordDisposition(c, ALIAS, 'martin');
      expect(r.ok && r.created).toBe(true);
      expect((await currentDispositions(c)).map((d) => d.itemLegacyId)).toEqual(['MIGF-O-010']);
      const id = r.ok ? r.disposition.id : '';
      await expectDbError(
        c,
        'update candidate_disposition set detail = $1 where id = $2',
        ['x', id],
        /immutable import evidence|import history and cannot be deleted/,
      );
      await expectDbError(
        c,
        'delete from candidate_disposition where id = $1',
        [id],
        /immutable import evidence|import history and cannot be deleted/,
      );
      const audit = (
        await c.query(
          `select count(*)::int n from change_event where table_name = 'candidate_disposition' and new_row->>'id' = $1`,
          [id],
        )
      ).rows[0].n as number;
      expect(audit).toBeGreaterThan(0);
    });
  });

  it('the table itself refuses a canonical-less alias and a legacy label with a target', async () => {
    await withRollback(async (c) => {
      const a = await recordDecisionAnswer(c, D018, 'martin');
      const answerId = a.ok ? a.answerId : '';
      const ins = `insert into candidate_disposition (item_legacy_id, disposition, canonical_legacy_ids, detail, decision_id, decision_answer_id, reason, actor)
                   values ($1, $2, $3, 'x', 'D-018', $4, 'x', 'martin')`;
      await expectDbError(
        c,
        ins,
        ['MIGF-O-010', 'ALIAS', [], answerId],
        /violates check constraint/,
      );
      await expectDbError(
        c,
        ins,
        ['MIGF-O-014', 'LEGACY_INVALID', ['MIGF-O-008'], answerId],
        /violates check constraint/,
      );
      await expectDbError(
        c,
        ins,
        ['MIGF-O-014', 'WHATEVER', [], answerId],
        /violates check constraint/,
      );
    });
  });

  it('is idempotent, supersedes a changed disposition, and refuses unanswered decisions, out-of-scope rows, self targets and alias chains', async () => {
    await withRollback(async (c) => {
      const noAnswer = await recordDisposition(c, ALIAS, 'martin');
      expect(!noAnswer.ok && noAnswer.errors[0]!.code).toBe('DECISION_NOT_ANSWERED');
      expect((await recordDecisionAnswer(c, D018, 'martin')).ok).toBe(true);

      const first = await recordDisposition(c, ALIAS, 'martin');
      const again = await recordDisposition(c, ALIAS, 'martin');
      expect(first.ok && first.created).toBe(true);
      expect(again.ok && again.created).toBe(false); // idempotent: no second row
      expect((await c.query('select count(*)::int n from candidate_disposition')).rows[0].n).toBe(
        1,
      );

      const changed = await recordDisposition(
        c,
        {
          ...ALIAS,
          canonicalLegacyIds: ['MIGF-O-009'],
          detail: 'Invitación para evento: sólo Premium',
        },
        'martin',
      );
      expect(changed.ok && changed.created).toBe(true);
      const cur = await currentDispositions(c);
      expect(cur).toHaveLength(1); // the earlier row is kept in history but no longer current
      expect(cur[0]!.canonicalLegacyIds).toEqual(['MIGF-O-009']);
      expect((await c.query('select count(*)::int n from candidate_disposition')).rows[0].n).toBe(
        2,
      );

      const oos = await recordDisposition(c, { ...ALIAS, itemLegacyId: 'MIG1-O-001' }, 'martin');
      expect(!oos.ok && oos.errors[0]!.code).toBe('OUT_OF_SCOPE');
      const self = await recordDisposition(
        c,
        { ...ALIAS, canonicalLegacyIds: ['MIGF-O-010'] },
        'martin',
      );
      expect(!self.ok && self.errors[0]!.code).toBe('SELF_TARGET');
      const chain = await recordDisposition(
        c,
        {
          ...ALIAS,
          itemLegacyId: 'MIGF-O-012',
          disposition: 'CONFIGURATION',
          canonicalLegacyIds: ['MIGF-O-010'],
        },
        'martin',
      );
      expect(!chain.ok && chain.errors[0]!.code).toBe('TARGET_NOT_CANONICAL');
      const legacy = await recordDisposition(
        c,
        {
          ...ALIAS,
          itemLegacyId: 'MIGF-O-014',
          disposition: 'LEGACY_INVALID',
          canonicalLegacyIds: [],
        },
        'martin',
      );
      expect(legacy.ok && legacy.created).toBe(true);
    });
  });
});

describe('CANDIDATE and unpriced ACTIVE items (owner spec 107, 130, 131)', () => {
  const insertItem = async (c: import('pg').PoolClient, name: string, status: string) =>
    (
      await c.query(
        `insert into catalog_item (kind, canonical_name, status, sale_unit) values ('PRODUCT', $1, $2::catalog_status, 'PIECE') returning id, public_code`,
        [name, status],
      )
    ).rows[0] as { id: string; public_code: string };

  it('a CANDIDATE item is in no publication profile; an ACTIVE one is in the internal CRM profile', async () => {
    await withRollback(async (c) => {
      const cand = await insertItem(c, 'Thank-you card (test)', 'CANDIDATE');
      const planned = await insertItem(c, 'Planned (test)', 'PLANNED');
      const active = await insertItem(c, 'Menú (test)', 'ACTIVE');
      const members = async (id: string) =>
        (
          await c.query('select profile_key from v_publication_membership where item_id = $1', [id])
        ).rows.map((r) => r.profile_key as string);
      expect(await members(cand.id)).toEqual([]);
      expect(await members(planned.id)).toEqual([]);
      expect(await members(active.id)).toContain('crm_internal');
      // no profile ever lists a status other than ACTIVE
      const bad = await c.query(
        `select count(*)::int n from publication_profile where allowed_statuses <> array['ACTIVE']::catalog_status[]`,
      );
      expect(bad.rows[0].n).toBe(0);
    });
  });

  it('an ACTIVE item with no authorized price quotes at any quantity (menú qty 1 and 6): no price is invented', async () => {
    await withRollback(async (c) => {
      const menu = await insertItem(c, 'Menús (test)', 'ACTIVE');
      const snap = await loadCatalogSnapshot(c);
      for (const quantity of [1, 6, 100]) {
        const r = resolvePrice(
          { catalogItemId: menu.id, market: 'USA', quantity } as never,
          snap,
          new Date(),
        );
        expect(r.status, `qty ${quantity}`).toBe('QUOTE_ONLY');
        expect('reasonCode' in r && r.reasonCode).toBe('NO_AUTHORIZED_BASE_PRICE');
      }
      const n = (
        await c.query('select count(*)::int n from price_definition where item_id = $1', [menu.id])
      ).rows[0].n;
      expect(n).toBe(0);
    });
  });
});
