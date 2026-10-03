import { z } from 'zod';
import { decisionById } from '../decisions/reference';
import { parseDraftResolution } from '../import/resolution';

/**
 * How an explicit owner answer can be turned into a controlled bulk change (STEP 08 §13–15).
 * The app NEVER answers a decision: it only records an answer a person gave and then lets that answer be
 * previewed and applied through the bulk planner. Decisions without an entry here can be answered
 * (recorded) but are applied manually; their answer is still the traceable reason.
 */

export interface DecisionApplication {
  kind: 'CATALOG_ITEM';
  field: string;
  label: string;
}

/** Only decisions whose answer maps 1:1 onto a bulk field of catalog-item candidates. */
export const DECISION_APPLICATIONS: Readonly<Record<string, DecisionApplication>> = {
  'D-001': { kind: 'CATALOG_ITEM', field: 'status', label: 'Estado de catálogo' },
  'D-002': { kind: 'CATALOG_ITEM', field: 'saleUnit', label: 'Unidad de venta' },
  'D-003': { kind: 'CATALOG_ITEM', field: 'itemType', label: 'Producto / Servicio' },
  'D-010': { kind: 'CATALOG_ITEM', field: 'saleUnit', label: 'Unidad de venta (par de imanes)' },
  'D-013': { kind: 'CATALOG_ITEM', field: 'customerSuppliedItem', label: 'Material del cliente' },
};

export const AssignmentSchema = z.strictObject({
  /** Value the owner chose for the listed items (validated by the real resolution schema). */
  value: z.json(),
  legacyIds: z.array(z.string().min(1)).min(1).max(500),
});

export const DecisionAnswerInput = z.strictObject({
  decisionId: z.string().regex(/^D-\d{3}$/),
  /** The owner's answer in words (what was decided). */
  summary: z.string().trim().min(1).max(1000),
  notes: z.string().trim().max(2000).optional(),
  /** Optional machine-applicable form of the answer (only for decisions in DECISION_APPLICATIONS). */
  assignments: z.array(AssignmentSchema).max(50).optional(),
  /**
   * Items (legacy ids) the answer settles besides those in `assignments` (e.g. "this stays as is").
   * A per-item decision stays OPEN for every item that is neither listed here nor assigned; GLOBAL_POLICY
   * decisions need no list (they cover their whole scope).
   */
  covers: z.array(z.string().min(1)).max(500).optional(),
});
export type DecisionAnswerInput = z.infer<typeof DecisionAnswerInput>;

export type AnswerValidation =
  { ok: true } | { ok: false; errors: { path: string; message: string }[] };

/** Pure validation of an answer against the static decision reference. */
export function validateAnswer(input: DecisionAnswerInput): AnswerValidation {
  const errors: { path: string; message: string }[] = [];
  const decision = decisionById(input.decisionId);
  if (!decision)
    return { ok: false, errors: [{ path: 'decisionId', message: 'unknown decision' }] };
  const scopeIds = new Set(decision.affected.map((a) => a.legacyId));
  for (const l of input.covers ?? [])
    if (!scopeIds.has(l))
      errors.push({
        path: 'covers',
        message: `${l} is not in the scope of ${input.decisionId}`,
      });
  if (input.assignments?.length) {
    const app = DECISION_APPLICATIONS[input.decisionId];
    if (!app)
      errors.push({
        path: 'assignments',
        message: `${input.decisionId} has no machine-applicable form; record the answer in words and resolve manually`,
      });
    else {
      const scope = new Set(decision.affected.map((a) => a.legacyId));
      const seen = new Set<string>();
      input.assignments.forEach((a, i) => {
        const parsed = parseDraftResolution(app.kind, { [app.field]: a.value });
        if (!parsed.ok)
          errors.push(
            ...parsed.errors.map((e) => ({ path: `assignments.${i}.value`, message: e.message })),
          );
        for (const l of a.legacyIds) {
          if (!scope.has(l))
            errors.push({
              path: `assignments.${i}.legacyIds`,
              message: `${l} is not in the scope of ${input.decisionId}`,
            });
          if (seen.has(l))
            errors.push({
              path: `assignments.${i}.legacyIds`,
              message: `${l} is assigned twice`,
            });
          seen.add(l);
        }
      });
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}
