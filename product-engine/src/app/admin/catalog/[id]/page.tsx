import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { catalogItemDetail, listCategories } from '@/db/admin/catalog';
import { adminPool } from '../../_server/db';
import { getActor } from '../../_server/actor';
import { fmtDate, Kv } from '../../_components/ui';
import { EditItemForm } from './edit-form';

export default async function CatalogItemPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const db = adminPool();
  const [d, categories, actor] = await Promise.all([
    catalogItemDetail(db, id),
    listCategories(db),
    getActor(),
  ]);
  if (!d) notFound();
  const primary = d.categories.find((c) => c.isPrimary);
  return (
    <>
      <div className="crumbs">
        <Link href="/admin/catalog">Catálogo</Link> /
      </div>
      <h1 className="adm-h1">
        <span className="mono">{d.item.publicCode}</span> · {d.item.name}{' '}
        {d.item.status ? (
          <span className="badge b-plain">{d.item.status}</span>
        ) : (
          <span className="badge b-unres">sin estado</span>
        )}
      </h1>
      <div className="grid2">
        <div className="panel">
          <h2 className="adm-h2">Identidad (inmutable)</h2>
          <Kv
            rows={[
              [
                'UUID',
                <span key="u" className="mono small">
                  {d.item.id}
                </span>,
              ],
              [
                'Código público',
                <span key="c" className="mono">
                  {d.item.publicCode}
                </span>,
              ],
              ['Tipo', d.item.kind],
              ['Creado', fmtDate(d.item.createdAt)],
              ['Actualizado', fmtDate(d.item.updatedAt)],
              ['Fusionado en', d.item.mergedIntoId ?? '—'],
            ]}
          />
          <p className="small muted" style={{ marginTop: 8 }}>
            El UUID y el código DTG no se editan nunca; el tipo tampoco (cambia invariantes de
            precios y de artículo del cliente).
          </p>
        </div>
        <div className="panel">
          <h2 className="adm-h2">Campos editables</h2>
          <EditItemForm
            id={d.item.id}
            kind={d.item.kind}
            hasActor={actor !== null}
            initial={{
              name: d.item.name,
              status: d.item.status,
              saleUnit: d.item.saleUnit,
              decorationPolicy: d.item.decorationPolicy,
              customerSuppliedItem: d.item.customerSuppliedItem,
              descriptionInternal: d.item.descriptionInternal,
              categoryKey: primary?.key ?? null,
            }}
            categories={categories.filter((c) => c.isActive)}
          />
        </div>
      </div>

      <div className="grid2">
        <div className="panel">
          <h2 className="adm-h2">Opciones ({d.options.length})</h2>
          {d.options.length === 0 ? (
            <p className="muted small">Sin opciones.</p>
          ) : (
            <table className="t">
              <thead>
                <tr>
                  <th>Opción</th>
                  <th>Tipo</th>
                  <th>Obligatoria</th>
                  <th>Selección</th>
                  <th>Valores permitidos</th>
                </tr>
              </thead>
              <tbody>
                {d.options.map((o) => (
                  <tr key={o.key}>
                    <td>
                      <span className="mono small">{o.key}</span>
                      <div className="small muted">{o.label}</div>
                    </td>
                    <td className="small">
                      {o.valueKind}
                      {o.unit ? ` (${o.unit})` : ''}
                    </td>
                    <td className="small">{o.isRequired ? 'sí' : 'no'}</td>
                    <td className="small">
                      {o.selectionMode}
                      {o.isDistributable ? ' · distribuible' : ''}
                    </td>
                    <td className="small">
                      {o.values.map((v) => v.label).join(', ') || <span className="muted">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="small muted">
            Sin Variant ni combinaciones: cada opción es una dimensión independiente (ADR-0007).
          </p>
        </div>
        <div className="panel">
          <h2 className="adm-h2">Decoración</h2>
          <Kv rows={[['Política', d.item.decorationPolicy]]} />
          <table className="t" style={{ marginTop: 6 }}>
            <thead>
              <tr>
                <th>Método de decoración</th>
                <th>Capacidad de este item</th>
              </tr>
            </thead>
            <tbody>
              {d.methods.map((m) => {
                const cap = d.capabilities.find((c) => c.methodKey === m.key);
                return (
                  <tr key={m.key}>
                    <td className="small">
                      <span className="mono">{m.key}</span> · {m.name}
                    </td>
                    <td className="small">
                      {cap ? (
                        <span className="badge b-ok">capacidad declarada</span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="small muted">
            Capacidad de decoración = el cliente puede elegir decorar el item con ese método. No es
            el proceso con el que se fabrica el producto; las asociaciones de proceso del Excel se
            revisan en la consola y nunca se crean solas.
          </p>
        </div>
      </div>

      <div className="grid2">
        <div className="panel">
          <h2 className="adm-h2">Composición</h2>
          {d.composition.asParent.length === 0 && d.composition.asChild.length === 0 && (
            <p className="muted small">Sin composición.</p>
          )}
          {d.composition.asParent.length > 0 && (
            <div className="small">
              <strong>{d.item.name}</strong>
              <ul style={{ margin: '4px 0' }}>
                {d.composition.asParent.map((l) => (
                  <li key={l.id}>
                    <Link href={`/admin/catalog/${l.childId}`}>
                      {l.childCode} · {l.childName}
                    </Link>{' '}
                    × {l.quantity} <span className="badge b-plain">{l.role}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {d.composition.asChild.length > 0 && (
            <div className="small">
              Es componente de:
              <ul style={{ margin: '4px 0' }}>
                {d.composition.asChild.map((l) => (
                  <li key={l.id}>
                    <Link href={`/admin/catalog/${l.parentId}`}>
                      {l.parentCode} · {l.parentName}
                    </Link>{' '}
                    × {l.quantity} <span className="badge b-plain">{l.role}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="small muted">
            INCLUDED = viene incluido · OPTIONAL = se puede agregar. Edición de composición: fuera
            de STEP 06.
          </p>
        </div>
        <div className="panel">
          <h2 className="adm-h2">Presentaciones ({d.presentations.length})</h2>
          {d.presentations.length === 0 ? (
            <p className="muted small">Sin presentaciones.</p>
          ) : (
            <table className="t">
              <tbody>
                {d.presentations.map((p) => (
                  <tr key={p.id}>
                    <td className="small">{p.locale}</td>
                    <td>{p.displayName}</td>
                    <td className="small">{p.occasion ?? ''}</td>
                    <td className="small">
                      {p.isDefault && <span className="badge b-info">default</span>}{' '}
                      <span className="badge b-plain">{p.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="grid2">
        <div className="panel">
          <div className="spread">
            <h2 className="adm-h2">Precios</h2>
            <Link href={`/admin/pricing/${d.item.id}`} className="small">
              ver precios
            </Link>
          </div>
          {d.pricing.length === 0 ? (
            <p className="muted small">Sin PriceDefinitions.</p>
          ) : (
            <table className="t">
              <tbody>
                {d.pricing.map((p) => (
                  <tr key={`${p.book}.${p.model}.${p.status}`}>
                    <td className="small">{p.book}</td>
                    <td className="small">{p.model}</td>
                    <td className="small">{p.status}</td>
                    <td className="num">{p.n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="small muted">
            Mercados:{' '}
            {d.marketPolicies.length === 0
              ? 'sin política explícita (INHERIT por defecto)'
              : d.marketPolicies.map((m) => `${m.market} ${m.pricingMode}`).join(' · ')}
          </p>
        </div>
        <div className="panel">
          <h2 className="adm-h2">Procedencia</h2>
          <table className="t">
            <tbody>
              {d.provenance.map((p, i) => (
                <tr key={i}>
                  <td className="small">
                    <span
                      className={`badge ${p.sourceKind === 'HISTORICAL_PRICE_EVIDENCE' ? 'b-warn' : 'b-plain'}`}
                    >
                      {p.sourceKind}
                    </span>
                  </td>
                  <td className="mono small">{p.locator}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {d.importTraces.length > 0 && (
            <div className="small" style={{ marginTop: 6 }}>
              Candidatos de importación:{' '}
              {d.importTraces.map((t) => (
                <Link key={t.candidateId} href={`/admin/review/${t.candidateId}`}>
                  {t.lineageKey}{' '}
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="panel" data-section="history">
        <h2 className="adm-h2">Historial (change_event)</h2>
        <table className="t">
          <thead>
            <tr>
              <th>Rev.</th>
              <th>Cuándo</th>
              <th>Quién</th>
              <th>Tabla</th>
              <th>Acción</th>
              <th>Cambios</th>
              <th>Contexto</th>
            </tr>
          </thead>
          <tbody>
            {d.history.map((h) => (
              <tr key={h.revision}>
                <td className="mono small">{h.revision}</td>
                <td className="small nowrap">{fmtDate(h.changedAt)}</td>
                <td className="small">{h.changedBy}</td>
                <td className="small">{h.table}</td>
                <td className="small">{h.action}</td>
                <td className="mono small">
                  {h.changes
                    .map((c) => `${c.field}: ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}`)
                    .join(' · ')}
                </td>
                <td className="small muted">{h.context ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
