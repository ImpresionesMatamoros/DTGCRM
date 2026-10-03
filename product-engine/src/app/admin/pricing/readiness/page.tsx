import Link from 'next/link';
import { connection } from 'next/server';
import { commercialPrintReadiness } from '@/db/admin/readiness';
import { adminPool } from '../../_server/db';

export default async function ReadinessPage() {
  await connection();
  const r = await commercialPrintReadiness(adminPool(), new Date());
  const t = r.totals;
  return (
    <>
      <div className="crumbs">
        <Link href="/admin/pricing">Precios</Link> / Commercial Print
      </div>
      <h1 className="adm-h1">Commercial Print · readiness de precios</h1>
      <p className="adm-sub">
        Primera categoría completa recomendada por STEP 05C. Esto es un <strong>informe</strong>: no
        migra, no publica y no marca la categoría como lista. Publicación aprobada:{' '}
        {t.publicationReady} de {t.candidates} (D-016 abierta).
      </p>
      <div className="metrics" data-testid="readiness-totals">
        {[
          ['Candidatos', t.candidates],
          ['Con evidencia de precio actual', t.withCurrentPriceEvidence],
          ['Con precio autorizado', t.withAuthorizedPrice],
          ['Sin precio autorizado', t.withoutAuthorizedPrice],
          ['Definiciones representadas', t.definitionsRepresented],
          ['Matrices exactas', t.matrixDefinitions],
          ['Precios fijos', t.fixedDefinitions],
          ['Observaciones de precio', t.evidenceObservations],
          ['Evidencia histórica', t.historicalEvidence],
        ].map(([label, n]) => (
          <div className="metric" key={String(label)}>
            <div className="v">{n}</div>
            <div className="l">{label}</div>
          </div>
        ))}
      </div>
      <div className="panel">
        <table className="t" data-testid="readiness-table">
          <thead>
            <tr>
              <th>Candidato</th>
              <th className="num">Obs. precio</th>
              <th className="num">Def. autorizadas</th>
              <th className="num">Cobertura matriz</th>
              <th className="num">Histórico</th>
              <th>Decisiones de precio</th>
              <th>Bloqueos para cotizar automático</th>
            </tr>
          </thead>
          <tbody>
            {r.items.map((i) => (
              <tr key={i.legacyId} data-legacy={i.legacyId}>
                <td>
                  <span className="mono small">{i.legacyId}</span> ·{' '}
                  {i.item ? <Link href={`/admin/pricing/${i.item.id}`}>{i.name}</Link> : i.name}
                  {i.stagedCandidateId && (
                    <>
                      {' '}
                      ·{' '}
                      <Link href={`/admin/review/${i.stagedCandidateId}`} className="small">
                        revisión
                      </Link>
                    </>
                  )}
                </td>
                <td className="num">{i.evidenceObservations || ''}</td>
                <td className="num">{i.authorizedDefinitions || ''}</td>
                <td className="num small">
                  {i.matrixDefinitions
                    ? `${i.matrixDefinitions} def · ${i.matrixQuantities} cortes`
                    : ''}
                </td>
                <td className="num">
                  {i.historicalEvidence ? (
                    <span className="badge b-warn">{i.historicalEvidence}</span>
                  ) : (
                    ''
                  )}
                </td>
                <td className="small">
                  {i.pricingDecisions.map((d) => (
                    <Link key={d} href={`/admin/decisions/${d}`} className="badge b-unres">
                      {d}
                    </Link>
                  ))}
                </td>
                <td className="small">
                  {i.blockers.length ? (
                    <ul style={{ margin: 0, paddingLeft: 16 }}>
                      {i.blockers.map((b, k) => (
                        <li key={k}>{b}</li>
                      ))}
                    </ul>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
