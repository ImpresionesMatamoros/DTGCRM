'use client';

import { useState, useTransition } from 'react';
import {
  approveMigrationPermitAction,
  runMigrationPublicationAction,
  simulateMigrationAction,
} from '../actions';

type Line = { itemLegacyId: string; ok: boolean; publicCode: string | null; errors: string[] };

export function MigrationControls({
  permitId,
  canApprove,
  canPublish,
  hasActor,
}: {
  permitId: string | null;
  canApprove: boolean;
  canPublish: boolean;
  hasActor: boolean;
}) {
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[] | null>(null);
  const [pending, start] = useTransition();
  const errText = (r: { errors: { message: string }[] }) =>
    r.errors.map((e) => e.message).join('; ');

  const simulate = () =>
    start(async () => {
      setMsg(null);
      setErr(null);
      const r = await simulateMigrationAction({ reason: reason || undefined });
      if (r.ok) {
        setLines(r.items);
        setMsg(
          `Simulación (nada se escribió): ${r.items.filter((i) => i.ok).length} de ${r.items.length} items se publicarían.`,
        );
      } else setErr(errText(r));
    });
  const approve = () =>
    start(async () => {
      setMsg(null);
      setErr(null);
      const r = await approveMigrationPermitAction({ reason });
      if (r.ok)
        setMsg(
          r.created
            ? `Permiso aprobado (${r.items} candidatos). Todavía no se publicó nada.`
            : 'El permiso vigente ya cubre exactamente estos candidatos.',
        );
      else setErr(errText(r));
    });
  const publish = () =>
    start(async () => {
      if (!permitId) return;
      setMsg(null);
      setErr(null);
      const r = await runMigrationPublicationAction({ permitId });
      if (r.ok) {
        setLines(r.items);
        setMsg(`Publicación ejecutada: ${r.items.filter((i) => i.ok).length} items.`);
      } else setErr(errText(r));
    });

  return (
    <div style={{ marginTop: 10 }}>
      {!hasActor && <div className="notice warn small">Indica el actor arriba para actuar.</div>}
      {!canApprove && (
        <div className="notice small" data-testid="migration-blocked">
          Aprobar o publicar la migración REAL requiere el permiso del dueño (migration.approve /
          migration.publish). Con este actor sólo puedes mirar.
        </div>
      )}
      {msg && (
        <div className="notice small" role="status" data-testid="migration-msg">
          {msg}
        </div>
      )}
      {err && (
        <div className="notice bad small" role="alert" data-testid="migration-err">
          {err}
        </div>
      )}
      {canApprove && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <input
            aria-label="Motivo de la aprobación"
            placeholder="Motivo (obligatorio para aprobar)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={1000}
            style={{ minWidth: 340 }}
          />
          <button
            className="btn"
            type="button"
            disabled={pending}
            onClick={simulate}
            data-testid="migration-simulate"
          >
            Simular publicación
          </button>
          <button
            className="btn"
            type="button"
            disabled={pending || reason.trim().length < 10}
            onClick={approve}
            data-testid="migration-approve"
          >
            Aprobar permiso
          </button>
          {canPublish && (
            <button
              className="btn primary"
              type="button"
              disabled={pending || !permitId}
              onClick={publish}
              data-testid="migration-publish"
            >
              Publicar bajo el permiso
            </button>
          )}
        </div>
      )}
      {lines && (
        <ul className="small" data-testid="migration-lines">
          {lines.map((l) => (
            <li key={l.itemLegacyId}>
              {l.itemLegacyId}: {l.ok ? `OK ${l.publicCode ?? ''}` : `FALLA ${l.errors.join('; ')}`}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
