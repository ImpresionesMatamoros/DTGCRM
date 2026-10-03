import { sha256Hex } from '../import/keys';
import { buildContext } from './context';
import { RULES, RULES_VERSION } from './rules';
import type {
  Area,
  DataQualityFinding,
  DataQualityRule,
  DecisionRef,
  Hit,
  QCandidate,
  QualityInput,
  Remediation,
  RuleContext,
  Severity,
} from './types';

const SEVERITY_ORDER: Record<Severity, number> = { BLOCKER: 0, WARNING: 1, INFO: 2 };

function categoryOf(ctx: RuleContext, c: QCandidate | null): string | null {
  if (!c) return null;
  const item = c.proposal.kind === 'CATALOG_ITEM' ? c : ctx.itemByLegacy(ctx.ownerLegacy(c));
  if (!item || item.proposal.kind !== 'CATALOG_ITEM') return null;
  const resolved = ctx.effective(item, 'categoryKey');
  return typeof resolved === 'string' ? resolved : item.proposal.categoryLegacy;
}

/** Decisions that bear on a rule AND list this item as affected (nothing is inferred beyond that). */
function decisionsFor(
  ctx: RuleContext,
  rule: DataQualityRule,
  legacy: string | null,
  answers: Map<string, { actor: string; summary: string }>,
): DecisionRef[] {
  // answered FOR THIS ITEM only: a partial answer never closes the decision for items it does not list
  const refs: DecisionRef[] = [];
  for (const id of rule.decisionTopics) {
    if (!ctx.decisionAffects(id, legacy)) continue;
    const a = ctx.decisionOpen(id, legacy) ? undefined : answers.get(id);
    refs.push(
      a
        ? { id, status: 'ANSWERED', answeredBy: a.actor, summary: a.summary }
        : { id, status: 'OPEN' },
    );
  }
  return refs;
}

function toFinding(
  ctx: RuleContext,
  rule: DataQualityRule,
  h: Hit,
  answers: Map<string, { actor: string; summary: string }>,
): DataQualityFinding {
  const c = h.candidate;
  const legacy = c ? ctx.ownerLegacy(c) : (h.itemLegacyId ?? null);
  const item = legacy ? ctx.itemByLegacy(legacy) : null;
  const decisions = decisionsFor(ctx, rule, legacy, answers);
  const hasOpen = decisions.some((d) => d.status === 'OPEN');
  const remediation: Remediation = hasOpen ? 'OWNER_DECISION_REQUIRED' : rule.remediation;
  // A duplicate pair already reviewed is information, not a blocker/warning.
  const reviewedDuplicate = rule.code === 'DQ-CATALOG-007' && h.evidence.reviewed === true;
  const severity: Severity = reviewedDuplicate ? 'INFO' : rule.severity;
  return {
    key: `${rule.code}:${c?.lineageKey ?? `domain:${h.subject}`}:${h.subject}`,
    ruleCode: rule.code,
    ruleVersion: rule.version,
    scope: rule.scope,
    area: rule.area,
    dimension: rule.dimension,
    severity,
    title: rule.title,
    message: h.message,
    remediation,
    bulk: rule.bulk ?? null,
    candidateId: c?.id ?? null,
    candidateKind: c?.kind ?? null,
    reviewStatus: c?.reviewStatus ?? null,
    itemLegacyId: legacy,
    itemName:
      h.itemName ?? (item && item.proposal.kind === 'CATALOG_ITEM' ? item.proposal.name : null),
    category: categoryOf(ctx, c),
    workbook: c?.batch.sourceFile ?? null,
    decisions,
    evidence: h.evidence,
  };
}

export interface QualityRun {
  rulesVersion: number;
  findings: DataQualityFinding[];
}

/**
 * Runs every rule. Deterministic: findings are ordered by severity, rule code, candidate lineage and
 * subject; the same input always gives the same output.
 */
export function runQuality(
  input: QualityInput,
  rules: readonly DataQualityRule[] = RULES,
): QualityRun {
  const ctx = buildContext(input);
  const answers = new Map(input.decisionAnswers.map((a) => [a.decisionId, a]));
  const findings: DataQualityFinding[] = [];
  const seen = new Set<string>();
  for (const rule of rules)
    for (const h of rule.evaluate(ctx)) {
      const f = toFinding(ctx, rule, h, answers);
      if (seen.has(f.key)) continue; // a rule never reports the same subject twice
      seen.add(f.key);
      findings.push(f);
    }
  findings.sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      (a.ruleCode < b.ruleCode ? -1 : a.ruleCode > b.ruleCode ? 1 : 0) ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );
  return { rulesVersion: RULES_VERSION, findings };
}

// ------------------------------------------------------------------ inventory & summary

export interface InventoryRow {
  ruleCode: string;
  title: string;
  description: string;
  severity: Severity;
  area: Area;
  version: number;
  affected: number;
  candidateKinds: string[];
  ownerDecisions: string[];
  bulkResolvable: number;
  ownerDecisionRequired: number;
  manualReview: number;
  sourceFix: number;
  /** Bulk field that resolves it, if any. */
  bulkField: string | null;
}

/** One row per rule (also rules with 0 findings), for prioritising work. */
export function inventory(
  findings: readonly DataQualityFinding[],
  rules: readonly DataQualityRule[] = RULES,
): InventoryRow[] {
  return rules.map((r) => {
    const mine = findings.filter((f) => f.ruleCode === r.code);
    const by = (rem: Remediation) => mine.filter((f) => f.remediation === rem).length;
    return {
      ruleCode: r.code,
      title: r.title,
      description: r.description,
      severity: r.severity,
      area: r.area,
      version: r.version,
      affected: mine.length,
      candidateKinds: [...new Set(mine.map((f) => f.candidateKind ?? 'DOMAIN'))].sort(),
      ownerDecisions: [...new Set(mine.flatMap((f) => f.decisions.map((d) => d.id)))].sort(),
      bulkResolvable: by('BULK_RESOLVABLE'),
      ownerDecisionRequired: by('OWNER_DECISION_REQUIRED'),
      manualReview: by('MANUAL_REVIEW'),
      sourceFix: by('SOURCE_FIX'),
      bulkField: r.bulk ? `${r.bulk.kind}.${r.bulk.field}` : null,
    };
  });
}

export interface QualitySummary {
  candidates: { total: number; resolved: number; unresolved: number };
  findings: { total: number; blockers: number; warnings: number; info: number };
  ownerDecisionRequired: number;
  byArea: Record<string, { total: number; blockers: number; warnings: number; info: number }>;
  byKind: Record<string, { candidates: number; resolved: number; unresolved: number }>;
}

/** Counts only: no scores. `resolved` = no resolution field is still open. */
export function summarize(
  input: QualityInput,
  findings: readonly DataQualityFinding[],
): QualitySummary {
  const ctx = buildContext(input);
  const byKind: QualitySummary['byKind'] = {};
  let resolved = 0;
  for (const c of ctx.candidates) {
    const row = (byKind[c.kind] ??= { candidates: 0, resolved: 0, unresolved: 0 });
    row.candidates++;
    if (ctx.openFields(c).length === 0) {
      row.resolved++;
      resolved++;
    } else row.unresolved++;
  }
  const byArea: QualitySummary['byArea'] = {};
  for (const f of findings) {
    const row = (byArea[f.area] ??= { total: 0, blockers: 0, warnings: 0, info: 0 });
    row.total++;
    if (f.severity === 'BLOCKER') row.blockers++;
    else if (f.severity === 'WARNING') row.warnings++;
    else row.info++;
  }
  return {
    candidates: {
      total: ctx.candidates.length,
      resolved,
      unresolved: ctx.candidates.length - resolved,
    },
    findings: {
      total: findings.length,
      blockers: findings.filter((f) => f.severity === 'BLOCKER').length,
      warnings: findings.filter((f) => f.severity === 'WARNING').length,
      info: findings.filter((f) => f.severity === 'INFO').length,
    },
    ownerDecisionRequired: findings.filter((f) => f.remediation === 'OWNER_DECISION_REQUIRED')
      .length,
    byArea,
    byKind,
  };
}

/** Stable content hash of a run, for before/after comparison. */
export const runHash = (run: QualityRun): string =>
  sha256Hex(JSON.stringify(run.findings.map((f) => [f.key, f.severity, f.remediation])));

export interface QualityDiff {
  resolved: string[];
  appeared: string[];
  unchanged: number;
}

/** What went away / appeared between two runs (keys are stable across re-staging). */
export function diffRuns(before: QualityRun, after: QualityRun): QualityDiff {
  const b = new Set(before.findings.map((f) => f.key));
  const a = new Set(after.findings.map((f) => f.key));
  return {
    resolved: [...b].filter((k) => !a.has(k)).sort(),
    appeared: [...a].filter((k) => !b.has(k)).sort(),
    unchanged: [...b].filter((k) => a.has(k)).length,
  };
}
