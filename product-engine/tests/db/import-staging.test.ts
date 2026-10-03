import { afterAll, describe, expect, it } from 'vitest';
import { loadCatalogSnapshot } from '@/db/catalog-snapshot';
import { approveCandidate } from '@/db/import/review';
import { StagingError, stageEnvelope } from '@/db/import/staging';
import { loadFixtureEnvelopeJson } from '../fixtures/import-envelopes';
import { expectDbError, pool, withRollback } from './helpers';
import {
  asNewVersion,
  candidate,
  candidatesOf,
  parse,
  replaceValues,
  scalar,
  stageAndValidate,
} from './import-helpers';

afterAll(() => pool.end());

const DOMAIN_COUNTS = `select
  (select count(*) from catalog_item) + (select count(*) from price_definition) * 1000
  + (select count(*) from source_reference) * 1000000 + (select count(*) from option_value) * 1000000000 as n`;

describe('persistent staging', () => {
  it('persists the import run: file, hash, parser version, counts, issues and status', async () => {
    await withRollback(async (c) => {
      const json = loadFixtureEnvelopeJson('premium-business-card');
      const env = parse(json);
      const r = await stageAndValidate(c, json);
      expect(r.status).toBe('STAGED');
      const b = (await c.query('select * from import_batch where id = $1', [r.batchId])).rows[0];
      expect(b).toMatchObject({
        source_file: 'Design_To_Go_Catalog_v1.2_RC_MANGO_TANGO.xlsx',
        source_sha256: env.import_batch.source_sha256,
        parser_name: 'dtg-step05a-parser',
        parser_version: '0.1.0',
        contract_version: '1.0.0',
        data_class: 'FIXTURE',
        record_count: env.records.length,
        candidate_count: r.candidates,
        status: 'VALIDATED',
        attempt: 1,
      });
      expect(
        await scalar(c, 'select count(*)::int n from import_record where batch_id = $1', [
          r.batchId,
        ]),
      ).toBe(env.records.length);
      expect(
        await scalar(c, 'select count(*)::int n from import_issue where batch_id = $1', [
          r.batchId,
        ]),
      ).toBe(r.issues);
      expect(b.warning_count + b.error_count + b.info_count).toBe(r.issues);
    });
  });

  it('never writes domain tables (staging ≠ domain)', async () => {
    await withRollback(async (c) => {
      const before = await scalar(c, DOMAIN_COUNTS);
      const revisions = (await c.query('select * from v_revisions')).rows[0];
      await stageAndValidate(c, loadFixtureEnvelopeJson('x-banner'));
      await stageAndValidate(c, loadFixtureEnvelopeJson('premium-business-card'));
      expect(await scalar(c, DOMAIN_COUNTS)).toBe(before);
      expect((await c.query('select * from v_revisions')).rows[0]).toEqual(revisions);
    });
  });

  it('keeps raw and normalized values and every cell of each record', async () => {
    await withRollback(async (c) => {
      const json = loadFixtureEnvelopeJson('magnets');
      const env = parse(json);
      const r = await stageAndValidate(c, json);
      for (const rec of env.records) {
        const row = (
          await c.query('select * from import_record where batch_id = $1 and record_key = $2', [
            r.batchId,
            rec.record_id,
          ])
        ).rows[0];
        expect(row.raw_payload).toEqual(rec.raw_payload);
        expect(row.normalized_payload).toEqual(rec.normalized_payload);
        expect(row.source_cells).toEqual(rec.source);
      }
    });
  });

  it('same workbook hash + parser version is detected and not staged twice', async () => {
    await withRollback(async (c) => {
      const json = loadFixtureEnvelopeJson('premium-business-card');
      const first = await stageAndValidate(c, json);
      const rows = await scalar(c, 'select count(*)::int n from import_record');
      const again = await stageEnvelope(c, parse(json));
      expect(again).toMatchObject({ status: 'ALREADY_STAGED', batchId: first.batchId, attempt: 1 });
      expect(await scalar(c, 'select count(*)::int n from import_record')).toBe(rows);
      expect(
        await scalar(c, 'select count(*)::int n from import_batch where source_sha256 = $1', [
          parse(json).import_batch.source_sha256,
        ]),
      ).toBe(1);
    });
  });

  it('an explicit re-run is a new attempt linked to the first one', async () => {
    await withRollback(async (c) => {
      const json = loadFixtureEnvelopeJson('dtf-transfer');
      const first = await stageAndValidate(c, json);
      const rerun = await stageEnvelope(c, parse(json), { rerun: true });
      expect(rerun).toMatchObject({
        status: 'STAGED',
        attempt: 2,
        rerunOfBatchId: first.batchId,
        previousBatchId: first.batchId,
      });
      expect(rerun.lineage).toEqual({ NEW: 0, UNCHANGED: first.candidates, CHANGED: 0 });
    });
  });

  it('a changed envelope with the same identity is refused (no silent overwrite)', async () => {
    await withRollback(async (c) => {
      const json = loadFixtureEnvelopeJson('dtf-transfer') as {
        records: { normalized_payload: Record<string, unknown> }[];
      };
      await stageAndValidate(c, json);
      json.records[0]!.normalized_payload.Notas = 'edited';
      await expect(stageEnvelope(c, parse(json))).rejects.toThrow(StagingError);
    });
  });

  it('reimport v1 → batch A, v2 → batch B: B follows A by lineage and A is kept intact', async () => {
    await withRollback(async (c) => {
      const v1 = loadFixtureEnvelopeJson('premium-business-card');
      const a = await stageAndValidate(c, v1);
      const aCandidates = await scalar(
        c,
        'select count(*)::int n from import_candidate where batch_id = $1',
        [a.batchId],
      );
      // v2: new workbook bytes and one price changed at the source (500 × 2 sides: 120 → 125).
      const v2 = asNewVersion(v1, 'e'.repeat(64)) as {
        candidates: {
          kind: string;
          data: {
            money: { amount: string };
            quantity_from: { value?: number };
            conditions: { Valor: unknown }[];
          };
        }[];
      };
      const target = v2.candidates.find(
        (x) =>
          x.kind === 'price' &&
          x.data.quantity_from.value === 500 &&
          String(x.data.conditions[0]?.Valor) === '2',
      )!;
      target.data.money.amount = '125';
      const b = await stageAndValidate(c, v2);
      expect(b.batchId).not.toBe(a.batchId);
      expect(b.previousBatchId).toBe(a.batchId);
      expect(b.lineage).toEqual({ NEW: 0, UNCHANGED: b.candidates - 1, CHANGED: 1 });
      const changed = (
        await c.query(
          "select lineage_key from import_candidate where batch_id = $1 and lineage_status = 'CHANGED'",
          [b.batchId],
        )
      ).rows;
      expect(changed[0].lineage_key).toMatch(
        /^PRICE:MIG1-O-009\|USD\|EXACT_QUANTITY_MATRIX\|Por paquete\|MIG1-OP-00\d=2$/,
      );
      expect(
        await scalar(c, 'select count(*)::int n from import_candidate where batch_id = $1', [
          a.batchId,
        ]),
      ).toBe(aCandidates);
      await expectDbError(
        c,
        'delete from import_batch where id = $1',
        [a.batchId],
        /cannot be deleted/,
      );
    });
  });

  it('unknown status, unknown kind and required null stay unresolved (never CANDIDATE/false)', async () => {
    await withRollback(async (c) => {
      const json = replaceValues(loadFixtureEnvelopeJson('yard-sign'), {}) as {
        candidates: { kind: string; data: Record<string, unknown> }[];
      };
      const item = json.candidates.find((x) => x.kind === 'catalog_item')!;
      item.data.item_type_hypothesis = null;
      item.data.catalog_status_hypothesis = null;
      const r = await stageAndValidate(c, json);
      const row = await candidate(c, r.batchId, 'CATALOG_ITEM:MIG1-O-020');
      expect(row.proposal.status).toBeNull();
      expect(row.proposal.itemType).toBeNull();
      expect(row.unresolved_fields).toEqual(['itemType', 'status', 'decorationPolicy']);
      expect(row.review_status).toBe('WARNING');

      const cotton = await stageAndValidate(c, loadFixtureEnvelopeJson('cotton-t-shirt'));
      for (const o of await candidatesOf(c, cotton.batchId, 'OPTION')) {
        expect(o.proposal.required).toBeNull();
        expect(o.unresolved_fields).toContain('isRequired');
      }
    });
  });

  it('current prices stay in staging (no price definition, no resolvable price) until approval', async () => {
    await withRollback(async (c) => {
      const before = await loadCatalogSnapshot(c);
      const r = await stageAndValidate(c, loadFixtureEnvelopeJson('premium-business-card'));
      const prices = await candidatesOf(c, r.batchId, 'PRICE');
      expect(prices).toHaveLength(2);
      expect(prices.every((p) => p.review_status === 'WARNING')).toBe(true);
      const after = await loadCatalogSnapshot(c);
      expect(after.priceDefinitions.length).toBe(before.priceDefinitions.length);
    });
  });

  it('a BLOCKED candidate can be approved neither by the service nor by SQL', async () => {
    await withRollback(async (c) => {
      const json = loadFixtureEnvelopeJson('premium-business-card') as {
        candidates: { kind: string; data: { classification: string } }[];
      };
      for (const x of json.candidates)
        if (x.kind === 'price') x.data.classification = 'UNKNOWN_REVIEW_REQUIRED';
      const r = await stageAndValidate(c, json);
      const [p] = await candidatesOf(c, r.batchId, 'PRICE');
      expect(p!.review_status).toBe('BLOCKED');
      expect(p!.blocking_reasons).toEqual([
        'PRICE_MODEL_NOT_SUPPORTED',
        'PRICE_NOT_AUTHORIZED_IN_SOURCE',
      ]);
      const res = await approveCandidate(c, p!.id, {
        reviewer: 'test',
        resolution: { validFrom: '2026-10-01T00:00:00Z' },
      });
      expect(res.ok).toBe(false);
      await expectDbError(
        c,
        "update import_candidate set review_status = 'APPROVED', approved_by = 'x', approved_at = now(), approval_sha256 = 'x', blocking_reasons = '{}' where id = $1",
        [p!.id],
        /BLOCKED → APPROVED is not allowed/,
      );
    });
  });

  it('historical price evidence and TEST rows can never feed candidates (database guards)', async () => {
    await withRollback(async (c) => {
      const r = await stageAndValidate(c, loadFixtureEnvelopeJson('x-banner'));
      const historical = (
        await c.query(
          "select id from import_record where batch_id = $1 and evidence_class = 'HISTORICAL_PRICE'",
          [r.batchId],
        )
      ).rows;
      expect(historical).toHaveLength(3);
      const fake = (
        await c.query(
          `insert into import_candidate (batch_id, candidate_key, kind, lineage_key, parser_candidate_keys, proposal, payload_sha256, parser_validation_state)
           values ($1, 'aaaaaaaaaaaaaaaaaaaaaaaa', 'PRICE', 'PRICE:fake', '{x}', '{}', $2, 'VALID') returning id`,
          [r.batchId, 'a'.repeat(64)],
        )
      ).rows[0].id;
      await expectDbError(
        c,
        "insert into import_candidate_source (candidate_id, batch_id, record_id, role, ordinal) values ($1, $2, $3, 'OBSERVATION', 0)",
        [fake, r.batchId, historical[0].id],
        /historical price evidence/,
      );
      const synthetic = (
        await c.query(
          `insert into import_record (batch_id, record_key, record_type, legacy_id, synthetic, raw_payload, normalized_payload, source_cells)
           select batch_id, 'bbbbbbbbbbbbbbbbbbbbbbbb', 'OFERTAS', 'TEST-O-1', true, raw_payload, normalized_payload, source_cells
             from import_record where id = $1 returning id`,
          [historical[0].id],
        )
      ).rows[0].id;
      await expectDbError(
        c,
        "insert into import_candidate_source (candidate_id, batch_id, record_id, role, ordinal) values ($1, $2, $3, 'PRIMARY', 1)",
        [fake, r.batchId, synthetic],
        /synthetic TEST record/,
      );
    });
  });

  it('import history is append-only: evidence and proposals cannot be edited or deleted', async () => {
    await withRollback(async (c) => {
      const r = await stageAndValidate(c, loadFixtureEnvelopeJson('dtf-transfer'));
      const rec = (
        await c.query('select id from import_record where batch_id = $1 limit 1', [r.batchId])
      ).rows[0].id;
      const cand = (
        await c.query('select id from import_candidate where batch_id = $1 limit 1', [r.batchId])
      ).rows[0].id;
      await expectDbError(
        c,
        "update import_record set raw_payload = '{}' where id = $1",
        [rec],
        /immutable import evidence/,
      );
      await expectDbError(c, 'delete from import_record where id = $1', [rec], /cannot be deleted/);
      await expectDbError(
        c,
        "update import_candidate set proposal = '{}' where id = $1",
        [cand],
        /immutable/,
      );
      await expectDbError(
        c,
        'update import_batch set source_sha256 = $2 where id = $1',
        [r.batchId, 'c'.repeat(64)],
        /immutable/,
      );
    });
  });

  it('review status is a vocabulary of its own, disjoint from CatalogStatus', async () => {
    const enums = async (t: string) =>
      (await pool.query(`select unnest(enum_range(null::${t}))::text as v`)).rows.map(
        (r) => r.v as string,
      );
    const review = await enums('import_review_status');
    const catalog = await enums('catalog_status');
    expect(review).toEqual([
      'PENDING',
      'VALID',
      'WARNING',
      'BLOCKED',
      'APPROVED',
      'REJECTED',
      'PUBLISHED',
    ]);
    expect(review.filter((v) => catalog.includes(v))).toEqual([]);
    expect(await enums('import_candidate_kind')).toEqual([
      'CATALOG_ITEM',
      'PRICE',
      'OPTION',
      'DECORATION',
      'COMPOSITION',
      'PRESENTATION',
    ]);
  });
});
