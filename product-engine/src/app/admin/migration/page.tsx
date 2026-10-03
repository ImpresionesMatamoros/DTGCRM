import Link from 'next/link';
import { connection } from 'next/server';
import { migrationOverview } from '@/db/admin/migration-views';
import { can } from '@/admin/permissions';
import { getActor } from '../_server/actor';
import { adminPool } from '../_server/db';
import { Badge } from '../_components/ui';
import { MigrationControls } from './controls';

export const metadata = { title: 'Migración · Admin' };

export default async function MigrationPage() {
  await connection();
  const [o, actor] = await Promise.all([migrationOverview(adminPool()), getActor()]);
  const g = o.gate;
  return (
    <>
      <h1 className="adm-h1">Migración · Commercial Print</h1>
      <p className="adm-sub">
        {o.scopeLabel}. La publicación REAL global sigue cerrada: sólo un permiso explícito,
        aprobado por el dueño, abre la publicación de los candidatos que nombra, item por item.
      </p>
      <div className="metrics" data-testid="migration-totals">
        {(
          [
            ['scoped', g.scoped, 'En alcance'],
            ['publishable', g.publishable, 'Publicables'],
            ['resolved', g.resolved, 'Resueltos (no producto)'],
            ['blocked', g.blocked, 'Bloqueados'],
            ['published', o.published.length, 'Publicados (REAL)'],
          ] as const
        ).map(([k, v, l]) => (
          <div key={k} className="metric" data-metric={k}>
            <div className="v">{v}</div>
            <div className="l">{l}</div>
          </div>
        ))}
      </div>

      <div className="panel" data-testid="permit-panel">
        <h2 className="adm-h2">Permiso de migración</h2>
        {o.permit ? (
          <div className="small">
            <Badge tone="ok">ACTIVO</Badge> aprobado por <strong>{o.permit.approvedBy}</strong> el{' '}
            {o.permit.approvedAt.slice(0, 19).replace('T', ' ')} · mercados{' '}
            {o.permit.markets.join(', ')} · {o.permit.included.length} candidatos de{' '}
            {new Set(o.permit.included.map((i) => i.itemLegacyId)).size} items
            <div className="muted">{o.permit.reason}</div>
            <div className="muted">
              Decisiones:{' '}
              {o.permit.decisionRefs.map((d) => `${d.decisionId} (rev. ${d.revision})`).join(', ')}
              {o.permit.waivedDecisions.length > 0 &&
                ` · eximidas para este mercado: ${o.permit.waivedDecisions.map((w) => w.decisionId).join(', ')}`}
            </div>
          </div>
        ) : (
          <p className="small muted">Sin permiso activo: nada se puede publicar como REAL.</p>
        )}
        <MigrationControls
          permitId={o.permit?.id ?? null}
          canApprove={can(actor, 'migration.approve')}
          canPublish={can(actor, 'migration.publish')}
          hasActor={!!actor}
        />
      </div>

      <div className="panel">
        <h2 className="adm-h2">Items en alcance (compuerta por item)</h2>
        <div className="t-wrap">
          <table className="t" data-testid="migration-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Veredicto</th>
                <th>Precio</th>
                <th>Decisiones abiertas</th>
                <th>Razones</th>
              </tr>
            </thead>
            <tbody>
              {g.items.map((i) => (
                <tr key={i.legacyId} data-item={i.legacyId} data-verdict={i.verdict}>
                  <td>
                    {i.candidateId ? (
                      <Link href={`/admin/review/${i.candidateId}`}>{i.name}</Link>
                    ) : (
                      i.name
                    )}
                    <div className="small muted mono">{i.legacyId}</div>
                  </td>
                  <td>
                    <Badge
                      tone={
                        i.verdict === 'BLOCKED' ? 'bad' : i.verdict === 'RESOLVED' ? 'plain' : 'ok'
                      }
                    >
                      {i.verdict === 'PUBLISHABLE'
                        ? 'publicable'
                        : i.verdict === 'PUBLISHED'
                          ? 'publicado'
                          : i.verdict === 'RESOLVED'
                            ? 'resuelto'
                            : 'bloqueado'}
                    </Badge>
                  </td>
                  <td className="small">
                    {i.disposition ? (
                      <span data-disposition={i.disposition.disposition}>
                        {i.disposition.disposition}
                        {i.disposition.canonicalLegacyIds.length > 0
                          ? ` → ${i.disposition.canonicalLegacyIds.join(', ')}`
                          : ''}
                      </span>
                    ) : (
                      i.pricing
                    )}
                  </td>
                  <td className="small">
                    {i.openDecisions.join(', ') || '—'}
                    {i.waivedDecisions.length > 0 && (
                      <div className="muted">eximida: {i.waivedDecisions.join(', ')}</div>
                    )}
                  </td>
                  <td className="small">
                    {i.reasons.length ? (
                      <ul style={{ margin: 0, paddingLeft: 14 }}>
                        {i.reasons.map((r) => (
                          <li key={r}>{r}</li>
                        ))}
                      </ul>
                    ) : (
                      <span className="muted">pasa su compuerta</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <h2 className="adm-h2">Publicados (REAL)</h2>
        {o.published.length === 0 ? (
          <p className="small muted">Aún no se ha publicado ningún item bajo el permiso.</p>
        ) : (
          <table className="t" data-testid="published-table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Item</th>
                <th>Estado</th>
                <th>Unidad</th>
                <th>Categoría</th>
                <th className="num">Precios (autorizados)</th>
                <th>Enlace</th>
                <th>Publicó</th>
              </tr>
            </thead>
            <tbody>
              {o.published.map((p) => (
                <tr key={p.catalogItemId} data-public-code={p.publicCode}>
                  <td className="mono">
                    <Link href={`/admin/catalog/${p.catalogItemId}`}>{p.publicCode}</Link>
                  </td>
                  <td>
                    {p.name}
                    <div className="small muted mono">{p.itemLegacyId}</div>
                  </td>
                  <td className="small">{p.status}</td>
                  <td className="small">{p.saleUnit ?? '—'}</td>
                  <td className="small">{p.category ?? '—'}</td>
                  <td className="num">
                    {p.prices} ({p.authorizedPrices})
                  </td>
                  <td className="small">{p.linkKind === 'CREATED' ? 'creado' : 'enlazado'}</td>
                  <td className="small">
                    {p.publishedBy}
                    <div className="muted">{p.publishedAt.slice(0, 19).replace('T', ' ')}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
