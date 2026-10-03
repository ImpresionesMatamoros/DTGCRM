import Link from 'next/link';
import { connection } from 'next/server';
import { qualityOverview } from '@/db/admin/quality-views';
import { filterQuery, type FindingFilters } from '@/quality/filter';
import { adminPool } from '../_server/db';
import { QualityTabs } from './nav';

const AREA_LABEL: Record<string, string> = {
  CATALOG_ITEM: 'Artículos de catálogo',
  OPTION: 'Opciones',
  DECORATION: 'Decoración',
  COMPOSITION: 'Composición',
  PRICING: 'Precios',
  PRESENTATION: 'Presentaciones',
  CATEGORY: 'Categorías',
  PROVENANCE: 'Procedencia',
  IMPORT: 'Importación',
};

const issues = (f: FindingFilters) => `/admin/data-quality/issues${filterQuery(f)}`;

export default async function DataQualityPage() {
  await connection();
  const o = await qualityOverview(adminPool());
  const s = o.summary;
  const metric = (key: string, v: number, l: string, href: string, h?: string) => (
    <Link key={key} href={href} className="metric" data-metric={key}>
      <div className="v">{v}</div>
      <div className="l">{l}</div>
      {h && <div className="h">{h}</div>}
    </Link>
  );
  const t = o.readinessTotals;
  return (
    <>
      <h1 className="adm-h1">Calidad de datos</h1>
      <p className="adm-sub">
        ¿Qué tan listo está el catálogo? Todo son conteos de hallazgos reales (sin puntaje 0–100) y
        se recalculan al abrir la página. Cada número abre su lista. Reglas v{o.run.rulesVersion}.
      </p>
      <QualityTabs />
      <div className="metrics" data-testid="quality-metrics">
        {metric('candidates', s.candidates.total, 'Candidatos', '/admin/review', 'en staging')}
        {metric(
          'resolved',
          s.candidates.resolved,
          'Resueltos',
          '/admin/review',
          'sin campos abiertos',
        )}
        {metric(
          'unresolved',
          s.candidates.unresolved,
          'Sin resolver',
          '/admin/review',
          'con algún campo abierto',
        )}
        {metric('findings', s.findings.total, 'Hallazgos', issues({}))}
        {metric(
          'blockers',
          s.findings.blockers,
          'Bloqueantes',
          issues({ severity: 'BLOCKER' }),
          'impiden publicar/migrar',
        )}
        {metric('warnings', s.findings.warnings, 'Advertencias', issues({ severity: 'WARNING' }))}
        {metric('info', s.findings.info, 'Informativos', issues({ severity: 'INFO' }))}
        {metric(
          'owner-decisions',
          s.ownerDecisionRequired,
          'Esperan decisión del dueño',
          issues({ remediation: 'OWNER_DECISION_REQUIRED' }),
          'no son errores técnicos',
        )}
        {metric(
          'bulk-resolvable',
          o.run.findings.filter((f) => f.remediation === 'BULK_RESOLVABLE').length,
          'Resolubles en masa',
          issues({ bulk: true }),
        )}
      </div>

      <div className="panel" style={{ marginTop: 14 }}>
        <h2 className="adm-h2">Por área</h2>
        <table className="t" data-testid="quality-by-area">
          <thead>
            <tr>
              <th>Área</th>
              <th className="num">Hallazgos</th>
              <th className="num">Bloqueantes</th>
              <th className="num">Advertencias</th>
              <th className="num">Info</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(AREA_LABEL).map(([area, label]) => {
              const a = s.byArea[area] ?? { total: 0, blockers: 0, warnings: 0, info: 0 };
              const link = (n: number, extra: Partial<FindingFilters>) =>
                n > 0 ? (
                  <Link href={issues({ area: area as FindingFilters['area'], ...extra })}>{n}</Link>
                ) : (
                  0
                );
              return (
                <tr key={area} data-area={area}>
                  <td>{label}</td>
                  <td className="num">{link(a.total, {})}</td>
                  <td className="num">{link(a.blockers, { severity: 'BLOCKER' })}</td>
                  <td className="num">{link(a.warnings, { severity: 'WARNING' })}</td>
                  <td className="num">{link(a.info, { severity: 'INFO' })}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <h2 className="adm-h2">Por tipo de candidato</h2>
        <table className="t">
          <thead>
            <tr>
              <th>Tipo</th>
              <th className="num">Candidatos</th>
              <th className="num">Resueltos</th>
              <th className="num">Sin resolver</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(s.byKind).map(([k, r]) => (
              <tr key={k}>
                <td className="mono">{k}</td>
                <td className="num">
                  <Link href={`/admin/review?kind=${k}`}>{r.candidates}</Link>
                </td>
                <td className="num">{r.resolved}</td>
                <td className="num">{r.unresolved}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel" data-testid="readiness-summary">
        <div className="spread">
          <h2 className="adm-h2">Preparación de {t.items} artículos (4 dimensiones)</h2>
          <Link href="/admin/data-quality/readiness" className="small">
            ver razones por artículo
          </Link>
        </div>
        <table className="t">
          <thead>
            <tr>
              <th>Dimensión</th>
              <th>Estados</th>
            </tr>
          </thead>
          <tbody>
            {(
              [
                ['Revisión', t.review, 'review'],
                ['Dominio', t.domain, 'domain'],
                ['Precios', t.pricing, 'pricing'],
                ['Publicación', t.publication, 'publication'],
              ] as const
            ).map(([label, counts, key]) => (
              <tr key={key} data-dimension={key}>
                <td>{label}</td>
                <td className="small">
                  {Object.entries(counts)
                    .map(([st, n]) => `${st}: ${n}`)
                    .join(' · ') || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="small muted">
          Listos si se levantara la barrera de publicación REAL (que sigue cerrada):{' '}
          <strong data-testid="ready-ignoring-barrier">{t.readyIgnoringBarrier}</strong>.
        </p>
      </div>

      <div className="panel">
        <h2 className="adm-h2">Compuerta Commercial Print</h2>
        <p className="small">
          {o.gate.totals.staged} de {o.gate.totals.total} artículos en staging ·{' '}
          {o.gate.totals.publicationReadyIgnoringBarrier} podrían migrar ·{' '}
          <Link href="/admin/data-quality/commercial-print">ver la compuerta</Link>
        </p>
      </div>
    </>
  );
}
