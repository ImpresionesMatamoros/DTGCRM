'use client';

import Link from 'next/link';
import { useMemo, useState, useTransition } from 'react';
import type { ReviewRow } from '@/db/admin/review';
import type { BulkPlan } from '@/review/bulk';
import type { FieldControl } from '@/review/fields';
import { KIND_LABELS, SKIP_REASON_LABELS } from '@/review/labels';
import { bulkApplyAction, bulkPreviewAction } from '../actions';
import { ValueInput, type Lists } from '../_components/value-input';

export interface BulkFieldMeta {
  field: string;
  label: string;
  control: FieldControl;
}

type Preview = { plan: BulkPlan; labels: Record<string, string> };
type Errors = { code: string; message: string; field?: string }[];

const TONE: Record<string, string> = {
  REVIEWED: 'b-info',
  SOURCE: 'b-plain',
  UNRESOLVED: 'b-unres',
  NOT_SET: 'b-plain',
};
const STATUS_TONE: Record<string, string> = {
  PENDING: 'b-plain',
  VALID: 'b-ok',
  WARNING: 'b-warn',
  BLOCKED: 'b-bad',
  APPROVED: 'b-info',
  REJECTED: 'b-plain',
  PUBLISHED: 'b-ok',
};

const show = (v: unknown, state: string) =>
  v === undefined
    ? state === 'NOT_SET'
      ? '—'
      : '?'
    : typeof v === 'object'
      ? JSON.stringify(v)
      : String(v);

export function ReviewTable({
  matching,
  rows,
  total,
  bulkFields,
  categories,
  methods,
  hasActor,
}: {
  /** Every id matching the current filters, by kind (null when more than 2000). */
  matching: { total: number; byKind: Record<string, string[]> } | null;
  rows: ReviewRow[];
  total: number;
  bulkFields: Record<string, BulkFieldMeta[]>;
  categories: Lists['categories'];
  methods: Lists['methods'];
  hasActor: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [kind, setKind] = useState<string>('');
  const [field, setField] = useState<string>('');
  const [value, setValue] = useState<unknown>(undefined);
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [errors, setErrors] = useState<Errors>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const kindOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const [k, ids] of Object.entries(matching?.byKind ?? {}))
      for (const id of ids) m.set(id, k);
    for (const r of rows) m.set(r.id, r.kind);
    return m;
  }, [rows, matching]);
  const selectedKinds = useMemo(() => {
    const m = new Map<string, number>();
    for (const id of selected) {
      const k = kindOf.get(id);
      if (k) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [kindOf, selected]);
  const selectAllMatching = () => {
    setSelected(new Set(kindOf.keys()));
    resetPlan();
  };
  const effectiveKind = kind || (selectedKinds.size === 1 ? [...selectedKinds.keys()][0]! : '');
  const fields = effectiveKind ? (bulkFields[effectiveKind] ?? []) : [];
  const meta = fields.find((f) => f.field === field);

  const resetPlan = () => {
    setPreview(null);
    setOverwrite(false);
    setErrors([]);
  };
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
    resetPlan();
  };
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const togglePage = () => {
    const next = new Set(selected);
    for (const r of rows) {
      if (allOnPage) next.delete(r.id);
      else next.add(r.id);
    }
    setSelected(next);
    resetPlan();
  };

  const request = () => ({
    candidateIds: [...selected],
    kind: effectiveKind,
    changes: { [field]: value },
  });

  const doPreview = () =>
    start(async () => {
      setMessage(null);
      const r = await bulkPreviewAction(request());
      if (r.ok) {
        setPreview({ plan: r.plan, labels: r.labels });
        setErrors([]);
      } else {
        setPreview(null);
        setErrors(r.errors);
      }
    });

  const doApply = () =>
    start(async () => {
      if (!preview) return;
      const r = await bulkApplyAction({
        ...request(),
        planSha256: preview.plan.planSha256,
        overwrite,
        reason: reason || undefined,
      });
      if (r.ok) {
        setMessage(
          `Aplicado: ${r.written} campos en ${r.candidates} candidatos (operación ${r.bulkOperationId.slice(0, 8)}…). Quedó en la auditoría.`,
        );
        setSelected(new Set());
        resetPlan();
      } else {
        setErrors(r.errors);
      }
    });

  const plan = preview?.plan;
  const differents = plan?.entries.filter((e) => e.classification === 'DIFFERENT') ?? [];
  const writes = plan
    ? plan.counts.affected + (overwrite ? new Set(differents.map((d) => d.candidateId)).size : 0)
    : 0;

  return (
    <div className="panel">
      <div className="spread">
        <span className="small muted">
          {total} candidatos · {selected.size} seleccionados
          {matching && matching.total > rows.length && selected.size < matching.total && (
            <>
              {' · '}
              <button className="btn-link small" onClick={selectAllMatching}>
                seleccionar los {matching.total} que cumplen el filtro
              </button>
            </>
          )}
        </span>
        {message && (
          <span className="small" role="status">
            {message}
          </span>
        )}
      </div>
      <div className="t-wrap">
        <table className="t" data-testid="review-table">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  aria-label="Seleccionar página"
                  checked={allOnPage}
                  onChange={togglePage}
                />
              </th>
              <th>Candidato</th>
              <th>Tipo</th>
              <th>Revisión</th>
              <th>Campos</th>
              <th>Origen</th>
              <th className="num">Issues</th>
              <th>Señales</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} data-candidate={r.lineageKey}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Seleccionar ${r.label ?? r.lineageKey}`}
                    checked={selected.has(r.id)}
                    onChange={() => toggle(r.id)}
                  />
                </td>
                <td>
                  <Link href={`/admin/review/${r.id}`}>{r.label ?? r.lineageKey}</Link>
                  {r.itemName && r.itemName !== r.label && (
                    <div className="small muted">item: {r.itemName}</div>
                  )}
                  <div className="small muted mono">{r.itemLegacyId ?? r.lineageKey}</div>
                </td>
                <td>
                  <span className="badge b-outline">{r.kind}</span>
                </td>
                <td>
                  <span className={`badge ${STATUS_TONE[r.reviewStatus] ?? 'b-plain'}`}>
                    {r.reviewStatus}
                  </span>
                  {r.openFields.length > 0 && (
                    <div className="small unres" title={r.openFields.join(', ')}>
                      ⚠ {r.openFields.length} sin resolver
                    </div>
                  )}
                </td>
                <td className="small">
                  {r.summary.map((s) => (
                    <div key={s.field}>
                      <span className="muted">{s.label}:</span>{' '}
                      <span className={`badge ${TONE[s.state] ?? 'b-plain'}`}>
                        {show(s.value, s.state)}
                      </span>
                    </div>
                  ))}
                </td>
                <td className="small nowrap">
                  {r.sheet ? `${r.sheet}!${r.cell ?? ''}` : '—'}
                  {r.row !== null && <div className="muted">fila {r.row}</div>}
                </td>
                <td className="num small">
                  {r.errors > 0 && <span className="badge b-bad">{r.errors} E</span>}{' '}
                  {r.warnings > 0 && <span className="badge b-warn">{r.warnings} W</span>}{' '}
                  {r.infos > 0 && <span className="badge b-info">{r.infos} I</span>}
                </td>
                <td className="small">
                  {r.hasPrice && <span className="badge b-plain">precio</span>}{' '}
                  {r.hasHistorical && <span className="badge b-warn">histórico</span>}{' '}
                  {r.hasDuplicate && <span className="badge b-bad">duplicado?</span>}{' '}
                  {r.dataClass === 'FIXTURE' && <span className="badge b-info">FIXTURE</span>}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="muted">
                  Ningún candidato con estos filtros.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selected.size > 0 && (
        <div className="bulkbar" data-testid="bulk-bar">
          <div className="spread">
            <strong>
              {selected.size} seleccionados
              <span className="muted small">
                {' '}
                ({[...selectedKinds].map(([k, n]) => `${n} ${k}`).join(' · ')})
              </span>
            </strong>
            <button
              className="btn-link small"
              onClick={() => {
                setSelected(new Set());
                resetPlan();
              }}
            >
              limpiar selección
            </button>
          </div>
          {!hasActor && (
            <div className="notice warn small">
              Indica el actor arriba para aplicar cambios masivos.
            </div>
          )}
          <div className="row" style={{ marginTop: 6 }}>
            {selectedKinds.size > 1 && (
              <label className="small">
                Tipo a cambiar{' '}
                <select
                  value={kind}
                  onChange={(e) => {
                    setKind(e.target.value);
                    setField('');
                    setValue(undefined);
                    resetPlan();
                  }}
                >
                  <option value="">— elegir —</option>
                  {[...selectedKinds.keys()].map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABELS[k] ?? k}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="small">
              Campo{' '}
              <select
                value={field}
                onChange={(e) => {
                  setField(e.target.value);
                  setValue(undefined);
                  resetPlan();
                }}
                disabled={!effectiveKind}
                name="bulk-field"
              >
                <option value="">— elegir —</option>
                {fields.map((f) => (
                  <option key={f.field} value={f.field}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
            {meta && (
              <label className="small">
                Valor{' '}
                <ValueInput
                  control={meta.control}
                  value={value}
                  onChange={(v) => {
                    setValue(v);
                    resetPlan();
                  }}
                  lists={{ categories, methods }}
                  name="bulk-value"
                  unsetLabel="elegir"
                />
              </label>
            )}
            <input
              type="text"
              placeholder="motivo (opcional)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              style={{ minWidth: 220 }}
            />
            <button
              className="btn"
              disabled={pending || !meta || value === undefined || !hasActor}
              onClick={doPreview}
            >
              Vista previa
            </button>
          </div>
          {errors.length > 0 && (
            <div className="notice bad small">
              {errors.map((e, i) => (
                <div key={i}>
                  <span className="mono">{e.code}</span> {e.field ? `(${e.field}) ` : ''}
                  {e.message}
                </div>
              ))}
            </div>
          )}
          {plan && (
            <div className="notice warn" data-testid="bulk-preview">
              <strong>VISTA PREVIA DEL CAMBIO MASIVO</strong>
              <div>
                {plan.counts.selected} seleccionados · <strong>{writes}</strong> candidatos
                cambiarán
              </div>
              <div className="small">
                {plan.counts.unresolved} estaban sin resolver · {plan.counts.same} ya tenían ese
                valor · <strong>{plan.counts.different} tenían otro valor</strong>
              </div>
              {Object.entries(plan.counts.skipped).filter(([k]) => k !== 'DIFFERENT_NOT_CONFIRMED')
                .length > 0 && (
                <div className="small">
                  Se omiten:{' '}
                  {Object.entries(plan.counts.skipped)
                    .filter(([k]) => k !== 'DIFFERENT_NOT_CONFIRMED')
                    .map(([k, n]) => `${n} ${SKIP_REASON_LABELS[k] ?? k}`)
                    .join(' · ')}
                </div>
              )}
              {differents.length > 0 && (
                <div className="small" style={{ marginTop: 6 }}>
                  <div>Valores distintos que NO se sobrescriben sin confirmar:</div>
                  <ul style={{ margin: '4px 0' }}>
                    {differents.slice(0, 20).map((d) => (
                      <li key={`${d.candidateId}.${d.field}`}>
                        {preview.labels[d.candidateId]}: {JSON.stringify(d.current)} (
                        {d.currentOrigin === 'SOURCE' ? 'del Excel' : 'decidido'}) →{' '}
                        {JSON.stringify(d.next)}
                      </li>
                    ))}
                    {differents.length > 20 && <li>… y {differents.length - 20} más</li>}
                  </ul>
                  <label>
                    <input
                      type="checkbox"
                      checked={overwrite}
                      onChange={(e) => setOverwrite(e.target.checked)}
                    />{' '}
                    Sí, sobrescribir esos {differents.length} valores distintos
                  </label>
                </div>
              )}
              <div className="row" style={{ marginTop: 8 }}>
                <button className="btn" onClick={resetPlan} disabled={pending}>
                  Cancelar
                </button>
                <button
                  className="btn btn-primary"
                  onClick={doApply}
                  disabled={pending || writes === 0}
                >
                  Aplicar a {writes}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
