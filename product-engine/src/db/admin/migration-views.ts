import type { MigrationGate } from '@/migration/gate';
import type { Queryable } from '../client';
import {
  activePermit,
  COMMERCIAL_PRINT_PERMIT,
  currentMigrationGate,
  type PermitView,
} from '../migration/permit';

/** Page data for /admin/migration (read-only). */

export interface PublishedRow {
  itemLegacyId: string;
  publicCode: string;
  catalogItemId: string;
  name: string;
  status: string | null;
  saleUnit: string | null;
  category: string | null;
  linkKind: string;
  prices: number;
  authorizedPrices: number;
  publishedBy: string;
  publishedAt: string;
}

export interface MigrationOverview {
  gate: MigrationGate;
  permit: PermitView | null;
  published: PublishedRow[];
  scopeLabel: string;
}

export async function migrationOverview(
  db: Queryable,
  asOf = new Date(),
): Promise<MigrationOverview> {
  const { gate } = await currentMigrationGate(db, COMMERCIAL_PRINT_PERMIT.markets, asOf);
  const permit = await activePermit(db, COMMERCIAL_PRINT_PERMIT.scopeKey);
  const published = (
    await db.query(
      `select p.item_legacy_id, i.public_code, i.id as item_id, i.canonical_name, i.status, i.sale_unit,
              (select c.key from catalog_item_category ic join category c on c.id = ic.category_id
                where ic.item_id = i.id and ic.is_primary limit 1) as category,
              l.link_kind, p.actor, p.published_at,
              (select count(*)::int from price_definition d where d.item_id = i.id) as prices,
              (select count(*)::int from price_definition d where d.item_id = i.id and d.status = 'AUTHORIZED') as authorized
         from migration_publication p
         join import_candidate_link l on l.candidate_id = p.candidate_id and l.entity_type = 'catalog_item'
         join catalog_item i on i.id = l.entity_id
        order by p.item_legacy_id`,
    )
  ).rows.map((r): PublishedRow => ({
    itemLegacyId: r.item_legacy_id,
    publicCode: r.public_code,
    catalogItemId: r.item_id,
    name: r.canonical_name,
    status: r.status,
    saleUnit: r.sale_unit,
    category: r.category,
    linkKind: r.link_kind,
    prices: r.prices,
    authorizedPrices: r.authorized,
    publishedBy: r.actor,
    publishedAt: new Date(r.published_at).toISOString(),
  }));
  return { gate, permit, published, scopeLabel: COMMERCIAL_PRINT_PERMIT.scopeLabel };
}
