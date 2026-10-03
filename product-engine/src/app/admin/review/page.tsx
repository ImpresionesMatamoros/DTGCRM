import Link from 'next/link';
import { connection } from 'next/server';
import { parsePage, parseReviewFilters } from '@/admin/filters';
import {
  listReviewCandidates,
  listReviewIdsByKind,
  REVIEW_KINDS,
  resolutionLists,
  reviewFacets,
} from '@/db/admin/review';
import { FIELD_DEFS } from '@/review/fields';
import { KIND_LABELS } from '@/review/labels';
import { adminPool } from '../_server/db';
import { getActor } from '../_server/actor';
import { Pager, qs } from '../_components/ui';
import { ReviewTable, type BulkFieldMeta } from './review-table';

type Search = Promise<Record<string, string | string[] | undefined>>;

const sel = (
  name: string,
  value: string | undefined,
  options: [string, string][],
  all = 'Todos',
) => (
  <select name={name} defaultValue={value ?? ''}>
    <option value="">{all}</option>
    {options.map(([v, l]) => (
      <option key={v} value={v}>
        {l}
      </option>
    ))}
  </select>
);

export default async function ReviewPage({ searchParams }: { searchParams: Search }) {
  await connection();
  const params = await searchParams;
  const filters = parseReviewFilters(params);
  const page = parsePage(params);
  const db = adminPool();
  const [result, facets, actor, matching] = await Promise.all([
    listReviewCandidates(db, filters, page),
    reviewFacets(db, filters.batchId),
    getActor(),
    listReviewIdsByKind(db, filters),
  ]);
  const { categories, methods } = await resolutionLists(db);
  const bulkFields: Record<string, BulkFieldMeta[]> = Object.fromEntries(
    Object.entries(FIELD_DEFS).map(([kind, defs]) => [
      kind,
      defs
        .filter((d) => d.bulk)
        .map((d) => ({ field: d.field, label: d.label, control: d.control })),
    ]),
  );
  const current = Object.fromEntries(
    Object.entries({
      ...filters,
      ids: filters.ids?.join(','),
      hasPrice: filters.hasPrice === undefined ? undefined : filters.hasPrice ? 'yes' : 'no',
      hasHistorical:
        filters.hasHistorical === undefined ? undefined : filters.hasHistorical ? 'yes' : 'no',
      hasDuplicate:
        filters.hasDuplicate === undefined ? undefined : filters.hasDuplicate ? 'yes' : 'no',
    }).filter(([, v]) => v !== undefined),
  ) as Record<string, string>;
  const yesNo: [string, string][] = [
    ['yes', 'Sí'],
    ['no', 'No'],
  ];
  const resolvedOpts: [string, string][] = [
    ['unresolved', 'Sin resolver'],
    ['resolved', 'Resuelto'],
  ];

  return (
    <>
      <h1 className="adm-h1">Revisión</h1>
      <p className="adm-sub">
        Candidatos importados en staging. Nada de lo que se ve aquí es todavía dato de Product
        Engine. <Link href="/admin/review/audit">Auditoría de cambios masivos</Link>
      </p>
      <form className="filters panel" method="get">
        <label>
          Buscar
          <input
            type="search"
            name="q"
            defaultValue={filters.q ?? ''}
            placeholder="nombre, LEGACY_ID…"
          />
        </label>
        <label>
          Lote
          {sel(
            'batchId',
            filters.batchId,
            facets.batches.map((b) => [b.id, `${b.sourceFile} (${b.candidates})`]),
          )}
        </label>
        <label>
          Tipo
          {sel(
            'kind',
            filters.kind,
            REVIEW_KINDS.map((k) => [k, KIND_LABELS[k] ?? k]),
          )}
        </label>
        <label>
          Estado de revisión
          {sel('status', filters.status, [
            ['TO_REVIEW', 'Por revisar (PENDING/VALID/WARNING)'],
            ['VALID', 'VALID'],
            ['WARNING', 'WARNING'],
            ['BLOCKED', 'BLOCKED'],
            ['APPROVED', 'APPROVED'],
            ['REJECTED', 'REJECTED'],
            ['PUBLISHED', 'PUBLISHED'],
          ])}
        </label>
        <label>
          Campos abiertos
          {sel('open', filters.open, [
            ['open', 'Con campos sin resolver'],
            ['complete', 'Sin campos abiertos'],
          ])}
        </label>
        <label>
          Campo sin resolver
          {sel(
            'openField',
            filters.openField,
            [
              'status',
              'itemType',
              'decorationPolicy',
              'customerSuppliedItem',
              'isRequired',
              'definition',
              'selectionMode',
              'isDistributable',
              'values',
              'methodKey',
              'validFrom',
              'amountBasis',
              'maxQuantity',
              'locale',
              'isDefault',
              'role',
              'quantity',
              'childLegacyId',
            ].map((f) => [f, f]),
            'Cualquiera',
          )}
        </label>
        <label>
          Estado de catálogo
          {sel('catalogStatus', filters.catalogStatus, resolvedOpts)}
        </label>
        <label>
          Product/Service
          {sel('itemType', filters.itemType, resolvedOpts)}
        </label>
        <label>
          Política de decoración
          {sel('decorationPolicy', filters.decorationPolicy, resolvedOpts)}
        </label>
        <label>
          Severidad
          {sel('severity', filters.severity, [
            ['ERROR', 'Con ERROR'],
            ['WARNING', 'Con WARNING'],
            ['INFO', 'Con INFO'],
          ])}
        </label>
        <label>
          Tiene precio
          {sel('hasPrice', current.hasPrice, yesNo)}
        </label>
        <label>
          Precio histórico
          {sel('hasHistorical', current.hasHistorical, yesNo)}
        </label>
        <label>
          Posible duplicado
          {sel('hasDuplicate', current.hasDuplicate, yesNo)}
        </label>
        <label>
          Hoja
          {sel(
            'sheet',
            filters.sheet,
            facets.sheets.map((s) => [s.sheet, `${s.sheet} (${s.n})`]),
            'Todas',
          )}
        </label>
        <label>
          Workbook
          {sel(
            'workbook',
            filters.workbook,
            facets.workbooks.map((w) => [w.sourceFile, `${w.sourceFile} (${w.n})`]),
          )}
        </label>
        <label>
          Orden
          {sel(
            'sort',
            filters.sort,
            [
              ['lineage', 'Linaje'],
              ['name', 'Nombre'],
              ['open', 'Más campos abiertos'],
              ['issues', 'Más issues'],
              ['status', 'Estado de revisión'],
              ['source', 'Hoja / fila'],
            ],
            'Linaje',
          )}
        </label>
        {filters.ids && <input type="hidden" name="ids" value={filters.ids.join(',')} />}
        <div className="row">
          <button className="btn btn-primary" type="submit">
            Filtrar
          </button>
          <Link href="/admin/review" className="small">
            limpiar
          </Link>
        </div>
      </form>
      {filters.ids && (
        <div className="notice info small">
          Lista explícita de {filters.ids.length} candidatos (p. ej. un grupo de decisión).{' '}
          <Link href="/admin/review">quitar</Link>
        </div>
      )}
      <ReviewTable
        key={`${JSON.stringify(current)}:${page}`}
        matching={matching}
        rows={result.rows}
        total={result.total}
        bulkFields={bulkFields}
        categories={categories}
        methods={methods}
        hasActor={actor !== null}
      />
      <Pager
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
        href={(p) => `/admin/review${qs({ ...current, page: p })}`}
      />
    </>
  );
}
