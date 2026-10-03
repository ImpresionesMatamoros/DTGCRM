'use client';

import { useState, useTransition } from 'react';
import type { SourceCategoryRow } from '@/db/admin/category-mapping';
import type { BulkSummary } from '@/review/bulk';
import { categoryApplyAction, categoryPreviewAction } from '../../actions';

type Preview = { planSha256: string; summary: BulkSummary };

export function CategoryMapper({
  rows,
  options,
  hasActor,
}: {
  rows: SourceCategoryRow[];
  options: { key: string; name: string }[];
  hasActor: boolean;
}) {
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [active, setActive] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const doPreview = (source: string) =>
    start(async () => {
      setMsg(null);
      setErr(null);
      setOverwrite(false);
      const r = await categoryPreviewAction({
        sourceCategory: source,
        categoryKey: choice[source],
      });
      if (r.ok) {
        setActive(source);
        setPreview({ planSha256: r.plan.planSha256, summary: r.summary });
      } else {
        setPreview(null);
        setActive(null);
        setErr(r.errors.map((e) => e.message).join('; '));
      }
    });
  const doApply = () =>
    start(async () => {
      if (!active || !preview) return;
      const r = await categoryApplyAction({
        sourceCategory: active,
        categoryKey: choice[active],
        planSha256: preview.planSha256,
        overwrite,
        reason: reason || undefined,
      });
      if (r.ok) {
        setMsg(`Mapeo registrado: ${active} → ${choice[active]} (${r.written} campos).`);
        setPreview(null);
        setActive(null);
      } else setErr(r.errors.map((e) => e.message).join('; '));
    });

  return (
    <div className="panel">
      {!hasActor && <div className="notice warn small">Indica el actor arriba para aplicar.</div>}
      {msg && (
        <div className="notice small" role="status" data-testid="mapping-done">
          {msg}
        </div>
      )}
      {err && (
        <div className="notice bad small" role="alert">
          {err}
        </div>
      )}
      <table className="t" data-testid="categories-table">
        <thead>
          <tr>
            <th>Origen</th>
            <th className="num">Candidatos</th>
            <th className="num">Con categoría</th>
            <th>Familias / ejemplos</th>
            <th>Categoría del Product Engine</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.sourceCategory} data-source-category={r.sourceCategory}>
              <td className="mono">{r.sourceCategory}</td>
              <td className="num">{r.candidates}</td>
              <td className="num">
                {r.resolved}
                <div className="small muted">
                  {Object.entries(r.resolvedAs)
                    .map(([k, n]) => `${k}: ${n}`)
                    .join(' · ')}
                </div>
              </td>
              <td className="small muted">
                {r.families.join(', ')} · {r.sampleNames.slice(0, 3).join(', ')}
              </td>
              <td>
                <div className="row">
                  <select
                    aria-label={`Categoría para ${r.sourceCategory}`}
                    value={choice[r.sourceCategory] ?? ''}
                    onChange={(e) => {
                      setChoice({ ...choice, [r.sourceCategory]: e.target.value });
                      setPreview(null);
                      setActive(null);
                    }}
                  >
                    <option value="">— sin elegir —</option>
                    {options.map((o) => (
                      <option key={o.key} value={o.key}>
                        {o.name} ({o.key})
                      </option>
                    ))}
                  </select>
                  <button
                    className="btn"
                    disabled={pending || !choice[r.sourceCategory]}
                    onClick={() => doPreview(r.sourceCategory)}
                    data-testid="mapping-preview"
                  >
                    Vista previa
                  </button>
                </div>
                {active === r.sourceCategory && preview && (
                  <div className="small" data-testid="mapping-summary">
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
                    <div className="row">
                      <input
                        type="text"
                        placeholder="motivo (opcional)"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                      />
                      <button
                        className="btn btn-primary"
                        disabled={pending || !hasActor}
                        onClick={doApply}
                        data-testid="mapping-apply"
                      >
                        Aplicar mapeo
                      </button>
                    </div>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
