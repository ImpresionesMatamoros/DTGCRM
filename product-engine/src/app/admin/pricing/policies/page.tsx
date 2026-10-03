import Link from 'next/link';
import { connection } from 'next/server';
import { z } from 'zod';
import { can } from '@/admin/permissions';
import { itemPricing } from '@/db/admin/pricing';
import { listItemsLite, listPolicies, mexicoBook } from '@/db/admin/price-views';
import { getActor } from '../../_server/actor';
import { adminPool } from '../../_server/db';
import { fmtDate, Kv } from '../../_components/ui';
import { PolicyForm } from './policy-form';

type Search = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function PoliciesPage({ searchParams }: { searchParams: Search }) {
  await connection();
  const params = await searchParams;
  const db = adminPool();
  const now = new Date();
  const actor = await getActor();
  const itemId = z.uuid().safeParse(first(params.itemId)).data;
  const [policies, items, book] = await Promise.all([
    listPolicies(db),
    listItemsLite(db),
    mexicoBook(db),
  ]);
  const sel = itemId ? await itemPricing(db, itemId, now) : null;
  const current = sel?.market.policies.find((x) => x.market === 'MX') ?? null;
  const effectiveFactor = current?.factorOverride ?? book?.defaultFactor ?? null;
  return (
    <>
      <div className="crumbs">
        <Link href="/admin/pricing">Precios</Link> / Política de mercado
      </div>
      <h1 className="adm-h1">Política de mercado por artículo (México)</h1>
      <p className="adm-sub">
        Sin fila = INHERIT: USA × factor × FX. México derivado usa redondeo{' '}
        <span className="mono">HALF_UP_2</span>{' '}
        <span className="badge b-warn">PROVISIONAL TECHNICAL BEHAVIOR</span>. IVA y redondeo
        comercial siguen abiertos (<Link href="/admin/decisions/D-022">D-022</Link>): no se agrega
        ni se infiere ningún impuesto.
      </p>

      <div className="panel">
        <h2 className="adm-h2">Libro MX</h2>
        <Kv
          rows={[
            ['Libro', book ? `${book.code} · ${book.mode} desde ${book.source}` : '—'],
            ['Factor por defecto', book?.defaultFactor ?? '—'],
            [
              'FX vigente',
              sel?.market.fx ? (
                `${sel.market.fx.value} MXN/USD (desde ${fmtDate(sel.market.fx.validFrom)})`
              ) : (
                <span key="fx">
                  ver <Link href="/admin/pricing/parameters">parámetros FX</Link>
                </span>
              ),
            ],
          ]}
        />
      </div>

      <div className="panel">
        <h2 className="adm-h2">Artículos con política explícita ({policies.length})</h2>
        <table className="t" data-testid="policy-list">
          <thead>
            <tr>
              <th>Artículo</th>
              <th>Modo</th>
              <th className="num">Factor propio</th>
              <th className="num">Factor efectivo</th>
              <th>Disponible</th>
            </tr>
          </thead>
          <tbody>
            {policies.map((r) => (
              <tr key={r.itemId}>
                <td>
                  <Link href={`/admin/pricing/policies?itemId=${r.itemId}`}>
                    <span className="mono small">{r.itemCode}</span> · {r.itemName}
                  </Link>
                </td>
                <td className="small">{r.pricingMode}</td>
                <td className="num">{r.factorOverride ?? '—'}</td>
                <td className="num">
                  {r.pricingMode === 'DERIVED' || r.pricingMode === 'INHERIT'
                    ? (r.factorOverride ?? r.defaultFactor)
                    : '—'}
                </td>
                <td className="small">{r.isAvailable ? 'sí' : 'no'}</td>
              </tr>
            ))}
            {policies.length === 0 && (
              <tr>
                <td colSpan={5} className="muted small">
                  Ningún artículo tiene política propia: todos heredan el libro MX.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <h2 className="adm-h2">Editar política</h2>
        <form method="get" className="row">
          <label className="small">
            Artículo
            <select name="itemId" defaultValue={itemId ?? ''}>
              <option value="">— elegir —</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.publicCode} · {i.name}
                </option>
              ))}
            </select>
          </label>
          <button className="btn" type="submit">
            Abrir
          </button>
        </form>
        {sel && (
          <>
            <h3 className="adm-h2" style={{ marginTop: 10 }}>
              {sel.item.publicCode} · {sel.item.name}
            </h3>
            <Kv
              rows={[
                [
                  'Política actual',
                  current
                    ? `${current.pricingMode}${current.factorOverride ? ` · factor ${current.factorOverride}` : ''}`
                    : 'sin fila → INHERIT',
                ],
                [
                  'Factor efectivo',
                  `${effectiveFactor ?? '—'} (${current?.factorOverride ? 'propio del artículo' : 'default del libro'})`,
                ],
                [
                  'Redondeo',
                  <span key="r">
                    <span className="mono">HALF_UP_2</span>{' '}
                    <span className="badge b-warn">PROVISIONAL TECHNICAL BEHAVIOR</span>
                  </span>,
                ],
              ]}
            />
            {can(actor, 'market.policy') ? (
              <PolicyForm
                key={sel.item.id + String(current?.pricingMode) + String(current?.factorOverride)}
                itemId={sel.item.id}
                current={current}
                defaultFactor={book?.defaultFactor ?? null}
              />
            ) : (
              <div className="notice warn small">
                Necesitas un actor local con permiso market.policy.
              </div>
            )}
            {sel.definitions.some((d) => d.mexico.length > 0) && (
              <>
                <h3 className="adm-h2" style={{ marginTop: 10 }}>
                  Vista previa derivada (calculada por el dominio, parámetros vigentes)
                </h3>
                {sel.definitions
                  .filter((d) => d.mexico.length > 0)
                  .map((d) => (
                    <table className="t" key={d.id} data-testid="policy-preview">
                      <thead>
                        <tr>
                          <th className="num">Cantidad</th>
                          <th className="num">USA (USD)</th>
                          <th className="num">Factor</th>
                          <th className="num">FX</th>
                          <th className="num">MXN</th>
                          <th>Resultado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.mexico.map((m) => (
                          <tr key={m.quantity}>
                            <td className="num">{m.quantity}</td>
                            <td className="num">{m.usaTotal ?? '—'}</td>
                            <td className="num">{m.factor ?? '—'}</td>
                            <td className="num">{m.fx ?? '—'}</td>
                            <td className="num">
                              <strong>{m.mxTotal ?? '—'}</strong>
                            </td>
                            <td className="small">
                              {m.status}
                              {m.reason ? ` · ${m.reason}` : ''}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ))}
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}
