import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { can } from '@/admin/permissions';
import { itemPricing } from '@/db/admin/pricing';
import { definitionDetail, itemOptionsForEditor } from '@/db/admin/price-views';
import { getActor } from '../../../_server/actor';
import { adminPool } from '../../../_server/db';
import { PriceSimulator } from '../../../_components/price-simulator';
import { fmtDate, Kv } from '../../../_components/ui';
import { DraftEditor } from './draft-editor';
import { RevisionActions } from './revision-actions';

const TONE: Record<string, string> = { AUTHORIZED: 'b-ok', DRAFT: 'b-warn', SUPERSEDED: 'b-plain' };
const KIND_TEXT: Record<string, string> = {
  IDENTICAL_SCOPE: 'Mismo alcance',
  SPECIFICITY_TIE: 'Empate de especificidad',
  PRECEDENCE: 'Precedencia',
  DEFINITION_INVALID: 'Definición inválida',
  RETROACTIVE_SUPERSESSION: 'Sustitución retroactiva',
  PREDECESSOR_WINDOW: 'Ventana de la revisión anterior',
};

export default async function DefinitionPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const now = new Date(); // application-boundary clock
  const db = adminPool();
  const d = await definitionDetail(db, id, now);
  if (!d) notFound();
  const actor = await getActor();
  const isDraft = d.status === 'DRAFT';
  const item = await itemPricing(db, d.item.id, now);
  const editor = isDraft ? await itemOptionsForEditor(db, d.item.id) : null;
  const report = d.conflicts && d.conflicts.ok ? d.conflicts.report : null;
  const blocked = report ? !report.canAuthorize : false;
  const cond = d.conditions.length
    ? d.conditions
        .map((c) =>
          c.kind === 'OPTION_VALUE'
            ? `${c.optionKey} = ${c.valueLabel ?? c.valueCode}`
            : `método ${c.methodKey}`,
        )
        .join(' · ')
    : 'sin condiciones';

  return (
    <>
      <div className="crumbs">
        <Link href="/admin/pricing">Precios</Link> /{' '}
        <Link href={`/admin/pricing/${d.item.id}`}>{d.item.publicCode}</Link>
      </div>
      <h1 className="adm-h1">
        <span className="mono">{d.item.publicCode}</span> · {d.item.name}
      </h1>
      <p className="adm-sub">
        <span className={`badge ${TONE[d.status] ?? 'b-plain'}`} data-testid="def-status">
          {d.status}
        </span>{' '}
        <span className="badge b-outline">{d.model}</span> · {d.bookCode} ({d.currency}) ·
        componente {d.component} · <strong data-testid="def-revision">revisión {d.revision}</strong>{' '}
        de este precio ({d.item.name} · {cond})
      </p>

      <RevisionActions
        definitionId={d.id}
        status={d.status}
        canClone={d.canClone && can(actor, 'price.edit')}
        nextRevisionId={d.existingNextRevision}
        canAuthorize={can(actor, 'price.authorize')}
        blocked={blocked}
      />

      <div className="panel">
        <h2 className="adm-h2">Definición</h2>
        <Kv
          rows={[
            ['Condiciones', cond],
            ['Vigencia', `${fmtDate(d.validFrom)} → ${d.validTo ? fmtDate(d.validTo) : 'abierta'}`],
            ['Vigente hoy', d.isCurrentlyEffective ? 'sí' : 'no'],
            ['Autorizada', d.authorizedBy ? `${d.authorizedBy} · ${fmtDate(d.authorizedAt)}` : '—'],
            ...(d.supersededAt
              ? ([['Sustituida', `${fmtDate(d.supersededAt)} por la revisión siguiente`]] as [
                  string,
                  string,
                ][])
              : []),
            ...(d.amount ? ([['Monto', `${d.amount} ${d.currency}`]] as [string, string][]) : []),
            ...(d.maxQuantity
              ? ([['Cantidad máxima', String(d.maxQuantity)]] as [string, string][])
              : []),
            ...(d.rate
              ? ([['Tarifa', `${d.rate} ${d.currency}/${d.rateUnit}`]] as [string, string][])
              : []),
          ]}
        />
        {d.breaks.length > 0 && (
          <table className="t" data-testid="def-breaks" style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th className="num">Cantidad</th>
                <th className="num">Monto ({d.currency})</th>
                <th>Base</th>
              </tr>
            </thead>
            <tbody>
              {d.breaks.map((b) => (
                <tr key={b.quantity}>
                  <td className="num">{b.quantity}</td>
                  <td className="num">{b.amount}</td>
                  <td className="small">{b.amountBasis === 'TOTAL' ? 'total' : 'por unidad'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {d.model === 'EXACT_QUANTITY_MATRIX' && (
          <p className="small muted">
            Matriz exacta: una cantidad ausente cotiza sólo bajo petición (nunca se interpola).
          </p>
        )}
      </div>

      {d.decisions.length > 0 && (
        <div className="panel" data-testid="def-decisions">
          <h2 className="adm-h2">Decisiones del dueño que afectan este precio</h2>
          <ul className="small">
            {d.decisions.map((x) => (
              <li key={x.id}>
                <Link href={`/admin/decisions/${x.id}`}>
                  <strong>{x.id}</strong>
                </Link>{' '}
                · {x.title}
                {x.frozenBehaviour && <div className="muted">{x.frozenBehaviour}</div>}
              </li>
            ))}
          </ul>
          {d.market === 'MX' || d.model === 'EXACT_QUANTITY_MATRIX' || d.model === 'FIXED' ? (
            <p className="small">
              Redondeo México <span className="mono">HALF_UP_2</span>{' '}
              <span className="badge b-warn">PROVISIONAL TECHNICAL BEHAVIOR</span>; IVA sin resolver
              (D-022).
            </p>
          ) : null}
        </div>
      )}

      <div className="panel">
        <h2 className="adm-h2">Linaje de revisiones</h2>
        <table className="t" data-testid="def-lineage">
          <thead>
            <tr>
              <th className="num">Rev.</th>
              <th>Estado</th>
              <th>Vigencia</th>
              <th>Autorizó</th>
              <th>Sustituida</th>
            </tr>
          </thead>
          <tbody>
            {d.lineage.map((l) => (
              <tr key={l.id} style={l.id === d.id ? { background: '#f4f1e8' } : undefined}>
                <td className="num">
                  <Link href={`/admin/pricing/definitions/${l.id}`}>{l.version}</Link>
                </td>
                <td>
                  <span className={`badge ${TONE[l.status] ?? 'b-plain'}`}>{l.status}</span>
                </td>
                <td className="small">
                  {fmtDate(l.validFrom)} → {l.validTo ? fmtDate(l.validTo) : 'abierta'}
                </td>
                <td className="small">
                  {l.authorizedBy ? `${l.authorizedBy} · ${fmtDate(l.authorizedAt)}` : '—'}
                </td>
                <td className="small">{l.supersededAt ? fmtDate(l.supersededAt) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isDraft && report && (
        <div className="panel" data-testid="conflict-preview">
          <h2 className="adm-h2">Vista previa de conflictos antes de autorizar</h2>
          {report.blocking.length === 0 && report.info.length === 0 && (
            <p className="small">Sin conflictos con las revisiones vigentes del mismo alcance.</p>
          )}
          {report.blocking.length > 0 && (
            <div className="notice bad small" data-testid="conflicts-blocking">
              <strong>Bloquea la autorización ({report.blocking.length}):</strong>
              <ul>
                {report.blocking.map((c, i) => (
                  <li key={i}>
                    <strong>{KIND_TEXT[c.kind] ?? c.kind}</strong> — {c.message}
                    {c.otherId && (
                      <>
                        {' '}
                        · <Link href={`/admin/pricing/definitions/${c.otherId}`}>ver la otra</Link>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {report.info.length > 0 && (
            <div className="notice small" data-testid="conflicts-info">
              <ul>
                {report.info.map((c, i) => (
                  <li key={i}>
                    <strong>{KIND_TEXT[c.kind] ?? c.kind}</strong> — {c.message}
                    {c.otherId && (
                      <>
                        {' '}
                        · <Link href={`/admin/pricing/definitions/${c.otherId}`}>ver la otra</Link>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {isDraft && d.impact && d.impact.ok && d.impact.rows.length > 0 && (
        <div className="panel" data-testid="impact-preview">
          <h2 className="adm-h2">Impacto: vigente vs. borrador</h2>
          <p className="small muted">
            Calculado por el dominio de pricing al {fmtDate(d.impact.asOf)} ({d.impact.market}). Es
            una vista previa, no reescribe historia. Las columnas MXN usan los parámetros técnicos
            provisionales (D-022).
          </p>
          <table className="t">
            <thead>
              <tr>
                <th className="num">Cantidad</th>
                <th className="num">Vigente</th>
                <th className="num">Borrador</th>
                <th className="num">Δ</th>
                {d.impact.market === 'USA' && <th className="num">Borrador MXN (provisional)</th>}
              </tr>
            </thead>
            <tbody>
              {d.impact.rows.map((r) => (
                <tr key={r.quantity} data-testid="impact-row">
                  <td className="num">{r.quantity}</td>
                  <td className="num">{r.current ?? r.currentStatus}</td>
                  <td className="num">{r.draft ?? r.draftStatus}</td>
                  <td className="num">
                    {r.delta === null ? '—' : Number(r.delta) > 0 ? `+${r.delta}` : r.delta}
                  </td>
                  {d.impact && d.impact.ok && d.impact.market === 'USA' && (
                    <td className="num">{r.mxDraft ?? r.mxStatus ?? '—'}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {d.compareTo && (
        <div className="panel" data-testid="compare-panel">
          <h2 className="adm-h2">
            Comparación con la revisión {d.compareTo.revision} ({d.compareTo.status})
          </h2>
          {d.compareTo.delta.fields.length === 0 &&
            d.compareTo.delta.breaks.length === 0 &&
            d.compareTo.delta.conditions.added.length === 0 &&
            d.compareTo.delta.conditions.removed.length === 0 && (
              <p className="small">Sin diferencias.</p>
            )}
          {d.compareTo.delta.fields.length > 0 && (
            <table className="t">
              <thead>
                <tr>
                  <th>Campo</th>
                  <th>Antes</th>
                  <th>Ahora</th>
                </tr>
              </thead>
              <tbody>
                {d.compareTo.delta.fields.map((f) => (
                  <tr key={f.field}>
                    <td className="mono small">{f.field}</td>
                    <td className="small">{f.from ?? '—'}</td>
                    <td className="small">{f.to ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {(d.compareTo.delta.conditions.added.length > 0 ||
            d.compareTo.delta.conditions.removed.length > 0) && (
            <p className="small">
              Condiciones: +{d.compareTo.delta.conditions.added.join(', ') || '—'} / −
              {d.compareTo.delta.conditions.removed.join(', ') || '—'}
            </p>
          )}
          {d.compareTo.delta.breaks.length > 0 && (
            <table className="t" data-testid="compare-breaks">
              <thead>
                <tr>
                  <th className="num">Cantidad</th>
                  <th className="num">Antes</th>
                  <th className="num">Ahora</th>
                  <th className="num">Δ</th>
                </tr>
              </thead>
              <tbody>
                {d.compareTo.delta.breaks.map((b) => (
                  <tr key={b.quantity}>
                    <td className="num">{b.quantity}</td>
                    <td className="num">{b.from ?? '—'}</td>
                    <td className="num">{b.to ?? '—'}</td>
                    <td className="num">
                      {b.delta === null
                        ? 'nuevo/quitado'
                        : Number(b.delta) > 0
                          ? `+${b.delta}`
                          : b.delta}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {isDraft && editor && can(actor, 'price.edit') && (
        <DraftEditor
          definitionId={d.id}
          itemId={d.item.id}
          market={d.market as 'USA' | 'MX'}
          component={d.component as 'ITEM' | 'DECORATION'}
          model={d.model}
          currency={d.currency}
          options={editor.options}
          methods={editor.methods}
          initial={{
            validFrom: d.validFrom,
            validTo: d.validTo,
            amount: d.amount,
            rate: d.rate,
            rateUnit: d.rateUnit,
            minCharge: d.minCharge,
            minQuantity: d.minQuantity,
            maxQuantity: d.maxQuantity,
            breaks: d.breaks,
            conditions: d.conditions.map((c) =>
              c.kind === 'OPTION_VALUE'
                ? {
                    kind: 'OPTION_VALUE' as const,
                    optionKey: c.optionKey ?? '',
                    valueCode: c.valueCode ?? '',
                  }
                : { kind: 'DECORATION_METHOD' as const, methodKey: c.methodKey ?? '' },
            ),
          }}
        />
      )}

      {isDraft && item && (
        <PriceSimulator
          itemId={d.item.id}
          options={item.options}
          methods={item.decorationMethods}
          hasMeasurement={item.hasMeasurement}
          draftId={d.id}
          defaultAsOf={new Date(Math.max(now.getTime(), Date.parse(d.validFrom))).toISOString()}
          defaultMarket={d.market as 'USA' | 'MX'}
        />
      )}
      {!isDraft && (
        <p className="small">
          <Link href={`/admin/pricing/${d.item.id}#simulator`} data-testid="sim-shortcut">
            Simular este artículo →
          </Link>
        </p>
      )}

      <div className="panel" data-testid="def-history">
        <h2 className="adm-h2">Historial de cambios</h2>
        <table className="t">
          <thead>
            <tr>
              <th className="num">Rev. sistema</th>
              <th>Cuándo</th>
              <th>Quién</th>
              <th>Cambio</th>
              <th>Contexto</th>
              <th>Motivo</th>
            </tr>
          </thead>
          <tbody>
            {d.history.map((h) => (
              <tr key={h.revision}>
                <td className="num mono small">{h.revision}</td>
                <td className="small">{fmtDate(h.changedAt)}</td>
                <td className="small">{h.changedBy}</td>
                <td className="small">{h.summary}</td>
                <td className="mono small">{h.context ?? ''}</td>
                <td className="small">{h.reason ?? ''}</td>
              </tr>
            ))}
            {d.history.length === 0 && (
              <tr>
                <td colSpan={6} className="muted small">
                  Sin eventos registrados (datos de siembra).
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <h2 className="adm-h2">Procedencia</h2>
        {d.provenance.length === 0 && d.importTraces.length === 0 ? (
          <p className="small muted">Sin referencias de procedencia.</p>
        ) : (
          <ul className="small">
            {d.provenance.map((s, i) => (
              <li key={i} className="mono">
                {s.sourceKind} {s.locator}
              </li>
            ))}
            {d.importTraces.map((t) => (
              <li key={t.candidateId}>
                <Link href={`/admin/review/${t.candidateId}`}>{t.lineageKey}</Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
