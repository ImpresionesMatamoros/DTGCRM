import { inventory, summarize } from './engine';
import type { QualityRun } from './engine';
import { computeReadiness, readinessTotals } from './readiness';
import { RULES } from './rules';
import type { DataQualityFinding, QualityInput } from './types';

/**
 * Machine-readable quality report (STEP 08 §23). Contains the FINDINGS, not just the summary, so two
 * runs can be compared (keys are stable across re-staging). Pure: the timestamp is `input.asOf`.
 */

export interface QualityExport {
  meta: {
    generatedAt: string;
    rulesVersion: number;
    rules: { code: string; version: number; severity: string; title: string }[];
    batches: QualityInput['batches'];
    publicationEnabledFor: string[];
  };
  summary: ReturnType<typeof summarize>;
  inventory: ReturnType<typeof inventory>;
  readinessTotals: ReturnType<typeof readinessTotals>;
  readiness: ReturnType<typeof computeReadiness>;
  findings: DataQualityFinding[];
}

export function buildExport(input: QualityInput, run: QualityRun): QualityExport {
  const readiness = computeReadiness(input, run.findings);
  return {
    meta: {
      generatedAt: input.asOf,
      rulesVersion: run.rulesVersion,
      rules: RULES.map((r) => ({
        code: r.code,
        version: r.version,
        severity: r.severity,
        title: r.title,
      })),
      batches: input.batches,
      publicationEnabledFor: input.publicationEnabledFor,
    },
    summary: summarize(input, run.findings),
    inventory: inventory(run.findings),
    readinessTotals: readinessTotals(readiness),
    readiness,
    findings: run.findings,
  };
}

const csvCell = (v: unknown): string => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const FINDINGS_CSV_COLUMNS = [
  'key',
  'ruleCode',
  'severity',
  'area',
  'dimension',
  'remediation',
  'candidateKind',
  'candidateId',
  'reviewStatus',
  'itemLegacyId',
  'itemName',
  'category',
  'workbook',
  'decisions',
  'message',
] as const;

export function findingsToCsv(findings: readonly DataQualityFinding[]): string {
  const rows = findings.map((f) =>
    [
      f.key,
      f.ruleCode,
      f.severity,
      f.area,
      f.dimension,
      f.remediation,
      f.candidateKind,
      f.candidateId,
      f.reviewStatus,
      f.itemLegacyId,
      f.itemName,
      f.category,
      f.workbook,
      f.decisions.map((d) => `${d.id}:${d.status}`).join(' '),
      f.message,
    ]
      .map(csvCell)
      .join(','),
  );
  return [FINDINGS_CSV_COLUMNS.join(','), ...rows].join('\n') + '\n';
}
