import { OWNER_DECISIONS } from '../decisions/reference';
import { buildContext } from './context';
import type {
  DataQualityFinding,
  DimensionReadiness,
  ItemReadiness,
  QualityInput,
  ReadinessReason,
} from './types';

/**
 * Readiness (STEP 08 §6–7). Four separate questions, each with its reasons — never one 0–100 score:
 *
 *   Review       can the reviewer finish this item (every resolution field decided, provenance intact)?
 *   Domain       is the item (and its options/decoration/composition/presentations) structurally sound?
 *   Pricing      READY · DRAFT_ONLY · QUOTE_ONLY · BLOCKED
 *   Publication  READY only if the three above allow it, no blocking owner decision is open and the
 *                platform barrier (REAL publication disabled) is lifted.
 *
 * Pure: depends only on the input and the findings computed from it.
 */

const DECISION = new Map(OWNER_DECISIONS.map((d) => [d.id, d]));
const label = (f: DataQualityFinding) => f.title;

const reasonOf = (f: DataQualityFinding): ReadinessReason => ({
  kind: f.remediation === 'OWNER_DECISION_REQUIRED' ? 'OWNER_DECISION' : 'DEFECT',
  code: f.ruleCode,
  label: label(f),
  ...(f.decisions.length ? { decisionIds: f.decisions.map((d) => d.id) } : {}),
});

const dedupe = (reasons: ReadinessReason[]): ReadinessReason[] => {
  const seen = new Set<string>();
  return reasons.filter((r) => {
    const k = `${r.kind}|${r.code}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

const BLOCKS_REVIEW_HARD = new Set(['DQ-IMPORT-001', 'DQ-PROV-001', 'DQ-PROV-002']);

export function computeReadiness(
  input: QualityInput,
  findings: readonly DataQualityFinding[],
): ItemReadiness[] {
  const ctx = buildContext(input);
  const asOf = new Date(input.asOf).getTime();
  const byLegacy = new Map<string, DataQualityFinding[]>();
  for (const f of findings)
    if (f.itemLegacyId) byLegacy.set(f.itemLegacyId, [...(byLegacy.get(f.itemLegacyId) ?? []), f]);
  const defsByLegacy = new Map<string, QualityInput['domainDefinitions']>();
  for (const d of input.domainDefinitions)
    if (d.legacyId) defsByLegacy.set(d.legacyId, [...(defsByLegacy.get(d.legacyId) ?? []), d]);

  const out: ItemReadiness[] = [];
  for (const item of ctx.byKind('CATALOG_ITEM')) {
    const p = item.proposal;
    if (p.kind !== 'CATALOG_ITEM') continue;
    const mine = byLegacy.get(p.legacyId) ?? [];
    const blockers = mine.filter((f) => f.severity === 'BLOCKER');

    // ---- review
    const reviewBlockers = blockers.filter((f) => f.dimension === 'REVIEW');
    const reviewReasons = dedupe(reviewBlockers.map(reasonOf));
    const review: DimensionReadiness = {
      state:
        reviewBlockers.length === 0
          ? 'READY'
          : reviewBlockers.some((f) => BLOCKS_REVIEW_HARD.has(f.ruleCode))
            ? 'BLOCKED'
            : 'NEEDS_RESOLUTION',
      reasons: reviewReasons,
    };

    // ---- domain
    const domainBlockers = blockers.filter((f) => f.dimension === 'DOMAIN');
    const domainReasons = dedupe(domainBlockers.map(reasonOf));
    if (review.state !== 'READY')
      domainReasons.push({
        kind: 'DEPENDENCY',
        code: 'REVIEW_INCOMPLETE',
        label: `Review incompleto: ${reviewReasons.length} regla(s) con campos sin resolver`,
      });
    const domain: DimensionReadiness = {
      state: domainReasons.length === 0 ? 'READY' : 'BLOCKED',
      reasons: domainReasons,
    };

    // ---- pricing (technical state; owner decisions go to publication)
    const pricingDefects = blockers.filter(
      (f) => f.dimension === 'PRICING' && f.remediation !== 'OWNER_DECISION_REQUIRED',
    );
    const defs = defsByLegacy.get(p.legacyId) ?? [];
    const live = defs.filter(
      (d) =>
        d.status === 'AUTHORIZED' &&
        new Date(d.validFrom).getTime() <= asOf &&
        (d.validTo === null || new Date(d.validTo).getTime() > asOf),
    );
    const hasEvidence = mine.some((f) => f.ruleCode === 'DQ-PRICE-001');
    const pricingReasons: ReadinessReason[] = dedupe(pricingDefects.map(reasonOf));
    let pricingState: DimensionReadiness['state'];
    if (pricingDefects.length > 0) pricingState = 'BLOCKED';
    else if (live.length > 0) pricingState = 'READY';
    else if (defs.some((d) => d.status === 'DRAFT')) {
      pricingState = 'DRAFT_ONLY';
      pricingReasons.push({
        kind: 'STATE',
        code: 'DQ-PRICE-002',
        label: 'Sólo hay borradores de precio: nadie los ha autorizado',
      });
    } else {
      pricingState = 'QUOTE_ONLY';
      pricingReasons.push({
        kind: 'STATE',
        code: hasEvidence ? 'DQ-PRICE-001' : 'NO_PRICE',
        label: hasEvidence
          ? 'Hay evidencia de precio pero ninguna PriceDefinition: cotiza sólo bajo petición'
          : 'Sin precio autorizado ni evidencia actual: cotiza sólo bajo petición',
      });
    }
    const pricing: DimensionReadiness = { state: pricingState, reasons: pricingReasons };

    // ---- publication
    const pubReasons: ReadinessReason[] = [];
    if (review.state !== 'READY')
      pubReasons.push({ kind: 'DEPENDENCY', code: 'REVIEW', label: 'Review no está READY' });
    if (domain.state !== 'READY')
      pubReasons.push({ kind: 'DEPENDENCY', code: 'DOMAIN', label: 'Domain no está READY' });
    if (pricing.state === 'BLOCKED' || pricing.state === 'DRAFT_ONLY')
      pubReasons.push({
        kind: 'DEPENDENCY',
        code: 'PRICING',
        label: `Pricing está ${pricing.state}`,
      });
    const openDecisions: string[] = [];
    for (const d of OWNER_DECISIONS) {
      if (!ctx.decisionOpen(d.id, p.legacyId) || !d.affected.some((a) => a.legacyId === p.legacyId))
        continue;
      openDecisions.push(d.id);
      pubReasons.push({
        kind: d.canAffectedScopePublish === 'NO' ? 'OWNER_DECISION' : 'STATE',
        code: d.id,
        label: `${d.id} — ${d.title}${d.canAffectedScopePublish === 'NO' ? '' : ' (puede condicionar el alcance)'}`,
        decisionIds: [d.id],
      });
    }
    const blocking = pubReasons.some((r) => r.kind === 'DEPENDENCY' || r.kind === 'OWNER_DECISION');
    const readyIgnoringBarrier = !blocking;
    const publicationBlockedByBarrier = !input.publicationEnabledFor.includes(item.batch.dataClass);
    if (publicationBlockedByBarrier)
      pubReasons.push({
        kind: 'BARRIER',
        code: 'REAL_PUBLICATION_DISABLED',
        label: `Publicación de datos ${item.batch.dataClass} deshabilitada (PUBLICATION_ENABLED_FOR = ${input.publicationEnabledFor.join(', ') || 'ninguno'})`,
      });
    const publication: DimensionReadiness = {
      state: readyIgnoringBarrier && !publicationBlockedByBarrier ? 'READY' : 'BLOCKED',
      reasons: pubReasons,
    };

    const category = ctx.effective(item, 'categoryKey');
    out.push({
      candidateId: item.id,
      legacyId: p.legacyId,
      name: p.name,
      category: typeof category === 'string' ? category : p.categoryLegacy,
      reviewStatus: item.reviewStatus,
      review,
      domain,
      pricing,
      publication,
      openDecisions: openDecisions.sort(),
      findingCount: mine.length,
      readyIgnoringBarrier,
      dataClass: item.batch.dataClass,
    });
  }
  out.sort((a, b) => (a.legacyId < b.legacyId ? -1 : a.legacyId > b.legacyId ? 1 : 0));
  return out;
}

export interface ReadinessTotals {
  items: number;
  review: Record<string, number>;
  domain: Record<string, number>;
  pricing: Record<string, number>;
  publication: Record<string, number>;
  readyIgnoringBarrier: number;
}

export function readinessTotals(rows: readonly ItemReadiness[]): ReadinessTotals {
  const count = (pick: (r: ItemReadiness) => string) => {
    const m: Record<string, number> = {};
    for (const r of rows) m[pick(r)] = (m[pick(r)] ?? 0) + 1;
    return m;
  };
  return {
    items: rows.length,
    review: count((r) => r.review.state),
    domain: count((r) => r.domain.state),
    pricing: count((r) => r.pricing.state),
    publication: count((r) => r.publication.state),
    readyIgnoringBarrier: rows.filter((r) => r.readyIgnoringBarrier).length,
  };
}

export const decisionTitle = (id: string): string => DECISION.get(id)?.title ?? id;
