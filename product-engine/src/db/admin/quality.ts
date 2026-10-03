import { decisionById } from '@/decisions/reference';
import { ProposalSchema } from '@/import/proposal';
import { PUBLICATION_ENABLED_FOR } from '@/db/import/publish';
import { inventory, runQuality, summarize, type QualityRun } from '@/quality/engine';
import { computeReadiness, readinessTotals } from '@/quality/readiness';
import type { DuplicateSignal, ItemReadiness, QCandidate, QualityInput } from '@/quality/types';
import type { Queryable } from '../client';

/**
 * Loads a QualityInput from the database and runs the pure engine (src/quality). Read-only: it never
 * writes and never decides. `asOf` is explicit (the caller passes the clock), like the pricing resolver.
 */

type Row = Record<string, unknown>;

type AnswerJson = { assignments?: { legacyIds: string[] }[]; covers?: string[] } | null;

/** A GLOBAL_POLICY answer settles its whole scope; any other only the items it lists (never more). */
export function answerCoverage(decisionId: string, answer: AnswerJson): 'ALL' | string[] {
  if (decisionById(decisionId)?.responseMode === 'GLOBAL_POLICY') return 'ALL';
  return [
    ...new Set([
      ...(answer?.assignments ?? []).flatMap((a) => a.legacyIds),
      ...(answer?.covers ?? []),
    ]),
  ].sort();
}

export interface QualityScope {
  /** Restrict to one import batch (default: every batch). */
  batchId?: string;
  dataClass?: 'REAL' | 'FIXTURE';
}

export async function loadQualityInput(
  db: Queryable,
  asOf: Date,
  scope: QualityScope = {},
): Promise<QualityInput> {
  const params: unknown[] = [];
  const where: string[] = [];
  if (scope.batchId) {
    params.push(scope.batchId);
    where.push(`c.batch_id = $${params.length}`);
  }
  if (scope.dataClass) {
    params.push(scope.dataClass);
    where.push(`b.data_class = $${params.length}::import_data_class`);
  }
  const rows = (
    await db.query(
      `select c.id, c.kind, c.lineage_key, c.review_status, c.proposal, c.resolution, c.blocking_reasons,
              c.parser_validation_state, b.id as batch_id, b.source_file, b.data_class, b.source_role,
              coalesce(p.records, 0)::int as records, coalesce(p.with_cell, 0)::int as with_cell,
              coalesce(i.codes, '{}') as issue_codes
         from import_candidate c
         join import_batch b on b.id = c.batch_id
         left join lateral (
           select count(*) as records,
                  count(*) filter (where r.source_cells -> 0 ->> 'source_sheet' is not null
                                     and r.source_cells -> 0 ->> 'source_row' is not null
                                     and r.source_cells -> 0 ->> 'source_cell' is not null) as with_cell
             from import_candidate_source cs join import_record r on r.id = cs.record_id
            where cs.candidate_id = c.id) p on true
         left join lateral (
           select array_agg(distinct x.code order by x.code) as codes
             from import_issue x where x.candidate_id = c.id) i on true
        ${where.length ? `where ${where.join(' and ')}` : ''}
        order by c.lineage_key, c.id`,
      params,
    )
  ).rows as Row[];

  const candidates: QCandidate[] = rows.map((r) => ({
    id: r.id as string,
    kind: r.kind as QCandidate['kind'],
    lineageKey: r.lineage_key as string,
    reviewStatus: r.review_status as string,
    proposal: ProposalSchema.parse(r.proposal),
    resolution: (r.resolution as Record<string, unknown> | null) ?? null,
    blockingReasons: r.blocking_reasons as string[],
    parserValidationState: r.parser_validation_state as QCandidate['parserValidationState'],
    batch: {
      id: r.batch_id as string,
      sourceFile: r.source_file as string,
      dataClass: r.data_class as 'REAL' | 'FIXTURE',
      sourceRole: r.source_role as string,
    },
    provenance: { records: r.records as number, recordsWithCell: r.with_cell as number },
    issueCodes: r.issue_codes as string[],
  }));

  const keys = async (sql: string) =>
    ((await db.query(sql)).rows as Row[]).map((r) => r.key as string);

  const answers = (
    await db.query(
      `select a.id, a.decision_id, a.summary, a.actor, a.answered_at, a.answer
         from owner_decision_answer a
        where not exists (select 1 from owner_decision_answer n where n.supersedes_id = a.id)
        order by a.decision_id`,
    )
  ).rows as Row[];

  const mappings = (
    await db.query(
      `select m.source_category, m.category_key from category_mapping m
        where not exists (select 1 from category_mapping n where n.supersedes_id = m.id)`,
    )
  ).rows as Row[];

  const marks = (
    await db.query(
      `select m.subject_key, m.mark from quality_mark m
        where m.subject_type = 'DUPLICATE_PAIR'
          and not exists (select 1 from quality_mark n where n.supersedes_id = m.id)`,
    )
  ).rows as Row[];

  const batchIds = [...new Set(candidates.map((c) => c.batch.id))];
  const batches = (
    await db.query(
      `select b.id, b.source_file, b.source_sha256, b.data_class, b.source_role,
              (select count(*)::int from import_candidate c where c.id = any($2::uuid[]) and c.batch_id = b.id) as n
         from import_batch b where b.id = any($1::uuid[]) order by b.source_file, b.id`,
      [batchIds, candidates.map((c) => c.id)],
    )
  ).rows as Row[];
  const signalRows = (
    await db.query(
      `select detail from import_issue
        where code = 'IMPORT_DUPLICATE_REVIEW' and batch_id = any($1::uuid[]) and detail is not null`,
      [batchIds],
    )
  ).rows as Row[];
  const signalMap = new Map<string, DuplicateSignal>();
  for (const r of signalRows) {
    const d = r.detail as { kind?: string; legacyIds?: string[]; signals?: string[] };
    if (!d.legacyIds || d.legacyIds.length !== 2) continue;
    if (d.kind !== 'PROBABLE_DUPLICATE' && d.kind !== 'RELATIONSHIP_NOT_DUPLICATE') continue;
    const [a, b] = [...d.legacyIds].sort() as [string, string];
    signalMap.set(`${d.kind}|${a}|${b}`, {
      kind: d.kind,
      legacyIds: [a, b],
      signals: d.signals ?? [],
    });
  }

  const historical = (
    await db.query(
      `select evidence ->> 'price_legacy' as price_legacy, evidence ->> 'item_legacy' as item_legacy
         from import_record where evidence_class = 'HISTORICAL_PRICE' and batch_id = any($1::uuid[])`,
      [batchIds],
    )
  ).rows as Row[];
  const histByItem: Record<string, number> = {};
  for (const h of historical)
    if (h.item_legacy)
      histByItem[h.item_legacy as string] = (histByItem[h.item_legacy as string] ?? 0) + 1;

  const domainItems = (
    await db.query(
      `select i.id, i.public_code, i.sale_unit,
              (select s.source_locator from source_reference s
                where s.entity_type = 'catalog_item' and s.entity_id = i.id and s.source_kind = 'LEGACY_ID'
                order by s.source_locator limit 1) as legacy_id,
              (exists (select 1 from source_reference s where s.entity_type = 'catalog_item' and s.entity_id = i.id)
               or exists (select 1 from change_event e where e.table_name = 'catalog_item' and e.entity_key = i.id::text)) as traceable,
              coalesce((select jsonb_agg(jsonb_build_object('market', m.code, 'status', p.pricing_mode::text))
                          from item_market_policy p join market m on m.id = p.market_id where p.item_id = i.id), '[]') as policies
         from catalog_item i order by i.public_code`,
    )
  ).rows as Row[];

  const defs = (
    await db.query(
      `select d.id, d.item_id, d.status, d.model, d.valid_from, d.valid_to, d.max_quantity, b.currency,
              (select s.source_locator from source_reference s
                where s.entity_type = 'catalog_item' and s.entity_id = d.item_id and s.source_kind = 'LEGACY_ID'
                order by s.source_locator limit 1) as legacy_id,
              coalesce((select array_agg(k.quantity order by k.quantity) from price_break k
                         where k.price_definition_id = d.id), '{}') as quantities,
              coalesce((select array_agg(distinct s.source_kind::text) from source_reference s
                         where s.entity_type = 'price_definition' and s.entity_id = d.id), '{}') as source_kinds,
              price_definition_find_clash(d.id, null) as clash
         from price_definition d join price_book b on b.id = d.price_book_id
        where d.status <> 'SUPERSEDED'
        order by d.id`,
    )
  ).rows as Row[];

  return {
    asOf: asOf.toISOString(),
    batches: batches.map((b) => ({
      id: b.id as string,
      sourceFile: b.source_file as string,
      sourceSha256: b.source_sha256 as string,
      dataClass: b.data_class as 'REAL' | 'FIXTURE',
      sourceRole: b.source_role as string,
      candidates: Number(b.n),
    })),
    candidates,
    categoryKeys: await keys('select key from category order by key'),
    decorationMethodKeys: await keys('select key from decoration_method order by key'),
    optionDefinitionKeys: await keys('select key from option_definition order by key'),
    decisionAnswers: answers.map((a) => ({
      id: a.id as string,
      decisionId: a.decision_id as string,
      summary: a.summary as string,
      actor: a.actor as string,
      answeredAt: new Date(String(a.answered_at)).toISOString(),
      coverage: answerCoverage(a.decision_id as string, a.answer as AnswerJson),
    })),
    categoryMappings: mappings.map((m) => ({
      sourceCategory: m.source_category as string,
      categoryKey: m.category_key as string,
    })),
    duplicateMarks: marks.map((m) => ({
      pairKey: m.subject_key as string,
      mark: m.mark as 'DISTINCT' | 'REVIEWED',
    })),
    duplicateSignals: [...signalMap.values()].sort((a, b) =>
      `${a.legacyIds}` < `${b.legacyIds}` ? -1 : 1,
    ),
    historicalPriceLegacyIds: [
      ...new Set(historical.map((h) => h.price_legacy as string).filter(Boolean)),
    ].sort(),
    historicalCountByItemLegacy: histByItem,
    domainItems: domainItems.map((i) => ({
      id: i.id as string,
      publicCode: i.public_code as string,
      legacyId: (i.legacy_id as string | null) ?? null,
      saleUnit: (i.sale_unit as string | null) ?? null,
      traceable: i.traceable as boolean,
      marketPolicies: i.policies as { market: string; status: string }[],
    })),
    domainDefinitions: defs.map((d) => ({
      id: d.id as string,
      itemId: d.item_id as string,
      legacyId: (d.legacy_id as string | null) ?? null,
      status: d.status as 'DRAFT' | 'AUTHORIZED' | 'SUPERSEDED',
      currency: d.currency as string,
      model: d.model as string,
      validFrom: new Date(String(d.valid_from)).toISOString(),
      validTo: d.valid_to ? new Date(String(d.valid_to)).toISOString() : null,
      breakQuantities:
        d.model === 'FIXED' && d.max_quantity !== null
          ? [Number(d.max_quantity)]
          : (d.quantities as number[]).map(Number),
      sourceKinds: d.source_kinds as string[],
      clashesWith: d.clash ? [d.clash as string] : [],
    })),
    publicationEnabledFor: [...PUBLICATION_ENABLED_FOR],
  };
}

export interface QualityReport {
  input: QualityInput;
  run: QualityRun;
  summary: ReturnType<typeof summarize>;
  inventory: ReturnType<typeof inventory>;
  readiness: ItemReadiness[];
  readinessTotals: ReturnType<typeof readinessTotals>;
}

export async function qualityReport(
  db: Queryable,
  asOf: Date,
  scope: QualityScope = {},
): Promise<QualityReport> {
  const input = await loadQualityInput(db, asOf, scope);
  const run = runQuality(input);
  const readiness = computeReadiness(input, run.findings);
  return {
    input,
    run,
    summary: summarize(input, run.findings),
    inventory: inventory(run.findings),
    readiness,
    readinessTotals: readinessTotals(readiness),
  };
}
