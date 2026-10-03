import Link from 'next/link';
import { connection } from 'next/server';
import { qualityOverview } from '@/db/admin/quality-views';
import { adminPool } from '../../_server/db';
import { Badge } from '../../_components/ui';
import { QualityTabs } from '../nav';

const TONE: Record<string, string> = {
  READY: 'ok',
  BLOCKED: 'bad',
  NEEDS_RESOLUTION: 'warn',
  QUOTE_ONLY: 'info',
  DRAFT_ONLY: 'plain',
};

export default async function CommercialPrintPage() {
  await connection();
  const { gate } = await qualityOverview(adminPool());
  const t = gate.totals;
  const list = (xs: string[]) =>
    xs.length ? (
      <ul className="small" style={{ margin: 0, paddingLeft: 14 }}>
        {xs.map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>
    ) : (
      <span className="muted">—</span>
    );
  return (
    <>
      <h1 className="adm-h1">Compuerta de migración · Commercial Print</h1>
      <p className="adm-sub">
        Los {t.total} artículos del primer paquete (STEP 05C). Sólo lee: no migra, no publica y no
        marca nada como listo. Sirve para decidir qué falta antes de STEP 09.
      </p>
      <QualityTabs />
      <div className="metrics" data-testid="gate-totals">
        {(
          [
            ['total', t.total, 'Artículos'],
            ['staged', t.staged, 'En staging'],
            ['domain-ready', t.domainReady, 'Dominio listo'],
            ['pricing-ready', t.pricingReady, 'Precios listos'],
            ['quote-only', t.quoteOnly, 'Sólo cotización'],
            ['can-migrate', t.publicationReadyIgnoringBarrier, 'Podrían migrar'],
            ['blocked-decisions', t.blockedByOwnerDecisions, 'Bloqueados por decisión'],
            ['missing-sale-unit', t.missingSaleUnit, 'Sin unidad de venta'],
            ['missing-status', t.missingStatus, 'Sin estado'],
            ['missing-category', t.missingCategory, 'Sin categoría'],
            ['option-blockers', t.withOptionBlockers, 'Con bloqueo de opciones'],
          ] as const
        ).map(([k, v, l]) => (
          <div key={k} className="metric" data-metric={k}>
            <div className="v">{v}</div>
            <div className="l">{l}</div>
          </div>
        ))}
      </div>
      <p className="small muted">
        Decisiones abiertas (artículos afectados):{' '}
        {Object.entries(t.openDecisionCounts)
          .map(([d, n]) => `${d}: ${n}`)
          .join(' · ') || 'ninguna'}
      </p>
      <div className="panel">
        <div className="t-wrap">
          <table className="t" data-testid="gate-table">
            <thead>
              <tr>
                <th>Artículo</th>
                <th>Estado</th>
                <th>Unidad</th>
                <th>Categoría</th>
                <th>Precio</th>
                <th>Opciones / presentaciones</th>
                <th>Procedencia</th>
                <th>Bloqueos</th>
              </tr>
            </thead>
            <tbody>
              {gate.items.map((i) => (
                <tr key={i.legacyId} data-item={i.legacyId}>
                  <td>
                    {i.candidateId ? (
                      <Link href={`/admin/review/${i.candidateId}`}>{i.name}</Link>
                    ) : (
                      i.name
                    )}
                    <div className="small muted mono">{i.legacyId}</div>
                    {i.canMigrate ? (
                      <Badge tone="ok">podría migrar</Badge>
                    ) : (
                      <Badge tone="bad">no migra aún</Badge>
                    )}
                  </td>
                  <td className="small">
                    {i.status.value ?? <span className="unres">falta</span>}
                  </td>
                  <td className="small">
                    {i.saleUnit.value ?? <span className="unres">falta</span>}
                  </td>
                  <td className="small">
                    {i.category.value ?? <span className="unres">falta</span>}
                  </td>
                  <td className="small">
                    <Badge tone={TONE[i.price.state] ?? 'plain'}>{i.price.state}</Badge>
                    <div className="muted">{i.price.evidenceObservations} obs. de evidencia</div>
                  </td>
                  <td className="small">
                    {i.options.candidates} op. ({i.options.unresolved} sin resolver)
                    <br />
                    {i.presentations.candidates} pres. ({i.presentations.unresolved} sin resolver)
                  </td>
                  <td className="small">{i.provenance.state}</td>
                  <td>
                    {list([
                      ...i.blockers.domain.map((x) => `dominio · ${x}`),
                      ...i.blockers.option.map((x) => `opción · ${x}`),
                      ...i.blockers.pricing.map((x) => `precio · ${x}`),
                      ...i.blockers.decision.map((x) => `decisión · ${x}`),
                    ])}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
