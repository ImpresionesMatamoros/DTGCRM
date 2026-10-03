import Link from 'next/link';
import { connection } from 'next/server';
import { z } from 'zod';
import { parsePage } from '@/admin/filters';
import { listPricedItems } from '@/db/admin/pricing';
import { adminPool } from '../../_server/db';
import { Pager, qs } from '../../_components/ui';

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function PricingPage({ searchParams }: { searchParams: Search }) {
  await connection();
  const params = await searchParams;
  const q = z.string().max(120).safeParse(params.q).data;
  const all = params.all === '1';
  const page = parsePage(params);
  const result = await listPricedItems(adminPool(), { q, withPrices: !all }, page);
  return (
    <>
      <h1 className="adm-h1">Precios por artículo</h1>
      <p className="adm-sub">
        Resumen por artículo. Para revisiones, borradores y autorización usa la{' '}
        <Link href="/admin/pricing">lista de definiciones</Link>.{' '}
        <Link href="/admin/pricing/historical">Evidencia histórica</Link>
      </p>
      <form className="filters panel" method="get">
        <label>
          Buscar item
          <input type="search" name="q" defaultValue={q ?? ''} placeholder="nombre o DTG-00001" />
        </label>
        <label>
          Alcance
          <select name="all" defaultValue={all ? '1' : ''}>
            <option value="">Sólo items con precios</option>
            <option value="1">Todos los items</option>
          </select>
        </label>
        <button className="btn btn-primary" type="submit">
          Buscar
        </button>
      </form>
      <div className="panel">
        <table className="t" data-testid="pricing-items">
          <thead>
            <tr>
              <th>Código</th>
              <th>Item</th>
              <th>Estado</th>
              <th>Unidad</th>
              <th className="num">Definiciones</th>
              <th className="num">AUTHORIZED</th>
              <th className="num">DRAFT</th>
              <th className="num">Históricos</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((r) => (
              <tr key={r.id}>
                <td className="mono small">
                  <Link href={`/admin/pricing/${r.id}`}>{r.publicCode}</Link>
                </td>
                <td>
                  <Link href={`/admin/pricing/${r.id}`}>{r.name}</Link>
                </td>
                <td className="small">{r.status ?? <span className="unres">sin asignar</span>}</td>
                <td className="small">{r.saleUnit ?? <span className="muted">—</span>}</td>
                <td className="num">{r.definitions}</td>
                <td className="num">{r.authorized}</td>
                <td className="num">{r.draft}</td>
                <td className="num">
                  {r.historical ? <span className="badge b-warn">{r.historical}</span> : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pager
          page={result.page}
          pageSize={result.pageSize}
          total={result.total}
          href={(p) => `/admin/pricing/items${qs({ q, all: all ? '1' : undefined, page: p })}`}
        />
      </div>
    </>
  );
}
