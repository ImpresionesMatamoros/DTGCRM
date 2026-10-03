/**
 * STEP 09 · owner decisions OD-01..OD-09 (Martín, after the STEP 09 handoff), expressed as the answers the
 * existing decision mechanism (0016 owner_decision_answer) records. Nothing here is inferred: every
 * assignment lists the legacy ids that OD-01/OD-02/OD-08 clearly name. Absence is NOT "inactive" (OD-01):
 * items not listed here keep the decision OPEN.
 */

export const OWNER_ACTOR = 'martin';

/** Items OD-01 clearly confirms as currently sold (Business Cards, Flyers, Postcards, Auto Magnets). */
export const OD01_ACTIVE = [
  'MIG1-O-008', // Tarjeta Tradicional  — Business Cards
  'MIG1-O-009', // Tarjeta Premium / Gloss — Business Cards
  'MIG2-O-036', // Flyers
  'MIG2-O-040', // Postales — Postcards
  'MIGF-O-015', // Imanes para vehículo — Auto Magnets
] as const;

export interface AnswerSpec {
  decisionId: string;
  summary: string;
  notes: string;
  assignments?: { value: unknown; legacyIds: string[] }[];
  covers?: string[];
}

export const STEP09_ANSWERS: readonly AnswerSpec[] = [
  {
    decisionId: 'D-001',
    summary:
      'OD-01: ACTIVE = DTG vende/cotiza el item hoy (ACTIVE + QUOTE_ONLY es válido). Confirmados en Commercial Print: Business Cards, Flyers, Postcards y Auto Magnets.',
    notes:
      'Sólo coincidencias claras. La ausencia en la lista del owner NO significa inactivo: el resto de items queda abierto.',
    assignments: [{ value: 'ACTIVE', legacyIds: [...OD01_ACTIVE] }],
  },
  {
    decisionId: 'D-002',
    summary:
      'OD-02: la mayoría de los productos se vende por PIECE; excepciones Business Cards, Flyers y Stickers (cantidades/lotes definidos). Un paquete no es un CatalogItem aparte.',
    notes:
      'Aplicado sólo a Postales (Postcards no es una de las tres excepciones del owner). Tarjetas y Flyers ya traen su unidad desde el slice. Interpretación a confirmar: P2.',
    assignments: [{ value: 'PIECE', legacyIds: ['MIG2-O-040'] }],
  },
  {
    decisionId: 'D-010',
    summary:
      'OD-08: Auto Magnets = 65 USD por 1 PAR (cada imán 1×2 ft, impresión incluida). No se asume 2 pares = 2×; otras cantidades quedan QUOTE_ONLY.',
    notes: 'La unidad de venta del imán es PAR; el precio de un par queda con maxQuantity 1.',
    assignments: [{ value: 'PAIR', legacyIds: ['MIGF-O-015'] }],
  },
  {
    decisionId: 'D-016',
    summary:
      'OD-05 + OD-07: Martín autoriza el precio maestro y la primera publicación REAL de un producto (v0.1). Jonathan y Ceci preparan, editan y revisan; no autorizan. Delegable después.',
    notes: 'Resuelve el aspecto principal de D-016 para el MVP. Toda autorización queda auditada.',
  },
];

/** Reviewed source-category → Product Engine category mappings (evidence: STEP 05C Commercial Print definition + dev slice). */
export const STEP09_CATEGORY_MAPPINGS = [
  { sourceCategory: 'MIG1-CAT-006', categoryKey: 'impresos_papel' },
  { sourceCategory: 'MIG1-CAT-009', categoryKey: 'servicios_especiales' },
] as const;

export const STEP09_PRICE_VALID_FROM = '2026-09-15T00:00:00+00:00';
export const STEP09_DEFAULT_MARKETS = ['USA'] as const;
