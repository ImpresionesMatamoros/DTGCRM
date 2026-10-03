import Link from 'next/link';
import { connection } from 'next/server';
import { listBulkOperations } from '@/db/admin/bulk';
import { listReviewEvents } from '@/db/admin/review';
import { SKIP_REASON_LABELS } from '@/review/labels';
import { adminPool } from '../../_server/db';
import { fmtDate } from '../../_components/ui';

export default async function AuditPage() {
  await connection();
  const db = adminPool();
  const ops = await listBulkOperations(db, 100);
  const events = await listReviewEvents(db, 200);
  return (
    <>
      <div className="crumbs">
        <Link href="/admin/review">Revisión</Link> /
      </div>
      <h1 className="adm-h1">Auditoría de la revisión</h1>
      <p className="adm-sub">
        Append-only: ninguna fila se edita ni se borra. No hay “deshacer”: se corrige con otra
        decisión.
      </p>
      <div className="panel">
        <h2 className="adm-h2">Cambios masivos ({ops.length})</h2>
        <table className="t">
          <thead>
            <tr>
              <th>Cuándo</th>
              <th>Quién</th>
              <th>Tipo</th>
              <th>Cambio</th>
              <th>Conteos</th>
              <th>Sobrescritura</th>
              <th>Origen</th>
              <th>Motivo</th>
            </tr>
          </thead>
          <tbody>
            {ops.map((o) => {
              const c = o.counts as {
                selected?: number;
                affected?: number;
                unresolved?: number;
                same?: number;
                different?: number;
                skipped?: Record<string, number>;
              };
              return (
                <tr key={o.id}>
                  <td className="small nowrap">{fmtDate(o.createdAt)}</td>
                  <td className="small">{o.actor}</td>
                  <td className="small">{o.kind}</td>
                  <td className="mono small">{JSON.stringify(o.changes)}</td>
                  <td className="small">
                    {c.selected} sel. · {o.events} campos escritos · {c.unresolved} sin resolver ·{' '}
                    {c.same} iguales · {c.different} distintos
                    {c.skipped && Object.keys(c.skipped).length > 0 && (
                      <div className="muted">
                        omitidos:{' '}
                        {Object.entries(c.skipped)
                          .map(([k, n]) => `${n} ${SKIP_REASON_LABELS[k] ?? k}`)
                          .join(' · ')}
                      </div>
                    )}
                  </td>
                  <td className="small">{o.overwriteConfirmed ? 'confirmada' : 'no'}</td>
                  <td className="small">
                    {o.origin}
                    {o.originRef ? ` · ${o.originRef}` : ''}
                  </td>
                  <td className="small">{o.reason ?? ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="panel">
        <h2 className="adm-h2">Últimas decisiones (200)</h2>
        <table className="t">
          <thead>
            <tr>
              <th>Cuándo</th>
              <th>Quién</th>
              <th>Candidato</th>
              <th>Acción</th>
              <th>Campo</th>
              <th>Antes → después</th>
              <th>Motivo</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td className="small nowrap">{fmtDate(e.createdAt)}</td>
                <td className="small">{e.actor}</td>
                <td className="small">
                  <Link href={`/admin/review/${e.candidateId}`}>{e.label}</Link>
                </td>
                <td className="small">
                  {e.action}
                  {e.origin !== 'UI_SINGLE' && <div className="muted">{e.origin}</div>}
                </td>
                <td className="mono small">{e.field ?? ''}</td>
                <td className="mono small">
                  {e.field
                    ? `${e.oldValue === null ? '∅' : JSON.stringify(e.oldValue)} → ${e.newValue === null ? '∅' : JSON.stringify(e.newValue)}`
                    : ''}
                </td>
                <td className="small">{e.reason ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
