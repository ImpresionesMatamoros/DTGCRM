import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { itemPricing, type DefinitionView } from '@/db/admin/pricing';
import { adminPool } from '../../_server/db';
import { fmtDate, Kv } from '../../_components/ui';
import { PriceSimulator } from '../../_components/price-simulator';

const condLabel = (d: DefinitionView) =>
  d.conditions.length === 0
    ? 'sin condiciones'
    : d.conditions
        .map((c) =>
          c.kind === 'OPTION_VALUE'
            ? `${c.optionKey} = ${c.valueLabel ?? c.valueCode}`
            : `método ${c.methodKey}`,
        )
        .join(' · ');

const STATUS_TONE: Record<string, string> = {
  AUTHORIZED: 'b-ok',
  DRAFT: 'b-warn',
  SUPERSEDED: 'b-plain',
};

export default async function ItemPricingPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const asOf = new Date(); // explicit instant handed to the pricing domain (ADR-0009)
  const p = await itemPricing(adminPool(), id, asOf);
  if (!p) notFound();

  // Group matrix definitions of the same book/model/quantities into one table (presentation only).
  const matrices = new Map<string, DefinitionView[]>();
  const others: DefinitionView[] = [];
  for (const d of p.definitions) {
    if (d.breaks.length > 0) {
      const key = `${d.book}|${d.model}|${d.status}|${d.breaks.map((b) => b.quantity).join(',')}`;
      matrices.set(key, [...(matrices.get(key) ?? []), d]);
    } else others.push(d);
  }
  const mxBook = p.market.books.find((b) => b.market === 'MX');
  const mxPolicy = p.market.policies.find((x) => x.market === 'MX');

  return (
    <>
      <div className="crumbs">
        <Link href="/admin/pricing">Precios</Link> /{' '}
        <Link href={`/admin/catalog/${p.item.id}`}>ver en catálogo</Link>
      </div>
      <h1 className="adm-h1">
        <span className="mono">{p.item.publicCode}</span> · {p.item.name}
      </h1>
      <p className="adm-sub">
        {p.item.kind} · estado {p.item.status ?? 'sin asignar'} · unidad{' '}
        {p.item.saleUnit ?? 'sin unidad (sin precio automático)'} · calculado al {fmtDate(p.asOf)}
      </p>

      <div className="panel">
        <div className="spread">
          <h2 className="adm-h2">Price definitions ({p.definitions.length})</h2>
          <span className="row small">
            <Link href={`/admin/pricing?itemId=${p.item.id}`}>Todas las revisiones</Link>
            <Link
              href={`/admin/pricing/definitions/new?itemId=${p.item.id}&market=USA`}
              data-testid="new-draft-usa"
            >
              + Nuevo borrador (USA)
            </Link>
            <Link href={`/admin/pricing/definitions/new?itemId=${p.item.id}&market=MX`}>
              + Nuevo borrador (MX manual)
            </Link>
          </span>
        </div>
        {p.definitions.length === 0 && (
          <p className="muted small">Este item no tiene precio vigente ni borradores.</p>
        )}
        {[...matrices.values()].map((defs) => {
          const d0 = defs[0]!;
          return (
            <div key={defs.map((d) => d.id).join()} style={{ marginTop: 10 }}>
              <div className="small">
                <span className="badge b-plain">{d0.book}</span>{' '}
                <span className="badge b-outline">{d0.model}</span>{' '}
                <span className={`badge ${STATUS_TONE[d0.status] ?? 'b-plain'}`}>{d0.status}</span>{' '}
                {defs.map((d) => (
                  <Link key={d.id} href={`/admin/pricing/definitions/${d.id}`} className="small">
                    rev {d.version}
                  </Link>
                ))}{' '}
                <span className="muted">
                  {d0.currency} · base {d0.breaks[0]?.amountBasis} · vigente desde{' '}
                  {fmtDate(d0.validFrom)}
                  {d0.authorizedBy ? ` · autorizado por ${d0.authorizedBy}` : ''}
                </span>
              </div>
              <div className="t-wrap">
                <table className="t" data-testid="price-matrix">
                  <thead>
                    <tr>
                      <th className="num">Cantidad</th>
                      {defs.map((d) => (
                        <th key={d.id} className="num" title={d.id}>
                          {condLabel(d)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {d0.breaks.map((b, i) => (
                      <tr key={b.quantity}>
                        <td className="num">{b.quantity}</td>
                        {defs.map((d) => (
                          <td key={d.id} className="num">
                            {d.breaks[i]?.amount}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
        {others.map((d) => (
          <div key={d.id} style={{ marginTop: 10 }}>
            <span className="badge b-plain">{d.book}</span>{' '}
            <span className="badge b-outline">{d.model}</span>{' '}
            <span className={`badge ${STATUS_TONE[d.status] ?? 'b-plain'}`}>{d.status}</span>{' '}
            <Link href={`/admin/pricing/definitions/${d.id}`} className="small">
              rev {d.version}
            </Link>{' '}
            <span className="small">
              {d.amount && `${d.amount} ${d.currency}`}
              {d.maxQuantity ? ` por ${d.maxQuantity}` : ''}
              {d.rate && `${d.rate} ${d.currency}/${d.rateUnit}`} · {condLabel(d)} · vigente desde{' '}
              {fmtDate(d.validFrom)}
            </span>
          </div>
        ))}
        {p.definitions.length > 0 && (
          <details style={{ marginTop: 10 }}>
            <summary className="small">Procedencia de cada definición</summary>
            <table className="t">
              <tbody>
                {p.definitions.map((d) => (
                  <tr key={d.id}>
                    <td className="small">{condLabel(d)}</td>
                    <td className="mono small">
                      {d.provenance.map((s) => `${s.sourceKind} ${s.locator}`).join(' · ') || '—'}
                      {d.importTraces.map((t) => (
                        <div key={t.candidateId}>
                          <Link href={`/admin/review/${t.candidateId}`}>{t.lineageKey}</Link>
                        </div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        )}
      </div>

      {p.rules.length > 0 && (
        <div className="panel">
          <h2 className="adm-h2">Reglas asignadas</h2>
          <table className="t">
            <tbody>
              {p.rules.map((r) => (
                <tr key={r.id}>
                  <td className="small">{r.book}</td>
                  <td className="mono small">{r.code}</td>
                  <td>{r.label}</td>
                  <td className="small">
                    {r.kind} {r.amount ?? ''}
                  </td>
                  <td className="small">
                    {r.conditions
                      .map((c) => `${c.optionKey}=${c.valueLabel ?? c.valueCode}`)
                      .join(', ')}
                  </td>
                  <td>
                    <span className={`badge ${STATUS_TONE[r.status] ?? 'b-plain'}`}>
                      {r.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="panel" data-section="mexico">
        <h2 className="adm-h2">México</h2>
        <Kv
          rows={[
            [
              'Price book',
              mxBook
                ? `${mxBook.code} · ${mxBook.mode} desde ${mxBook.source} · ${mxBook.currency}`
                : '—',
            ],
            ['Factor default', mxBook?.defaultFactor ?? '—'],
            [
              'Política del item',
              mxPolicy
                ? `${mxPolicy.pricingMode}${mxPolicy.factorOverride ? ` · factor ${mxPolicy.factorOverride}` : ''}${mxPolicy.isAvailable ? '' : ' · no disponible'}`
                : 'sin política explícita → INHERIT (usa el libro MX derivado)',
            ],
            [
              'FX USD→MXN',
              p.market.fx
                ? `${p.market.fx.value} (parámetro ${p.market.fx.id.slice(0, 8)}…, desde ${fmtDate(p.market.fx.validFrom)})`
                : 'sin FX vigente',
            ],
            [
              'Redondeo',
              <span key="r">
                <span className="mono">HALF_UP_2</span>{' '}
                <span className="badge b-warn">PROVISIONAL TECHNICAL BEHAVIOR</span> (P1-02)
              </span>,
            ],
            [
              'IVA',
              <span key="i" className="unres">
                sin resolver — los importes no incluyen ni excluyen IVA explícitamente
              </span>,
            ],
          ]}
        />
        {p.definitions
          .filter((d) => d.mexico.length > 0)
          .map((d) => (
            <div key={d.id} style={{ marginTop: 10 }}>
              <div className="small muted">
                Derivación calculada por el dominio de pricing (
                <span className="mono">resolvePrice</span>, mercado MX) · {condLabel(d)}
              </div>
              <table className="t" data-testid="mexico-table">
                <thead>
                  <tr>
                    <th className="num">Cantidad</th>
                    <th className="num">USA base (USD)</th>
                    <th className="num">Factor</th>
                    <th className="num">FX</th>
                    <th>Redondeo</th>
                    <th className="num">Derivado (MXN)</th>
                    <th>Resultado</th>
                  </tr>
                </thead>
                <tbody>
                  {d.mexico.map((m) => (
                    <tr key={m.quantity}>
                      <td className="num">{m.quantity}</td>
                      <td className="num">{m.usaTotal ?? '—'}</td>
                      <td className="num">
                        {m.factor ?? '—'}{' '}
                        {m.factorSource && <span className="muted small">({m.factorSource})</span>}
                      </td>
                      <td className="num">{m.fx ?? '—'}</td>
                      <td className="mono small">{m.rounding ?? '—'}</td>
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
            </div>
          ))}
      </div>

      <PriceSimulator
        itemId={p.item.id}
        options={p.options}
        methods={p.decorationMethods}
        hasMeasurement={p.hasMeasurement}
        defaultAsOf={p.asOf}
      />

      <div className="panel" data-section="historical" style={{ borderColor: '#efd49a' }}>
        <h2 className="adm-h2">Historical evidence · Not used for current pricing</h2>
        {p.historical.length === 0 ? (
          <p className="muted small">Sin evidencia histórica.</p>
        ) : (
          <>
            <p className="small muted">
              Sólo lectura (ADR-0005). Nunca es un PriceDefinition ni se ofrece al cotizar.
            </p>
            <table className="t">
              <thead>
                <tr>
                  <th>Origen</th>
                  <th className="num">Importe</th>
                  <th>Moneda</th>
                  <th>Condición</th>
                  <th>Nota</th>
                  <th>Ubicación</th>
                </tr>
              </thead>
              <tbody>
                {p.historical.map((h, i) => (
                  <tr key={i}>
                    <td>
                      <span className="badge b-warn">
                        {h.origin === 'DOMAIN' ? 'dominio' : 'staging'}
                      </span>
                    </td>
                    <td className="num">{h.amount ?? '—'}</td>
                    <td>{h.currency ?? '—'}</td>
                    <td className="mono small">{h.condition ?? '—'}</td>
                    <td className="small">{h.note ?? ''}</td>
                    <td className="mono small">{h.locator}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </>
  );
}
