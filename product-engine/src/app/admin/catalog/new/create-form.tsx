'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { createCatalogItemAction } from '../../actions';

/**
 * Minimal creation form. Status and decoration policy have NO preselection:
 * the person chooses them (the database default NONE would be a silent default).
 * The server validates everything again.
 */
export function CreateItemForm({
  categories,
  hasActor,
}: {
  categories: { key: string; name: string }[];
  hasActor: boolean;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('');
  const [decoration, setDecoration] = useState('');
  const [customer, setCustomer] = useState('');
  const [category, setCategory] = useState('');
  const [saleUnit, setSaleUnit] = useState('');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<{ code: string; message: string; field?: string }[]>([]);
  const [created, setCreated] = useState<{ id: string; publicCode: string } | null>(null);
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      const r = await createCatalogItemAction({
        name,
        kind: kind || undefined,
        status: status || undefined,
        decorationPolicy: decoration || undefined,
        customerSuppliedItem: kind === 'SERVICE' ? customer || undefined : undefined,
        categoryKey: category || null,
        saleUnit: saleUnit || null,
        descriptionInternal: description || null,
      });
      if (r.ok) {
        setCreated({ id: r.id, publicCode: r.publicCode });
        setErrors([]);
      } else setErrors(r.errors);
    });

  const radios = (name: string, value: string, set: (v: string) => void, options: string[]) => (
    <div className="choices" role="radiogroup">
      {options.map((o) => (
        <label key={o}>
          <input type="radio" name={name} value={o} checked={value === o} onChange={() => set(o)} />
          {o}
        </label>
      ))}
    </div>
  );

  if (created) {
    return (
      <div className="notice ok" role="status">
        Creado <strong className="mono">{created.publicCode}</strong>.{' '}
        <Link href={`/admin/catalog/${created.id}`}>Abrir</Link> ·{' '}
        <button className="btn-link" onClick={() => location.reload()}>
          crear otro
        </button>
      </div>
    );
  }

  return (
    <div className="panel" style={{ maxWidth: 760 }} data-testid="create-item-form">
      <div className="field">
        <div className="field-head">
          <span className="field-label">Nombre *</span>
        </div>
        <input
          type="text"
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ width: '100%' }}
        />
      </div>
      <div className="field">
        <div className="field-head">
          <span className="field-label">Tipo *</span>
        </div>
        {radios('kind', kind, setKind, ['PRODUCT', 'SERVICE'])}
      </div>
      <div className="field">
        <div className="field-head">
          <span className="field-label">Estado de catálogo *</span>
          <span className="small muted">
            sin preselección: un item nuevo no nace con estado supuesto
          </span>
        </div>
        {radios('status', status, setStatus, ['CANDIDATE', 'PLANNED', 'ACTIVE', 'RETIRED'])}
      </div>
      <div className="field">
        <div className="field-head">
          <span className="field-label">Política de decoración *</span>
          <span className="small muted">NONE / OPTIONAL / REQUIRED — decisión explícita</span>
        </div>
        {radios('decorationPolicy', decoration, setDecoration, ['NONE', 'OPTIONAL', 'REQUIRED'])}
      </div>
      {kind === 'SERVICE' && (
        <div className="field">
          <div className="field-head">
            <span className="field-label">Artículo del cliente *</span>
            <span className="small muted">sólo SERVICE</span>
          </div>
          {radios('customerSuppliedItem', customer, setCustomer, [
            'NOT_APPLICABLE',
            'ALLOWED',
            'REQUIRED',
          ])}
        </div>
      )}
      <div className="field">
        <div className="field-head">
          <span className="field-label">Categoría</span>
          <span className="small muted">opcional</span>
        </div>
        <select name="categoryKey" value={category} onChange={(e) => setCategory(e.target.value)}>
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
          <span className="field-label">Unidad de venta</span>
          <span className="small muted">opcional; sin unidad no hay precio automático</span>
        </div>
        <select name="saleUnit" value={saleUnit} onChange={(e) => setSaleUnit(e.target.value)}>
          <option value="">— sin unidad —</option>
          {['PIECE', 'PAIR', 'SET', 'PACKAGE', 'SHEET', 'SQ_FT', 'LINEAR_FT'].map((u) => (
            <option key={u}>{u}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <div className="field-head">
          <span className="field-label">Descripción interna</span>
          <span className="small muted">opcional</span>
        </div>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <button
          className="btn btn-primary"
          onClick={submit}
          disabled={pending || !hasActor}
          data-testid="create-item"
        >
          Guardar
        </button>
        {!hasActor && <span className="small muted">Indica el actor arriba.</span>}
      </div>
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
