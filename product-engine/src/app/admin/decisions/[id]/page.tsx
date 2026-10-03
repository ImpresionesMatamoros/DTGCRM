import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { decisionLinks } from '@/db/admin/decisions';
import { decisionById, PRICING_RELEVANCE } from '@/decisions/reference';
import { answerHistory } from '@/db/admin/decision-answers';
import { decisionControl, resolutionLists } from '@/db/admin/quality-views';
import { can } from '@/admin/permissions';
import { adminPool } from '../../_server/db';
import { getActor } from '../../_server/actor';
import { AnswerPanel } from './answer-panel';
import { Kv } from '../../_components/ui';

export default async function DecisionPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const decision = decisionById(id);
  if (!decision) notFound();
  const db = adminPool();
  const [links, history, actor, lists] = await Promise.all([
    decisionLinks(db, decision),
    answerHistory(db, decision.id),
    getActor(),
    resolutionLists(db),
  ]);
  const current = history.length ? history[history.length - 1]! : null;
  const relevance = PRICING_RELEVANCE[decision.id];
  const reviewHref = links.candidates.length
    ? `/admin/review?ids=${links.candidates.map((c) => c.id).join(',')}`
    : null;
  return (
    <>
      <div className="crumbs">
        <Link href="/admin/decisions">Decisiones</Link> / {decision.id}
      </div>
      <h1 className="adm-h1">
        <span className="mono">{decision.id}</span> · {decision.title}{' '}
        <span className={`badge ${decision.priority === 'P1' ? 'b-bad' : 'b-plain'}`}>
          {decision.priority}
        </span>
      </h1>
      <p className="adm-sub">
        Estado: <strong data-testid="decision-state">{current ? 'RESPONDIDA' : 'ABIERTA'}</strong> ·
        respuesta:{' '}
        <strong data-testid="decision-answer">{current ? current.summary : 'sin respuesta'}</strong>
        . Nada de lo que aparece aquí se aplica automáticamente.
      </p>

      <div className="panel">
        <Kv
          rows={[
            ['Pregunta', decision.question],
            ['Por qué importa', decision.whyNeeded],
            ['Ya se sabe', decision.alreadyKnown],
            [
              'Alternativas observadas',
              decision.alternatives.length ? decision.alternatives.join(' · ') : '—',
            ],
            ['Responde', decision.owner],
            ['Impacto', decision.downstreamImpact],
            [
              '¿Se puede seguir preparando sin ella?',
              decision.canPreparationContinue === 'YES' ? 'sí' : decision.canPreparationContinue,
            ],
            [
              '¿Se puede publicar el alcance afectado?',
              decision.canAffectedScopePublish === 'NO' ? 'no' : decision.canAffectedScopePublish,
            ],
          ]}
        />
      </div>

      <AnswerPanel
        decisionId={decision.id}
        affected={decision.affected.map((a) => ({ legacyId: a.legacyId, name: a.name }))}
        current={current}
        history={history}
        application={decisionControl(decision.id)}
        canRecord={!!actor && can(actor, 'decision.record')}
        hasActor={!!actor}
        lists={lists}
      />

      {relevance && (
        <div className="panel" data-testid="pricing-relevance" style={{ borderColor: '#efd49a' }}>
          <h2 className="adm-h2">Relevancia para precios</h2>
          <p className="small">{relevance.frozenBehaviour}</p>
          <p className="small muted">{relevance.adminHint}</p>
          {links.items.length > 0 && (
            <p className="small">
              Artículos del Product Engine:{' '}
              {links.items.map((i) => (
                <Link
                  key={i.id}
                  href={`/admin/pricing/${i.id}`}
                  className="badge b-outline"
                  data-testid="decision-item-link"
                >
                  {i.publicCode} · {i.name}
                </Link>
              ))}
            </p>
          )}
        </div>
      )}

      <div className="panel">
        <div className="spread">
          <h2 className="adm-h2">
            Candidatos afectados ({decision.affected.length}; {links.candidates.length} en staging)
          </h2>
          {reviewHref ? (
            <Link className="btn btn-primary" href={reviewHref} data-testid="open-in-review">
              Abrir en la bandeja de Revisión
            </Link>
          ) : (
            <span className="small muted">Ningún candidato en staging.</span>
          )}
        </div>
        <p className="small muted">
          Se abre la bandeja existente (STEP 06) filtrada por estos candidatos; allí está la
          resolución masiva. Esta pantalla no modifica nada.
        </p>
        <table className="t" data-testid="decision-candidates">
          <thead>
            <tr>
              <th>ID legado</th>
              <th>Nombre</th>
              <th>Revisión</th>
            </tr>
          </thead>
          <tbody>
            {decision.affected.map((a) => {
              const c = links.candidates.find((x) => x.legacyId === a.legacyId);
              return (
                <tr key={a.legacyId}>
                  <td className="mono small">{a.legacyId}</td>
                  <td>{a.name}</td>
                  <td className="small">
                    {c ? (
                      <Link href={`/admin/review/${c.id}`}>{c.reviewStatus}</Link>
                    ) : (
                      <span className="muted">no está en staging</span>
                    )}
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
