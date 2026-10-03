import Link from 'next/link';
import { connection } from 'next/server';
import { dashboardMetrics } from '@/db/admin/dashboard';
import { listBulkOperations } from '@/db/admin/bulk';
import { adminPool } from './_server/db';
import { fmtDate } from './_components/ui';

export default async function AdminHome() {
  await connection();
  const db = adminPool();
  const [metrics, bulk] = await Promise.all([dashboardMetrics(db), listBulkOperations(db, 5)]);
  return (
    <>
      <h1 className="adm-h1">Admin</h1>
      <p className="adm-sub">
        Primero la revisión de lo importado; después el catálogo. Cada número abre su lista.
      </p>
      <div className="metrics">
        {metrics.map((m) => (
          <Link key={m.key} href={m.href} className="metric" data-metric={m.key}>
            <div className="v">{m.value}</div>
            <div className="l">{m.label}</div>
            <div className="h">{m.hint}</div>
          </Link>
        ))}
      </div>
      <div className="panel" style={{ marginTop: 14 }}>
        <div className="spread">
          <h2 className="adm-h2">Últimos cambios masivos</h2>
          <Link href="/admin/review/audit" className="small">
            ver auditoría
          </Link>
        </div>
        {bulk.length === 0 ? (
          <p className="muted small">Todavía no hay cambios masivos.</p>
        ) : (
          <table className="t">
            <tbody>
              {bulk.map((b) => (
                <tr key={b.id}>
                  <td className="nowrap small">{fmtDate(b.createdAt)}</td>
                  <td>{b.actor}</td>
                  <td className="mono small">{JSON.stringify(b.changes)}</td>
                  <td className="small">
                    {b.events} campos · {b.candidates} seleccionados
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
