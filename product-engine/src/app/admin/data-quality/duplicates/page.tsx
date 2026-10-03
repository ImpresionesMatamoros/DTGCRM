import Link from 'next/link';
import { connection } from 'next/server';
import { duplicatePairs, type DuplicateSide } from '@/db/admin/duplicates';
import { adminPool } from '../../_server/db';
import { getActor } from '../../_server/actor';
import { Badge } from '../../_components/ui';
import { QualityTabs } from '../nav';
import { DuplicateActions } from './duplicate-actions';

function Side({ s }: { s: DuplicateSide }) {
  return (
    <td className="small" style={{ verticalAlign: 'top' }}>
      <div>
        {s.candidateId ? <Link href={`/admin/review/${s.candidateId}`}>{s.name}</Link> : s.name}
      </div>
      <div className="mono muted">{s.legacyId}</div>
      <div>Categoría: {s.category ?? <span className="unres">sin resolver</span>}</div>
      <div>
        Estado: {s.status ?? '—'} · revisión {s.reviewStatus ?? '—'}
      </div>
      <div>
        Opciones ({s.options.length}): {s.options.join(', ') || '—'}
      </div>
      <div>
        Evidencia de precio: {s.priceEvidence.observations} obs. en {s.priceEvidence.candidates}{' '}
        candidatos ({s.priceEvidence.models.join(', ') || '—'}) · históricos {s.historicalEvidence}
      </div>
      <div className="muted">
        Procedencia:{' '}
        {s.provenance
          ? `${s.provenance.workbook} · ${s.provenance.sheet ?? '?'}!${s.provenance.cell ?? '?'} (fila ${s.provenance.row ?? '?'})`
          : 'sin procedencia'}
      </div>
    </td>
  );
}

export default async function DuplicatesPage() {
  await connection();
  const [pairs, actor] = await Promise.all([duplicatePairs(adminPool(), new Date()), getActor()]);
  return (
    <>
      <h1 className="adm-h1">Revisión de duplicados</h1>
      <p className="adm-sub">
        Señales del importador, lado a lado. Sólo se puede marcar “distintos” o “revisado”:{' '}
        <strong>no hay fusión</strong> ni borrado.
      </p>
      <QualityTabs />
      <div className="panel">
        <table className="t" data-testid="duplicates-table">
          <thead>
            <tr>
              <th>Señal</th>
              <th>Artículo A</th>
              <th>Artículo B</th>
              <th>Marca</th>
            </tr>
          </thead>
          <tbody>
            {pairs.map((p) => (
              <tr key={p.pairKey} data-pair={p.pairKey}>
                <td className="small">
                  <Badge tone={p.kind === 'PROBABLE_DUPLICATE' ? 'warn' : 'info'}>
                    {p.kind === 'PROBABLE_DUPLICATE'
                      ? 'probable duplicado'
                      : 'relación, no duplicado'}
                  </Badge>
                  <div className="muted">{p.signals.join(' · ')}</div>
                </td>
                <Side s={p.sides[0]} />
                <Side s={p.sides[1]} />
                <td className="small">
                  {p.mark ? (
                    <div data-testid="pair-mark">
                      {p.mark} por {p.markedBy}
                    </div>
                  ) : (
                    <div className="muted">sin marcar</div>
                  )}
                  <DuplicateActions pairKey={p.pairKey} hasActor={!!actor} />
                </td>
              </tr>
            ))}
            {pairs.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  Sin señales de duplicado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
