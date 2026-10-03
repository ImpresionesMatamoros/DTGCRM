import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { z } from 'zod';
import { candidateDetail } from '@/db/admin/review';
import { KIND_LABELS } from '@/review/labels';
import { adminPool } from '../../_server/db';
import { getActor } from '../../_server/actor';
import {
  DataClass,
  fmtDate,
  Kind,
  Kv,
  ReviewStatus,
  Severity,
  short,
  Value,
} from '../../_components/ui';
import { CandidateActions } from './candidate-actions';
import { ResolutionPanel } from './resolution-panel';

export default async function CandidatePage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const [d, actor] = await Promise.all([candidateDetail(adminPool(), id), getActor()]);
  if (!d) notFound();
  const editable = d.reviewStatus === 'VALID' || d.reviewStatus === 'WARNING';
  const optionValues =
    d.proposal.kind === 'OPTION'
      ? d.proposal.values.map((v) => ({
          recordKey: v.recordKey,
          label: v.label,
          measurement: v.measurement,
        }))
      : [];

  return (
    <>
      <div className="crumbs">
        <Link href="/admin/review">Revisión</Link> /{' '}
        <Link href={`/admin/review?batchId=${d.batch.id}`}>{d.batch.sourceFile}</Link> /
      </div>
      <div className="spread">
        <h1 className="adm-h1">
          {d.label ?? d.lineageKey} <Kind kind={d.kind} /> <ReviewStatus status={d.reviewStatus} />{' '}
          <DataClass dataClass={d.batch.dataClass} />
        </h1>
        <span className="mono small muted">{d.lineageKey}</span>
      </div>
      <p className="adm-sub">
        {KIND_LABELS[d.kind]}
        {d.itemName && d.itemName !== d.label ? ` · item: ${d.itemName}` : ''}
        {d.itemLegacyId ? ` · LEGACY_ID ${d.itemLegacyId}` : ''} · linaje {d.lineageStatus} · parser{' '}
        {d.parserValidationState}
      </p>
      {d.blockingReasons.length > 0 && (
        <div className="notice bad">
          <strong>Bloqueado — no se puede aprobar.</strong>
          <ul style={{ margin: '4px 0 0' }}>
            {d.blockingReasons.map((b) => (
              <li key={b.code}>
                <span className="mono">{b.code}</span>: {b.explanation}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid2">
        <div>
          <div className="panel" data-section="source">
            <h2 className="adm-h2">1 · Source — lo que decía el Excel</h2>
            <Kv
              rows={[
                ['Workbook', d.batch.sourceFile],
                [
                  'SHA-256',
                  <span key="s" className="mono small" title={d.batch.sourceSha256}>
                    {short(d.batch.sourceSha256, 16)}
                  </span>,
                ],
                ['Parser', `${d.batch.parserName} ${d.batch.parserVersion}`],
                ['Importado', fmtDate(d.batch.stagedAt)],
              ]}
            />
            {d.records.map((r) => (
              <div key={r.recordId} style={{ marginTop: 10 }}>
                <div className="small">
                  <span className="badge b-plain">{r.role}</span>{' '}
                  <span className="mono">{r.recordType}</span>
                  {r.legacyId && <span className="mono"> · {r.legacyId}</span>}
                  <span className="muted"> · registro {r.recordKey}</span>
                </div>
                <div className="t-wrap">
                  <table className="t" data-testid="source-cells">
                    <thead>
                      <tr>
                        <th>Hoja</th>
                        <th className="num">Fila</th>
                        <th className="num">Col</th>
                        <th>Celda</th>
                        <th>Valor original</th>
                        <th>Normalizado</th>
                        <th>Fórmula</th>
                        <th>Caché</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.cells
                        .filter((c) => c.raw_value !== null || c.formula !== null)
                        .map((c) => (
                          <tr key={`${c.source_sheet}!${c.source_cell}`}>
                            <td className="small">{c.source_sheet}</td>
                            <td className="num small">{c.source_row}</td>
                            <td className="num small">{c.source_column}</td>
                            <td className="mono small">{c.source_cell}</td>
                            <td className="small">
                              <Value value={c.raw_value} state="NOT_SET" />
                            </td>
                            <td className="small">
                              <Value value={c.normalized_value} state="NOT_SET" />
                            </td>
                            <td className="mono small">{c.formula ?? ''}</td>
                            <td className="small">
                              {c.cached_value === null ? '' : String(c.cached_value)}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                {r.cells.some((c) => c.raw_value === null && c.formula === null) && (
                  <div className="small muted">
                    Celdas vacías en el Excel:{' '}
                    {r.cells
                      .filter((c) => c.raw_value === null && c.formula === null)
                      .map((c) => c.source_cell)
                      .join(', ')}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="panel" data-section="normalized">
            <h2 className="adm-h2">2 · Normalized — lo que produjo el parser</h2>
            <p className="small muted">
              Propuesta del staging (JSONB inmutable). <code>null</code> = desconocido en la fuente,
              nunca un default.
            </p>
            <pre className="json">{JSON.stringify(d.proposal, null, 2)}</pre>
            <details>
              <summary className="small">Registros normalizados ({d.records.length})</summary>
              {d.records.map((r) => (
                <pre key={r.recordId} className="json">
                  {JSON.stringify(r.normalized, null, 2)}
                </pre>
              ))}
            </details>
          </div>
        </div>

        <div>
          <div className="panel" data-section="resolution">
            <h2 className="adm-h2">3 · Resolution — lo que decides</h2>
            <ResolutionPanel
              candidateId={d.id}
              kind={d.kind}
              fields={d.fields}
              draft={d.draft}
              editable={editable}
              reviewStatus={d.reviewStatus}
              hasActor={actor !== null}
              lists={{ categories: d.controls.categories, methods: d.controls.methods }}
              optionDefinitions={d.controls.optionDefinitions}
              optionValues={optionValues}
              lineageMatches={d.lineageMatches}
            />
            <CandidateActions
              candidateId={d.id}
              reviewStatus={d.reviewStatus}
              dataClass={d.batch.dataClass}
              openFields={d.openFields}
              blocked={d.blockingReasons.length > 0}
              hasActor={actor !== null}
              approval={d.approval}
              rejection={d.rejection}
              publication={d.publication}
            />
          </div>

          <div className="panel" data-section="preview">
            <h2 className="adm-h2">4 · Domain preview — cómo quedaría en Product Engine</h2>
            <p className="small muted">
              Calculado por el Domain Adapter real con la resolución guardada, sin escribir nada.
              Los códigos DTG se asignan sólo al publicar.
            </p>
            {d.preview.state === 'OK' && (
              <>
                <div className="notice ok small">El adaptador acepta esta resolución.</div>
                <table className="t" data-testid="preview-ops">
                  <tbody>
                    {d.preview.ops.map((o, i) => (
                      <tr key={i}>
                        <td className="mono small nowrap">{o.op}</td>
                        <td className="small">{o.summary}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {d.preview.notes.map((n) => (
                  <div key={n} className="notice info small">
                    {n}
                  </div>
                ))}
              </>
            )}
            {d.preview.state !== 'OK' && (
              <div
                className={`notice ${d.preview.state === 'INCOMPLETE' ? 'warn' : 'bad'} small`}
                data-testid="preview-errors"
              >
                <strong>
                  {d.preview.state === 'INCOMPLETE'
                    ? 'Resolución incompleta'
                    : 'El adaptador rechaza la resolución'}
                </strong>
                <ul style={{ margin: '4px 0 0' }}>
                  {d.preview.errors.map((e, i) => (
                    <li key={i}>
                      <span className="mono">{e.code}</span>
                      {e.field ? <span className="mono"> ({e.field})</span> : null}: {e.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="panel" data-section="issues">
        <h2 className="adm-h2">Issues ({d.issues.length})</h2>
        {d.issues.length === 0 ? (
          <p className="muted small">Sin issues.</p>
        ) : (
          <table className="t">
            <thead>
              <tr>
                <th>Severidad</th>
                <th>Código</th>
                <th>Explicación</th>
                <th>Campo</th>
                <th>Origen</th>
              </tr>
            </thead>
            <tbody>
              {d.issues.map((i) => (
                <tr key={i.id}>
                  <td>
                    <Severity severity={i.severity} />
                  </td>
                  <td className="mono small">{i.code}</td>
                  <td className="small">
                    {i.explanation}
                    {i.explanation !== i.message && <div className="muted">{i.message}</div>}
                  </td>
                  <td className="mono small">{i.field ?? '—'}</td>
                  <td className="small">
                    {i.origin}
                    {i.source ? ` · ${i.source}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {d.historical.length > 0 && (
        <div className="panel" data-section="historical" style={{ borderColor: '#efd49a' }}>
          <h2 className="adm-h2">Historical evidence · Not used for current pricing</h2>
          <p className="small muted">
            Precios históricos o no autorizados del Excel (ADR-0005). Sólo lectura: nunca son
            PriceDefinition, nunca se seleccionan automáticamente y no se pueden publicar como
            precio vigente.
          </p>
          <table className="t">
            <thead>
              <tr>
                <th>Precio legacy</th>
                <th className="num">Importe</th>
                <th>Moneda</th>
                <th>Condiciones</th>
                <th>Origen</th>
              </tr>
            </thead>
            <tbody>
              {d.historical.map((h) => (
                <tr key={h.recordId}>
                  <td className="mono small">{h.priceLegacyId}</td>
                  <td className="num">{h.amount ?? '—'}</td>
                  <td>{h.currency ?? '—'}</td>
                  <td className="mono small">
                    {h.conditions ? JSON.stringify(h.conditions) : '—'}
                  </td>
                  <td className="small">
                    {h.sheet}
                    {h.row !== null ? ` · fila ${h.row}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid2">
        <div className="panel">
          <h2 className="adm-h2">Candidatos relacionados (mismo item)</h2>
          {d.related.length === 0 ? (
            <p className="muted small">Ninguno.</p>
          ) : (
            <table className="t">
              <tbody>
                {d.related.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Kind kind={r.kind} />
                    </td>
                    <td>
                      <Link href={`/admin/review/${r.id}`}>{r.label ?? r.id}</Link>
                    </td>
                    <td>
                      <ReviewStatus status={r.reviewStatus} />
                    </td>
                    <td className="small">
                      {r.openFields > 0 ? (
                        <span className="unres">{r.openFields} sin resolver</span>
                      ) : (
                        ''
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {d.links.length > 0 && (
            <>
              <h2 className="adm-h2" style={{ marginTop: 12 }}>
                Enlaces al dominio
              </h2>
              <table className="t">
                <tbody>
                  {d.links.map((l) => (
                    <tr key={`${l.role}.${l.entityId}`}>
                      <td className="small">{l.role}</td>
                      <td className="mono small">
                        {l.entityType === 'catalog_item' ? (
                          <Link href={`/admin/catalog/${l.entityId}`}>{l.entityId}</Link>
                        ) : (
                          l.entityId
                        )}
                      </td>
                      <td className="small">{l.linkKind}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
        <div className="panel" data-section="audit">
          <h2 className="adm-h2">Auditoría de la revisión</h2>
          {d.events.length === 0 ? (
            <p className="muted small">Sin decisiones registradas todavía.</p>
          ) : (
            <table className="t" data-testid="audit-trail">
              <thead>
                <tr>
                  <th>Cuándo</th>
                  <th>Quién</th>
                  <th>Acción</th>
                  <th>Campo</th>
                  <th>Antes → después</th>
                  <th>Motivo</th>
                </tr>
              </thead>
              <tbody>
                {d.events.map((e) => (
                  <tr key={e.id}>
                    <td className="small nowrap">{fmtDate(e.createdAt)}</td>
                    <td className="small">{e.actor}</td>
                    <td className="small">
                      {e.action}
                      {e.origin !== 'UI_SINGLE' && <div className="muted">{e.origin}</div>}
                    </td>
                    <td className="mono small">{e.field ?? ''}</td>
                    <td className="mono small">
                      {e.action === 'SET' || e.action === 'CLEAR'
                        ? `${e.oldValue === null ? '∅' : JSON.stringify(e.oldValue)} → ${e.newValue === null ? '∅' : JSON.stringify(e.newValue)}`
                        : ''}
                    </td>
                    <td className="small">{e.reason ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
