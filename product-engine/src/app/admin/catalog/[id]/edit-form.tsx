'use client';

import { useState, useTransition } from 'react';
import { updateCatalogItemAction } from '../../actions';

interface Values {
  name: string;
  status: string | null;
  saleUnit: string | null;
  decorationPolicy: string;
  customerSuppliedItem: string;
  descriptionInternal: string | null;
  categoryKey: string | null;
}

/** Safe fields only; the server re-validates (identity, kind and unset status are protected). */
export function EditItemForm({
  id,
  kind,
  initial,
  categories,
  hasActor,
}: {
  id: string;
  kind: string;
  initial: Values;
  categories: { key: string; name: string }[];
  hasActor: boolean;
}) {
  const [v, setV] = useState<Values>(initial);
  const [errors, setErrors] = useState<{ code: string; message: string; field?: string }[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const patch: Record<string, unknown> = {};
  if (v.name !== initial.name) patch.name = v.name;
  if (v.status !== initial.status && v.status !== null) patch.status = v.status;
  if (v.saleUnit !== initial.saleUnit) patch.saleUnit = v.saleUnit;
  if (v.decorationPolicy !== initial.decorationPolicy) patch.decorationPolicy = v.decorationPolicy;
  if (v.customerSuppliedItem !== initial.customerSuppliedItem)
    patch.customerSuppliedItem = v.customerSuppliedItem;
  if ((v.descriptionInternal ?? '') !== (initial.descriptionInternal ?? ''))
    patch.descriptionInternal = v.descriptionInternal || null;
  if (v.categoryKey !== initial.categoryKey) patch.categoryKey = v.categoryKey;
  const dirty = Object.keys(patch).length > 0;

  const save = () =>
    start(async () => {
      const r = await updateCatalogItemAction({ id, patch });
      if (r.ok) {
        setErrors([]);
        setMessage(`Guardado: ${r.changed.join(', ')}. Registrado en el historial.`);
      } else setErrors(r.errors);
    });

  const set = (k: keyof Values, value: string | null) => {
    setMessage(null);
    setV((p) => ({ ...p, [k]: value }));
  };

  return (
    <fieldset
      disabled={!hasActor || pending}
      style={{ border: 0, padding: 0, margin: 0 }}
      data-testid="edit-item-form"
    >
      <div className="field">
        <div className="field-head">
          <span className="field-label">Nombre canónico</span>
        </div>
        <input
          type="text"
          name="name"
          value={v.name}
          onChange={(e) => set('name', e.target.value)}
          style={{ width: '100%' }}
        />
      </div>
      <div className="field">
        <div className="field-head">
          <span className="field-label">Estado</span>
          {initial.status === null && <span className="badge b-unres">sin asignar</span>}
        </div>
        <select
          name="status"
          value={v.status ?? ''}
          onChange={(e) => set('status', e.target.value || null)}
        >
          {initial.status === null && <option value="">— sin asignar (null) —</option>}
          {['CANDIDATE', 'PLANNED', 'ACTIVE', 'RETIRED'].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <div className="help">Un estado asignado nunca vuelve a “sin asignar” (ADR-0002).</div>
      </div>
      <div className="field">
        <div className="field-head">
          <span className="field-label">Unidad de venta</span>
        </div>
        <select
          name="saleUnit"
          value={v.saleUnit ?? ''}
          onChange={(e) => set('saleUnit', e.target.value || null)}
        >
          <option value="">— sin unidad —</option>
          {['PIECE', 'PAIR', 'SET', 'PACKAGE', 'SHEET', 'SQ_FT', 'LINEAR_FT'].map((u) => (
            <option key={u}>{u}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <div className="field-head">
          <span className="field-label">Política de decoración</span>
        </div>
        <select
          name="decorationPolicy"
          value={v.decorationPolicy}
          onChange={(e) => set('decorationPolicy', e.target.value)}
        >
          {['NONE', 'OPTIONAL', 'REQUIRED'].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>
      {kind === 'SERVICE' && (
        <div className="field">
          <div className="field-head">
            <span className="field-label">Artículo del cliente</span>
          </div>
          <select
            name="customerSuppliedItem"
            value={v.customerSuppliedItem}
            onChange={(e) => set('customerSuppliedItem', e.target.value)}
          >
            {['NOT_APPLICABLE', 'ALLOWED', 'REQUIRED'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
      )}
      <div className="field">
        <div className="field-head">
          <span className="field-label">Categoría primaria</span>
        </div>
        <select
          name="categoryKey"
          value={v.categoryKey ?? ''}
          onChange={(e) => set('categoryKey', e.target.value || null)}
        >
          <option value="">— sin categoría —</option>
          {categories.map((c) => (
            <option key={c.key} value={c.key}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <div className="field-head">
          <span className="field-label">Descripción interna</span>
        </div>
        <textarea
          value={v.descriptionInternal ?? ''}
          onChange={(e) => set('descriptionInternal', e.target.value)}
        />
      </div>
      <div className="row">
        <button
          className="btn btn-primary"
          onClick={save}
          disabled={!dirty}
          data-testid="save-item"
        >
          Guardar cambios
        </button>
        {dirty && (
          <button className="btn" onClick={() => setV(initial)}>
            Descartar
          </button>
        )}
      </div>
      <p className="small muted">Los precios se ven en Precios; no se editan aquí.</p>
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
    </fieldset>
  );
}
