'use client';

import { useState, useTransition } from 'react';
import type { BulkSummary } from '@/review/bulk';
import { remediationApplyAction, remediationPreviewAction } from '../../actions';
import { ValueInput, type Lists } from '../../_components/value-input';
import type { RemediationOption } from '@/db/admin/quality-views';

type Preview = { planSha256: string; summary: BulkSummary };
type Errors = { code: string; message: string }[];

/**
 * Explicit remediation of ONE rule through the existing bulk planner: pick the value, preview, then apply.
 * Nothing is preselected and nothing is written without a preview (the server refuses stale previews).
 */
export function RemediationPanel({
  option,
  lists,
  hasActor,
}: {
  option: RemediationOption;
  lists: Lists;
  hasActor: boolean;
}) {
  const [value, setValue] = useState<unknown>(undefined);
  const [reason, setReason] = useState('');
  const [overwrite, setOverwrite] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [errors, setErrors] = useState<Errors>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const reset = () => {
    setPreview(null);
    setErrors([]);
    setOverwrite(false);
  };
  const req = () => ({ ruleCode: option.ruleCode, value });

  const doPreview = () =>
    start(async () => {
      setMessage(null);
      const r = await remediationPreviewAction(req());
      if (r.ok) {
        setPreview({ planSha256: r.plan.planSha256, summary: r.summary });
        setErrors([]);
      } else {
        setPreview(null);
        setErrors(r.errors);
      }
    });
  const doApply = () =>
    start(async () => {
      if (!preview) return;
      const r = await remediationApplyAction({
        ...req(),
        planSha256: preview.planSha256,
        overwrite,
        reason: reason || undefined,
      });
      if (r.ok) {
        setMessage(
          `Aplicado: ${r.written} campos en ${r.candidates} candidatos. Quedó en la auditoría.`,
        );
        setValue(undefined);
        reset();
      } else setErrors(r.errors);
    });

  const s = preview?.summary;
  return (
    <div className="panel" data-testid="remediation-panel">
      <h2 className="adm-h2">
        Resolver en masa {option.ruleCode} · {option.label}
      </h2>
      <p className="small muted">
        {option.resolvable} candidatos resolubles en masa. Elige el valor, mira la vista previa y
        aplica. No se sobrescribe nada distinto sin confirmación expresa.
      </p>
      {!hasActor && <div className="notice warn small">Indica el actor arriba para aplicar.</div>}
      <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
        <ValueInput
          control={option.control}
          value={value}
          lists={lists}
          name="remediation-value"
          onChange={(v) => {
            setValue(v);
            reset();
          }}
        />
        <input
          type="text"
          placeholder="motivo (opcional)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          aria-label="Motivo"
        />
        <button
          className="btn"
          disabled={pending || value === undefined}
          onClick={doPreview}
          data-testid="remediation-preview"
        >
          Vista previa
        </button>
      </div>
      {errors.length > 0 && (
        <div className="notice bad small" role="alert" data-testid="remediation-errors">
          {errors.map((e) => `${e.code}: ${e.message}`).join(' · ')}
        </div>
      )}
      {s && (
        <div data-testid="remediation-summary">
          <p className="small">
            Seleccionados {s.selected} · cambiarían <strong>{s.wouldChange}</strong> · ya iguales{' '}
            {s.alreadySame} · con otro valor {s.hasOtherValue} · no aplica {s.notApplicable} ·
            bloqueados {s.blocked}
          </p>
          {s.overwriteNeeded > 0 && (
            <label className="small">
              <input
                type="checkbox"
                checked={overwrite}
                onChange={(e) => setOverwrite(e.target.checked)}
                data-testid="remediation-overwrite"
              />{' '}
              Confirmo sobrescribir {s.overwriteNeeded} valores distintos ya decididos
            </label>
          )}
          <div>
            <button
              className="btn btn-primary"
              disabled={pending || !hasActor || (s.wouldChange === 0 && !overwrite)}
              onClick={doApply}
              data-testid="remediation-apply"
            >
              Aplicar
            </button>
          </div>
        </div>
      )}
      {message && (
        <p className="small" role="status" data-testid="remediation-done">
          {message}
        </p>
      )}
    </div>
  );
}
