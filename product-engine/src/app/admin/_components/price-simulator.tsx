'use client';

import { useState, useTransition } from 'react';
import { simulatePriceAction } from '../actions';

/**
 * Internal pricing diagnostic (STEP 07 §20–21). The browser only sends a configuration; every number comes
 * from the pricing domain on the server. With `draftId` the simulation is explicit and isolated: it resolves
 * against the draft overlay and also shows the current (live) answer for comparison.
 */
interface Props {
  itemId: string;
  options: {
    key: string;
    label: string;
    valueKind: string;
    isRequired: boolean;
    isDistributable?: boolean;
    values: { code: string; label: string }[];
  }[];
  methods?: { key: string; name: string }[];
  hasMeasurement?: boolean;
  draftId?: string;
  /** ISO instant; default for the "como de" input. */
  defaultAsOf?: string;
  defaultMarket?: 'USA' | 'MX';
}

interface View {
  status: string;
  reasonCode: string | null;
  currency: string | null;
  total: string | null;
  basis: string | null;
  reason: string | null;
  explanation: string[];
  lines: {
    kind: string;
    label: string;
    quantity: number;
    amount: string | null;
    definitionId: string | null;
    definitionRevision: number | null;
    breakQuantity: number | null;
    ruleCode: string | null;
    ruleVersion: number | null;
  }[];
  rulesApplied: { code: string; version: number; ruleId: string }[];
  policy: {
    market: string;
    priceBook: string;
    basis: string;
    factor: string | null;
    factorSource: string | null;
  } | null;
  derivation: {
    usaTotal: string | null;
    factor: string | null;
    factorSource: string | null;
    fx: string | null;
    fxParameterId: string | null;
    rounding: string | null;
    mxTotal: string | null;
  } | null;
  sourcePriceBook: string | null;
  conflictingIds: string[];
  errors: { code: string; path: string }[];
  effectiveAt: string;
  asOf: string;
}
type Resp =
  | ({ ok: true; simulatedDraft?: boolean; current?: View | null } & View)
  | { ok: false; errors: { message: string }[] };

function Trace({ v, title }: { v: View; title?: string }) {
  return (
    <div
      className="notice small"
      style={{ marginTop: 8 }}
      data-testid={title ? 'sim-draft' : 'sim-result'}
    >
      {title && <strong>{title}: </strong>}
      <strong data-testid="sim-status">{v.status}</strong>
      {v.total && (
        <>
          {' '}
          · total <strong data-testid="sim-total">{v.total}</strong> {v.currency} ({v.basis})
        </>
      )}
      {v.reasonCode && <> · {v.reasonCode}</>}
      {v.reason && v.status !== 'RESOLVED' && <div>{v.reason}</div>}
      {v.errors.length > 0 && <div>{v.errors.map((e) => `${e.code} ${e.path}`).join('; ')}</div>}
      {v.conflictingIds.length > 0 && (
        <div>Definiciones en conflicto: {v.conflictingIds.join(', ')}</div>
      )}
      {v.policy && (
        <div>
          Política: {v.policy.market} · libro {v.policy.priceBook} · base{' '}
          <span className="mono">{v.policy.basis}</span>
          {v.policy.factor && (
            <>
              {' '}
              · factor {v.policy.factor} (
              {v.policy.factorSource === 'ITEM' ? 'propio del artículo' : 'default del libro'})
            </>
          )}
        </div>
      )}
      {v.derivation && (
        <div data-testid="sim-derivation">
          Fuente {v.sourcePriceBook}: {v.derivation.usaTotal} USD × factor {v.derivation.factor} ×
          FX {v.derivation.fx}
          {v.derivation.fxParameterId
            ? ` (parámetro ${v.derivation.fxParameterId.slice(0, 8)}…)`
            : ''}{' '}
          → {v.derivation.mxTotal} MXN · redondeo{' '}
          <span className="mono">{v.derivation.rounding}</span>{' '}
          <span className="badge b-warn">PROVISIONAL TECHNICAL BEHAVIOR</span> · IVA sin resolver
          (D-022): no se agrega ni se infiere.
        </div>
      )}
      {v.lines.length > 0 && (
        <ul style={{ margin: '4px 0 0' }}>
          {v.lines.map((l, i) => (
            <li key={i}>
              {l.kind} · {l.label} × {l.quantity}: {l.amount ?? '—'}
              {l.definitionId && (
                <span className="mono muted">
                  {' '}
                  · def {l.definitionId.slice(0, 8)}… rev {l.definitionRevision}
                  {l.breakQuantity !== null ? ` · corte ${l.breakQuantity}` : ''}
                </span>
              )}
              {l.ruleCode && (
                <span className="mono muted">
                  {' '}
                  · regla {l.ruleCode} v{l.ruleVersion}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {v.rulesApplied.length > 0 && (
        <div>
          Reglas aplicadas: {v.rulesApplied.map((r) => `${r.code} v${r.version}`).join(', ')}
        </div>
      )}
      {v.explanation.length > 0 && <div className="muted">{v.explanation.join(' ')}</div>}
      <div className="muted">Vigencia evaluada: {v.effectiveAt}</div>
    </div>
  );
}

export function PriceSimulator(p: Props) {
  const enumOptions = p.options.filter((o) => o.values.length > 0);
  const distributable = enumOptions.filter((o) => o.isDistributable);
  const [market, setMarket] = useState<'USA' | 'MX'>(p.defaultMarket ?? 'USA');
  const [quantity, setQuantity] = useState(100);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [methods, setMethods] = useState<string[]>([]);
  const [dist, setDist] = useState<Record<string, string>>({});
  const [meas, setMeas] = useState({ width: '', height: '', length: '', unit: 'in' });
  const [asOf, setAsOf] = useState(p.defaultAsOf ? p.defaultAsOf.slice(0, 16) : '');
  const [result, setResult] = useState<Resp | null>(null);
  const [pending, start] = useTransition();

  const run = () =>
    start(async () => {
      const distribution = distributable.flatMap((o) =>
        (dist[o.key] ?? '')
          .split(/[,\s]+/)
          .filter(Boolean)
          .map((pair) => {
            const [code, n] = pair.split(':');
            return {
              selections: [{ optionKey: o.key, valueCodes: [code ?? ''] }],
              quantity: Number(n),
            };
          }),
      );
      const num = (s: string) => (s === '' ? undefined : Number(s));
      const r = await simulatePriceAction({
        itemId: p.itemId,
        market,
        quantity,
        selections: Object.entries(picked)
          .filter(([, v]) => v)
          .map(([optionKey, code]) => ({ optionKey, valueCodes: [code] })),
        ...(distribution.length ? { distribution } : {}),
        ...(methods.length ? { decorations: methods.map((methodKey) => ({ methodKey })) } : {}),
        ...(p.hasMeasurement
          ? {
              measurements: {
                width: num(meas.width),
                height: num(meas.height),
                length: num(meas.length),
                unit: meas.unit,
              },
            }
          : {}),
        ...(asOf ? { asOf: `${asOf}:00Z` } : {}),
        ...(p.draftId ? { draftId: p.draftId } : {}),
      });
      setResult(r as unknown as Resp);
    });

  return (
    <div className="panel" data-testid="price-simulator" id="simulator">
      <h2 className="adm-h2">
        {p.draftId ? 'Simular este borrador (aislado)' : 'Simulador (dominio de pricing)'}
      </h2>
      {p.draftId && (
        <p className="small muted">
          Resuelve contra el borrador como si estuviera autorizado; la cotización normal nunca lee
          borradores. Se muestra también la respuesta vigente.
        </p>
      )}
      <div className="row">
        <label className="small">
          Mercado{' '}
          <select
            value={market}
            onChange={(e) => setMarket(e.target.value as 'USA' | 'MX')}
            data-testid="sim-market"
          >
            <option value="USA">USA</option>
            <option value="MX">MX</option>
          </select>
        </label>
        <label className="small">
          Cantidad{' '}
          <input
            type="number"
            min={1}
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
            data-testid="sim-qty"
          />
        </label>
        <label className="small">
          Como de (UTC){' '}
          <input
            type="datetime-local"
            value={asOf}
            onChange={(e) => setAsOf(e.target.value)}
            data-testid="sim-asof"
          />
        </label>
        {enumOptions.map((o) => (
          <label key={o.key} className="small">
            {o.label}
            {o.isRequired ? ' *' : ''}{' '}
            <select
              value={picked[o.key] ?? ''}
              onChange={(e) => setPicked({ ...picked, [o.key]: e.target.value })}
              data-testid={`sim-opt-${o.key}`}
            >
              <option value="">— sin elegir —</option>
              {o.values.map((v) => (
                <option key={v.code} value={v.code}>
                  {v.label}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      {distributable.map((o) => (
        <label key={o.key} className="small" style={{ display: 'block', marginTop: 6 }}>
          Distribución por {o.label} (código:cantidad, p. ej. L:9, 3XL:3 — debe sumar la cantidad){' '}
          <input
            value={dist[o.key] ?? ''}
            onChange={(e) => setDist({ ...dist, [o.key]: e.target.value })}
            data-testid={`sim-dist-${o.key}`}
            style={{ minWidth: 220 }}
          />
        </label>
      ))}
      {(p.methods ?? []).length > 0 && (
        <div className="row small" style={{ marginTop: 6 }}>
          Decoración:
          {(p.methods ?? []).map((m) => (
            <label key={m.key}>
              <input
                type="checkbox"
                checked={methods.includes(m.key)}
                onChange={(e) =>
                  setMethods(
                    e.target.checked ? [...methods, m.key] : methods.filter((x) => x !== m.key),
                  )
                }
              />{' '}
              {m.name}
            </label>
          ))}
        </div>
      )}
      {p.hasMeasurement && (
        <div className="row small" style={{ marginTop: 6 }}>
          Medidas:
          {(['width', 'height', 'length'] as const).map((k) => (
            <label key={k}>
              {k === 'width' ? 'ancho' : k === 'height' ? 'alto' : 'largo'}{' '}
              <input
                style={{ width: 70 }}
                value={meas[k]}
                onChange={(e) => setMeas({ ...meas, [k]: e.target.value })}
              />
            </label>
          ))}
          <select value={meas.unit} onChange={(e) => setMeas({ ...meas, unit: e.target.value })}>
            <option value="in">in</option>
            <option value="ft">ft</option>
          </select>
        </div>
      )}
      <div style={{ marginTop: 8 }}>
        <button className="btn" onClick={run} disabled={pending} data-testid="sim-run">
          Calcular
        </button>
      </div>
      {result && !result.ok && (
        <div className="notice bad small">{result.errors.map((e) => e.message).join('; ')}</div>
      )}
      {result && result.ok && (
        <>
          <Trace v={result} title={result.simulatedDraft ? 'Con el borrador' : undefined} />
          {result.simulatedDraft && result.current && (
            <Trace v={result.current} title="Vigente hoy" />
          )}
        </>
      )}
    </div>
  );
}
