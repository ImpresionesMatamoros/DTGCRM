import Link from 'next/link';
import { connection } from 'next/server';
import { parsePage } from '@/admin/filters';
import {
  DefinitionFilters,
  listDefinitions,
  type DefinitionFilters as Filters,
} from '@/db/admin/price-views';
import { adminPool } from '../_server/db';
import { fmtDate, Pager, qs } from '../_components/ui';

type Search = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const STATUS_TONE: Record<string, string> = {
  AUTHORIZED: 'b-ok',
  DRAFT: 'b-warn',
  SUPERSEDED: 'b-plain',
};
const VALIDITY_TEXT: Record<string, string> = {
  current: 'vigente',
  future: 'futura',
  expired: 'vencida',
  draft: 'borrador',
};

export default async function PricingPage({ searchParams }: { searchParams: Search }) {
  await connection();
  const params = await searchParams;
  const parsed = DefinitionFilters.safeParse({
    q: first(params.q) || undefined,
    itemId: first(params.itemId) || undefined,
    market: first(params.market) || undefined,
    status: first(params.status) || undefined,
    model: first(params.model) || undefined,
    component: first(params.component) || undefined,
    validity: first(params.validity) || undefined,
    decision: first(params.decision) || undefined,
  });
  // Invalid filter values are dropped, never sent to SQL.
  const f: Filters = parsed.success ? parsed.data : {};
  const page = parsePage(params);
  const asOf = new Date(); // explicit boundary clock (ADR-0009)
  const result = await listDefinitions(adminPool(), f, asOf, page);
  const sel = (name: keyof Filters, options: [string, string][]) => (
    <select name={name} defaultValue={f[name] ?? ''}>
      <option value="">Todos</option>
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
  return (
    <>
      <h1 className="adm-h1">Precios</h1>
      <p className="adm-sub">
        Definiciones de precio y sus revisiones. Un precio se crea como BORRADOR, se autoriza de
        forma explícita y nunca se edita después: se crea una nueva revisión. ·{' '}
        <Link href="/admin/pricing/items">Por artículo</Link> ·{' '}
        <Link href="/admin/pricing/policies">Política de mercado</Link> ·{' '}
        <Link href="/admin/pricing/parameters">FX</Link> ·{' '}
        <Link href="/admin/pricing/readiness">Commercial Print</Link> ·{' '}
        <Link href="/admin/pricing/historical">Evidencia histórica</Link> (no es precio activo)
      </p>
      <form className="filters panel" method="get" data-testid="pricing-filters">
        <label>
          Artículo
          <input type="search" name="q" defaultValue={f.q ?? ''} placeholder="nombre o DTG-00001" />
        </label>
        <label>
          Mercado
          {sel('market', [
            ['USA', 'USA'],
            ['MX', 'MX'],
          ])}
        </label>
        <label>
          Estado
          {sel('status', [
            ['DRAFT', 'DRAFT'],
            ['AUTHORIZED', 'AUTHORIZED'],
            ['SUPERSEDED', 'SUPERSEDED'],
          ])}
        </label>
        <label>
          Modelo
          {sel('model', [
            ['FIXED', 'FIXED'],
            ['PER_UNIT', 'PER_UNIT'],
            ['EXACT_QUANTITY_MATRIX', 'Matriz exacta'],
            ['TIERED', 'TIERED'],
            ['MEASURED', 'MEASURED'],
          ])}
        </label>
        <label>
          Componente
          {sel('component', [
            ['ITEM', 'ITEM'],
            ['DECORATION', 'DECORATION'],
          ])}
        </label>
        <label>
          Vigencia
          {sel('validity', [
            ['current', 'Vigente'],
            ['future', 'Futura'],
            ['expired', 'Vencida'],
          ])}
        </label>
        <label>
          Decisión 05C
          {sel('decision', [['pricing', 'Con decisión de precio abierta']])}
        </label>
        <button className="btn btn-primary" type="submit">
          Filtrar
        </button>
      </form>
      <div className="panel">
        <table className="t" data-testid="pricing-definitions">
          <thead>
            <tr>
              <th>Artículo</th>
              <th>Mercado</th>
              <th>Modelo</th>
              <th>Condiciones</th>
              <th className="num">Rev.</th>
              <th>Estado</th>
              <th>Vigencia</th>
              <th>Decisiones abiertas</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((r) => (
              <tr key={r.id} data-status={r.status}>
                <td>
                  <Link href={`/admin/pricing/definitions/${r.id}`}>
                    <span className="mono small">{r.itemCode}</span> · {r.itemName}
                  </Link>
                </td>
                <td className="small">
                  {r.market} {r.currency}
                  {r.component === 'DECORATION' ? ' · decoración' : ''}
                </td>
                <td className="small">
                  {r.model}
                  {r.breaks ? ` · ${r.breaks} cortes` : ''}
                </td>
                <td className="small">{r.conditions}</td>
                <td className="num">{r.revision}</td>
                <td>
                  <span className={`badge ${STATUS_TONE[r.status] ?? 'b-plain'}`}>{r.status}</span>
                </td>
                <td className="small">
                  {VALIDITY_TEXT[r.validity]} · {fmtDate(r.validFrom)} →{' '}
                  {r.validTo ? fmtDate(r.validTo) : 'abierta'}
                </td>
                <td className="small">
                  {r.decisions.map((d) => (
                    <Link key={d} href={`/admin/decisions/${d}`} className="badge b-unres">
                      {d}
                    </Link>
                  ))}
                </td>
              </tr>
            ))}
            {result.rows.length === 0 && (
              <tr>
                <td colSpan={8} className="muted small">
                  Sin definiciones con esos filtros.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <Pager
          page={result.page}
          pageSize={result.pageSize}
          total={result.total}
          href={(p) => `/admin/pricing${qs({ ...(f as Record<string, string>), page: p })}`}
        />
      </div>
    </>
  );
}
