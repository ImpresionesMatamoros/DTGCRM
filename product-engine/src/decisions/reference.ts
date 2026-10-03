import { z } from 'zod';
import raw from './owner-decisions.step05c.json';

/**
 * Decision-intelligence reference (STEP 07 §23). A static, versioned ingestion of the STEP 05C owner
 * decision queue. It is domain-neutral and READ-ONLY:
 *
 *   · every `answer` is null — no decision has been answered, so nothing may be applied;
 *   · it never writes, never feeds the pricing resolver and never changes a candidate;
 *   · "pricing relevance" notes below are documentation, not business rules.
 */
const Decision = z.strictObject({
  id: z.string().regex(/^D-\d{3}$/),
  priority: z.enum(['P1', 'P2']),
  title: z.string(),
  question: z.string(),
  whyNeeded: z.string(),
  alreadyKnown: z.string(),
  alternatives: z.array(z.string()),
  owner: z.string(),
  downstreamImpact: z.string(),
  canPreparationContinue: z.string(),
  canAffectedScopePublish: z.string(),
  responseMode: z.string(),
  status: z.literal('OPEN'),
  answer: z.null(),
  affected: z.array(z.strictObject({ legacyId: z.string(), name: z.string() })),
});
const File = z.strictObject({
  meta: z.strictObject({
    namespace: z.literal('STEP_05C'),
    source: z.string(),
    sourceSha256: z.string().regex(/^[0-9a-f]{64}$/),
    note: z.string(),
  }),
  decisions: z.array(Decision).length(22),
});

export type OwnerDecision = z.infer<typeof Decision>;

const parsed = File.parse(raw);
export const DECISION_SOURCE = parsed.meta;
export const OWNER_DECISIONS: readonly OwnerDecision[] = parsed.decisions;

export const decisionById = (id: string) => OWNER_DECISIONS.find((d) => d.id === id) ?? null;

export interface PricingRelevance {
  /** What pricing behaviour is currently frozen because the decision is open. */
  frozenBehaviour: string;
  /** Where to look in the Admin. */
  adminHint: string;
}

/** Documentation of how open decisions constrain pricing today. Not a rule engine. */
export const PRICING_RELEVANCE: Readonly<Record<string, PricingRelevance>> = {
  'D-008': {
    frozenBehaviour:
      'Recargo 2XL +2 USD / 3XL +3 USD sólo en las asignaciones ya existentes (algodón y Dry Fit). No se extiende a otras prendas.',
    adminHint: 'Reglas por artículo en el detalle de precios; asignaciones sin cambios.',
  },
  'D-010': {
    frozenBehaviour:
      'Imanes: 1 par = 65 USD (FIXED). Varios pares siguen en QUOTE_ONLY; no se inventa 2 × 65 ni un corte por cantidad.',
    adminHint: 'Precio fijo del artículo Imanes para vehículo.',
  },
  'D-011': {
    frozenBehaviour:
      'Yard Sign 1=$25, 6=$20 c/u, 12=$18 c/u es evidencia: no existe PriceDefinition ni se asume USD ni cantidades exactas vs umbral.',
    adminHint: 'Evidencia no activa; el artículo cotiza sólo bajo petición.',
  },
  'D-016': {
    frozenBehaviour:
      'Existe la capacidad técnica price.authorize; quién la tiene en producción no está definido. En desarrollo sólo un actor listado en DTG_PRICE_AUTHORIZERS.',
    adminHint: 'Botón de autorización en el borrador (requiere price.authorize).',
  },
  'D-022': {
    frozenBehaviour:
      'México: precio USA × factor × FX con redondeo HALF_UP_2 = COMPORTAMIENTO TÉCNICO PROVISIONAL, no política comercial. IVA/impuestos sin resolver: no se agrega ni se infiere ningún impuesto.',
    adminHint: 'Simulador y política de mercado muestran la etiqueta PROVISIONAL.',
  },
};

export const PRICING_DECISION_IDS = Object.keys(PRICING_RELEVANCE);
