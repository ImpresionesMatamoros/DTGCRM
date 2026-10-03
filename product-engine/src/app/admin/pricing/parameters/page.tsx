import Link from 'next/link';
import { connection } from 'next/server';
import { can } from '@/admin/permissions';
import { listFxParameters, parameterHistory } from '@/db/admin/price-views';
import { getActor } from '../../_server/actor';
import { adminPool } from '../../_server/db';
import { fmtDate } from '../../_components/ui';
import { FxForm } from './fx-form';

export default async function ParametersPage() {
  await connection();
  const db = adminPool();
  const now = new Date();
  const [params, history, actor] = await Promise.all([
    listFxParameters(db),
    parameterHistory(db),
    getActor(),
  ]);
  const effective = params.find(
    (p) => new Date(p.validFrom) <= now && (!p.validTo || new Date(p.validTo) > now),
  );
  return (
    <>
      <div className="crumbs">
        <Link href="/admin/pricing">Precios</Link> / Parámetros FX
      </div>
      <h1 className="adm-h1">FX USD → MXN</h1>
      <p className="adm-sub">
        Parámetro maestro controlado por DTG (sin llamadas a APIs externas). Cada revisión tiene
        vigencia; las futuras no cambian el precio de hoy y las pasadas no se reescriben. El valor
        actual (16.5) es <span className="badge b-warn">PROVISIONAL TECHNICAL BEHAVIOR</span>.
      </p>
      <div className="panel">
        <h2 className="adm-h2">Revisiones</h2>
        <table className="t" data-testid="fx-list">
          <thead>
            <tr>
              <th className="num">Valor</th>
              <th>Desde</th>
              <th>Hasta</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {params.map((p) => (
              <tr key={p.id}>
                <td className="num">{Number(p.value).toFixed(2)}</td>
                <td className="small">{fmtDate(p.validFrom)}</td>
                <td className="small">{p.validTo ? fmtDate(p.validTo) : 'abierta'}</td>
                <td className="small">
                  {p.id === effective?.id ? (
                    <span className="badge b-ok">vigente</span>
                  ) : new Date(p.validFrom) > now ? (
                    <span className="badge b-info">futura</span>
                  ) : (
                    <span className="badge b-plain">histórica</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="panel">
        <h2 className="adm-h2">Nueva revisión</h2>
        {can(actor, 'pricing.parameter') ? (
          <FxForm />
        ) : (
          <div className="notice warn small">
            Necesitas un actor local con permiso pricing.parameter.
          </div>
        )}
      </div>
      <div className="panel">
        <h2 className="adm-h2">Auditoría</h2>
        <table className="t">
          <thead>
            <tr>
              <th className="num">Rev. sistema</th>
              <th>Cuándo</th>
              <th>Quién</th>
              <th>Acción</th>
              <th className="num">Valor</th>
              <th>Motivo</th>
            </tr>
          </thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.revision}>
                <td className="num mono small">{h.revision}</td>
                <td className="small">{fmtDate(h.changedAt)}</td>
                <td className="small">{h.changedBy}</td>
                <td className="small">{h.action}</td>
                <td className="num">{h.value ? Number(h.value).toFixed(2) : '—'}</td>
                <td className="small">{h.reason ?? ''}</td>
              </tr>
            ))}
            {history.length === 0 && (
              <tr>
                <td colSpan={6} className="muted small">
                  Sin cambios desde la siembra.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
