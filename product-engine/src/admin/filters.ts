import { z } from 'zod';
import type { CatalogFilters } from '@/db/admin/catalog';
import { REVIEW_KINDS, REVIEW_STATUSES, type ReviewFilters } from '@/db/admin/review';

/**
 * URL → filters, validated on the server. Filters live in the query string
 * (shareable links, work without JavaScript); anything invalid is ignored
 * instead of reaching SQL.
 */

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const bool = z.enum(['yes', 'no']).transform((v) => v === 'yes');
const resolved = z.enum(['resolved', 'unresolved']);
const uuid = z.uuid();

function pick<T>(schema: z.ZodType<T>, raw: string | undefined): T | undefined {
  if (raw === undefined || raw === '') return undefined;
  const r = schema.safeParse(raw);
  return r.success ? r.data : undefined;
}

export function parseReviewFilters(params: Params): ReviewFilters {
  const g = (k: string) => first(params[k]);
  const ids = (g('ids') ?? '')
    .split(/[\s,]+/)
    .filter(Boolean)
    .filter((x) => uuid.safeParse(x).success)
    .slice(0, 2000);
  return {
    batchId: pick(uuid, g('batchId')),
    kind: pick(z.enum(REVIEW_KINDS), g('kind')),
    status: pick(z.enum([...REVIEW_STATUSES, 'TO_REVIEW']), g('status')),
    severity: pick(z.enum(['ERROR', 'WARNING', 'INFO']), g('severity')),
    catalogStatus: pick(resolved, g('catalogStatus')),
    itemType: pick(resolved, g('itemType')),
    decorationPolicy: pick(resolved, g('decorationPolicy')),
    open: pick(z.enum(['open', 'complete']), g('open')),
    openField: pick(
      z
        .string()
        .regex(/^[a-zA-Z][a-zA-Z0-9]*$/)
        .max(40),
      g('openField'),
    ),
    hasPrice: pick(bool, g('hasPrice')),
    hasHistorical: pick(bool, g('hasHistorical')),
    hasDuplicate: pick(bool, g('hasDuplicate')),
    sheet: pick(z.string().max(80), g('sheet')),
    workbook: pick(z.string().max(200), g('workbook')),
    dataClass: pick(z.enum(['REAL', 'FIXTURE']), g('dataClass')),
    q: pick(z.string().trim().max(120), g('q')),
    ids: ids.length ? ids : undefined,
    sort: pick(z.enum(['lineage', 'name', 'open', 'issues', 'status', 'source']), g('sort')),
  };
}

export function parsePage(params: Params): number {
  const n = Number(first(params.page));
  return Number.isInteger(n) && n > 0 ? n : 1;
}

export function parseCatalogFilters(params: Params): CatalogFilters {
  const g = (k: string) => first(params[k]);
  return {
    q: pick(z.string().trim().max(120), g('q')),
    kind: pick(z.enum(['PRODUCT', 'SERVICE']), g('kind')),
    status: pick(z.enum(['CANDIDATE', 'PLANNED', 'ACTIVE', 'RETIRED', 'UNSET']), g('status')),
    categoryKey: pick(z.string().regex(/^([a-z][a-z0-9_]*|NONE)$/), g('category')),
    decorationPolicy: pick(z.enum(['NONE', 'OPTIONAL', 'REQUIRED']), g('decoration')),
  };
}
