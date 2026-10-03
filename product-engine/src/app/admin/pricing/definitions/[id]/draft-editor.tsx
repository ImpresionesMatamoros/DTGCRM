'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { createPriceDraftAction, updatePriceDraftAction } from '../../../actions';

/**
 * Draft editor (STEP 07 §12–13). Only DRAFT definitions reach this component. It sends raw values to the
 * server; validation, conflict analysis and persistence are server-side. The quantity matrix is EXACT:
 * one row per quantity, no interpolation, duplicate quantities blocked, rows kept sorted.
 */
export interface EditorInitial {
  validFrom: string;
  validTo: string | null;
  amount: string | null;
  rate: string | null;
  rateUnit: string | null;
  minCharge: string | null;
  minQuantity: number | null;
  maxQuantity: number | null;
  breaks: { quantity: number; amount: string; amountBasis: string }[];
  conditions: {
    kind: 'OPTION_VALUE' | 'DECORATION_METHOD';
    optionKey?: string;
    valueCode?: string;
    methodKey?: string;
  }[];
}

interface Props {
  /** existing draft to update; absent = create a new draft */
  definitionId?: string;
  itemId: string;
  market: 'USA' | 'MX';
  component: 'ITEM' | 'DECORATION';
  model: string;
  currency: string;
  initial: EditorInitial;
  options: { key: string; label: string; values: { code: string; label: string }[] }[];
  methods: { key: string; name: string }[];
}

type Cond = EditorInitial['conditions'][number];
type BreakRow = { id: number; quantity: string; amount: string; amountBasis: 'TOTAL' | 'UNIT' };
const toLocal = (iso: string | null) => (iso ? iso.slice(0, 16) : '');
const fromLocal = (v: string) => (v ? `${v}:00Z` : null);
let seq = 0;

export function DraftEditor(p: Props) {
  const router = useRouter();
  const [validFrom, setValidFrom] = useState(toLocal(p.initial.validFrom));
  const [validTo, setValidTo] = useState(toLocal(p.initial.validTo));
  const [amount, setAmount] = useState(p.initial.amount ?? '');
  const [rate, setRate] = useState(p.initial.rate ?? '');
  const [rateUnit, setRateUnit] = useState(p.initial.rateUnit ?? '');
  const [minCharge, setMinCharge] = useState(p.initial.minCharge ?? '');
  const [minQuantity, setMinQuantity] = useState(p.initial.minQuantity?.toString() ?? '');
  const [maxQuantity, setMaxQuantity] = useState(p.initial.maxQuantity?.toString() ?? '');
  const [conds, setConds] = useState<Cond[]>(p.initial.conditions);
  const [rows, setRows] = useState<BreakRow[]>(
    [...p.initial.breaks]
      .sort((a, b) => a.quantity - b.quantity)
      .map((b) => ({
        id: ++seq,
        quantity: String(b.quantity),
        amount: b.amount,
        amountBasis: b.amountBasis as 'TOTAL' | 'UNIT',
      })),
  );
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const usesBreaks = p.model === 'EXACT_QUANTITY_MATRIX' || p.model === 'TIERED';
  const qtys = rows.map((r) => r.quantity.trim());
  const duplicates = new Set(qtys.filter((q, i) => q !== '' && qtys.indexOf(q) !== i));
  const invalidRow = rows.some(
    (r) =>
      !/^\d+$/.test(r.quantity) || Number(r.quantity) <= 0 || !/^\d+(\.\d{1,2})?$/.test(r.amount),
  );
  const blocked = usesBreaks && (duplicates.size > 0 || invalidRow || rows.length === 0);

  const sortRows = () =>
    setRows((rs) =>
      [...rs].sort((a, b) => Number(a.quantity || Infinity) - Number(b.quantity || Infinity)),
    );
  const patchRow = (id: number, patch: Partial<BreakRow>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const save = () =>
    start(async () => {
      const body = {
        validFrom: fromLocal(validFrom),
        validTo: fromLocal(validTo),
        amount: p.model === 'FIXED' || p.model === 'PER_UNIT' ? amount || null : null,
        rate: p.model === 'MEASURED' ? rate || null : null,
        rateUnit: p.model === 'MEASURED' ? rateUnit || null : null,
        minCharge: p.model === 'MEASURED' ? minCharge || null : null,
        minQuantity: p.model === 'PER_UNIT' && minQuantity ? Number(minQuantity) : null,
        maxQuantity:
          (p.model === 'FIXED' || p.model === 'PER_UNIT') && maxQuantity
            ? Number(maxQuantity)
            : null,
        conditions: conds,
        breaks: usesBreaks
          ? rows.map((r) => ({
              quantity: Number(r.quantity),
              amount: r.amount,
              amountBasis: r.amountBasis,
            }))
          : [],
        reason: reason || null,
      };
      const r = p.definitionId
        ? await updatePriceDraftAction({ definitionId: p.definitionId, ...body })
        : await createPriceDraftAction({
            itemId: p.itemId,
            market: p.market,
            component: p.component,
            model: p.model,
            ...body,
          });
      if (r.ok) {
        setMsg({ ok: true, text: 'Borrador guardado.' });
        const id = (r as { definitionId?: string }).definitionId;
        if (!p.definitionId && id) router.push(`/admin/pricing/definitions/${id}`);
        else router.refresh();
      } else {
        setMsg({ ok: false, text: r.errors.map((e) => e.message).join('; ') });
      }
    });

  const condChoices = p.options.flatMap((o) =>
    o.values.map((v) => ({
      kind: 'OPTION_VALUE' as const,
      optionKey: o.key,
      valueCode: v.code,
      label: `${o.label} = ${v.label}`,
    })),
  );
  const [pick, setPick] = useState('');
  const addCond = () => {
    if (!pick) return;
    const [kind, a, b] = pick.split('|');
    const c: Cond =
      kind === 'OPTION_VALUE'
        ? { kind: 'OPTION_VALUE', optionKey: a, valueCode: b }
        : { kind: 'DECORATION_METHOD', methodKey: a };
    if (conds.some((x) => JSON.stringify(x) === JSON.stringify(c))) return;
    setConds([...conds, c]);
    setPick('');
  };

  return (
    <div className="panel" data-testid="draft-editor">
      <h2 className="adm-h2">Editar borrador</h2>
      <p className="small muted">
        Sólo un borrador es editable. Moneda: <strong>{p.currency}</strong> (la del price book).
        Fechas en UTC.
      </p>
      <div className="row">
        <label className="small">
          Vigente desde (UTC)
          <input
            type="datetime-local"
            value={validFrom}
            onChange={(e) => setValidFrom(e.target.value)}
            data-testid="valid-from"
          />
        </label>
        <label className="small">
          Hasta (opcional)
          <input
            type="datetime-local"
            value={validTo}
            onChange={(e) => setValidTo(e.target.value)}
          />
        </label>
      </div>

      <h3 className="adm-h2" style={{ marginTop: 10 }}>
        Condiciones (fuera de la matriz)
      </h3>
      <div className="row" data-testid="conditions">
        {conds.length === 0 && <span className="muted small">sin condiciones</span>}
        {conds.map((c, i) => (
          <span key={i} className="badge b-outline">
            {c.kind === 'OPTION_VALUE' ? `${c.optionKey}=${c.valueCode}` : `método ${c.methodKey}`}{' '}
            <button
              type="button"
              className="btn-link"
              onClick={() => setConds(conds.filter((_, j) => j !== i))}
              aria-label="quitar condición"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="row">
        <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="nueva condición">
          <option value="">— añadir condición —</option>
          {condChoices.map((c) => (
            <option
              key={`${c.optionKey}${c.valueCode}`}
              value={`OPTION_VALUE|${c.optionKey}|${c.valueCode}`}
            >
              {c.label}
            </option>
          ))}
          {p.methods.map((m) => (
            <option key={m.key} value={`DECORATION_METHOD|${m.key}`}>
              método {m.name}
            </option>
          ))}
        </select>
        <button type="button" className="btn" onClick={addCond}>
          Añadir
        </button>
      </div>

      {usesBreaks && (
        <>
          <h3 className="adm-h2" style={{ marginTop: 10 }}>
            Matriz de cantidades exactas (
            {p.model === 'TIERED' ? 'escalonado' : 'sin interpolación'})
          </h3>
          <table className="t" data-testid="matrix-editor">
            <thead>
              <tr>
                <th className="num">Cantidad</th>
                <th className="num">Monto ({p.currency})</th>
                <th>Base</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id} data-testid="matrix-row">
                  <td className="num">
                    <input
                      inputMode="numeric"
                      value={r.quantity}
                      data-testid={`matrix-qty-${i}`}
                      style={
                        duplicates.has(r.quantity.trim()) ? { borderColor: '#b3261e' } : undefined
                      }
                      onChange={(e) => patchRow(r.id, { quantity: e.target.value })}
                      onBlur={sortRows}
                    />
                    {duplicates.has(r.quantity.trim()) && (
                      <div className="small unres">cantidad repetida</div>
                    )}
                  </td>
                  <td className="num">
                    <input
                      inputMode="decimal"
                      value={r.amount}
                      data-testid={`matrix-amount-${i}`}
                      onChange={(e) => patchRow(r.id, { amount: e.target.value })}
                    />
                  </td>
                  <td>
                    <select
                      value={r.amountBasis}
                      onChange={(e) =>
                        patchRow(r.id, { amountBasis: e.target.value as 'TOTAL' | 'UNIT' })
                      }
                    >
                      <option value="TOTAL">total</option>
                      <option value="UNIT">por unidad</option>
                    </select>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn"
                      data-testid={`remove-break-${i}`}
                      onClick={() => setRows(rows.filter((x) => x.id !== r.id))}
                    >
                      Quitar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            type="button"
            className="btn"
            data-testid="add-break"
            onClick={() =>
              setRows([...rows, { id: ++seq, quantity: '', amount: '', amountBasis: 'TOTAL' }])
            }
          >
            + Añadir corte
          </button>
          {p.model === 'EXACT_QUANTITY_MATRIX' && (
            <p className="small muted">
              Una cantidad que no esté en la lista cotiza sólo bajo petición (nunca se interpola).
            </p>
          )}
        </>
      )}

      {(p.model === 'FIXED' || p.model === 'PER_UNIT') && (
        <div className="row">
          <label className="small">
            Monto ({p.currency}){' '}
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              data-testid="amount"
            />
          </label>
          {p.model === 'PER_UNIT' && (
            <label className="small">
              Mín. cantidad{' '}
              <input value={minQuantity} onChange={(e) => setMinQuantity(e.target.value)} />
            </label>
          )}
          <label className="small">
            Máx. cantidad{p.model === 'FIXED' ? ' *' : ''}{' '}
            <input value={maxQuantity} onChange={(e) => setMaxQuantity(e.target.value)} />
          </label>
          {p.model === 'FIXED' && (
            <span className="small muted">Más allá del máximo cotiza sólo bajo petición.</span>
          )}
        </div>
      )}
      {p.model === 'MEASURED' && (
        <div className="row">
          <label className="small">
            Tarifa <input value={rate} onChange={(e) => setRate(e.target.value)} />
          </label>
          <label className="small">
            Unidad
            <select value={rateUnit} onChange={(e) => setRateUnit(e.target.value)}>
              <option value="">—</option>
              <option value="SQ_FT">SQ_FT</option>
              <option value="LINEAR_FT">LINEAR_FT</option>
            </select>
          </label>
          <label className="small">
            Cargo mínimo <input value={minCharge} onChange={(e) => setMinCharge(e.target.value)} />
          </label>
        </div>
      )}

      <div className="row" style={{ marginTop: 10 }}>
        <label className="small">
          Motivo del cambio (auditoría)
          <input
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
            style={{ minWidth: 280 }}
          />
        </label>
        <button
          type="button"
          className="btn btn-primary"
          data-testid="save-draft-price"
          disabled={pending || blocked}
          onClick={save}
        >
          Guardar borrador
        </button>
      </div>
      {msg && (
        <div className={`notice small ${msg.ok ? '' : 'bad'}`} role="status">
          {msg.text}
        </div>
      )}
    </div>
  );
}
