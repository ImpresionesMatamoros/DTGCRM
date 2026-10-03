'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { markDuplicateAction } from '../../actions';

export function DuplicateActions({ pairKey, hasActor }: { pairKey: string; hasActor: boolean }) {
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const mark = (m: 'DISTINCT' | 'REVIEWED') =>
    start(async () => {
      const r = await markDuplicateAction({ pairKey, mark: m, reason: reason || undefined });
      if (r.ok) router.refresh();
      else setErr(r.errors.map((e) => e.message).join('; '));
    });
  return (
    <div>
      <input
        type="text"
        placeholder="motivo"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        aria-label="Motivo"
      />
      <div className="row">
        <button className="btn" disabled={pending || !hasActor} onClick={() => mark('DISTINCT')}>
          Son distintos
        </button>
        <button className="btn" disabled={pending || !hasActor} onClick={() => mark('REVIEWED')}>
          Revisado
        </button>
      </div>
      {err && <div className="notice bad small">{err}</div>}
    </div>
  );
}
