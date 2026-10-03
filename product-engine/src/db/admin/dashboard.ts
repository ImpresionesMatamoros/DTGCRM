import type { Queryable } from '../client';

/** Admin home: each metric is a real count that links to the list it summarizes. */

export interface Metric {
  key: string;
  label: string;
  value: number;
  href: string;
  hint: string;
}

export async function dashboardMetrics(db: Queryable): Promise<Metric[]> {
  const r = (
    await db.query(
      `select
         (select count(*)::int from import_candidate) as candidates,
         (select count(*)::int from import_candidate where review_status in ('PENDING', 'VALID', 'WARNING')) as needs_review,
         (select count(*)::int from import_candidate where review_status = 'BLOCKED') as blocked,
         (select count(*)::int from import_candidate where review_status = 'APPROVED') as approved,
         (select count(*)::int from catalog_item) as items,
         (select count(*)::int from v_review_candidate where kind = 'CATALOG_ITEM' and 'status' = any(open_fields)) as unresolved_status,
         (select count(*)::int from v_review_candidate where kind = 'OPTION' and 'isRequired' = any(open_fields)) as unresolved_options,
         (select count(*)::int from import_record where evidence_class = 'HISTORICAL_PRICE') as historical_staging,
         (select count(*)::int from source_reference where source_kind = 'HISTORICAL_PRICE_EVIDENCE') as historical_domain`,
    )
  ).rows[0] as Record<string, number>;
  return [
    {
      key: 'candidates',
      label: 'Candidatos importados',
      value: r.candidates!,
      href: '/admin/review',
      hint: 'Todos los candidatos en staging',
    },
    {
      key: 'needs_review',
      label: 'Por revisar',
      value: r.needs_review!,
      href: '/admin/review?status=TO_REVIEW',
      hint: 'PENDING, VALID o WARNING (sin aprobar ni rechazar)',
    },
    {
      key: 'blocked',
      label: 'Bloqueados',
      value: r.blocked!,
      href: '/admin/review?status=BLOCKED',
      hint: 'No se pueden aprobar',
    },
    {
      key: 'approved',
      label: 'Aprobados',
      value: r.approved!,
      href: '/admin/review?status=APPROVED',
      hint: 'Aprobados, sin publicar',
    },
    {
      key: 'items',
      label: 'Items de catálogo',
      value: r.items!,
      href: '/admin/catalog',
      hint: 'CatalogItems en el dominio',
    },
    {
      key: 'unresolved_status',
      label: 'Estado sin resolver',
      value: r.unresolved_status!,
      href: '/admin/review?kind=CATALOG_ITEM&catalogStatus=unresolved',
      hint: 'Candidatos de item sin estado de catálogo decidido',
    },
    {
      key: 'unresolved_options',
      label: 'Opciones sin resolver',
      value: r.unresolved_options!,
      href: '/admin/review?kind=OPTION&openField=isRequired',
      hint: 'Opciones con “Obligatoria” sin resolver',
    },
    {
      key: 'historical',
      label: 'Precios históricos',
      value: r.historical_staging! + r.historical_domain!,
      href: '/admin/pricing/historical',
      hint: `${r.historical_staging} en staging · ${r.historical_domain} en el dominio · sólo evidencia`,
    },
  ];
}
