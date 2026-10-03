import type { Proposal } from './proposal';

/**
 * What a candidate still needs before it can be approved (unresolved fields)
 * and what makes it impossible to approve at all (blocking reasons).
 * Pure: the same proposal + resolution always gives the same answer.
 */

export interface IssueLike {
  code: string;
  severity: 'ERROR' | 'WARNING' | 'INFO';
}

export const BLOCKING = {
  PARSER_REJECTED: 'PARSER_REJECTED',
  SOURCE_ERROR: 'SOURCE_ERROR',
  EMPTY_NAME: 'EMPTY_NAME',
  BUNDLE_NOT_SUPPORTED: 'BUNDLE_NOT_SUPPORTED',
  PRICE_MODEL_NOT_SUPPORTED: 'PRICE_MODEL_NOT_SUPPORTED',
  PRICE_NOT_AUTHORIZED_IN_SOURCE: 'PRICE_NOT_AUTHORIZED_IN_SOURCE',
  PRICE_CURRENCY_UNKNOWN: 'PRICE_CURRENCY_UNKNOWN',
  MX_PRICE_EVIDENCE_ONLY: 'MX_PRICE_EVIDENCE_ONLY',
  PRICE_AMOUNT_INVALID: 'PRICE_AMOUNT_INVALID',
  PRICE_QUANTITY_NOT_EXACT: 'PRICE_QUANTITY_NOT_EXACT',
  PRICE_CONFLICT: 'PRICE_CONFLICT',
  PRICE_DUPLICATE_BREAK: 'PRICE_DUPLICATE_BREAK',
  FIXED_PRICE_MULTIPLE_OBSERVATIONS: 'FIXED_PRICE_MULTIPLE_OBSERVATIONS',
  UNSUPPORTED_CONDITION_OPERATOR: 'UNSUPPORTED_CONDITION_OPERATOR',
  PRESENTATION_WITHOUT_NAME: 'PRESENTATION_WITHOUT_NAME',
  REFERENCE_MISSING: 'REFERENCE_MISSING',
} as const;

export function blockingReasons(
  proposal: Proposal,
  parserValidationState: 'VALID' | 'WARNING' | 'REJECTED',
  issues: readonly IssueLike[],
): string[] {
  const out = new Set<string>();
  if (parserValidationState === 'REJECTED') out.add(BLOCKING.PARSER_REJECTED);
  if (issues.some((i) => i.severity === 'ERROR')) out.add(BLOCKING.SOURCE_ERROR);
  switch (proposal.kind) {
    case 'CATALOG_ITEM':
      if (!proposal.name?.trim()) out.add(BLOCKING.EMPTY_NAME);
      if (proposal.itemTypeEvidence === 'BUNDLE') out.add(BLOCKING.BUNDLE_NOT_SUPPORTED);
      break;
    case 'PRICE': {
      const obs = proposal.observations;
      if (proposal.model === null) out.add(BLOCKING.PRICE_MODEL_NOT_SUPPORTED);
      if (
        obs.some((o) => !o.authorizationEvidence || o.classification === 'UNKNOWN_REVIEW_REQUIRED')
      ) {
        out.add(BLOCKING.PRICE_NOT_AUTHORIZED_IN_SOURCE);
      }
      if (proposal.currency === null) out.add(BLOCKING.PRICE_CURRENCY_UNKNOWN);
      if (proposal.currency === 'MXN') out.add(BLOCKING.MX_PRICE_EVIDENCE_ONLY);
      if (obs.some((o) => o.amount === null)) out.add(BLOCKING.PRICE_AMOUNT_INVALID);
      if (proposal.conditions.some((c) => (c.operator ?? '').toLowerCase() !== 'igual')) {
        out.add(BLOCKING.UNSUPPORTED_CONDITION_OPERATOR);
      }
      if (proposal.model === 'EXACT_QUANTITY_MATRIX') {
        if (obs.some((o) => o.quantity === null)) out.add(BLOCKING.PRICE_QUANTITY_NOT_EXACT);
        const byQty = new Map<number, Set<string>>();
        for (const o of obs) {
          if (o.quantity === null) continue;
          const set = byQty.get(o.quantity) ?? new Set<string>();
          set.add(o.amount ?? '?');
          byQty.set(o.quantity, set);
        }
        for (const [q, amounts] of byQty) {
          if (amounts.size > 1) out.add(BLOCKING.PRICE_CONFLICT);
          else if (obs.filter((o) => o.quantity === q).length > 1)
            out.add(BLOCKING.PRICE_DUPLICATE_BREAK);
        }
      }
      if (proposal.model === 'FIXED' && obs.length !== 1)
        out.add(BLOCKING.FIXED_PRICE_MULTIPLE_OBSERVATIONS);
      break;
    }
    case 'PRESENTATION':
      if (!proposal.displayName?.trim()) out.add(BLOCKING.PRESENTATION_WITHOUT_NAME);
      if (!proposal.itemLegacyId) out.add(BLOCKING.REFERENCE_MISSING);
      break;
    case 'COMPOSITION':
      if (
        proposal.subtype === 'RELATION' &&
        (!proposal.parentLegacyId || !proposal.childLegacyId)
      ) {
        out.add(BLOCKING.REFERENCE_MISSING);
      }
      break;
    default:
      break;
  }
  return [...out].sort();
}

type AnyResolution = Record<string, unknown> | null | undefined;
const has = (r: AnyResolution, k: string) => r !== null && r !== undefined && r[k] !== undefined;

/**
 * Fields that must be decided by a person before approval. Values proposed
 * from explicit source cells count as known; blanks never do.
 */
export function unresolvedFields(proposal: Proposal, resolution?: AnyResolution): string[] {
  const out: string[] = [];
  const need = (field: string, known: boolean) => {
    if (!known && !has(resolution, field)) out.push(field);
  };
  switch (proposal.kind) {
    case 'CATALOG_ITEM': {
      need('itemType', proposal.itemType !== null);
      need('status', proposal.status !== null);
      need('decorationPolicy', false);
      const type = (resolution?.itemType as string | undefined) ?? proposal.itemType;
      // `Acepta_material_cliente = Sí` does not say ALLOWED vs REQUIRED: always a human decision.
      if (type === 'SERVICE') need('customerSuppliedItem', false);
      break;
    }
    case 'OPTION':
      need('definition', false);
      need('isRequired', proposal.required !== null);
      need('selectionMode', false);
      need('isDistributable', false);
      if (proposal.values.length > 0) need('values', false);
      break;
    case 'DECORATION':
      if (proposal.subtype === 'METHOD_ASSOCIATION') need('methodKey', false);
      break;
    case 'COMPOSITION':
      if (proposal.subtype === 'RELATION') {
        need('quantity', proposal.quantity !== null);
        need('role', proposal.role !== null);
      } else {
        need('childLegacyId', false);
        need('role', false);
        need('quantity', false);
      }
      break;
    case 'PRICE':
      need('validFrom', false);
      need('amountBasis', proposal.amountBasis !== null);
      if (proposal.model === 'FIXED') {
        need(
          'maxQuantity',
          proposal.observations.length === 1 && proposal.observations[0]!.quantity !== null,
        );
      }
      break;
    case 'PRESENTATION':
      need('locale', proposal.locale !== null);
      need('isDefault', false);
      break;
  }
  return out;
}
