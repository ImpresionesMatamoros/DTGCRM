import type { AmountBasis } from '../domain/pricing-model';

/**
 * Versioned, explicit vocabulary mappings used to build *proposals*. A proposal
 * is never a decision: every value still goes through human approval, and any
 * source value that is not listed here stays null (unresolved).
 */
export const MAPPING_VERSION = '2026-09-30.1';

/**
 * Excel `Base_de_cobro` → price break amount basis. Evidence: STEP 03
 * MIGRATION-MAPPING §7 and the authorized dev-slice prices (package price is
 * the total for the exact package quantity; `Total` is a total amount).
 */
export const AMOUNT_BASIS_BY_SOURCE: Readonly<Record<string, AmountBasis>> = {
  'por paquete': 'TOTAL',
  total: 'TOTAL',
};

/**
 * Excel method label → decoration method key, as a *suggestion* only. A method
 * association in OFERTA_METODO does not prove a selectable decoration (STEP 05A
 * Q-12, ADR-0004); the reviewer must confirm it. Production processes that are
 * not decoration methods of the domain (UV DTF, sublimation, large-format or
 * commercial printing, adhesive vinyl, laser) have no suggestion.
 */
export const DECORATION_METHOD_SUGGESTION: Readonly<Record<string, string>> = {
  'dtf textil': 'DTF',
  bordado: 'EMBROIDERY',
  serigrafia: 'SCREEN_PRINTING',
  'htv / vinil textil': 'HTV',
};

/** Source language → presentation locale. Blank stays unresolved. */
export const LOCALE_BY_SOURCE: Readonly<Record<string, 'es' | 'en'>> = {
  es: 'es',
  espanol: 'es',
  en: 'en',
  ingles: 'en',
  english: 'en',
};

/** Blank/Personalizada modality ⇒ decoration is optional; blank = no DecorationSelection (ADR-0004). */
export const DECORATION_POLICY_MODALITY_LABELS = ['blank', 'personalizada'] as const;

/** Lowercase, accent-free comparison key (same idea as the parser's `key()`). */
export function lookupKey(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
}
