import type { Uuid } from '../domain/catalog';
import {
  conditionSignature,
  validatePriceDefinition,
  type PriceCondition,
  type PriceDefinition,
  type PriceDefinitionIssue,
} from '../domain/pricing-model';

/**
 * Authorization-time conflict analysis (STEP 07 §9). Pure: it compares one candidate definition with the
 * AUTHORIZED/SUPERSEDED definitions of the same item, price book and component. The database keeps the
 * hard invariant (identical scope + overlapping interval) and the resolver keeps `AMBIGUOUS` as the final
 * safety net; this module explains the competing definitions *before* anyone authorizes.
 *
 *   IDENTICAL_SCOPE        same conditions, overlapping interval            → BLOCKING (DB rejects too)
 *   SPECIFICITY_TIE        different conditions that can match the same
 *                          configuration with equal specificity             → BLOCKING (would resolve AMBIGUOUS)
 *   PRECEDENCE             overlap where one side is strictly more specific → INFO (resolver precedence)
 *   DEFINITION_INVALID     duplicate breaks, empty matrix, bad validity …   → BLOCKING
 *   RETROACTIVE            supersession starting in the past                → BLOCKING (rewrites history)
 *   PREDECESSOR_WINDOW     successor starts before its predecessor          → BLOCKING
 */
export type ConflictKind =
  | 'IDENTICAL_SCOPE'
  | 'SPECIFICITY_TIE'
  | 'PRECEDENCE'
  | 'DEFINITION_INVALID'
  | 'RETROACTIVE_SUPERSESSION'
  | 'PREDECESSOR_WINDOW';

export interface Conflict {
  kind: ConflictKind;
  severity: 'BLOCKING' | 'INFO';
  /** The competing authorized definition (absent for self-checks). */
  otherId: Uuid | null;
  message: string;
  issues?: PriceDefinitionIssue[];
}

export interface ConflictReport {
  blocking: Conflict[];
  info: Conflict[];
  canAuthorize: boolean;
}

const t = (v: string | null, open: number) => (v === null ? open : Date.parse(v));

export function intervalsOverlap(
  a: { validFrom: string; validTo: string | null },
  b: { validFrom: string; validTo: string | null },
): boolean {
  return (
    Date.parse(a.validFrom) < t(b.validTo, Infinity) &&
    Date.parse(b.validFrom) < t(a.validTo, Infinity)
  );
}

function optionSets(conditions: readonly PriceCondition[]): Map<Uuid, Set<Uuid>> {
  const m = new Map<Uuid, Set<Uuid>>();
  for (const c of conditions) {
    if (c.kind !== 'OPTION_VALUE') continue;
    m.set(c.optionDefinitionId, (m.get(c.optionDefinitionId) ?? new Set()).add(c.optionValueId));
  }
  return m;
}

/** Can one configuration satisfy both condition sets? (AND across options, IN within one option.) */
export function conditionsCompatible(
  a: readonly PriceCondition[],
  b: readonly PriceCondition[],
): boolean {
  const sa = optionSets(a);
  const sb = optionSets(b);
  for (const [opt, va] of sa) {
    const vb = sb.get(opt);
    if (vb && ![...va].some((v) => vb.has(v))) return false;
  }
  // Decoration-method conditions are additive: a configuration may select several methods.
  return true;
}

export function specificityOf(conditions: readonly PriceCondition[]): number {
  return new Set(
    conditions.map((c) =>
      c.kind === 'OPTION_VALUE' ? `o:${c.optionDefinitionId}` : `m:${c.decorationMethodId}`,
    ),
  ).size;
}

export interface AnalyzeOptions {
  /** Application-boundary clock. Only used for the retroactive-supersession rule. */
  now: Date;
}

export function analyzeAuthorizationConflicts(
  candidate: PriceDefinition,
  authorizedSet: readonly PriceDefinition[],
  opts: AnalyzeOptions,
): ConflictReport {
  const out: Conflict[] = [];

  const issues = validatePriceDefinition({ ...candidate, status: 'DRAFT' });
  if (issues.length) {
    out.push({
      kind: 'DEFINITION_INVALID',
      severity: 'BLOCKING',
      otherId: null,
      issues,
      message: `Definición inválida: ${issues.join(', ')}`,
    });
  }

  const predecessor = candidate.supersedesId
    ? authorizedSet.find((d) => d.id === candidate.supersedesId)
    : undefined;
  if (candidate.supersedesId && !predecessor) {
    out.push({
      kind: 'PREDECESSOR_WINDOW',
      severity: 'BLOCKING',
      otherId: candidate.supersedesId,
      message: 'La revisión anterior ya no está vigente como AUTHORIZED.',
    });
  }
  if (predecessor) {
    if (Date.parse(candidate.validFrom) <= Date.parse(predecessor.validFrom)) {
      out.push({
        kind: 'PREDECESSOR_WINDOW',
        severity: 'BLOCKING',
        otherId: predecessor.id,
        message: 'La nueva revisión debe empezar después de que empiece la anterior.',
      });
    }
    if (Date.parse(candidate.validFrom) < opts.now.getTime()) {
      out.push({
        kind: 'RETROACTIVE_SUPERSESSION',
        severity: 'BLOCKING',
        otherId: predecessor.id,
        message:
          'Sustituir una revisión con vigencia en el pasado reescribiría lo que respondería un asOf anterior. Usa una vigencia desde ahora o futura.',
      });
    }
    if (
      predecessor.validTo !== null &&
      Date.parse(candidate.validFrom) !== Date.parse(predecessor.validTo)
    ) {
      out.push({
        kind: 'PREDECESSOR_WINDOW',
        severity: 'BLOCKING',
        otherId: predecessor.id,
        message:
          'La revisión anterior ya tiene fecha de fin; la nueva debe empezar exactamente ahí (la vigencia cerrada no se reescribe).',
      });
    }
  }

  const candSig = conditionSignature(candidate.conditions);
  const candSpec = specificityOf(candidate.conditions);
  for (const d of authorizedSet) {
    if (d.id === candidate.id || d.id === candidate.supersedesId) continue;
    if (
      d.itemId !== candidate.itemId ||
      d.priceBookId !== candidate.priceBookId ||
      d.component !== candidate.component
    )
      continue;
    if (d.status === 'DRAFT') continue;
    // The candidate replaces its predecessor: the predecessor's later siblings are not its concern.
    const window = {
      validFrom: candidate.validFrom,
      validTo: candidate.validTo,
    };
    if (!intervalsOverlap(window, d)) continue;
    if (conditionSignature(d.conditions) === candSig) {
      out.push({
        kind: 'IDENTICAL_SCOPE',
        severity: 'BLOCKING',
        otherId: d.id,
        message: `Ya existe una definición ${d.status} con las mismas condiciones y vigencia solapada (rev. ${d.version}).`,
      });
      continue;
    }
    if (!conditionsCompatible(candidate.conditions, d.conditions)) continue;
    const spec = specificityOf(d.conditions);
    if (spec === candSpec) {
      out.push({
        kind: 'SPECIFICITY_TIE',
        severity: 'BLOCKING',
        otherId: d.id,
        message: `Condiciones distintas pero compatibles con la misma especificidad (${spec}): una configuración podría coincidir con ambas y el resolver devolvería AMBIGUOUS.`,
      });
    } else {
      out.push({
        kind: 'PRECEDENCE',
        severity: 'INFO',
        otherId: d.id,
        message:
          spec > candSpec
            ? 'La definición existente es más específica y tendrá precedencia donde ambas coincidan.'
            : 'La nueva definición es más específica y tendrá precedencia donde ambas coincidan.',
      });
    }
  }

  const blocking = out.filter((c) => c.severity === 'BLOCKING');
  return {
    blocking,
    info: out.filter((c) => c.severity === 'INFO'),
    canAuthorize: blocking.length === 0,
  };
}
