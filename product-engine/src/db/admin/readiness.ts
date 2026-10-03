import type { Queryable } from '../client';
import pack from '@/decisions/commercial-print.pack.json';
import { OWNER_DECISIONS } from '@/decisions/reference';

/**
 * Commercial Print pricing readiness (STEP 07 §25). A report over STEP 05C's first-category pack joined to
 * the live pricing tables. It migrates nothing, publishes nothing and marks nothing as ready.
 */

type Row = Record<string, unknown>;
const PRICING_DECISIONS = ['D-008', 'D-010', 'D-011', 'D-016', 'D-022'] as const;

export interface ReadinessItem {
  legacyId: string;
  name: string;
  family: string;
  stagedCandidateId: string | null;
  item: { id: string; publicCode: string } | null;
  evidenceObservations: number;
  authorizedDefinitions: number;
  draftDefinitions: number;
  matrixDefinitions: number;
  matrixQuantities: number;
  historicalEvidence: number;
  pricingDecisions: string[];
  otherDecisions: string[];
  blockers: string[];
}

export interface CommercialPrintReadiness {
  asOf: string;
  meta: typeof pack.meta;
  totals: {
    candidates: number;
    withCurrentPriceEvidence: number;
    withAuthorizedPrice: number;
    withoutAuthorizedPrice: number;
    definitionsRepresented: number;
    matrixDefinitions: number;
    fixedDefinitions: number;
    evidenceObservations: number;
    historicalEvidence: number;
    publicationReady: number;
  };
  items: ReadinessItem[];
}

export function blockersFor(i: {
  authorizedDefinitions: number;
  evidenceObservations: number;
  item: unknown;
  ownerDecisionIds: readonly string[];
}): string[] {
  const out: string[] = [];
  if (!i.item) out.push('No existe como artículo del Product Engine (sólo candidato en staging).');
  else if (i.authorizedDefinitions === 0)
    out.push(
      i.evidenceObservations > 0
        ? 'Tiene evidencia de precio pero ninguna definición AUTORIZADA: cotiza sólo bajo petición.'
        : 'Sin precio autorizado ni evidencia actual: cotiza sólo bajo petición.',
    );
  for (const d of i.ownerDecisionIds) {
    if (d === 'D-016') out.push('D-016: falta definir quién autoriza la publicación.');
    if (d === 'D-022')
      out.push('D-022: redondeo/IVA de México sin resolver (comportamiento provisional).');
    if (d === 'D-010') out.push('D-010: pedidos de varios pares sin definir (QUOTE_ONLY).');
    if (d === 'D-011') out.push('D-011: moneda y semántica de cantidad sin definir.');
    if (d === 'D-008') out.push('D-008: alcance del recargo de talla sin definir.');
    if (d === 'D-002') out.push('D-002: unidad de venta sin resolver.');
    if (d === 'D-001') out.push('D-001: estado comercial formal sin asignar.');
  }
  return out;
}

export async function commercialPrintReadiness(
  db: Queryable,
  asOf: Date,
): Promise<CommercialPrintReadiness> {
  const legacy = pack.items.map((i) => i.legacyId);
  const staged = new Map(
    (
      (
        await db.query(
          `select c.id, c.proposal ->> 'legacyId' as legacy_id from import_candidate c
             join import_batch b on b.id = c.batch_id
            where c.kind = 'CATALOG_ITEM' and b.source_role = 'PRIMARY_RC' and c.proposal ->> 'legacyId' = any($1)`,
          [legacy],
        )
      ).rows as Row[]
    ).map((r) => [r.legacy_id as string, r.id as string]),
  );
  const domain = new Map(
    (
      (
        await db.query(
          `select s.source_locator, i.id, i.public_code from source_reference s
             join catalog_item i on i.id = s.entity_id
            where s.source_kind = 'LEGACY_ID' and s.entity_type = 'catalog_item' and s.source_locator = any($1)`,
          [legacy],
        )
      ).rows as Row[]
    ).map((r) => [
      r.source_locator as string,
      { id: r.id as string, publicCode: r.public_code as string },
    ]),
  );
  const hist = new Map(
    (
      (
        await db.query(
          `select evidence ->> 'item_legacy' as legacy_id, count(*)::int as n from import_record
            where evidence_class = 'HISTORICAL_PRICE' and evidence ->> 'item_legacy' = any($1) group by 1`,
          [legacy],
        )
      ).rows as Row[]
    ).map((r) => [r.legacy_id as string, Number(r.n)]),
  );
  const itemIds = [...domain.values()].map((d) => d.id);
  const defs = (
    await db.query(
      `select d.item_id, d.status, d.model,
              (d.valid_from <= $2 and (d.valid_to is null or d.valid_to > $2)) as effective,
              (select count(*)::int from price_break b where b.price_definition_id = d.id) as breaks
         from price_definition d where d.item_id = any($1)`,
      [itemIds, asOf.toISOString()],
    )
  ).rows as Row[];
  const domainHist = new Map(
    (
      (
        await db.query(
          `select entity_id, count(*)::int as n from source_reference
            where entity_type = 'catalog_item' and source_kind = 'HISTORICAL_PRICE_EVIDENCE' and entity_id = any($1)
            group by 1`,
          [itemIds],
        )
      ).rows as Row[]
    ).map((r) => [r.entity_id as string, Number(r.n)]),
  );

  const items: ReadinessItem[] = pack.items.map((p) => {
    const item = domain.get(p.legacyId) ?? null;
    const mine = item ? defs.filter((d) => d.item_id === item.id) : [];
    const authorized = mine.filter((d) => d.status === 'AUTHORIZED' && d.effective);
    const matrix = authorized.filter((d) => d.model === 'EXACT_QUANTITY_MATRIX');
    const authorizedDefinitions = authorized.length;
    // The STEP 05C queue is the authority on who is affected (e.g. D-016 covers every record, D-022 the four
    // priced items); the pack's own per-candidate list is merged in.
    const decisions = [
      ...new Set([
        ...p.ownerDecisionIds,
        ...OWNER_DECISIONS.filter((d) => d.affected.some((a) => a.legacyId === p.legacyId)).map(
          (d) => d.id,
        ),
      ]),
    ].sort();
    return {
      legacyId: p.legacyId,
      name: p.name,
      family: p.family,
      stagedCandidateId: staged.get(p.legacyId) ?? null,
      item,
      evidenceObservations: p.priceObservations,
      authorizedDefinitions,
      draftDefinitions: mine.filter((d) => d.status === 'DRAFT').length,
      matrixDefinitions: matrix.length,
      matrixQuantities: matrix.reduce((n, d) => n + Number(d.breaks), 0),
      historicalEvidence: (hist.get(p.legacyId) ?? 0) + (item ? (domainHist.get(item.id) ?? 0) : 0),
      pricingDecisions: decisions.filter((d) =>
        (PRICING_DECISIONS as readonly string[]).includes(d),
      ),
      otherDecisions: decisions.filter(
        (d) => !(PRICING_DECISIONS as readonly string[]).includes(d),
      ),
      blockers: blockersFor({
        authorizedDefinitions,
        evidenceObservations: p.priceObservations,
        item,
        ownerDecisionIds: decisions,
      }),
    };
  });

  const authorizedAll = items.filter((i) => i.authorizedDefinitions > 0);
  return {
    asOf: asOf.toISOString(),
    meta: pack.meta,
    totals: {
      candidates: items.length,
      withCurrentPriceEvidence: items.filter((i) => i.evidenceObservations > 0).length,
      withAuthorizedPrice: authorizedAll.length,
      withoutAuthorizedPrice: items.length - authorizedAll.length,
      definitionsRepresented: items.reduce((n, i) => n + i.authorizedDefinitions, 0),
      matrixDefinitions: items.reduce((n, i) => n + i.matrixDefinitions, 0),
      fixedDefinitions: defs.filter(
        (d) => d.status === 'AUTHORIZED' && d.effective && d.model === 'FIXED',
      ).length,
      evidenceObservations: items.reduce((n, i) => n + i.evidenceObservations, 0),
      historicalEvidence: items.reduce((n, i) => n + i.historicalEvidence, 0),
      publicationReady: pack.items.filter((i) => i.publicationReady).length,
    },
    items,
  };
}
