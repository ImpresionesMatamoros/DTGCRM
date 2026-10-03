import pack from '../decisions/commercial-print.pack.json';
import { buildContext } from './context';
import type { DataQualityFinding, ItemReadiness, QualityInput } from './types';

/**
 * Commercial Print migration gate (STEP 08 §21–22, §37). Item by item: what is blocking migration and why.
 * It migrates nothing, publishes nothing and marks nothing as ready — it only reads the findings and
 * readiness already computed, over the 21 items of the STEP 05C first-category pack.
 */

export type Tri = 'DEFINED' | 'MISSING';

export interface GateItem {
  legacyId: string;
  name: string;
  family: string;
  staged: boolean;
  candidateId: string | null;
  readiness: ItemReadiness | null;
  status: { state: Tri; value: string | null };
  saleUnit: { state: Tri; value: string | null };
  category: { state: Tri; value: string | null };
  price: { state: string; evidenceObservations: number; priceCandidates: number };
  options: { candidates: number; unresolved: number };
  presentations: { candidates: number; unresolved: number };
  provenance: { state: 'OK' | 'BROKEN'; candidates: number; broken: number };
  openDecisions: string[];
  blockers: {
    domain: string[];
    option: string[];
    pricing: string[];
    decision: string[];
    publication: string[];
  };
  /** Ready to migrate once the platform barrier is lifted by an explicit decision. */
  canMigrate: boolean;
}

export interface GateTotals {
  total: number;
  staged: number;
  reviewReady: number;
  domainReady: number;
  pricingReady: number;
  quoteOnly: number;
  publicationReadyIgnoringBarrier: number;
  blockedByOwnerDecisions: number;
  missingSaleUnit: number;
  missingStatus: number;
  missingCategory: number;
  withOptionBlockers: number;
  withUnresolvedPresentations: number;
  brokenProvenance: number;
  openDecisionCounts: Record<string, number>;
}

export interface CommercialPrintGate {
  asOf: string;
  meta: typeof pack.meta;
  items: GateItem[];
  totals: GateTotals;
}

const uniq = (xs: string[]) => [...new Set(xs)];

export function commercialPrintGate(
  input: QualityInput,
  findings: readonly DataQualityFinding[],
  readiness: readonly ItemReadiness[],
): CommercialPrintGate {
  const ctx = buildContext(input);
  const ready = new Map(readiness.map((r) => [r.legacyId, r]));
  const items: GateItem[] = pack.items.map((p) => {
    const item = ctx.itemByLegacy(p.legacyId);
    const r = ready.get(p.legacyId) ?? null;
    const mine = findings.filter((f) => f.itemLegacyId === p.legacyId);
    const own = ctx.candidates.filter((c) => ctx.ownerLegacy(c) === p.legacyId);
    const status = item ? ctx.effective(item, 'status') : undefined;
    const sale = item ? ctx.effective(item, 'saleUnit') : undefined;
    const cat = item ? ctx.effective(item, 'categoryKey') : undefined;
    const opts = own.filter((c) => c.kind === 'OPTION');
    const pres = own.filter((c) => c.kind === 'PRESENTATION');
    const prices = own.filter((c) => c.kind === 'PRICE');
    const brokenProv = own.filter(
      (c) => c.provenance.records === 0 || c.provenance.recordsWithCell < c.provenance.records,
    );
    const label = (f: DataQualityFinding) =>
      `${f.ruleCode} · ${f.title}${f.decisions.length ? ` (${f.decisions.map((d) => d.id).join(', ')})` : ''}`;
    const blk = mine.filter((f) => f.severity === 'BLOCKER');
    const blockers = {
      domain: uniq(
        blk
          .filter(
            (f) =>
              f.area === 'CATALOG_ITEM' ||
              f.area === 'DECORATION' ||
              f.area === 'COMPOSITION' ||
              f.area === 'CATEGORY' ||
              f.area === 'PROVENANCE' ||
              f.area === 'IMPORT',
          )
          .map(label),
      ),
      option: uniq(blk.filter((f) => f.area === 'OPTION').map(label)),
      pricing: uniq(
        blk
          .filter((f) => f.area === 'PRICING' && f.remediation !== 'OWNER_DECISION_REQUIRED')
          .map(label),
      ),
      decision: uniq(
        r?.publication.reasons.filter((x) => x.kind === 'OWNER_DECISION').map((x) => x.label) ?? [],
      ),
      publication: uniq(r?.publication.reasons.map((x) => `${x.kind} · ${x.label}`) ?? []),
    };
    // the family pack asks for a category too: a missing one blocks the migration gate even though it is only a warning
    if (cat === undefined)
      blockers.domain.push(
        'DQ-CATALOG-004 · Categoría sin mapear (requisito de la compuerta de migración)',
      );
    return {
      legacyId: p.legacyId,
      name: p.name,
      family: p.family,
      staged: item !== null,
      candidateId: item?.id ?? null,
      readiness: r,
      status: {
        state: status === undefined ? 'MISSING' : 'DEFINED',
        value: (status as string | undefined) ?? null,
      },
      saleUnit: {
        state: sale === undefined ? 'MISSING' : 'DEFINED',
        value: (sale as string | null | undefined) ?? null,
      },
      category: {
        state: cat === undefined ? 'MISSING' : 'DEFINED',
        value: (cat as string | undefined) ?? null,
      },
      price: {
        state: r?.pricing.state ?? 'UNKNOWN',
        evidenceObservations: p.priceObservations,
        priceCandidates: prices.length,
      },
      options: {
        candidates: opts.length,
        unresolved: opts.filter((c) => ctx.openFields(c).length > 0).length,
      },
      presentations: {
        candidates: pres.length,
        unresolved: pres.filter((c) => ctx.openFields(c).length > 0).length,
      },
      provenance: {
        state: brokenProv.length ? 'BROKEN' : 'OK',
        candidates: own.length,
        broken: brokenProv.length,
      },
      openDecisions: r?.openDecisions ?? [],
      blockers,
      canMigrate: !!r && r.readyIgnoringBarrier && cat !== undefined,
    };
  });
  const open: Record<string, number> = {};
  for (const i of items) for (const d of i.openDecisions) open[d] = (open[d] ?? 0) + 1;
  return {
    asOf: input.asOf,
    meta: pack.meta,
    items,
    totals: {
      total: items.length,
      staged: items.filter((i) => i.staged).length,
      reviewReady: items.filter((i) => i.readiness?.review.state === 'READY').length,
      domainReady: items.filter((i) => i.readiness?.domain.state === 'READY').length,
      pricingReady: items.filter((i) => i.readiness?.pricing.state === 'READY').length,
      quoteOnly: items.filter((i) => i.readiness?.pricing.state === 'QUOTE_ONLY').length,
      publicationReadyIgnoringBarrier: items.filter((i) => i.canMigrate).length,
      blockedByOwnerDecisions: items.filter((i) => i.blockers.decision.length > 0).length,
      missingSaleUnit: items.filter((i) => i.saleUnit.state === 'MISSING').length,
      missingStatus: items.filter((i) => i.status.state === 'MISSING').length,
      missingCategory: items.filter((i) => i.category.state === 'MISSING').length,
      withOptionBlockers: items.filter((i) => i.blockers.option.length > 0).length,
      withUnresolvedPresentations: items.filter((i) => i.presentations.unresolved > 0).length,
      brokenProvenance: items.filter((i) => i.provenance.state === 'BROKEN').length,
      openDecisionCounts: Object.fromEntries(Object.entries(open).sort()),
    },
  };
}
