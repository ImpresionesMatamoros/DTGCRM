import Link from 'next/link';
import { connection } from 'next/server';
import { qualityOverview } from '@/db/admin/quality-views';
import type { DimensionReadiness, ItemReadiness } from '@/quality/types';
import { adminPool } from '../../_server/db';
import { Badge, Pager, one, qs } from '../../_components/ui';
import { QualityTabs } from '../nav';

const PAGE = 40;
const TONE: Record<string, string> = {
  READY: 'ok',
  BLOCKED: 'bad',
  NEEDS_RESOLUTION: 'warn',
  QUOTE_ONLY: 'info',
  DRAFT_ONLY: 'plain',
};
const DIMS = ['review', 'domain', 'pricing', 'publication'] as const;

function Dim({ d }: { d: DimensionReadiness }) {
  return (
    <div>
      <Badge tone={TONE[d.state] ?? 'plain'}>{d.state}</Badge>
      <ul className="small muted" style={{ margin: '2px 0 0 14px', padding: 0 }}>
        {d.reasons.slice(0, 4).map((r, i) => (
          <li key={i} data-reason-kind={r.kind}>
            {r.label}
            {r.decisionIds?.map((id) => (
              <Link key={id} href={`/admin/decisions/${id}`}>
                {' '}
                {id}
              </Link>
            ))}
          </li>
        ))}
        {d.reasons.length > 4 && <li>… +{d.reasons.length - 4}</li>}
      </ul>
    </div>
  );
}

export default async function ReadinessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  const p = await searchParams;
  const o = await qualityOverview(adminPool());
  const dim = DIMS.find((d) => d === one(p.dimension));
  const state = one(p.state);
  const pageNo = Math.max(1, Number(one(p.page)) || 1);
  const rows: ItemReadiness[] = o.readiness.filter((r) => !dim || !state || r[dim].state === state);
  return (
    <>
      <h1 className="adm-h1">Preparación por artículo</h1>
      <p className="adm-sub">
        Cuatro dimensiones separadas (revisión, dominio, precios, publicación), cada estado con sus
        razones. No hay puntaje: un faltante sigue faltando. La publicación REAL está deshabilitada
        por diseño.
      </p>
      <QualityTabs />
      <div className="panel small" data-testid="readiness-filters">
        {DIMS.map((d) => (
          <div key={d}>
            <strong>{d}</strong>:{' '}
            {Object.entries(o.readinessTotals[d]).map(([st, n]) => (
              <Link
                key={st}
                href={`/admin/data-quality/readiness${qs({ dimension: d, state: st })}`}
                style={{ marginRight: 10 }}
              >
                {st} ({n})
              </Link>
            ))}
          </div>
        ))}
        {dim && (
          <Link href="/admin/data-quality/readiness">
            quitar filtro ({dim}: {state})
          </Link>
        )}
      </div>
      <div className="panel">
        <div className="t-wrap">
          <table className="t" data-testid="readiness-table">
            <thead>
              <tr>
                <th>Artículo</th>
                <th>Revisión</th>
                <th>Dominio</th>
                <th>Precios</th>
                <th>Publicación</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice((pageNo - 1) * PAGE, pageNo * PAGE).map((r) => (
                <tr key={r.candidateId} data-item={r.legacyId}>
                  <td>
                    <Link href={`/admin/review/${r.candidateId}`}>{r.name ?? r.legacyId}</Link>
                    <div className="small muted mono">
                      {r.legacyId} · {r.category ?? 'sin categoría'}
                    </div>
                    {r.openDecisions.length > 0 && (
                      <div className="small">decisiones: {r.openDecisions.join(', ')}</div>
                    )}
                  </td>
                  {DIMS.map((d) => (
                    <td key={d}>
                      <Dim d={r[d]} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pager
          page={pageNo}
          pageSize={PAGE}
          total={rows.length}
          href={(n) => `/admin/data-quality/readiness${qs({ dimension: dim, state, page: n })}`}
        />
      </div>
    </>
  );
}
