import Link from 'next/link';
import { connection } from 'next/server';
import { listBatches } from '@/db/admin/imports';
import { adminPool } from '../_server/db';
import { DataClass, fmtDate, short } from '../_components/ui';

export default async function ImportsPage() {
  await connection();
  const batches = await listBatches(adminPool());
  return (
    <>
      <h1 className="adm-h1">Importaciones</h1>
      <p className="adm-sub">
        Un lote por workbook importado. Cifras tomadas del staging, sin métricas inventadas.
      </p>
      {batches.length === 0 && (
        <div className="notice">
          No hay lotes. Corre <code>pnpm importer:envelopes && pnpm import:dry-run</code> (con{' '}
          <code>DTG_SOURCES</code>).
        </div>
      )}
      <div className="stack">
        {batches.map((b) => {
          const approved = b.byStatus.APPROVED ?? 0;
          const published = b.byStatus.PUBLISHED ?? 0;
          const blocked = b.byStatus.BLOCKED ?? 0;
          const rejected = b.byStatus.REJECTED ?? 0;
          return (
            <div className="panel" key={b.id}>
              <div className="spread">
                <div>
                  <Link href={`/admin/imports/${b.id}`}>
                    <strong>{b.sourceFile}</strong>
                  </Link>{' '}
                  <DataClass dataClass={b.dataClass} />{' '}
                  <span className="badge b-plain">{b.sourceRole}</span>
                  {b.fixtureName && <span className="muted small"> · {b.fixtureName}</span>}
                </div>
                <span className="muted small">
                  importado {fmtDate(b.stagedAt)} por {b.stagedBy}
                </span>
              </div>
              <table className="t" style={{ marginTop: 6 }}>
                <thead>
                  <tr>
                    <th className="num">Candidatos</th>
                    <th className="num">Registros</th>
                    <th className="num">Errores</th>
                    <th className="num">Avisos</th>
                    <th className="num">Info</th>
                    <th className="num">Bloqueados</th>
                    <th className="num">Aprobados</th>
                    <th className="num">Publicados</th>
                    <th className="num">Rechazados</th>
                    <th className="num">Históricos</th>
                    <th>Parser</th>
                    <th>Hash</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="num">
                      {b.candidates > 0 ? (
                        <Link href={`/admin/review?batchId=${b.id}`}>{b.candidates}</Link>
                      ) : (
                        0
                      )}
                    </td>
                    <td className="num">{b.records}</td>
                    <td className="num">{b.issues.ERROR}</td>
                    <td className="num">{b.issues.WARNING}</td>
                    <td className="num">{b.issues.INFO}</td>
                    <td className="num">{blocked}</td>
                    <td className="num">{approved}</td>
                    <td className="num">{published}</td>
                    <td className="num">{rejected}</td>
                    <td className="num">{b.historical}</td>
                    <td className="mono small">
                      {b.parserName} {b.parserVersion}
                    </td>
                    <td className="mono small" title={b.sourceSha256}>
                      {short(b.sourceSha256)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </>
  );
}
