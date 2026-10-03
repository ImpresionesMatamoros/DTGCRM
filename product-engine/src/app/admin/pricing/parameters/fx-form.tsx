'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { fxRevisionAction } from '../../actions';

/** New effective-dated FX revision. The server refuses past dates and anything not after the latest revision. */
export function FxForm() {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [from, setFrom] = useState('');
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const save = () =>
    start(async () => {
      const r = await fxRevisionAction({
        key: 'usd_mxn_fx',
        value,
        validFrom: from ? `${from}:00Z` : '',
        reason: reason || null,
      });
      if (r.ok) {
        setMsg({ ok: true, text: 'Revisión de FX creada.' });
        router.refresh();
      } else setMsg({ ok: false, text: r.errors.map((e) => e.message).join('; ') });
    });
  return (
    <div data-testid="fx-form">
      <div className="row">
        <label className="small">
          MXN por USD{' '}
          <input value={value} onChange={(e) => setValue(e.target.value)} data-testid="fx-value" />
        </label>
        <label className="small">
          Vigente desde (UTC){' '}
          <input
            type="datetime-local"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            data-testid="fx-from"
          />
        </label>
        <label className="small">
          Motivo{' '}
          <input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
        </label>
        <button className="btn btn-primary" onClick={save} disabled={pending} data-testid="fx-save">
          Crear revisión futura
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
