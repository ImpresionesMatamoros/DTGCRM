import { afterAll, describe, expect, it } from 'vitest';
import { decisionLinks, decisionSummaries } from '@/db/admin/decisions';
import { commercialPrintReadiness } from '@/db/admin/readiness';
import { decisionById, OWNER_DECISIONS } from '@/decisions/reference';
import { pool, withRollback } from './helpers';

afterAll(() => pool.end());
const NOW = new Date('2026-10-01T12:00:00Z');

const fingerprint = async (c: {
  query: (s: string) => Promise<{ rows: Record<string, unknown>[] }>;
}) =>
  (
    await c.query(
      `select count(*)::int n, md5(string_agg(coalesce(resolution::text,'') || review_status || coalesce(open_fields::text,''), '|' order by id)) h
         from import_candidate`,
    )
  ).rows[0];

describe('decision intelligence (database links)', () => {
  it('links are valid: found + unmatched = affected, found ⊆ affected; all matched when staging is loaded', async () => {
    await withRollback(async (c) => {
      const staged = Number(
        (await c.query("select count(*)::int n from import_candidate where kind = 'CATALOG_ITEM'"))
          .rows[0].n,
      );
      for (const d of OWNER_DECISIONS) {
        const l = await decisionLinks(c, d);
        const affected = new Set(d.affected.map((a) => a.legacyId));
        expect(l.candidates.every((x) => affected.has(x.legacyId))).toBe(true);
        expect(l.candidates.length + l.unmatched.length).toBe(d.affected.length);
        if (staged > 0) expect(l.unmatched).toEqual([]);
      }
    });
  });

  it('computing links and summaries never mutates a candidate (nothing is auto-applied)', async () => {
    await withRollback(async (c) => {
      const before = await fingerprint(c);
      for (const d of OWNER_DECISIONS) await decisionLinks(c, d);
      await decisionSummaries(c);
      expect(await fingerprint(c)).toEqual(before);
    });
  });

  it('pricing decisions open the right context', async () => {
    await withRollback(async (c) => {
      const items = async (id: string) =>
        (await decisionLinks(c, decisionById(id)!)).items.map((i) => i.publicCode);
      expect(await items('D-010')).toEqual(['DTG-00004']); // magnets
      expect(await items('D-011')).toEqual(['DTG-00011']); // yard sign
      expect(await items('D-008')).toEqual(expect.arrayContaining(['DTG-00005', 'DTG-00006'])); // cotton, dry fit
      expect((await items('D-016')).length).toBeGreaterThan(5);
    });
  });
});

describe('Commercial Print pricing readiness', () => {
  it('21 candidates; 4 with current price evidence (131 observations); 14 definitions: 13 matrices + 1 fixed', async () => {
    await withRollback(async (c) => {
      const r = await commercialPrintReadiness(c, NOW);
      expect(r.totals).toMatchObject({
        candidates: 21,
        withCurrentPriceEvidence: 4,
        evidenceObservations: 131,
        withAuthorizedPrice: 4,
        withoutAuthorizedPrice: 17,
        definitionsRepresented: 14,
        matrixDefinitions: 13,
        fixedDefinitions: 1,
        publicationReady: 0,
      });
      const premium = r.items.find((i) => i.legacyId === 'MIG1-O-009')!;
      expect(premium).toMatchObject({
        authorizedDefinitions: 2,
        matrixDefinitions: 2,
        evidenceObservations: 20,
      });
      expect(premium.blockers.join(' ')).toMatch(/D-016/);
      const magnet = r.items.find((i) => i.legacyId === 'MIGF-O-015')!;
      expect(magnet.pricingDecisions).toEqual(expect.arrayContaining(['D-010', 'D-016', 'D-022']));
      const bare = r.items.find((i) => i.authorizedDefinitions === 0)!;
      expect(bare.blockers.join(' ')).toMatch(/sólo bajo petición|No existe como artículo/);
    });
  });
});
