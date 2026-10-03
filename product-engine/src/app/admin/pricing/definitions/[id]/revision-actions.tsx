'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  authorizePriceRevisionAction,
  cloneToDraftAction,
  deletePriceDraftAction,
} from '../../../actions';

/** Lifecycle buttons. Visibility is a convenience: the server re-checks capability and state on every call. */
export function RevisionActions(p: {
  definitionId: string;
  status: string;
  canClone: boolean;
  nextRevisionId: string | null;
  canAuthorize: boolean;
  blocked: boolean;
}) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const run = (
    fn: () => Promise<{ ok: boolean; errors?: { message: string }[] } & Record<string, unknown>>,
    after: (r: Record<string, unknown>) => void,
  ) =>
    start(async () => {
      const r = await fn();
      if (r.ok) after(r);
      else setMsg({ ok: false, text: (r.errors ?? []).map((e) => e.message).join('; ') });
    });

  return (
    <div className="panel" data-testid="revision-actions">
      <div className="row">
        {p.canClone && (
          <button
            className="btn btn-primary"
            data-testid="clone-draft"
            disabled={pending}
            onClick={() =>
              run(
                () => cloneToDraftAction({ definitionId: p.definitionId }),
                (r) => router.push(`/admin/pricing/definitions/${String(r.definitionId)}`),
              )
            }
          >
            Crear nueva revisión (borrador)
          </button>
        )}
        {p.status === 'AUTHORIZED' && !p.canClone && p.nextRevisionId && (
          <a className="btn" href={`/admin/pricing/definitions/${p.nextRevisionId}`}>
            Ver la revisión siguiente
          </a>
        )}
        {p.status === 'DRAFT' && (
          <>
            <label className="small">
              Motivo
              <input
                value={reason}
                maxLength={500}
                onChange={(e) => setReason(e.target.value)}
                data-testid="authorize-reason"
              />
            </label>
            <button
              className="btn btn-primary"
              data-testid="authorize-price"
              disabled={pending || p.blocked || !p.canAuthorize}
              title={
                p.blocked
                  ? 'Hay conflictos que bloquean la autorización'
                  : !p.canAuthorize
                    ? 'Requiere el permiso price.authorize (quién lo tiene en producción: decisión D-016, abierta)'
                    : undefined
              }
              onClick={() =>
                run(
                  () =>
                    authorizePriceRevisionAction({
                      definitionId: p.definitionId,
                      reason: reason || null,
                    }),
                  () => {
                    setMsg({ ok: true, text: 'Revisión autorizada.' });
                    router.refresh();
                  },
                )
              }
            >
              Autorizar revisión
            </button>
            <button
              className="btn btn-danger"
              data-testid="delete-draft"
              disabled={pending}
              onClick={() =>
                run(
                  () =>
                    deletePriceDraftAction({
                      definitionId: p.definitionId,
                      reason: reason || null,
                    }),
                  () => router.push('/admin/pricing'),
                )
              }
            >
              Eliminar borrador
            </button>
          </>
        )}
        {p.status === 'SUPERSEDED' && (
          <span className="small muted">Revisión sustituida: historia, sin acciones.</span>
        )}
        {p.status === 'DRAFT' && !p.canAuthorize && (
          <span className="small muted" data-testid="authorize-capability-note">
            Autorizar requiere el permiso <span className="mono">price.authorize</span>. La
            asignación real (decisión D-016) sigue abierta.
          </span>
        )}
      </div>
      {msg && (
        <div
          className={`notice small ${msg.ok ? '' : 'bad'}`}
          role="status"
          data-testid="revision-msg"
        >
          {msg.text}
        </div>
      )}
    </div>
  );
}
