/**
 * STEP 09 completion · OWNER_DECISION_SPEC_v1.0 (Martín, 2026-10-02) applied to the 16 Commercial Print rows
 * that stayed blocked after OD-01..OD-09. Nothing here is inferred: every line is a row of the spec or of the
 * owner's `STEP09_BLOCKED_ITEMS_RESOLUTION_MAP`. Rows whose treatment depends on evidence the workbooks do
 * not carry (sizes, tiers, prices) get no value: ACTIVE + QUOTE_ONLY is valid (decision 107).
 */
import { OD01_ACTIVE, type AnswerSpec } from './step09-owner-decisions';

export const SPEC_REF = 'OWNER_DECISION_SPEC_v1.0';

/** Canonical products (they become CatalogItems). */
export const CANONICAL = {
  'MIG2-O-037': { status: 'ACTIVE', saleUnit: 'PIECE', canonicalName: 'Poster / Tabloide 11×17' },
  'MIG2-O-038': { status: 'ACTIVE', saleUnit: 'SQ_FT', canonicalName: 'Poster Gran Formato' },
  'MIG2-O-039': { status: 'ACTIVE', saleUnit: 'PIECE' },
  'MIGF-O-008': { status: 'ACTIVE', saleUnit: 'PIECE' },
  'MIGF-O-009': { status: 'ACTIVE', saleUnit: 'PIECE' },
  'OWN-MT-O-046': { status: 'ACTIVE', saleUnit: 'PIECE' },
  'MIG2-O-047': { status: 'CANDIDATE', saleUnit: 'PIECE' },
  'MIG2-O-048': { status: 'CANDIDATE', saleUnit: 'PIECE' },
} as const satisfies Record<
  string,
  { status: 'ACTIVE' | 'CANDIDATE'; saleUnit: 'PIECE' | 'SQ_FT'; canonicalName?: string }
>;
export type CanonicalId = keyof typeof CANONICAL;
export const CANONICAL_IDS = Object.keys(CANONICAL) as CanonicalId[];

/** All canonical rows land in the existing `impresos_papel` category (implementation taxonomy; no new category). */
export const COMPLETION_CATEGORY = 'impresos_papel';

const INV = ['MIGF-O-008', 'MIGF-O-009'];
export interface DispositionSpec {
  itemLegacyId: string;
  disposition: 'ALIAS' | 'CONFIGURATION' | 'STYLE' | 'LEGACY_INVALID';
  canonicalLegacyIds: string[];
  detail: string;
  decisionId: string;
}
/** Source rows that are not products. */
export const DISPOSITION_SPECS: readonly DispositionSpec[] = [
  {
    itemLegacyId: 'MIG2-O-046',
    disposition: 'LEGACY_INVALID',
    canonicalLegacyIds: [],
    decisionId: 'D-001',
    detail: 'Tarjetas complementarias: concepto legacy no válido, no es un producto canónico',
  },
  {
    itemLegacyId: 'MIGF-O-014',
    disposition: 'LEGACY_INVALID',
    canonicalLegacyIds: [],
    decisionId: 'D-018',
    detail: 'Invitación especial: concepto legacy no válido',
  },
  {
    itemLegacyId: 'MIGF-O-010',
    disposition: 'ALIAS',
    canonicalLegacyIds: INV,
    decisionId: 'D-018',
    detail:
      'Invitación para evento: etiqueta genérica de la familia de invitaciones (Sencilla / Premium)',
  },
  {
    itemLegacyId: 'MIGF-O-011',
    disposition: 'CONFIGURATION',
    canonicalLegacyIds: INV,
    decisionId: 'D-018',
    detail: 'Invitación con sobre: configuración de la invitación, no un producto',
  },
  {
    itemLegacyId: 'MIGF-O-012',
    disposition: 'CONFIGURATION',
    canonicalLegacyIds: ['MIGF-O-009'],
    decisionId: 'D-018',
    detail: 'Invitación con sello: configuración de Invitación Premium',
  },
  {
    itemLegacyId: 'MIGF-O-013',
    disposition: 'CONFIGURATION',
    canonicalLegacyIds: ['MIGF-O-009'],
    decisionId: 'D-018',
    detail: 'Invitación con acrílico: configuración de Invitación Premium',
  },
  {
    itemLegacyId: 'OWN-O-007',
    disposition: 'STYLE',
    canonicalLegacyIds: INV,
    decisionId: 'D-018',
    detail: 'Invitación formal: estilo/diseño, no un producto',
  },
  {
    itemLegacyId: 'OWN-O-008',
    disposition: 'STYLE',
    canonicalLegacyIds: INV,
    decisionId: 'D-018',
    detail: 'Invitación casual: estilo/diseño, no un producto',
  },
];
export const NON_PRODUCT_IDS = DISPOSITION_SPECS.map((d) => d.itemLegacyId);

const idsOf = (status: 'ACTIVE' | 'CANDIDATE') =>
  CANONICAL_IDS.filter((l) => CANONICAL[l].status === status);
const unitIds = (u: 'PIECE' | 'SQ_FT') => CANONICAL_IDS.filter((l) => CANONICAL[l].saleUnit === u);

const ref = `Fuente: ${SPEC_REF} (revisión de las 140 decisiones por Martín, 2026-10-02) y mapa de items bloqueados. Registrado por la sesión de cierre de STEP 09 a nombre del dueño.`;

/** Revised answers (each supersedes the STEP 09 one: earlier assignments are kept, history stays). */
export const COMPLETION_ANSWERS: readonly AnswerSpec[] = [
  {
    decisionId: 'D-001',
    summary:
      'Owner spec v1.0: ACTIVE = Tabloide/Poster 11×17, Poster Gran Formato, Menús, Invitación Sencilla, Invitación Premium, Periódico personalizado (además de los ya confirmados). CANDIDATE = Seating/Place Cards y Thank-you Cards (fabricables, aún nunca vendidos; nunca públicos). Tarjetas complementarias e Invitación especial son legacy no válidos; Invitación para evento / con sobre / con sello / con acrílico / formal / casual no son productos con estado propio (se resuelven por canonicalización, D-018).',
    notes: ref,
    assignments: [
      { value: 'ACTIVE', legacyIds: [...OD01_ACTIVE, ...idsOf('ACTIVE')] },
      { value: 'CANDIDATE', legacyIds: idsOf('CANDIDATE') },
    ],
    covers: [...NON_PRODUCT_IDS],
  },
  {
    decisionId: 'D-002',
    summary:
      'Owner spec v1.0: la mayoría de los productos tangibles se vende por PIECE (Tabloide 11×17, Menús, Invitaciones, Periódico, Seating, Thank-you); Poster Gran Formato se mide por área (SQ_FT, medidas estándar y personalizadas). Un paquete no es un CatalogItem aparte. Las cantidades por tramos (invitaciones 12…300, menús 1/6) son política de precio, no unidad de venta.',
    notes: `${ref} Se conserva Postales = PIECE (STEP 09).`,
    assignments: [
      { value: 'PIECE', legacyIds: ['MIG2-O-040', ...unitIds('PIECE')] },
      { value: 'SQ_FT', legacyIds: unitIds('SQ_FT') },
    ],
    covers: [...NON_PRODUCT_IDS],
  },
  {
    decisionId: 'D-003',
    summary:
      'Owner spec v1.0: tangible = PRODUCT, intangible = SERVICE. El periódico personalizado para eventos es un PRODUCT físico.',
    notes: ref,
    assignments: [{ value: 'PRODUCT', legacyIds: ['OWN-MT-O-046'] }],
  },
  {
    decisionId: 'D-004',
    summary:
      'Owner spec v1.0 (decisiones 11–14 y 3): Menús — tamaño, 1 o 2 caras y laminado opcional son opciones comerciales del cliente; el material es decisión interna salvo diferencia comercial. Invitación con acrílico es una configuración de Invitación Premium, no un producto. Proveedor/acabado/técnica siguen internos (OD-04).',
    notes: `${ref} Los tamaños y caras no tienen valores en el workbook: no se inventan.`,
    covers: ['MIG2-O-039', 'MIGF-O-013'],
  },
  {
    decisionId: 'D-005',
    summary:
      'Owner spec v1.0 (decisión 13): "Laminado" en Menús es una opción comercial opcional cuando se ofrece; no se asume que el menú genérico sea sin laminado. Las opciones "presentación/acabado" de Invitación con acrílico quedan como evidencia de la configuración Premium.',
    notes: ref,
    covers: ['MIG2-O-039', 'MIGF-O-013'],
  },
  {
    decisionId: 'D-018',
    summary:
      'Owner spec v1.0: canónicas Invitación Sencilla e Invitación Premium; "Invitación para evento" = etiqueta genérica; "con sobre" = configuración; "con sello" y "con acrílico" = configuraciones de Premium; "Invitación especial" = legacy no válido; "formal" y "casual" = estilos. Umbrales 12/25/50/75/100/150/200/250/300 con semántica de tramo alcanzado (sin precios).',
    notes: ref,
    covers: [
      'MIGF-O-008',
      'MIGF-O-009',
      'MIGF-O-010',
      'MIGF-O-011',
      'MIGF-O-012',
      'MIGF-O-013',
      'MIGF-O-014',
      'OWN-O-007',
      'OWN-O-008',
    ],
  },
];

/** Decisions the second permit rests on (the first rested on D-001, D-002, D-010, D-016). */
export const COMPLETION_PERMIT_DECISIONS = ['D-001', 'D-002', 'D-003', 'D-010', 'D-016', 'D-018'];
