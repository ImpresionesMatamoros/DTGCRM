import Link from 'next/link';
import { connection } from 'next/server';
import { parseCatalogFilters, parsePage } from '@/admin/filters';
import { listCategories, searchCatalog } from '@/db/admin/catalog';
import { adminPool } from '../_server/db';
import { Pager, qs } from '../_components/ui';

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function CatalogPage({ searchParams }: { searchParams: Search }) {
  await connection();
  const params = await searchParams;
  const f = parseCatalogFilters(params);
  const page = parsePage(params);
  const db = adminPool();
  const [result, categories] = await Promise.all([searchCatalog(db, f, page), listCategories(db)]);
  const current = {
    q: f.q,
    kind: f.kind,
    status: f.status,
    category: f.categoryKey,
    decoration: f.decorationPolicy,
  };
  return (
    <>
      <div className="spread">
        <h1 className="adm-h1">Catálogo</h1>
        <Link href="/admin/catalog/new" className="btn btn-primary">
          Nuevo item
        </Link>
      </div>
      <p className="adm-sub">
        CatalogItems del dominio (no del staging). Buscar por nombre, código DTG o LEGACY_ID.
      </p>
      <form className="filters panel" method="get">
        <label>
          Buscar
          <input
            type="search"
            name="q"
            defaultValue={f.q ?? ''}
            placeholder="nombre, DTG-00001, MIG1-O-009…"
          />
        </label>
        <label>
          Tipo
          <select name="kind" defaultValue={f.kind ?? ''}>
            <option value="">Todos</option>
            <option value="PRODUCT">PRODUCT</option>
            <option value="SERVICE">SERVICE</option>
          </select>
        </label>
        <label>
          Estado
          <select name="status" defaultValue={f.status ?? ''}>
            <option value="">Todos</option>
            {['CANDIDATE', 'PLANNED', 'ACTIVE', 'RETIRED'].map((s) => (
              <option key={s}>{s}</option>
            ))}
            <option value="UNSET">Sin asignar (null)</option>
          </select>
        </label>
        <label>
          Categoría
          <select name="category" defaultValue={f.categoryKey ?? ''}>
            <option value="">Todas</option>
            {categories.map((c) => (
              <option key={c.key} value={c.key}>
                {c.name}
              </option>
            ))}
            <option value="NONE">Sin categoría</option>
          </select>
        </label>
        <label>
          Decoración
          <select name="decoration" defaultValue={f.decorationPolicy ?? ''}>
            <option value="">Todas</option>
            {['NONE', 'OPTIONAL', 'REQUIRED'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <button className="btn btn-primary" type="submit">
          Filtrar
        </button>
        <Link href="/admin/catalog" className="small">
          limpiar
        </Link>
      </form>
      <div className="panel">
        <table className="t" data-testid="catalog-table">
          <thead>
            <tr>
              <th>Código</th>
              <th>Nombre</th>
              <th>Tipo</th>
              <th>Estado</th>
              <th>Unidad</th>
              <th>Decoración</th>
              <th>Categoría</th>
              <th>LEGACY_ID</th>
              <th className="num">Precios</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((r) => (
              <tr key={r.id}>
                <td className="mono small">
                  <Link href={`/admin/catalog/${r.id}`}>{r.publicCode}</Link>
                </td>
                <td>
                  <Link href={`/admin/catalog/${r.id}`}>{r.name}</Link>
                </td>
                <td className="small">{r.kind}</td>
                <td>
                  {r.status ? (
                    <span className="badge b-plain">{r.status}</span>
                  ) : (
                    <span className="badge b-unres">sin asignar</span>
                  )}
                </td>
                <td className="small">{r.saleUnit ?? <span className="muted">—</span>}</td>
                <td className="small">{r.decorationPolicy}</td>
                <td className="small">{r.category ?? <span className="muted">—</span>}</td>
                <td className="mono small">{r.legacyIds.join(', ')}</td>
                <td className="num">{r.priceDefinitions || ''}</td>
              </tr>
            ))}
            {result.rows.length === 0 && (
              <tr>
                <td colSpan={9} className="muted">
                  Sin resultados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <Pager
          page={result.page}
          pageSize={result.pageSize}
          total={result.total}
          href={(p) => `/admin/catalog${qs({ ...current, page: p })}`}
        />
      </div>
    </>
  );
}
