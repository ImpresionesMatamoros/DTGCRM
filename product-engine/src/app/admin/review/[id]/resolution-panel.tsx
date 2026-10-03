'use client';

import { useState, useTransition } from 'react';
import type { FieldView } from '@/review/fields';
import { saveDraftAction } from '../../actions';
import { ValueInput, type Lists } from '../../_components/value-input';

/**
 * Resolution panel: shows only the fields that apply to this candidate, with
 * what the Excel said, the current decision and what is still unresolved.
 * Nothing is preselected unless a person already decided it. Saving sends the
 * field changes to the server, which validates and audits them.
 */

type Draft = Record<string, unknown>;

interface OptionDef {
  key: string;
  label: string;
  valueKind: string;
  unit: string | null;
  values: { code: string; label: string }[];
}

const STATE: Record<string, [string, string]> = {
  REVIEWED: ['b-info', 'decidido'],
  SOURCE: ['b-plain', 'del Excel'],
  UNRESOLVED: ['b-unres', 'sin resolver'],
  NOT_SET: ['b-plain', 'sin asignar'],
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const show = (v: unknown) =>
  v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v);

export function ResolutionPanel({
  candidateId,
  kind,
  fields,
  draft,
  editable,
  reviewStatus,
  hasActor,
  lists,
  optionDefinitions,
  optionValues,
  lineageMatches,
}: {
  candidateId: string;
  kind: string;
  fields: FieldView[];
  draft: Draft | null;
  editable: boolean;
  reviewStatus: string;
  hasActor: boolean;
  lists: Lists;
  optionDefinitions: OptionDef[];
  optionValues: { recordKey: string; label: string | null; measurement: unknown }[];
  lineageMatches: { id: string; publicCode: string; name: string; status: string | null }[];
}) {
  const saved: Draft = draft ?? {};
  const [local, setLocal] = useState<Draft>(() => ({ ...saved }));
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<{ code: string; message: string; field?: string }[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const keys = new Set([...Object.keys(saved), ...Object.keys(local)]);
  const set: Draft = {};
  const clear: string[] = [];
  for (const k of keys) {
    const now = local[k];
    if (now === undefined) {
      if (saved[k] !== undefined) clear.push(k);
    } else if (!same(now, saved[k])) set[k] = now;
  }
  const dirty = Object.keys(set).length > 0 || clear.length > 0;
  const change = (field: string, value: unknown) => {
    setMessage(null);
    setLocal((prev) => {
      const next = { ...prev };
      if (value === undefined) delete next[field];
      else next[field] = value;
      return next;
    });
  };

  const save = () =>
    start(async () => {
      const r = await saveDraftAction({ candidateId, set, clear, reason: reason || undefined });
      if (r.ok) {
        setErrors([]);
        setReason('');
        setMessage(
          `Guardado (${r.changed} cambios). Campos abiertos: ${r.openFields.length ? r.openFields.join(', ') : 'ninguno'}.`,
        );
      } else setErrors(r.errors);
    });

  const disabled = !editable || !hasActor || pending;

  return (
    <div data-testid="resolution-panel">
      {!editable && (
        <div className="notice info small">
          {reviewStatus === 'APPROVED'
            ? 'Aprobado: la resolución queda fija. Para cambiarla, primero retira la aprobación.'
            : `Un candidato ${reviewStatus} no se edita.`}
        </div>
      )}
      {fields.map((f) => {
        const [tone, text] = STATE[f.state] ?? ['b-plain', f.state];
        const value = local[f.field];
        return (
          <div className="field" key={f.field} data-field={f.field}>
            <div className="field-head">
              <span className="field-label">{f.label}</span>
              <span className={`badge ${tone}`}>{text}</span>
              {f.requiredWhenUnknown && f.state !== 'SOURCE' && (
                <span className="small muted">necesario para aprobar</span>
              )}
              {f.sourceValue !== undefined && (
                <span className="small muted">
                  Excel: <strong>{show(f.sourceValue)}</strong>
                </span>
              )}
            </div>
            {f.evidence && <div className="evidence">{f.evidence}</div>}
            <div style={{ marginTop: 4 }}>
              {f.control.type === 'target' ? (
                <TargetInput
                  value={value}
                  onChange={(v) => change(f.field, v)}
                  kind={kind}
                  lineageMatches={lineageMatches}
                  disabled={disabled}
                />
              ) : f.control.type === 'optionDefinition' ? (
                <OptionDefinitionInput
                  value={value}
                  onChange={(v) => {
                    change(f.field, v);
                    // An option without source values still needs its (empty) value map: nothing to decide.
                    if (optionValues.length === 0 && v !== undefined && local.values === undefined)
                      change('values', {});
                  }}
                  definitions={optionDefinitions}
                  disabled={disabled}
                />
              ) : f.control.type === 'optionValues' ? (
                <OptionValuesInput
                  value={(value as Record<string, unknown> | undefined) ?? undefined}
                  onChange={(v) => change(f.field, v)}
                  sourceValues={optionValues}
                  definition={
                    local.definition && (local.definition as { mode?: string }).mode === 'EXISTING'
                      ? optionDefinitions.find(
                          (d) => d.key === (local.definition as { key: string }).key,
                        )
                      : undefined
                  }
                  disabled={disabled}
                />
              ) : (
                <fieldset disabled={disabled} style={{ border: 0, padding: 0, margin: 0 }}>
                  <ValueInput
                    control={f.control}
                    value={value}
                    onChange={(v) => change(f.field, v)}
                    lists={lists}
                    name={`res-${f.field}`}
                    radios={f.control.type === 'enum' || f.control.type === 'boolean'}
                    unsetLabel={
                      f.sourceValue !== undefined
                        ? `Usar el del Excel (${show(f.sourceValue)})`
                        : f.requiredWhenUnknown
                          ? 'Sin resolver'
                          : 'Sin asignar'
                    }
                  />
                </fieldset>
              )}
            </div>
            <div className="help">{f.help}</div>
          </div>
        );
      })}
      {kind === 'OPTION' && optionValues.length === 0 && (
        <div className="small muted">
          El Excel no trae valores para esta opción: el mapa de valores queda vacío.
        </div>
      )}
      <div className="row" style={{ marginTop: 8 }}>
        <input
          type="text"
          placeholder="motivo / fuente de la decisión (opcional)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          style={{ flex: 1, minWidth: 200 }}
          disabled={disabled}
        />
        <button
          className="btn btn-primary"
          onClick={save}
          disabled={disabled || !dirty}
          data-testid="save-draft"
        >
          Guardar resolución
        </button>
        {dirty && (
          <button className="btn" onClick={() => setLocal({ ...saved })} disabled={pending}>
            Descartar cambios
          </button>
        )}
      </div>
      {dirty && (
        <div className="small muted">
          Cambios sin guardar: {[...Object.keys(set), ...clear].join(', ')}
        </div>
      )}
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

function TargetInput({
  value,
  onChange,
  kind,
  lineageMatches,
  disabled,
}: {
  value: unknown;
  onChange: (v: unknown) => void;
  kind: string;
  lineageMatches: { id: string; publicCode: string; name: string; status: string | null }[];
  disabled: boolean;
}) {
  const v = value as { mode?: string; entityId?: string } | undefined;
  const mode = v?.mode ?? '';
  return (
    <fieldset disabled={disabled} style={{ border: 0, padding: 0, margin: 0 }}>
      <div className="choices">
        <label>
          <input type="radio" name="target" checked={!v} onChange={() => onChange(undefined)} />
          Sin elegir (el adaptador exige elegir si el linaje ya existe)
        </label>
        <label>
          <input
            type="radio"
            name="target"
            checked={mode === 'CREATE'}
            onChange={() => onChange({ mode: 'CREATE' })}
          />
          Crear nuevo
        </label>
        <label>
          <input
            type="radio"
            name="target"
            checked={mode === 'LINK_EXISTING'}
            onChange={() =>
              onChange({ mode: 'LINK_EXISTING', entityId: lineageMatches[0]?.id ?? '' })
            }
          />
          Vincular a existente
        </label>
      </div>
      {kind === 'CATALOG_ITEM' && lineageMatches.length > 0 && (
        <div className="small evidence">
          Ya existe en el dominio con este LEGACY_ID:{' '}
          {lineageMatches
            .map((m) => `${m.publicCode} · ${m.name} (${m.status ?? 'sin estado'})`)
            .join(', ')}
        </div>
      )}
      {mode === 'LINK_EXISTING' && (
        <div className="row" style={{ marginTop: 4 }}>
          {kind === 'CATALOG_ITEM' && lineageMatches.length > 0 && (
            <select
              value={v?.entityId ?? ''}
              onChange={(e) => onChange({ mode: 'LINK_EXISTING', entityId: e.target.value })}
            >
              {lineageMatches.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.publicCode} · {m.name}
                </option>
              ))}
            </select>
          )}
          <input
            type="text"
            className="mono"
            placeholder="UUID de la entidad existente"
            value={v?.entityId ?? ''}
            onChange={(e) => onChange({ mode: 'LINK_EXISTING', entityId: e.target.value.trim() })}
            style={{ minWidth: 300 }}
          />
        </div>
      )}
    </fieldset>
  );
}

function OptionDefinitionInput({
  value,
  onChange,
  definitions,
  disabled,
}: {
  value: unknown;
  onChange: (v: unknown) => void;
  definitions: OptionDef[];
  disabled: boolean;
}) {
  const v = value as
    | { mode: 'EXISTING'; key: string }
    | {
        mode: 'CREATE';
        key: string;
        label: string;
        valueKind: string;
        unit: string | null;
        scope: string;
      }
    | undefined;
  return (
    <fieldset disabled={disabled} style={{ border: 0, padding: 0, margin: 0 }}>
      <div className="choices">
        <label className="unres">
          <input type="radio" name="def-mode" checked={!v} onChange={() => onChange(undefined)} />
          Sin resolver
        </label>
        <label>
          <input
            type="radio"
            name="def-mode"
            checked={v?.mode === 'EXISTING'}
            onChange={() => onChange({ mode: 'EXISTING', key: '' })}
          />
          Definición existente
        </label>
        <label>
          <input
            type="radio"
            name="def-mode"
            checked={v?.mode === 'CREATE'}
            onChange={() =>
              onChange({
                mode: 'CREATE',
                key: '',
                label: '',
                valueKind: 'ENUM',
                unit: null,
                scope: 'ITEM',
              })
            }
          />
          Crear definición nueva
        </label>
      </div>
      {v?.mode === 'EXISTING' && (
        <select value={v.key} onChange={(e) => onChange({ mode: 'EXISTING', key: e.target.value })}>
          <option value="">— elegir —</option>
          {definitions.map((d) => (
            <option key={d.key} value={d.key}>
              {d.key} · {d.label} ({d.valueKind}
              {d.unit ? `, ${d.unit}` : ''})
            </option>
          ))}
        </select>
      )}
      {v?.mode === 'CREATE' && (
        <div className="row">
          <input
            type="text"
            placeholder="key (snake_case)"
            value={v.key}
            onChange={(e) => onChange({ ...v, key: e.target.value })}
          />
          <input
            type="text"
            placeholder="etiqueta"
            value={v.label}
            onChange={(e) => onChange({ ...v, label: e.target.value })}
          />
          <select
            value={v.valueKind}
            onChange={(e) => onChange({ ...v, valueKind: e.target.value })}
          >
            {['ENUM', 'DIMENSIONS', 'QUANTITY', 'LENGTH', 'TEXT', 'BOOLEAN'].map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
          <select
            value={v.unit ?? ''}
            onChange={(e) => onChange({ ...v, unit: e.target.value || null })}
          >
            <option value="">sin unidad</option>
            <option value="in">in</option>
            <option value="ft">ft</option>
            <option value="oz">oz</option>
          </select>
          <select value={v.scope} onChange={(e) => onChange({ ...v, scope: e.target.value })}>
            <option value="ITEM">ITEM</option>
            <option value="DECORATION">DECORATION</option>
          </select>
        </div>
      )}
    </fieldset>
  );
}

type ValueChoice =
  | { mode: 'EXISTING'; code: string }
  | {
      mode: 'CREATE';
      code: string;
      label: string;
      spec: null | { w: number; h: number } | { value: number };
    }
  | { mode: 'EXCLUDE'; reason: string };

function OptionValuesInput({
  value,
  onChange,
  sourceValues,
  definition,
  disabled,
}: {
  value: Record<string, unknown> | undefined;
  onChange: (v: unknown) => void;
  sourceValues: { recordKey: string; label: string | null; measurement: unknown }[];
  definition: OptionDef | undefined;
  disabled: boolean;
}) {
  const map = (value ?? {}) as Record<string, ValueChoice>;
  const put = (key: string, choice: ValueChoice | undefined) => {
    const next = { ...map };
    if (choice) next[key] = choice;
    else delete next[key];
    onChange(Object.keys(next).length ? next : undefined);
  };
  return (
    <fieldset disabled={disabled} style={{ border: 0, padding: 0, margin: 0 }}>
      <table className="t">
        <thead>
          <tr>
            <th>Valor del Excel</th>
            <th>Decisión</th>
          </tr>
        </thead>
        <tbody>
          {sourceValues.map((sv) => {
            const c = map[sv.recordKey];
            return (
              <tr key={sv.recordKey}>
                <td className="small">
                  {sv.label ?? <span className="muted">(vacío)</span>}
                  <div className="mono muted" style={{ fontSize: 10 }}>
                    {JSON.stringify(sv.measurement)}
                  </div>
                </td>
                <td>
                  <div className="row">
                    <select
                      value={c?.mode ?? ''}
                      onChange={(e) => {
                        const m = e.target.value;
                        if (!m) put(sv.recordKey, undefined);
                        else if (m === 'EXISTING')
                          put(sv.recordKey, { mode: 'EXISTING', code: '' });
                        else if (m === 'CREATE')
                          put(sv.recordKey, {
                            mode: 'CREATE',
                            code: '',
                            label: sv.label ?? '',
                            spec: null,
                          });
                        else put(sv.recordKey, { mode: 'EXCLUDE', reason: '' });
                      }}
                    >
                      <option value="">— sin resolver —</option>
                      <option value="EXISTING">usar valor existente</option>
                      <option value="CREATE">crear valor</option>
                      <option value="EXCLUDE">excluir</option>
                    </select>
                    {c?.mode === 'EXISTING' &&
                      (definition ? (
                        <select
                          value={c.code}
                          onChange={(e) =>
                            put(sv.recordKey, { mode: 'EXISTING', code: e.target.value })
                          }
                        >
                          <option value="">— código —</option>
                          {definition.values.map((x) => (
                            <option key={x.code} value={x.code}>
                              {x.code} · {x.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          placeholder="código"
                          value={c.code}
                          onChange={(e) =>
                            put(sv.recordKey, { mode: 'EXISTING', code: e.target.value })
                          }
                        />
                      ))}
                    {c?.mode === 'CREATE' && (
                      <>
                        <input
                          type="text"
                          placeholder="código"
                          value={c.code}
                          onChange={(e) => put(sv.recordKey, { ...c, code: e.target.value })}
                        />
                        <input
                          type="text"
                          placeholder="etiqueta"
                          value={c.label}
                          onChange={(e) => put(sv.recordKey, { ...c, label: e.target.value })}
                        />
                      </>
                    )}
                    {c?.mode === 'EXCLUDE' && (
                      <input
                        type="text"
                        placeholder="motivo"
                        value={c.reason}
                        onChange={(e) =>
                          put(sv.recordKey, { mode: 'EXCLUDE', reason: e.target.value })
                        }
                      />
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="help">
        Para dimensiones o cantidades, crear el valor exige su especificación; si falta, la vista
        previa del adaptador lo indica.
      </div>
    </fieldset>
  );
}
