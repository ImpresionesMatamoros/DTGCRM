import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { z } from 'zod';
import { batchDetail } from '@/db/admin/imports';
import { KIND_LABELS } from '@/review/labels';
import { adminPool } from '../../_server/db';
import { DataClass, fmtDate, Kv, ReviewStatus, Severity } from '../../_components/ui';

export default async function BatchPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const b = await batchDetail(adminPool(), id);
  if (!b) notFound();
  const kinds = [...new Set(b.kindStatus.map((k) => k.kind))];
  const statuses = [...new Set(b.kindStatus.map((k) => k.status))];
  const cell = (kind: string, status: string) =>
    b.kindStatus.find((k) => k.kind === kind && k.status === status)?.n ?? 0;
  const pct = b.reviewed.total ? Math.round((100 * b.reviewed.decided) / b.reviewed.total) : 0;
  return (
    <>
      <div className="crumbs">
        <Link href="/admin/imports">Importaciones</Link> /
      </div>
      <h1 className="adm-h1">
        {b.sourceFile} <DataClass dataClass={b.dataClass} />
      </h1>
      <div className="grid2">
        <div className="panel">
          <h2 className="adm-h2">Origen</h2>
          <Kv
            rows={[
              ['Workbook', b.sourceFile],
              [
                'SHA-256',
                <span className="mono small" key="s">
                  {b.sourceSha256}
                </span>,
              ],
              ['Rol', b.sourceRole],
              ['Parser', `${b.parserName} ${b.parserVersion}`],
              ['Contrato / exportador', `${b.contractVersion} / ${b.exporterVersion}`],
              ['Linaje', `${b.lineageKey} · intento ${b.attempt}`],
              ['Importado', `${fmtDate(b.stagedAt)} por ${b.stagedBy}`],
              ['Validado', fmtDate(b.validatedAt)],
              ['Hojas / filas inspeccionadas', `${b.sheetsInspected} / ${b.rowsInspected}`],
            ]}
          />
        </div>
        <div className="panel">
          <h2 className="adm-h2">Conteos</h2>
          <Kv
            rows={[
              ['Registros', b.records],
              [
                'Candidatos',
                b.candidates > 0 ? (
                  <Link key="c" href={`/admin/review?batchId=${b.id}`}>
                    {b.candidates}
                  </Link>
                ) : (
                  0
                ),
              ],
              [
                'Issues',
                `${b.issues.ERROR} ERROR · ${b.issues.WARNING} WARNING · ${b.issues.INFO} INFO`,
              ],
              ['Precios históricos (evidencia)', b.historical],
              [
                'Linaje de candidatos',
                Object.entries(b.lineage)
                  .map(([k, v]) => `${k} ${v}`)
                  .join(' · ') || '—',
              ],
              [
                'Progreso de revisión',
                `${b.reviewed.decided} de ${b.reviewed.total} decididos (aprobados, publicados o rechazados) · ${pct}%`,
              ],
            ]}
          />
        </div>
      </div>
      {b.candidates > 0 && (
        <div className="panel">
          <h2 className="adm-h2">Candidatos por tipo y estado de revisión</h2>
          <table className="t">
            <thead>
              <tr>
                <th>Tipo</th>
                {statuses.map((s) => (
                  <th key={s} className="num">
                    <ReviewStatus status={s} />
                  </th>
                ))}
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {kinds.map((k) => (
                <tr key={k}>
                  <td>
                    <Link href={`/admin/review?batchId=${b.id}&kind=${k}`}>
                      {KIND_LABELS[k] ?? k}
                    </Link>
                  </td>
                  {statuses.map((s) => (
                    <td key={s} className="num">
                      {cell(k, s) ? (
                        <Link href={`/admin/review?batchId=${b.id}&kind=${k}&status=${s}`}>
                          {cell(k, s)}
                        </Link>
                      ) : (
                        ''
                      )}
                    </td>
                  ))}
                  <td className="num">
                    {b.kindStatus.filter((x) => x.kind === k).reduce((a, x) => a + x.n, 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="grid2">
        <div className="panel">
          <h2 className="adm-h2">Campos abiertos</h2>
          {b.openFields.length === 0 ? (
            <p className="muted small">Ninguno.</p>
          ) : (
            <table className="t">
              <tbody>
                {b.openFields.map((f) => (
                  <tr key={`${f.kind}.${f.field}`}>
                    <td>{KIND_LABELS[f.kind] ?? f.kind}</td>
                    <td className="mono small">{f.field}</td>
                    <td className="num">{f.n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="panel">
          <h2 className="adm-h2">Registros por tipo</h2>
          <table className="t">
            <tbody>
              {b.recordsByType.map((r) => (
                <tr key={r.type}>
                  <td className="mono small">{r.type}</td>
                  <td className="num">{r.n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="panel">
        <h2 className="adm-h2">Issues por código</h2>
        <table className="t">
          <thead>
            <tr>
              <th>Código</th>
              <th>Severidad</th>
              <th>Origen</th>
              <th className="num">N</th>
              <th>Explicación</th>
            </tr>
          </thead>
          <tbody>
            {b.issuesByCode.map((i) => (
              <tr key={`${i.code}.${i.severity}.${i.origin}`}>
                <td className="mono small">{i.code}</td>
                <td>
                  <Severity severity={i.severity} />
                </td>
                <td className="small">{i.origin}</td>
                <td className="num">{i.n}</td>
                <td className="small">
                  {i.explanation}
                  <div className="muted">ej.: {i.sample}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
