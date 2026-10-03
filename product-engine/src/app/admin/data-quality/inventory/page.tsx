import Link from 'next/link';
import { connection } from 'next/server';
import { qualityOverview } from '@/db/admin/quality-views';
import { adminPool } from '../../_server/db';
import { Badge } from '../../_components/ui';
import { QualityTabs } from '../nav';

const TONE = { BLOCKER: 'bad', WARNING: 'warn', INFO: 'info' } as const;

export default async function InventoryPage() {
  await connection();
  const o = await qualityOverview(adminPool());
  return (
    <>
      <h1 className="adm-h1">Inventario de reglas</h1>
      <p className="adm-sub">
        Todas las reglas, también las que hoy no encuentran nada. Dice qué se puede resolver en
        masa, qué es manual y qué espera al dueño.
      </p>
      <QualityTabs />
      <div className="panel">
        <div className="t-wrap">
          <table className="t" data-testid="inventory-table">
            <thead>
              <tr>
                <th>Regla</th>
                <th>Descripción</th>
                <th>Severidad</th>
                <th className="num">Afectados</th>
                <th>Tipos</th>
                <th>Decisión</th>
                <th className="num">En masa</th>
                <th className="num">Dueño</th>
                <th className="num">Manual</th>
                <th className="num">Fuente</th>
              </tr>
            </thead>
            <tbody>
              {o.inventory.map((r) => (
                <tr key={r.ruleCode} data-rule={r.ruleCode}>
                  <td className="mono small">
                    {r.affected > 0 ? (
                      <Link href={`/admin/data-quality/issues?rule=${r.ruleCode}`}>
                        {r.ruleCode}
                      </Link>
                    ) : (
                      r.ruleCode
                    )}
                    <div className="muted">v{r.version}</div>
                  </td>
                  <td className="small">
                    <strong>{r.title}</strong>
                    <div className="muted">{r.description}</div>
                    {r.bulkField && <div className="mono muted">bulk: {r.bulkField}</div>}
                  </td>
                  <td>
                    <Badge tone={TONE[r.severity]}>{r.severity}</Badge>
                  </td>
                  <td className="num">{r.affected}</td>
                  <td className="small">{r.candidateKinds.join(', ')}</td>
                  <td className="small">{r.ownerDecisions.join(', ')}</td>
                  <td className="num">{r.bulkResolvable}</td>
                  <td className="num">{r.ownerDecisionRequired}</td>
                  <td className="num">{r.manualReview}</td>
                  <td className="num">{r.sourceFix}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
