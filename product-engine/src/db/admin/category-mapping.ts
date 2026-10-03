import type { Queryable } from '../client';
import { applyBulk, previewBulk, type BulkPreview } from './bulk';

/**
 * Category mapping (STEP 08 §17): "source category X → Product Engine category Y" as a reviewed
 * decision with an impact preview, applied through the existing bulk planner and recorded (who, why,
 * how many) in category_mapping. Nothing maps by name: the Excel category is a code and stays evidence
 * until a person maps it. The taxonomy itself (the 5 domain categories) is not redesigned here.
 */

type Row = Record<string, unknown>;

export interface SourceCategoryRow {
  sourceCategory: string;
  candidates: number;
  /** candidates that already have a resolved Product Engine category */
  resolved: number;
  resolvedAs: Record<string, number>;
  families: string[];
  sampleNames: string[];
  recorded: { categoryKey: string; actor: string; decidedAt: string; candidates: number } | null;
}

export async function categoryOptions(db: Queryable): Promise<{ key: string; name: string }[]> {
  return (
    (await db.query('select key, name from category where is_active order by sort, name'))
      .rows as Row[]
  ).map((r) => ({ key: r.key as string, name: r.name as string }));
}

export async function sourceCategories(db: Queryable): Promise<SourceCategoryRow[]> {
  const rows = (
    await db.query(
      `select c.id, c.proposal ->> 'categoryLegacy' as src, c.proposal ->> 'familyEvidence' as family,
              c.proposal ->> 'name' as name, c.resolution ->> 'categoryKey' as resolved
         from import_candidate c where c.kind = 'CATALOG_ITEM' and c.review_status <> 'REJECTED'
        order by c.lineage_key`,
    )
  ).rows as Row[];
  const rec = (
    await db.query(
      `select m.source_category, m.category_key, m.actor, m.decided_at, m.candidates from category_mapping m
        where not exists (select 1 from category_mapping n where n.supersedes_id = m.id)`,
    )
  ).rows as Row[];
  const recorded = new Map(rec.map((r) => [r.source_category as string, r]));
  const groups = new Map<string, SourceCategoryRow>();
  for (const r of rows) {
    const src = (r.src as string | null) ?? '';
    if (!src) continue;
    const g =
      groups.get(src) ??
      ({
        sourceCategory: src,
        candidates: 0,
        resolved: 0,
        resolvedAs: {},
        families: [],
        sampleNames: [],
        recorded: null,
      } satisfies SourceCategoryRow);
    g.candidates++;
    if (r.resolved) {
      g.resolved++;
      g.resolvedAs[r.resolved as string] = (g.resolvedAs[r.resolved as string] ?? 0) + 1;
    }
    if (r.family && !g.families.includes(r.family as string)) g.families.push(r.family as string);
    if (r.name && g.sampleNames.length < 3) g.sampleNames.push(r.name as string);
    groups.set(src, g);
  }
  for (const g of groups.values()) {
    const m = recorded.get(g.sourceCategory);
    if (m)
      g.recorded = {
        categoryKey: m.category_key as string,
        actor: m.actor as string,
        decidedAt: new Date(String(m.decided_at)).toISOString(),
        candidates: Number(m.candidates),
      };
    g.families = g.families.slice(0, 6);
  }
  return [...groups.values()].sort(
    (a, b) => b.candidates - a.candidates || (a.sourceCategory < b.sourceCategory ? -1 : 1),
  );
}

async function targets(db: Queryable, sourceCategory: string): Promise<string[]> {
  return (
    (
      await db.query(
        `select id from import_candidate where kind = 'CATALOG_ITEM' and review_status <> 'REJECTED'
            and proposal ->> 'categoryLegacy' = $1 order by lineage_key`,
        [sourceCategory],
      )
    ).rows as Row[]
  ).map((r) => r.id as string);
}

async function checkCategory(db: Queryable, key: string): Promise<string | null> {
  const r = await db.query('select 1 from category where key = $1 and is_active', [key]);
  return r.rows.length ? null : `unknown category ${key}`;
}

export type MappingPreview =
  | { ok: true; preview: BulkPreview; sourceCategory: string; categoryKey: string }
  | { ok: false; message: string };

export async function previewCategoryMapping(
  db: Queryable,
  sourceCategory: string,
  categoryKey: string,
): Promise<MappingPreview> {
  if (!sourceCategory.trim()) return { ok: false, message: 'a source category is required' };
  const bad = await checkCategory(db, categoryKey);
  if (bad) return { ok: false, message: bad };
  const ids = await targets(db, sourceCategory);
  if (ids.length === 0)
    return { ok: false, message: `no candidate has source category ${sourceCategory}` };
  const p = await previewBulk(db, {
    candidateIds: ids,
    kind: 'CATALOG_ITEM',
    changes: { categoryKey },
    strict: true,
  });
  if (!p.ok) return { ok: false, message: p.errors.map((e) => e.message).join('; ') };
  return { ok: true, preview: p.preview, sourceCategory, categoryKey };
}

export async function applyCategoryMapping(
  db: Queryable,
  input: {
    sourceCategory: string;
    categoryKey: string;
    planSha256: string;
    overwrite: boolean;
    actor: string;
    reason?: string | null;
  },
) {
  const bad = await checkCategory(db, input.categoryKey);
  if (bad)
    return { ok: false as const, errors: [{ code: 'INVALID_RESOLUTION' as const, message: bad }] };
  const ids = await targets(db, input.sourceCategory);
  const res = await applyBulk(db, {
    candidateIds: ids,
    kind: 'CATALOG_ITEM',
    changes: { categoryKey: input.categoryKey },
    strict: true,
    actor: input.actor,
    planSha256: input.planSha256,
    overwrite: input.overwrite,
    reason: input.reason ?? `Mapeo de categoría ${input.sourceCategory} → ${input.categoryKey}`,
    origin: 'UI_BULK',
  });
  if (!res.ok) return res;
  const prev = (
    await db.query(
      `select m.id from category_mapping m where m.source_category = $1
          and not exists (select 1 from category_mapping n where n.supersedes_id = m.id)`,
      [input.sourceCategory],
    )
  ).rows[0] as Row | undefined;
  const mapping = (
    await db.query(
      `insert into category_mapping (source_category, category_key, candidates, reason, actor, bulk_operation_id, supersedes_id)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [
        input.sourceCategory,
        input.categoryKey,
        res.candidates,
        input.reason ?? null,
        input.actor,
        res.bulkOperationId,
        prev?.id ?? null,
      ],
    )
  ).rows[0] as Row;
  return { ...res, mappingId: mapping.id as string };
}

export async function mappingHistory(db: Queryable, limit = 50) {
  return (
    (
      await db.query(
        `select m.*, (select count(*) from category_mapping n where n.supersedes_id = m.id) = 0 as current
           from category_mapping m order by m.decided_at desc limit $1`,
        [limit],
      )
    ).rows as Row[]
  ).map((r) => ({
    id: r.id as string,
    sourceCategory: r.source_category as string,
    categoryKey: r.category_key as string,
    candidates: Number(r.candidates),
    reason: (r.reason as string | null) ?? null,
    actor: r.actor as string,
    decidedAt: new Date(String(r.decided_at)).toISOString(),
    bulkOperationId: (r.bulk_operation_id as string | null) ?? null,
    current: r.current as boolean,
  }));
}
