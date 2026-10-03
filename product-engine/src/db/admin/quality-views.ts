import { FIELD_DEFS } from '@/review/fields';
import { commercialPrintGate, type CommercialPrintGate } from '@/quality/gate';
import { ruleByCode } from '@/quality/rules';
import type { FieldControl } from '@/review/fields';
import type { Queryable } from '../client';
import { qualityReport, type QualityReport } from './quality';
import { resolutionLists } from './review';

/** Page data for /admin/data-quality (read-only; the pages never touch the engine or SQL directly). */

export interface Overview extends QualityReport {
  gate: CommercialPrintGate;
}

export async function qualityOverview(db: Queryable, asOf = new Date()): Promise<Overview> {
  const report = await qualityReport(db, asOf);
  return {
    ...report,
    gate: commercialPrintGate(report.input, report.run.findings, report.readiness),
  };
}

export interface RemediationOption {
  ruleCode: string;
  field: string;
  label: string;
  control: FieldControl;
  /** current BULK_RESOLVABLE findings of the rule */
  resolvable: number;
}

/** Bulk field + control for a rule, from the same FIELD_DEFS the review bulk bar uses (never invented). */
export function remediationOption(ruleCode: string, resolvable: number): RemediationOption | null {
  const rule = ruleByCode(ruleCode);
  if (!rule?.bulk) return null;
  const def = FIELD_DEFS[rule.bulk.kind].find((d) => d.field === rule.bulk!.field && d.bulk);
  if (!def) return null;
  return { ruleCode, field: def.field, label: def.label, control: def.control, resolvable };
}

export { resolutionLists };

import { DECISION_APPLICATIONS } from '@/quality/decision-actions';

/** Field control that an answer to this decision maps onto (only for decisions with a machine form). */
export function decisionControl(
  decisionId: string,
): { field: string; label: string; control: FieldControl } | null {
  const app = DECISION_APPLICATIONS[decisionId];
  if (!app) return null;
  const def = FIELD_DEFS[app.kind].find((d) => d.field === app.field);
  return def ? { field: def.field, label: app.label, control: def.control } : null;
}
