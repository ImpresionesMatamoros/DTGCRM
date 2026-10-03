import Link from 'next/link';

const TABS: [string, string][] = [
  ['/admin/data-quality', 'Resumen'],
  ['/admin/data-quality/issues', 'Problemas'],
  ['/admin/data-quality/readiness', 'Preparación'],
  ['/admin/data-quality/inventory', 'Inventario de reglas'],
  ['/admin/data-quality/categories', 'Categorías'],
  ['/admin/data-quality/duplicates', 'Duplicados'],
  ['/admin/data-quality/commercial-print', 'Commercial Print'],
];

export function QualityTabs() {
  return (
    <nav className="small row" style={{ gap: 14, marginBottom: 10 }} data-testid="quality-tabs">
      {TABS.map(([href, label]) => (
        <Link key={href} href={href}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
