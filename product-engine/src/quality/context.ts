import type { CandidateKind } from '../import/proposal';
import { unresolvedFields } from '../import/requirements';
import { OWNER_DECISIONS } from '../decisions/reference';
import { fieldDef } from '../review/fields';
import type { QCandidate, QualityInput, RuleContext } from './types';

export const normalizeText = (s: string | null | undefined): string =>
  (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export const pairKey = (a: string, b: string): string => (a <= b ? `${a}|${b}` : `${b}|${a}`);

/** Legacy id of the catalog item a candidate belongs to (null if it points at none). */
export function ownerLegacyOf(c: QCandidate): string | null {
  const p = c.proposal;
  switch (p.kind) {
    case 'CATALOG_ITEM':
      return p.legacyId;
    case 'OPTION':
    case 'PRICE':
      return p.itemLegacyId;
    case 'DECORATION':
      return p.itemLegacyId;
    case 'PRESENTATION':
      return p.itemLegacyId;
    case 'COMPOSITION':
      return p.subtype === 'RELATION' ? p.parentLegacyId : p.itemLegacyId;
  }
}

const byLineage = (a: QCandidate, b: QCandidate) =>
  a.lineageKey < b.lineageKey
    ? -1
    : a.lineageKey > b.lineageKey
      ? 1
      : a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0;

export function buildContext(input: QualityInput): RuleContext {
  // A REJECTED candidate is an explicit "do not import": it raises no findings (but still resolves references).
  const candidates = input.candidates.filter((c) => c.reviewStatus !== 'REJECTED').sort(byLineage);
  const kinds = new Map<CandidateKind, QCandidate[]>();
  const items = new Map<string, QCandidate>();
  for (const c of candidates) {
    const list = kinds.get(c.kind) ?? [];
    list.push(c);
    kinds.set(c.kind, list);
  }
  for (const c of [...input.candidates].sort(byLineage)) {
    if (c.proposal.kind === 'CATALOG_ITEM' && !items.has(c.proposal.legacyId))
      items.set(c.proposal.legacyId, c);
  }
  const open = new Map<string, readonly string[]>();
  const answers = new Map(input.decisionAnswers.map((a) => [a.decisionId, a] as const));
  const affected = new Map(
    OWNER_DECISIONS.map((d) => [d.id, new Set(d.affected.map((a) => a.legacyId))] as const),
  );
  return {
    input,
    candidates,
    byKind: (k) => kinds.get(k) ?? [],
    itemByLegacy: (l) => (l ? (items.get(l) ?? null) : null),
    openFields: (c) => {
      let v = open.get(c.id);
      if (!v) {
        v = unresolvedFields(c.proposal, c.resolution);
        open.set(c.id, v);
      }
      return v;
    },
    ownerLegacy: ownerLegacyOf,
    effective: (c, field) => {
      const r = c.resolution;
      if (r !== null && Object.prototype.hasOwnProperty.call(r, field) && r[field] !== undefined)
        return r[field];
      return fieldDef(c.kind, field)?.sourceValue(c.proposal);
    },
    pairKey,
    decisionOpen: (id, legacy) => {
      const a = answers.get(id);
      if (!a) return true;
      if (a.coverage === 'ALL') return false;
      return legacy ? !a.coverage.includes(legacy) : true;
    },
    decisionAffects: (id, legacy) => (legacy ? (affected.get(id)?.has(legacy) ?? false) : false),
  };
}
