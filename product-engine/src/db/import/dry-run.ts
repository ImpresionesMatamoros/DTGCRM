import type { Queryable } from '../client';
import { previewCandidate } from './publish';

/**
 * Read-only statistics of a staged batch, plus an adapter dry run of every
 * candidate with its proposal as-is (no resolution, no writes).
 */

type Row = Record<string, unknown>;
const rows = async (db: Queryable, sql: string, params: unknown[]) =>
  (await db.query(sql, params)).rows as Row[];

export interface BatchStatistics {
  batch: Row;
  recordsByType: { record_type: string; synthetic: boolean; n: number }[];
  candidatesByKindStatus: { kind: string; review_status: string; n: number }[];
  blocked: { lineage_key: string; blocking_reasons: string[] }[];
  unresolved: { kind: string; field: string; n: number }[];
  issues: { code: string; severity: string; origin: string; n: number; occurrences: number }[];
  itemTypes: { item_type: string | null; n: number }[];
  statuses: { status: string | null; n: number }[];
  priceGroups: {
    lineage_key: string;
    model: string | null;
    observations: number;
    quantities: number[];
    amounts: string[];
    currency: string | null;
    review_status: string;
  }[];
  historical: {
    record_key: string;
    item: string;
    price: string;
    amount: string | null;
    currency: string | null;
    model: string | null;
    notes: string | null;
  }[];
  duplicates: { message: string; severity: string; detail: Row }[];
  presentations: {
    lineage_key: string;
    item: string | null;
    name: string | null;
    occasion: string | null;
    locale: string | null;
  }[];
  decorationSuggestions: { labels: string; suggestion: string | null; n: number }[];
  lineage: { lineage_status: string; n: number }[];
  adapter: {
    adaptableAsProposed: number;
    /** Adaptable candidates whose plan only links to existing domain rows (reconciliation). */
    linkOnly: number;
    byFirstError: Record<string, number>;
    byKind: Record<string, { ok: number; failed: number }>;
  };
}

export async function batchStatistics(
  db: Queryable,
  batchId: string,
  runAdapter = true,
): Promise<BatchStatistics> {
  const [batch] = await rows(db, 'select * from import_batch where id = $1', [batchId]);
  const recordsByType = (await rows(
    db,
    'select record_type, synthetic, count(*)::int as n from import_record where batch_id = $1 group by 1, 2 order by 1, 2',
    [batchId],
  )) as BatchStatistics['recordsByType'];
  const candidatesByKindStatus = (await rows(
    db,
    'select kind::text, review_status::text, count(*)::int as n from import_candidate where batch_id = $1 group by 1, 2 order by 1, 2',
    [batchId],
  )) as BatchStatistics['candidatesByKindStatus'];
  const blocked = (await rows(
    db,
    "select lineage_key, blocking_reasons from import_candidate where batch_id = $1 and review_status = 'BLOCKED' order by 1",
    [batchId],
  )) as BatchStatistics['blocked'];
  const unresolved = (await rows(
    db,
    `select kind::text, f as field, count(*)::int as n
       from import_candidate, unnest(unresolved_fields) f where batch_id = $1 group by 1, 2 order by 1, 3 desc, 2`,
    [batchId],
  )) as BatchStatistics['unresolved'];
  const issues = (await rows(
    db,
    `select code, severity::text, origin::text, count(*)::int as n, sum(occurrences)::int as occurrences
       from import_issue where batch_id = $1 group by 1, 2, 3 order by 4 desc, 1`,
    [batchId],
  )) as BatchStatistics['issues'];
  const itemTypes = (await rows(
    db,
    `select proposal ->> 'itemType' as item_type, count(*)::int as n from import_candidate
      where batch_id = $1 and kind = 'CATALOG_ITEM' group by 1 order by 2 desc`,
    [batchId],
  )) as BatchStatistics['itemTypes'];
  const statuses = (await rows(
    db,
    `select proposal ->> 'status' as status, count(*)::int as n from import_candidate
      where batch_id = $1 and kind = 'CATALOG_ITEM' group by 1 order by 2 desc`,
    [batchId],
  )) as BatchStatistics['statuses'];
  const priceGroups = (
    await rows(
      db,
      `select lineage_key, proposal ->> 'model' as model, proposal ->> 'currency' as currency, review_status::text,
              jsonb_array_length(proposal -> 'observations')::int as observations,
              (select array_agg((o ->> 'quantity')::int order by (o ->> 'quantity')::int)
                 from jsonb_array_elements(proposal -> 'observations') o where o ->> 'quantity' is not null) as quantities,
              (select array_agg(o ->> 'amount' order by (o ->> 'quantity')::int nulls last)
                 from jsonb_array_elements(proposal -> 'observations') o) as amounts
         from import_candidate where batch_id = $1 and kind = 'PRICE' order by lineage_key`,
      [batchId],
    )
  ).map((r) => ({
    ...r,
    quantities: (r.quantities as number[] | null) ?? [],
    amounts: (r.amounts as string[] | null) ?? [],
  })) as BatchStatistics['priceGroups'];
  const historical = (await rows(
    db,
    `select record_key, evidence ->> 'item_legacy' as item, evidence ->> 'price_legacy' as price,
            evidence -> 'money' ->> 'amount' as amount, evidence -> 'money' ->> 'currency' as currency,
            evidence ->> 'source_model' as model, normalized_payload ->> 'Notas' as notes
       from import_record where batch_id = $1 and evidence_class = 'HISTORICAL_PRICE' order by 2, 3`,
    [batchId],
  )) as BatchStatistics['historical'];
  const duplicates = (await rows(
    db,
    "select message, severity::text, detail from import_issue where batch_id = $1 and code = 'IMPORT_DUPLICATE_REVIEW' order by 1",
    [batchId],
  )) as BatchStatistics['duplicates'];
  const presentations = (await rows(
    db,
    `select lineage_key, proposal ->> 'itemLegacyId' as item, proposal ->> 'displayName' as name,
            proposal ->> 'occasion' as occasion, proposal ->> 'locale' as locale
       from import_candidate where batch_id = $1 and kind = 'PRESENTATION' order by 1`,
    [batchId],
  )) as BatchStatistics['presentations'];
  const decorationSuggestions = (await rows(
    db,
    `select array_to_string(array(select jsonb_array_elements_text(proposal -> 'methodLabels')), ', ') as labels,
            proposal ->> 'suggestedMethodKey' as suggestion, count(*)::int as n
       from import_candidate where batch_id = $1 and kind = 'DECORATION' and proposal ->> 'subtype' = 'METHOD_ASSOCIATION'
      group by 1, 2 order by 3 desc, 1`,
    [batchId],
  )) as BatchStatistics['decorationSuggestions'];
  const lineage = (await rows(
    db,
    'select lineage_status::text, count(*)::int as n from import_candidate where batch_id = $1 group by 1 order by 1',
    [batchId],
  )) as BatchStatistics['lineage'];

  const adapter: BatchStatistics['adapter'] = {
    adaptableAsProposed: 0,
    linkOnly: 0,
    byFirstError: {},
    byKind: {},
  };
  if (runAdapter) {
    const all = await rows(
      db,
      'select id, kind::text from import_candidate where batch_id = $1 order by lineage_key',
      [batchId],
    );
    for (const c of all) {
      const kind = c.kind as string;
      const k = (adapter.byKind[kind] ??= { ok: 0, failed: 0 });
      const r = await previewCandidate(db, c.id as string, null);
      if (r.ok) {
        adapter.adaptableAsProposed += 1;
        if (r.plan.ops.every((o) => o.op === 'LINK' || o.op === 'ADD_SOURCE_REFERENCE'))
          adapter.linkOnly += 1;
        k.ok += 1;
      } else {
        k.failed += 1;
        const first = r.errors[0]!;
        const key = 'field' in first && first.field ? `${first.code}:${first.field}` : first.code;
        adapter.byFirstError[key] = (adapter.byFirstError[key] ?? 0) + 1;
      }
    }
  }
  return {
    batch: batch!,
    recordsByType,
    candidatesByKindStatus,
    blocked,
    unresolved,
    issues,
    itemTypes,
    statuses,
    priceGroups,
    historical,
    duplicates,
    presentations,
    decorationSuggestions,
    lineage,
    adapter,
  };
}
