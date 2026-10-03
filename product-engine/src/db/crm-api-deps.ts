import { sharedPool } from './client';
import { loadCatalogSnapshot } from './catalog-snapshot';
import type { Presentation } from '../domain/publication';
import type { CrmApiDeps } from '../api/crm-handlers';

type Row = Record<string, unknown>;

/** All presentations; the projection emits READY ones only and uses aliases of any status for search. */
export async function loadPresentations(db: {
  query: (sql: string) => Promise<{ rows: unknown[] }>;
}): Promise<Presentation[]> {
  const res = await db.query('select * from presentation order by item_id, locale, id');
  return (res.rows as Row[]).map((r) => ({
    id: r.id as string,
    itemId: r.item_id as string,
    locale: r.locale as 'es' | 'en',
    occasion: (r.occasion as string | null) ?? null,
    displayName: r.display_name as string,
    shortDescription: (r.short_description as string | null) ?? null,
    aliases: (r.aliases as string[]) ?? [],
    seoKeywords: (r.seo_keywords as string[]) ?? [],
    isDefault: r.is_default as boolean,
    status: r.status as 'DRAFT' | 'READY',
  }));
}

export function productionDeps(): CrmApiDeps {
  const db = sharedPool();
  return {
    loadSnapshot: () => loadCatalogSnapshot(db),
    loadPresentations: () => loadPresentations(db),
    now: () => new Date(),
  };
}
