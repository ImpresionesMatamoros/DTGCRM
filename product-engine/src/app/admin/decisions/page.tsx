import Link from 'next/link';
import { connection } from 'next/server';
import { decisionStates } from '@/db/admin/decision-answers';
import { DECISION_SOURCE, PRICING_RELEVANCE, decisionById } from '@/decisions/reference';
import { adminPool } from '../_server/db';

export default async function DecisionsPage() {
  await connection();
  const states = await decisionStates(adminPool());
  return (
    <>
      <h1 className="adm-h1">Decisiones del dueño (STEP 05C)</h1>
      <p className="adm-sub">
        {states.filter((s) => s.status === 'OPEN').length} abiertas de {states.length}.{' '}
        <strong>La aplicación nunca responde una decisión</strong>: sólo registra, con actor y
        fecha, la respuesta que una persona autorizada da, y recién entonces permite aplicarla con
        vista previa. Fuente: <span className="mono">{DECISION_SOURCE.source}</span>.
      </p>
      <div className="panel">
        <table className="t" data-testid="decisions-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Prioridad</th>
              <th>Decisión</th>
              <th>Estado</th>
              <th className="num">Afectados</th>
              <th className="num">En staging</th>
              <th>¿Se puede seguir preparando?</th>
              <th>¿Publicar el alcance sin ella?</th>
              <th>Precio</th>
            </tr>
          </thead>
          <tbody>
            {states.map((st) => {
              const d = decisionById(st.id)!;
              const stagedCandidates = st.stagedCandidates;
              return (
                <tr key={d.id} data-decision={d.id}>
                  <td className="mono">
                    <Link href={`/admin/decisions/${d.id}`}>{d.id}</Link>
                  </td>
                  <td>
                    <span className={`badge ${d.priority === 'P1' ? 'b-bad' : 'b-plain'}`}>
                      {d.priority}
                    </span>
                  </td>
                  <td>{d.title}</td>
                  <td data-testid="decision-status">
                    <span className={`badge ${st.status === 'OPEN' ? 'b-warn' : 'b-ok'}`}>
                      {st.status === 'OPEN' ? 'ABIERTA' : 'RESPONDIDA'}
                    </span>
                  </td>
                  <td className="num">{d.affected.length}</td>
                  <td className="num">{stagedCandidates}</td>
                  <td className="small">
                    {d.canPreparationContinue === 'YES' ? 'sí' : d.canPreparationContinue}
                  </td>
                  <td className="small">
                    {d.canAffectedScopePublish === 'NO'
                      ? 'no'
                      : d.canAffectedScopePublish.toLowerCase().replace(/_/g, ' ')}
                  </td>
                  <td className="small">
                    {PRICING_RELEVANCE[d.id] ? <span className="badge b-warn">precio</span> : ''}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
