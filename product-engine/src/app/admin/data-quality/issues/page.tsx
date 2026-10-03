import Link from 'next/link';
import { connection } from 'next/server';
import { qualityOverview, remediationOption, resolutionLists } from '@/db/admin/quality-views';
import {
  applyFindingFilters,
  filterQuery,
  findingFacets,
  parseFindingFilters,
} from '@/quality/filter';
import { adminPool } from '../../_server/db';
import { Badge, Pager, qs } from '../../_components/ui';
import { getActor } from '../../_server/actor';
import { QualityTabs } from '../nav';
import { RemediationPanel } from './remediation-panel';

const PAGE = 50;
const TONE = { BLOCKER: 'bad', WARNING: 'warn', INFO: 'info' } as const;

export default async function IssuesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  const params = await searchParams;
  const filters = parseFindingFilters(params);
  const pageNo = Math.max(
    1,
    Number(Array.isArray(params.page) ? params.page[0] : params.page) || 1,
  );
  const db = adminPool();
  const [o, actor, lists] = await Promise.all([
    qualityOverview(db),
    getActor(),
    resolutionLists(db),
  ]);
  const all = o.run.findings;
  const facets = findingFacets(all);
  const rows = applyFindingFilters(all, filters);
  const page = rows.slice((pageNo - 1) * PAGE, pageNo * PAGE);
  const option =
    filters.rule && filters.rule
      ? remediationOption(
          filters.rule,
          rows.filter((r) => r.remediation === 'BULK_RESOLVABLE').length,
        )
      : null;
  const current = filterQuery(filters);
  const sel = (name: string, value: string | undefined, opts: [string, string][]) => (
    <label className="small">
      {name}{' '}
      <select name={name} defaultValue={value ?? ''}>
        <option value="">todos</option>
        {opts.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
  const dec = (id: string) => (
    <Link key={id} href={`/admin/decisions/${id}`} className="badge b-outline">
      {id}
    </Link>
  );
  return (
    <>
      <h1 className="adm-h1">Problemas de calidad</h1>
      <p className="adm-sub" data-testid="issues-count">
        {rows.length} de {all.length} hallazgos.
      </p>
      <QualityTabs />
      <form method="get" className="panel row" style={{ flexWrap: 'wrap', gap: 10 }}>
        {sel(
          'rule',
          filters.rule,
          facets.rules.map((r) => [r.code, `${r.code} (${r.n}) ${r.title}`]),
        )}
        {sel('severity', filters.severity, [
          ['BLOCKER', 'Bloqueante'],
          ['WARNING', 'Advertencia'],
          ['INFO', 'Info'],
        ])}
        {sel(
          'kind',
          filters.kind,
          facets.kinds.map((k) => [k, k]),
        )}
        {sel(
          'category',
          filters.category,
          facets.categories.map((k) => [k, k]),
        )}
        {sel(
          'decision',
          filters.decision,
          facets.decisions.map((k) => [k, k]),
        )}
        {sel('bulk', filters.bulk === undefined ? undefined : filters.bulk ? 'yes' : 'no', [
          ['yes', 'Resoluble en masa'],
          ['no', 'No en masa'],
        ])}
        {sel(
          'workbook',
          filters.workbook,
          facets.workbooks.map((k) => [k, k]),
        )}
        {sel(
          'reviewStatus',
          filters.reviewStatus,
          facets.reviewStatuses.map((k) => [k, k]),
        )}
        <button className="btn" type="submit">
          Filtrar
        </button>
        <Link href="/admin/data-quality/issues" className="small">
          limpiar
        </Link>
        <Link href={`/admin/data-quality/export?format=csv&${current.slice(1)}`} className="small">
          CSV
        </Link>
        <Link href="/admin/data-quality/export" className="small">
          JSON
        </Link>
      </form>

      {option && option.resolvable > 0 && (
        <RemediationPanel option={option} lists={lists} hasActor={!!actor} />
      )}

      <div className="panel">
        <div className="t-wrap">
          <table className="t" data-testid="issues-table">
            <thead>
              <tr>
                <th>Regla</th>
                <th>Severidad</th>
                <th>Artículo / candidato</th>
                <th>Problema</th>
                <th>Remediación</th>
                <th>Decisión</th>
              </tr>
            </thead>
            <tbody>
              {page.map((f) => (
                <tr key={f.key} data-rule={f.ruleCode}>
                  <td className="mono small">
                    <Link href={`/admin/data-quality/issues?rule=${f.ruleCode}`}>{f.ruleCode}</Link>
                  </td>
                  <td>
                    <Badge tone={TONE[f.severity]}>{f.severity}</Badge>
                  </td>
                  <td>
                    {f.candidateId ? (
                      <Link href={`/admin/review/${f.candidateId}`} data-testid="finding-candidate">
                        {f.itemName ?? f.itemLegacyId ?? f.candidateId.slice(0, 8)}
                      </Link>
                    ) : (
                      (f.itemName ?? f.itemLegacyId ?? '—')
                    )}
                    <div className="small muted mono">
                      {f.itemLegacyId} · {f.candidateKind ?? 'DOMAIN'}
                    </div>
                  </td>
                  <td className="small">
                    {f.message}
                    <div className="muted">{f.workbook}</div>
                  </td>
                  <td className="small">{f.remediation.replace(/_/g, ' ').toLowerCase()}</td>
                  <td className="small">{f.decisions.map((d) => dec(d.id))}</td>
                </tr>
              ))}
              {page.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    Ningún hallazgo con estos filtros.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pager
          page={pageNo}
          pageSize={PAGE}
          total={rows.length}
          href={(p) =>
            `/admin/data-quality/issues${qs({ ...Object.fromEntries(new URLSearchParams(current.slice(1))), page: p })}`
          }
        />
      </div>
    </>
  );
}
