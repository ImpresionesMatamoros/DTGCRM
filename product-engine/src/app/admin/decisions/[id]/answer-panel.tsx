'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { AnswerView } from '@/db/admin/decision-answers';
import type { FieldControl } from '@/review/fields';
import type { BulkSummary } from '@/review/bulk';
import { decisionApplyAction, decisionPreviewAction, recordDecisionAction } from '../../actions';
import { ValueInput, type Lists } from '../../_components/value-input';
import { fmtDate } from '../../_components/ui';

type Assignment = { value: unknown; legacyIds: string[] };
type Preview = { index: number; planSha256: string; summary: BulkSummary };

/**
 * Records what the owner answered (never answers by itself) and, if the decision has a machine form,
 * previews/applies it through the bulk planner. Recording needs the `decision.record` role.
 */
export function AnswerPanel({
  decisionId,
  affected,
  current,
  history,
  application,
  canRecord,
  hasActor,
  lists,
}: {
  decisionId: string;
  affected: { legacyId: string; name: string }[];
  current: AnswerView | null;
  history: AnswerView[];
  application: { field: string; label: string; control: FieldControl } | null;
  canRecord: boolean;
  hasActor: boolean;
  lists: Lists;
}) {
  const router = useRouter();
  const [summary, setSummary] = useState('');
  const [notes, setNotes] = useState('');
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [draftValue, setDraftValue] = useState<unknown>(undefined);
  const [draftAll, setDraftAll] = useState(true);
  const [errors, setErrors] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const addAssignment = () => {
    if (draftValue === undefined) return;
    setAssignments([
      ...assignments,
      { value: draftValue, legacyIds: draftAll ? affected.map((a) => a.legacyId) : [] },
    ]);
    setDraftValue(undefined);
  };
  const record = () =>
    start(async () => {
      setErrors(null);
      const r = await recordDecisionAction({
        decisionId,
        summary,
        notes: notes || undefined,
        assignments: assignments.length ? assignments : undefined,
      });
      if (r.ok) {
        setSummary('');
        setNotes('');
        setAssignments([]);
        setMsg('Respuesta registrada con actor y fecha.');
        router.refresh();
      } else setErrors(r.errors.map((e) => `${e.field ?? ''} ${e.message}`).join('; '));
    });
  const doPreview = (index: number) =>
    start(async () => {
      setErrors(null);
      setOverwrite(false);
      const r = await decisionPreviewAction({ decisionId, index });
      if (r.ok) setPreview({ index, planSha256: r.plan.planSha256, summary: r.summary });
      else {
        setPreview(null);
        setErrors(r.errors.map((e) => e.message).join('; '));
      }
    });
  const doApply = () =>
    start(async () => {
      if (!preview) return;
      const r = await decisionApplyAction({
        decisionId,
        index: preview.index,
        planSha256: preview.planSha256,
        overwrite,
        reason: `Respuesta registrada de ${decisionId}`,
      });
      if (r.ok) {
        setMsg(
          `Aplicado: ${r.written} campos en ${r.candidates} candidatos (origen DECISION_GROUP ${decisionId}).`,
        );
        setPreview(null);
        router.refresh();
      } else setErrors(r.errors.map((e) => e.message).join('; '));
    });

  return (
    <div className="panel" data-testid="answer-panel">
      <h2 className="adm-h2">Respuesta del dueño</h2>
      {current ? (
        <div data-testid="current-answer">
          <p>
            <span className="badge b-ok">RESPONDIDA</span> rev. {current.revision} por{' '}
            <strong>{current.actor}</strong> el {fmtDate(current.answeredAt)}
          </p>
          <p>{current.summary}</p>
          {current.notes && <p className="small muted">{current.notes}</p>}
          {current.assignments.map((a, i) => (
            <div key={i} className="small" data-testid="answer-assignment">
              <span className="mono">{JSON.stringify(a.value)}</span> → {a.legacyIds.length}{' '}
              artículos{' '}
              {application && (
                <button
                  className="btn"
                  disabled={pending || !hasActor}
                  onClick={() => doPreview(i)}
                  data-testid="assignment-preview"
                >
                  Vista previa de aplicar
                </button>
              )}
            </div>
          ))}
          {preview && (
            <div className="small" data-testid="assignment-summary">
              Cambiarían <strong>{preview.summary.wouldChange}</strong> · ya iguales{' '}
              {preview.summary.alreadySame} · con otro valor {preview.summary.hasOtherValue}
              {preview.summary.overwriteNeeded > 0 && (
                <label style={{ display: 'block' }}>
                  <input
                    type="checkbox"
                    checked={overwrite}
                    onChange={(e) => setOverwrite(e.target.checked)}
                  />{' '}
                  Confirmo sobrescribir {preview.summary.overwriteNeeded} valores distintos
                </label>
              )}
              <button
                className="btn btn-primary"
                disabled={pending || !hasActor}
                onClick={doApply}
                data-testid="assignment-apply"
              >
                Aplicar
              </button>
            </div>
          )}
          {history.length > 1 && (
            <details className="small">
              <summary>Historial ({history.length} revisiones)</summary>
              {history.map((h) => (
                <div key={h.id}>
                  rev. {h.revision} · {h.actor} · {fmtDate(h.answeredAt)} · {h.summary}
                </div>
              ))}
            </details>
          )}
        </div>
      ) : (
        <p>
          <span className="badge b-warn">ABIERTA</span> sin respuesta registrada.
        </p>
      )}
      {msg && (
        <div className="notice small" role="status" data-testid="answer-done">
          {msg}
        </div>
      )}
      {errors && (
        <div className="notice bad small" role="alert" data-testid="answer-errors">
          {errors}
        </div>
      )}

      {canRecord ? (
        <div style={{ marginTop: 10 }}>
          <h3 className="adm-h2">
            {current ? 'Registrar una nueva revisión' : 'Registrar la respuesta'}
          </h3>
          <p className="small muted">
            Escribe lo que el dueño decidió, en sus palabras. Esto sólo lo registra (decisión,
            respuesta, actor, fecha, notas); no cambia ningún candidato.
          </p>
          <textarea
            aria-label="Respuesta"
            rows={2}
            style={{ width: '100%' }}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="Respuesta del dueño"
          />
          <textarea
            aria-label="Notas"
            rows={1}
            style={{ width: '100%' }}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notas (opcional)"
          />
          {application && (
            <div className="small">
              <strong>Forma aplicable: {application.label}</strong> (opcional)
              {assignments.map((a, i) => (
                <div key={i} className="mono">
                  {JSON.stringify(a.value)} → {a.legacyIds.length} artículos
                </div>
              ))}
              <div className="row">
                <ValueInput
                  control={application.control}
                  value={draftValue}
                  lists={lists}
                  name="answer-value"
                  onChange={setDraftValue}
                />
                <label>
                  <input
                    type="checkbox"
                    checked={draftAll}
                    onChange={(e) => setDraftAll(e.target.checked)}
                  />{' '}
                  todos los {affected.length} afectados
                </label>
                <button
                  className="btn"
                  onClick={addAssignment}
                  disabled={draftValue === undefined || !draftAll}
                >
                  Agregar
                </button>
              </div>
            </div>
          )}
          <button
            className="btn btn-primary"
            disabled={pending || !summary.trim()}
            onClick={record}
            data-testid="record-answer"
          >
            Registrar respuesta
          </button>
        </div>
      ) : (
        <p className="small muted">
          Sólo un actor con el rol de registro de decisiones puede registrar la respuesta del dueño
          (<span className="mono">DTG_DECISION_RECORDERS</span>).
        </p>
      )}
    </div>
  );
}
