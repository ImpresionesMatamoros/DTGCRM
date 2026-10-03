import Link from 'next/link';
import type { ReactNode } from 'react';
import { KIND_LABELS, REVIEW_STATUS_LABELS } from '@/review/labels';

/** Small presentational helpers shared by the admin pages (no business logic). */

export function Badge({
  tone,
  children,
  title,
}: {
  tone: string;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span className={`badge b-${tone}`} title={title}>
      {children}
    </span>
  );
}

const STATUS_TONE: Record<string, string> = {
  PENDING: 'plain',
  VALID: 'ok',
  WARNING: 'warn',
  BLOCKED: 'bad',
  APPROVED: 'info',
  REJECTED: 'plain',
  PUBLISHED: 'ok',
};

export function ReviewStatus({ status }: { status: string }) {
  return (
    <Badge tone={STATUS_TONE[status] ?? 'plain'} title={REVIEW_STATUS_LABELS[status]}>
      {status}
    </Badge>
  );
}

export function Kind({ kind }: { kind: string }) {
  return (
    <Badge tone="outline" title={KIND_LABELS[kind]}>
      {kind}
    </Badge>
  );
}

export function Severity({ severity }: { severity: string }) {
  return (
    <Badge tone={severity === 'ERROR' ? 'bad' : severity === 'WARNING' ? 'warn' : 'info'}>
      {severity}
    </Badge>
  );
}

export function DataClass({ dataClass }: { dataClass: string }) {
  return <Badge tone={dataClass === 'REAL' ? 'warn' : 'info'}>{dataClass}</Badge>;
}

const STATE_TEXT: Record<string, { tone: string; text: string }> = {
  REVIEWED: { tone: 'info', text: 'decidido' },
  SOURCE: { tone: 'plain', text: 'del Excel' },
  UNRESOLVED: { tone: 'unres', text: 'sin resolver' },
  NOT_SET: { tone: 'plain', text: 'sin asignar' },
};

export function FieldState({ state }: { state: string }) {
  const s = STATE_TEXT[state] ?? { tone: 'plain', text: state };
  return <Badge tone={s.tone}>{s.text}</Badge>;
}

/** Renders a value without inventing one: undefined is shown as unresolved. */
export function Value({ value, state }: { value: unknown; state?: string }) {
  if (value === undefined) {
    return state === 'NOT_SET' ? (
      <span className="muted">—</span>
    ) : (
      <span className="unres">?</span>
    );
  }
  if (value === null) return <span className="mono">null</span>;
  if (typeof value === 'boolean') return <span className="mono">{String(value)}</span>;
  if (typeof value === 'object') return <span className="mono small">{JSON.stringify(value)}</span>;
  return <span>{String(value)}</span>;
}

export function Kv({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="kv">
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: 'contents' }}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Pager({
  page,
  pageSize,
  total,
  href,
}: {
  page: number;
  pageSize: number;
  total: number;
  href: (page: number) => string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="pager small">
      <span className="muted">
        {from}–{to} de {total}
      </span>
      {page > 1 ? (
        <Link href={href(page - 1)}>← anterior</Link>
      ) : (
        <span className="muted">← anterior</span>
      )}
      <span>
        página {page} / {pages}
      </span>
      {page < pages ? (
        <Link href={href(page + 1)}>siguiente →</Link>
      ) : (
        <span className="muted">siguiente →</span>
      )}
    </div>
  );
}

/** Builds a query string from defined params only. */
export function qs(params: Record<string, string | number | undefined | null>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params))
    if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : '';
}

export const one = (v: string | string[] | undefined): string | undefined =>
  Array.isArray(v) ? v[0] : v;

export function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—';
  return iso.replace('T', ' ').replace(/\.\d+Z$/, 'Z');
}

export function short(sha: string | null | undefined, n = 12) {
  return sha ? `${sha.slice(0, n)}…` : '—';
}
