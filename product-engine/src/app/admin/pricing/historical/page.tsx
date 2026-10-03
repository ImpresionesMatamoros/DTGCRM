import Link from 'next/link';
import { connection } from 'next/server';
import { listHistorical } from '@/db/admin/pricing';
import { adminPool } from '../../_server/db';

export default async function HistoricalPage() {
  await connection();
  const rows = await listHistorical(adminPool());
  return (
    <>
      <div className="crumbs">
        <Link href="/admin/pricing">Precios</Link> /
      </div>
      <h1 className="adm-h1">Historical evidence · Not used for current pricing</h1>
      <div className="notice warn">
        Precios históricos o no autorizados (ADR-0005). Son evidencia: no se editan, no se
        seleccionan automáticamente y no se pueden convertir en precio vigente desde aquí. No hay
        ninguna acción en esta pantalla.
      </div>
      <div className="panel">
        <table className="t" data-testid="historical-table">
          <thead>
            <tr>
              <th>Origen</th>
              <th>Item</th>
              <th>Precio legacy</th>
              <th className="num">Importe</th>
              <th>Moneda</th>
              <th>Condiciones</th>
              <th>Fuente</th>
              <th>Nota</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((h, i) => (
              <tr key={i}>
                <td>
                  <span className="badge b-warn">
                    {h.origin === 'DOMAIN' ? 'dominio' : 'staging'}
                  </span>
                </td>
                <td className="small">
                  {h.itemId ? (
                    <Link href={`/admin/pricing/${h.itemId}`}>{h.itemName}</Link>
                  ) : (
                    (h.itemName ?? h.itemLegacy ?? '—')
                  )}
                  {h.itemLegacy && <div className="mono muted">{h.itemLegacy}</div>}
                </td>
                <td className="mono small">{h.priceLegacy ?? '—'}</td>
                <td className="num">{h.amount ?? '—'}</td>
                <td>{h.currency ?? '—'}</td>
                <td className="mono small">{h.conditions ?? '—'}</td>
                <td className="small">
                  {h.sourceFile}
                  {h.sheet ? ` · ${h.sheet}` : ''}
                  {h.row !== null ? ` · fila ${h.row}` : ''}
                </td>
                <td className="small">{h.note ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
