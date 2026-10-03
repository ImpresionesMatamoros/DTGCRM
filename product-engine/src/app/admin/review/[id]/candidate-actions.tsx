'use client';

import { useState, useTransition } from 'react';
import {
  approveAction,
  publishFixtureAction,
  rejectAction,
  withdrawApprovalAction,
} from '../../actions';

/**
 * Resolve · Approve · Publish stay separate. The buttons only reflect what the
 * server already said (open fields, status, data class); every action is
 * re-validated on the server. REAL publication has no button that works.
 */
export function CandidateActions({
  candidateId,
  reviewStatus,
  dataClass,
  openFields,
  blocked,
  hasActor,
  approval,
  rejection,
  publication,
}: {
  candidateId: string;
  reviewStatus: string;
  dataClass: 'REAL' | 'FIXTURE';
  openFields: string[];
  blocked: boolean;
  hasActor: boolean;
  approval: { by: string | null; at: string | null; sha256: string | null };
  rejection: { by: string | null; at: string | null; reason: string | null };
  publication: { by: string | null; at: string | null };
}) {
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<{ code: string; message: string; field?: string }[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (
    fn: () => Promise<{
      ok: boolean;
      errors?: { code: string; message: string; field?: string }[];
    }>,
    ok: string,
  ) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        setErrors([]);
        setReason('');
        setMessage(ok);
      } else setErrors(r.errors ?? []);
    });

  const editable = reviewStatus === 'VALID' || reviewStatus === 'WARNING';
  const approveBlockedBy = !hasActor
    ? 'falta el actor'
    : blocked
      ? 'el candidato está bloqueado'
      : !editable
        ? `el candidato está ${reviewStatus}`
        : openFields.length > 0
          ? `faltan: ${openFields.join(', ')}`
          : null;

  return (
    <div
      style={{ borderTop: '1px solid var(--line)', marginTop: 10, paddingTop: 10 }}
      data-testid="candidate-actions"
    >
      {reviewStatus === 'APPROVED' && (
        <div className="notice info small">
          Aprobado por {approval.by} el {approval.at?.replace('T', ' ').slice(0, 19)} · hash{' '}
          <span className="mono">{approval.sha256?.slice(0, 16)}…</span>
        </div>
      )}
      {reviewStatus === 'REJECTED' && (
        <div className="notice small">
          Rechazado por {rejection.by}: {rejection.reason}
        </div>
      )}
      {reviewStatus === 'PUBLISHED' && (
        <div className="notice ok small">
          Publicado por {publication.by} el {publication.at?.replace('T', ' ').slice(0, 19)}
        </div>
      )}
      <div className="row">
        <button
          className="btn btn-primary"
          disabled={pending || approveBlockedBy !== null}
          title={approveBlockedBy ?? 'Aprueba la resolución guardada'}
          onClick={() =>
            run(
              () => approveAction({ candidateId, reason: reason || undefined }),
              'Aprobado. No se publicó nada.',
            )
          }
          data-testid="approve"
        >
          Aprobar
        </button>
        {approveBlockedBy && editable && (
          <span className="small muted">No se puede aprobar: {approveBlockedBy}</span>
        )}
        {!approveBlockedBy && (
          <span className="small muted">
            Aprueba la resolución guardada (no los cambios sin guardar).
          </span>
        )}
        {reviewStatus === 'APPROVED' && (
          <button
            className="btn"
            disabled={pending || !hasActor || !reason.trim()}
            title={!reason.trim() ? 'Escribe el motivo' : undefined}
            onClick={() =>
              run(() => withdrawApprovalAction({ candidateId, reason }), 'Aprobación retirada.')
            }
          >
            Retirar aprobación
          </button>
        )}
        {(editable || reviewStatus === 'BLOCKED' || reviewStatus === 'APPROVED') && (
          <button
            className="btn btn-danger"
            disabled={pending || !hasActor || !reason.trim()}
            title={!reason.trim() ? 'Escribe el motivo' : undefined}
            onClick={() => run(() => rejectAction({ candidateId, reason }), 'Rechazado.')}
          >
            Rechazar
          </button>
        )}
      </div>
      <input
        type="text"
        placeholder="motivo (obligatorio para rechazar o retirar la aprobación)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        style={{ width: '100%', marginTop: 6 }}
      />
      <div className="row" style={{ marginTop: 8 }}>
        {dataClass === 'FIXTURE' ? (
          <button
            className="btn"
            disabled={pending || !hasActor || reviewStatus !== 'APPROVED'}
            title={
              reviewStatus !== 'APPROVED'
                ? 'Sólo un candidato APPROVED'
                : 'Escribe en el dominio (sólo FIXTURE DEV/TEST)'
            }
            onClick={() => run(() => publishFixtureAction({ candidateId }), 'Publicado (FIXTURE).')}
          >
            Publicar FIXTURE
          </button>
        ) : (
          <>
            <button className="btn" disabled data-testid="publish-real-disabled">
              Publicar
            </button>
            <span className="small muted">
              Publicación REAL deshabilitada en STEP 06:{' '}
              <span className="mono">PUBLICATION_ENABLED_FOR = [&apos;FIXTURE&apos;]</span>.
              Habilitarla es decisión del dueño (P1-09).
            </span>
          </>
        )}
      </div>
      {message && (
        <div className="notice ok small" role="status">
          {message}
        </div>
      )}
      {errors.length > 0 && (
        <div className="notice bad small" role="alert">
          {errors.map((e, i) => (
            <div key={i}>
              <span className="mono">{e.code}</span> {e.field ? `(${e.field}) ` : ''}
              {e.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
