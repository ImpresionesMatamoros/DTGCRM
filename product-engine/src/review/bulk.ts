import { canonicalJson, sha256Hex } from '../import/keys';
import type { CandidateKind, Proposal } from '../import/proposal';
import { parseDraftResolution } from '../import/resolution';
import { FIELD_DEFS, fieldDef, type Draft } from './fields';

/**
 * Bulk resolution planning (STEP 06 §14–15, §17). Pure: the same candidates and
 * changes always give the same plan and the same `planSha256`. The server
 * recomputes the plan when applying and refuses it if it no longer matches the
 * preview the person saw. Nothing here approves or publishes.
 */

export interface BulkCandidate {
  id: string;
  kind: CandidateKind;
  reviewStatus: string;
  proposal: Proposal;
  draft: Draft | null;
}

export type BulkSkipReason =
  | 'OTHER_KIND' // selection mixes kinds: only the chosen kind is changed
  | 'BLOCKED' // can never be approved; fix the source first
  | 'APPROVED_LOCKED' // withdraw the approval before changing its resolution
  | 'TERMINAL' // PUBLISHED / REJECTED
  | 'NOT_VALIDATED' // PENDING: run validation first
  | 'FIELD_NOT_APPLICABLE' // e.g. customer supplied on a PRODUCT
  | 'DIFFERENT_NOT_CONFIRMED'; // had another value and overwrite was not confirmed

export type BulkClassification = 'UNRESOLVED' | 'SAME' | 'DIFFERENT';

export interface BulkEntry {
  candidateId: string;
  field: string;
  /** Current effective value (draft first, then source); undefined = unknown. */
  current: unknown;
  currentOrigin: 'DRAFT' | 'SOURCE' | null;
  next: unknown;
  classification: BulkClassification;
}

export interface BulkCounts {
  selected: number;
  /** Candidates with at least one change to write (overwrite confirmed or not needed). */
  affected: number;
  unresolved: number;
  same: number;
  different: number;
  skipped: Partial<Record<BulkSkipReason, number>>;
}

export interface BulkPlan {
  kind: CandidateKind;
  changes: Draft;
  entries: BulkEntry[];
  skipped: { candidateId: string; field: string | null; reason: BulkSkipReason }[];
  counts: BulkCounts;
  planSha256: string;
}

export type BulkPlanResult =
  | { ok: true; plan: BulkPlan }
  | {
      ok: false;
      errors: { field: string; message: string }[];
      /** Set when STRICT mode refused a selection that is not field-compatible. */
      code?: 'INCOMPATIBLE_SELECTION';
      incompatible?: Partial<Record<BulkSkipReason, number>>;
    };

const EDITABLE = new Set(['VALID', 'WARNING']);

const has = (d: Draft | null, k: string) =>
  d !== null && Object.prototype.hasOwnProperty.call(d, k) && d[k] !== undefined;

export function planBulk(
  candidates: readonly BulkCandidate[],
  kind: CandidateKind,
  changes: Draft,
  options: {
    overwrite?: boolean;
    /**
     * STRICT (STEP 08): the field must be valid for EVERY selected candidate. A selection with another
     * kind or a not-applicable field is refused instead of silently skipped.
     */
    strict?: boolean;
  } = {},
): BulkPlanResult {
  const fields = Object.keys(changes).filter((f) => changes[f] !== undefined);
  const errors: { field: string; message: string }[] = [];
  if (fields.length === 0) errors.push({ field: '', message: 'no field to change' });
  for (const f of fields) {
    const def = fieldDef(kind, f);
    if (!def || !def.bulk)
      errors.push({ field: f, message: `${f} cannot be changed in bulk for ${kind}` });
  }
  const parsed = parseDraftResolution(kind, changes);
  if (!parsed.ok) errors.push(...parsed.errors.map((e) => ({ field: e.path, message: e.message })));
  if (errors.length > 0 || !parsed.ok) return { ok: false, errors };
  const validChanges = parsed.resolution;

  const entries: BulkEntry[] = [];
  const skipped: BulkPlan['skipped'] = [];
  const sorted = [...candidates].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const c of sorted) {
    if (c.kind !== kind) {
      skipped.push({ candidateId: c.id, field: null, reason: 'OTHER_KIND' });
      continue;
    }
    if (!EDITABLE.has(c.reviewStatus)) {
      const reason: BulkSkipReason =
        c.reviewStatus === 'BLOCKED'
          ? 'BLOCKED'
          : c.reviewStatus === 'APPROVED'
            ? 'APPROVED_LOCKED'
            : c.reviewStatus === 'PENDING'
              ? 'NOT_VALIDATED'
              : 'TERMINAL';
      skipped.push({ candidateId: c.id, field: null, reason });
      continue;
    }
    // Applicability is judged on the draft as it would be after the change (itemType first).
    const after: Draft = { ...(c.draft ?? {}), ...changes };
    for (const f of fields) {
      const def = fieldDef(kind, f)!;
      if (!def.applies(c.proposal, after)) {
        skipped.push({ candidateId: c.id, field: f, reason: 'FIELD_NOT_APPLICABLE' });
        continue;
      }
      const source = def.sourceValue(c.proposal);
      const inDraft = has(c.draft, f);
      const current = inDraft ? c.draft![f] : source;
      const currentOrigin = inDraft ? 'DRAFT' : source !== undefined ? 'SOURCE' : null;
      const next = changes[f];
      const classification: BulkClassification =
        current === undefined
          ? 'UNRESOLVED'
          : canonicalJson(current) === canonicalJson(next)
            ? 'SAME'
            : 'DIFFERENT';
      entries.push({ candidateId: c.id, field: f, current, currentOrigin, next, classification });
    }
  }

  if (options.strict) {
    const bad: Partial<Record<BulkSkipReason, number>> = {};
    for (const sk of skipped)
      if (sk.reason === 'OTHER_KIND' || sk.reason === 'FIELD_NOT_APPLICABLE')
        bad[sk.reason] = (bad[sk.reason] ?? 0) + 1;
    if (Object.keys(bad).length > 0)
      return {
        ok: false,
        code: 'INCOMPATIBLE_SELECTION',
        incompatible: bad,
        errors: [
          {
            field: fields.join(','),
            message: `the selection is not compatible with ${fields.join(', ')} for ${kind}: ${Object.entries(
              bad,
            )
              .map(([k, n]) => `${n} ${k}`)
              .join(', ')}`,
          },
        ],
      };
  }

  const willWrite = entries.filter(
    (e) =>
      e.classification === 'UNRESOLVED' || (e.classification === 'DIFFERENT' && options.overwrite),
  );
  if (!options.overwrite) {
    for (const e of entries.filter((x) => x.classification === 'DIFFERENT')) {
      skipped.push({
        candidateId: e.candidateId,
        field: e.field,
        reason: 'DIFFERENT_NOT_CONFIRMED',
      });
    }
  }
  const skippedCounts: BulkCounts['skipped'] = {};
  for (const s of skipped) skippedCounts[s.reason] = (skippedCounts[s.reason] ?? 0) + 1;
  const counts: BulkCounts = {
    selected: candidates.length,
    affected: new Set(willWrite.map((e) => e.candidateId)).size,
    unresolved: entries.filter((e) => e.classification === 'UNRESOLVED').length,
    same: entries.filter((e) => e.classification === 'SAME').length,
    different: entries.filter((e) => e.classification === 'DIFFERENT').length,
    skipped: skippedCounts,
  };
  // The hash covers what the person saw, independent of the overwrite choice.
  const planSha256 = sha256Hex(
    canonicalJson({
      kind,
      changes: validChanges,
      entries: entries.map((e) => [e.candidateId, e.field, e.current ?? null, e.classification]),
      skipped: skipped
        .filter((s) => s.reason !== 'DIFFERENT_NOT_CONFIRMED')
        .map((s) => [s.candidateId, s.field, s.reason]),
    }),
  );
  return {
    ok: true,
    plan: { kind, changes: validChanges, entries, skipped, counts, planSha256 },
  };
}

/** Entries that an apply writes: unresolved ones, plus different ones only if confirmed. */
export function entriesToWrite(plan: BulkPlan, overwrite: boolean): BulkEntry[] {
  return plan.entries.filter(
    (e) => e.classification === 'UNRESOLVED' || (e.classification === 'DIFFERENT' && overwrite),
  );
}

/**
 * Preview summary shown before anything is written (STEP 08 §11). Counts candidates, not entries:
 * `notApplicable` = another kind or a field that does not apply; `blocked` = cannot be edited now
 * (BLOCKED, approved, terminal, not validated yet).
 */
export interface BulkSummary {
  selected: number;
  wouldChange: number;
  alreadySame: number;
  hasOtherValue: number;
  notApplicable: number;
  blocked: number;
  /** Different values that stay untouched unless the overwrite is confirmed. */
  overwriteNeeded: number;
}

export function bulkSummary(plan: BulkPlan, overwrite = false): BulkSummary {
  const ids = (pred: (r: BulkSkipReason) => boolean) =>
    new Set(plan.skipped.filter((s) => pred(s.reason)).map((s) => s.candidateId)).size;
  const different = new Set(
    plan.entries.filter((e) => e.classification === 'DIFFERENT').map((e) => e.candidateId),
  ).size;
  return {
    selected: plan.counts.selected,
    wouldChange: plan.counts.affected,
    alreadySame: new Set(
      plan.entries.filter((e) => e.classification === 'SAME').map((e) => e.candidateId),
    ).size,
    hasOtherValue: different,
    notApplicable: ids((r) => r === 'OTHER_KIND' || r === 'FIELD_NOT_APPLICABLE'),
    blocked: ids(
      (r) =>
        r === 'BLOCKED' || r === 'APPROVED_LOCKED' || r === 'TERMINAL' || r === 'NOT_VALIDATED',
    ),
    overwriteNeeded: overwrite ? 0 : different,
  };
}

export interface OfferedField {
  field: string;
  label: string;
}

/**
 * Which bulk fields may be offered for this selection (STEP 08 §10): only fields that are valid for
 * every selected candidate. A mixed-kind selection offers nothing (never `Option.required` on items).
 */
export function offeredFields(candidates: readonly BulkCandidate[]): {
  kind: CandidateKind | null;
  fields: OfferedField[];
  reason?: 'MIXED_KINDS' | 'EMPTY';
} {
  if (candidates.length === 0) return { kind: null, fields: [], reason: 'EMPTY' };
  const kind = candidates[0]!.kind;
  if (candidates.some((c) => c.kind !== kind))
    return { kind: null, fields: [], reason: 'MIXED_KINDS' };
  const fields = FIELD_DEFS[kind]
    .filter((d) => d.bulk && candidates.every((c) => d.applies(c.proposal, c.draft ?? {})))
    .map((d) => ({ field: d.field, label: d.label }));
  return { kind, fields };
}
