import { z } from 'zod';
import { AREAS, REMEDIATIONS, SEVERITIES, type DataQualityFinding } from './types';

/** Issue-queue filters (STEP 08 §16). Pure and URL-driven; anything invalid is ignored. */

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export interface FindingFilters {
  rule?: string;
  severity?: (typeof SEVERITIES)[number];
  kind?: string;
  category?: string;
  decision?: string;
  /** yes = remediation BULK_RESOLVABLE; no = anything else */
  bulk?: boolean;
  remediation?: (typeof REMEDIATIONS)[number];
  area?: (typeof AREAS)[number];
  workbook?: string;
  reviewStatus?: string;
  dimension?: 'REVIEW' | 'DOMAIN' | 'PRICING';
  q?: string;
}

const pick = <T>(schema: z.ZodType<T>, raw: string | undefined): T | undefined => {
  if (raw === undefined || raw === '') return undefined;
  const r = schema.safeParse(raw);
  return r.success ? r.data : undefined;
};

export function parseFindingFilters(params: Params): FindingFilters {
  const g = (k: string) => first(params[k]);
  return {
    rule: pick(z.string().regex(/^DQ-[A-Z]+-\d{3}$/), g('rule')),
    severity: pick(z.enum(SEVERITIES), g('severity')),
    kind: pick(
      z.enum([
        'CATALOG_ITEM',
        'OPTION',
        'DECORATION',
        'COMPOSITION',
        'PRICE',
        'PRESENTATION',
        'DOMAIN',
      ]),
      g('kind'),
    ),
    category: pick(z.string().max(80), g('category')),
    decision: pick(z.string().regex(/^D-\d{3}$/), g('decision')),
    bulk: pick(
      z.enum(['yes', 'no']).transform((v) => v === 'yes'),
      g('bulk'),
    ),
    remediation: pick(z.enum(REMEDIATIONS), g('remediation')),
    area: pick(z.enum(AREAS), g('area')),
    workbook: pick(z.string().max(200), g('workbook')),
    reviewStatus: pick(z.string().max(30), g('reviewStatus')),
    dimension: pick(z.enum(['REVIEW', 'DOMAIN', 'PRICING']), g('dimension')),
    q: pick(z.string().trim().max(120), g('q')),
  };
}

export function applyFindingFilters(
  findings: readonly DataQualityFinding[],
  f: FindingFilters,
): DataQualityFinding[] {
  const q = f.q?.toLowerCase();
  return findings.filter(
    (x) =>
      (!f.rule || x.ruleCode === f.rule) &&
      (!f.severity || x.severity === f.severity) &&
      (!f.kind || (x.candidateKind ?? 'DOMAIN') === f.kind) &&
      (!f.category || x.category === f.category) &&
      (!f.decision || x.decisions.some((d) => d.id === f.decision)) &&
      (f.bulk === undefined || (x.remediation === 'BULK_RESOLVABLE') === f.bulk) &&
      (!f.remediation || x.remediation === f.remediation) &&
      (!f.area || x.area === f.area) &&
      (!f.workbook || x.workbook === f.workbook) &&
      (!f.reviewStatus || x.reviewStatus === f.reviewStatus) &&
      (!f.dimension || x.dimension === f.dimension) &&
      (!q ||
        `${x.itemName ?? ''} ${x.itemLegacyId ?? ''} ${x.message} ${x.ruleCode}`
          .toLowerCase()
          .includes(q)),
  );
}

/** Query string for a filter set (every dashboard number links to its filtered list). */
export function filterQuery(f: FindingFilters): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) {
    if (v === undefined || v === '') continue;
    p.set(k, typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

export interface FindingFacets {
  rules: { code: string; title: string; n: number }[];
  kinds: string[];
  categories: string[];
  decisions: string[];
  workbooks: string[];
  reviewStatuses: string[];
}

export function findingFacets(findings: readonly DataQualityFinding[]): FindingFacets {
  const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))].sort();
  const rules = new Map<string, { code: string; title: string; n: number }>();
  for (const f of findings) {
    const r = rules.get(f.ruleCode) ?? { code: f.ruleCode, title: f.title, n: 0 };
    r.n++;
    rules.set(f.ruleCode, r);
  }
  return {
    rules: [...rules.values()].sort((a, b) => (a.code < b.code ? -1 : 1)),
    kinds: uniq(findings.map((f) => f.candidateKind ?? 'DOMAIN')),
    categories: uniq(findings.map((f) => f.category)),
    decisions: uniq(findings.flatMap((f) => f.decisions.map((d) => d.id))),
    workbooks: uniq(findings.map((f) => f.workbook)),
    reviewStatuses: uniq(findings.map((f) => f.reviewStatus)),
  };
}
