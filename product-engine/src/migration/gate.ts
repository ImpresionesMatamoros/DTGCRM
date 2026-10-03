import type { CommercialPrintGate, GateItem } from '../quality/gate';

/**
 * Item-aware migration gate (STEP 09 §22–24). Pure. It combines the STEP 08 gate (readiness, findings,
 * provenance, category) with what a migration permit may legitimately waive. It never lifts the platform
 * barrier: that is the permit's job, candidate by candidate.
 */

export interface Waiver {
  decisionId: string;
  reason: string;
}

/**
 * Decisions that only concern a market outside the permit's markets (OD-09). Everything else stays a
 * blocker: a waiver exists only because the decision's own subject is another market.
 */
export const MARKET_SCOPED_DECISIONS: Readonly<Record<string, { market: string; reason: string }>> =
  {
    'D-022': {
      market: 'MX',
      reason:
        'D-022 (redondeo e impuestos México) sólo concierne al mercado MX; OD-09 fija USA como mercado MVP y México no bloquea.',
    },
  };

export function waiversFor(markets: readonly string[]): Waiver[] {
  return Object.entries(MARKET_SCOPED_DECISIONS)
    .filter(([, v]) => !markets.includes(v.market))
    .map(([decisionId, v]) => ({ decisionId, reason: v.reason }));
}

/**
 * PUBLISHED = already live under a permit: it was publishable and stays so whatever happens to the decisions later.
 * RESOLVED = the source row is not a product (alias / configuration / style / never-valid legacy label): an
 * owner-backed disposition explains it, its evidence stays in staging, and it never becomes a CatalogItem.
 */
export type MigrationClass = 'PUBLISHABLE' | 'PUBLISHED' | 'RESOLVED' | 'BLOCKED';

/** Verdicts that pass the migration gate as products (resolved rows do not publish anything). */
export const isPublishableVerdict = (v: MigrationClass) => v === 'PUBLISHABLE' || v === 'PUBLISHED';

/** The owner-backed disposition of a source row that is not a product (STEP 09 completion, migration 0018). */
export interface DispositionRef {
  itemLegacyId: string;
  disposition: 'ALIAS' | 'CONFIGURATION' | 'STYLE' | 'LEGACY_INVALID';
  canonicalLegacyIds: string[];
  detail: string;
  decisionId: string;
}

export interface MigrationItemVerdict {
  legacyId: string;
  name: string;
  candidateId: string | null;
  verdict: MigrationClass;
  /** Why it is blocked; empty when publishable. */
  reasons: string[];
  /** Open decisions that still apply (after waivers). */
  openDecisions: string[];
  waivedDecisions: string[];
  pricing: string;
  /** Set when verdict is RESOLVED. */
  disposition?: DispositionRef;
}

export function evaluateMigrationItem(
  item: GateItem,
  waived: readonly Waiver[],
  disposition?: DispositionRef,
): MigrationItemVerdict {
  const waivedIds = new Set(waived.map((w) => w.decisionId));
  if (disposition && item.readiness?.reviewStatus !== 'PUBLISHED')
    return {
      legacyId: item.legacyId,
      name: item.name,
      candidateId: item.candidateId,
      verdict: 'RESOLVED',
      reasons: [],
      openDecisions: [],
      waivedDecisions: [],
      pricing: 'NOT_APPLICABLE',
      disposition,
    };
  if (item.readiness?.reviewStatus === 'PUBLISHED')
    return {
      legacyId: item.legacyId,
      name: item.name,
      candidateId: item.candidateId,
      verdict: 'PUBLISHED',
      reasons: [],
      openDecisions: [],
      waivedDecisions: [],
      pricing: item.readiness.pricing.state,
    };
  const reasons: string[] = [];
  if (!item.staged || !item.readiness) reasons.push('No está en staging');
  const r = item.readiness;
  if (r) {
    if (r.review.state !== 'READY') reasons.push('Review no está READY');
    if (r.domain.state !== 'READY') reasons.push('Domain no está READY');
    if (r.pricing.state === 'BLOCKED' || r.pricing.state === 'DRAFT_ONLY')
      reasons.push(`Pricing está ${r.pricing.state}`);
    for (const p of r.publication.reasons) {
      if (p.kind !== 'OWNER_DECISION') continue;
      const ids = p.decisionIds ?? [];
      if (ids.length > 0 && ids.every((d) => waivedIds.has(d))) continue;
      reasons.push(`Decisión abierta: ${p.label}`);
    }
    if (r.reviewStatus !== 'APPROVED' && r.reviewStatus !== 'PUBLISHED')
      reasons.push(`El item está ${r.reviewStatus}, no APPROVED`);
  }
  if (item.category.state !== 'DEFINED') reasons.push('Sin categoría de Product Engine');
  if (item.provenance.state !== 'OK') reasons.push('Procedencia incompleta');
  const open = (r?.openDecisions ?? []).filter((d) => !waivedIds.has(d));
  return {
    legacyId: item.legacyId,
    name: item.name,
    candidateId: item.candidateId,
    verdict: reasons.length === 0 ? 'PUBLISHABLE' : 'BLOCKED',
    reasons: [...new Set(reasons)],
    openDecisions: open,
    waivedDecisions: (r?.openDecisions ?? []).filter((d) => waivedIds.has(d)),
    pricing: r?.pricing.state ?? 'UNKNOWN',
  };
}

export interface MigrationGate {
  markets: string[];
  waivers: Waiver[];
  items: MigrationItemVerdict[];
  scoped: number;
  /** Items that pass their gate as products (including those already published). */
  publishable: number;
  published: number;
  /** Source rows resolved as alias / configuration / style / legacy: evidence kept, no CatalogItem. */
  resolved: number;
  blocked: number;
}

export function migrationGate(
  gate: CommercialPrintGate,
  markets: readonly string[],
  dispositions: readonly DispositionRef[] = [],
): MigrationGate {
  const waivers = waiversFor(markets);
  const disp = new Map(dispositions.map((d) => [d.itemLegacyId, d]));
  const items = gate.items.map((i) => evaluateMigrationItem(i, waivers, disp.get(i.legacyId)));
  return {
    markets: [...markets],
    waivers,
    items,
    scoped: items.length,
    publishable: items.filter((i) => isPublishableVerdict(i.verdict)).length,
    published: items.filter((i) => i.verdict === 'PUBLISHED').length,
    resolved: items.filter((i) => i.verdict === 'RESOLVED').length,
    blocked: items.filter((i) => i.verdict === 'BLOCKED').length,
  };
}
