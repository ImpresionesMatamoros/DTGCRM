'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { setMarketPolicyAction } from '../../actions';

/** ItemMarketPolicy editor (MX). The server validates every combination; this form only sends the choice. */
export function PolicyForm(p: {
  itemId: string;
  current: { pricingMode: string; factorOverride: string | null; isAvailable: boolean } | null;
  defaultFactor: string | null;
}) {
  const router = useRouter();
  const [mode, setMode] = useState(p.current?.pricingMode ?? 'INHERIT');
  const [factor, setFactor] = useState(p.current?.factorOverride ?? '');
  const [available, setAvailable] = useState(p.current?.isAvailable ?? true);
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const allowsFactor = mode === 'INHERIT' || mode === 'DERIVED';

  const save = () =>
    start(async () => {
      const r = await setMarketPolicyAction({
        itemId: p.itemId,
        market: 'MX',
        pricingMode: mode,
        factorOverride: allowsFactor && factor ? factor : null,
        isAvailable: available,
        reason: reason || null,
      });
      if (r.ok) {
        setMsg({ ok: true, text: 'Política guardada.' });
        router.refresh();
      } else setMsg({ ok: false, text: r.errors.map((e) => e.message).join('; ') });
    });

  return (
    <div data-testid="policy-form">
      <div className="row">
        <label className="small">
          Modo
          <select value={mode} onChange={(e) => setMode(e.target.value)} data-testid="policy-mode">
            <option value="INHERIT">INHERIT (usa el libro MX derivado)</option>
            <option value="DERIVED">DERIVED (factor propio)</option>
            <option value="MANUAL">MANUAL (sólo precio MX explícito)</option>
            <option value="QUOTE_ONLY">QUOTE_ONLY</option>
          </select>
        </label>
        <label className="small">
          Factor propio {p.defaultFactor ? `(default ${p.defaultFactor})` : ''}
          <input
            value={factor}
            disabled={!allowsFactor}
            onChange={(e) => setFactor(e.target.value)}
            data-testid="policy-factor"
            placeholder="vacío = default"
          />
        </label>
        <label className="small">
          <input
            type="checkbox"
            checked={available}
            onChange={(e) => setAvailable(e.target.checked)}
          />{' '}
          disponible en MX
        </label>
      </div>
      <div className="row">
        <label className="small">
          Motivo
          <input
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
            style={{ minWidth: 280 }}
          />
        </label>
        <button
          className="btn btn-primary"
          onClick={save}
          disabled={pending}
          data-testid="policy-save"
        >
          Guardar política
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
