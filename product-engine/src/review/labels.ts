/**
 * Human explanations for technical codes shown in the review console. The code
 * is always shown too; this only adds a readable sentence and, when the issue
 * points to a resolution field, which one. Presentation only: no decisions.
 */

export interface IssueExplanation {
  explanation: string;
  /** Resolution field the issue is about, when there is one. */
  field: string | null;
}

const DOMAIN_QUESTIONS: [RegExp, IssueExplanation][] = [
  [
    /Sale unit/i,
    {
      explanation:
        'El Excel no trae una unidad de venta reconocible; decidirla (o dejarla explícitamente sin unidad).',
      field: 'saleUnit',
    },
  ],
  [
    /Unmapped Clase/i,
    {
      explanation: 'La columna Clase no dice PRODUCT ni SERVICE; el tipo de item es una decisión.',
      field: 'itemType',
    },
  ],
  [
    /Production method association/i,
    {
      explanation:
        'El Excel asocia un proceso al producto, pero eso no prueba que sea una decoración que el cliente elige.',
      field: 'methodKey',
    },
  ],
  [
    /Presentation language/i,
    { explanation: 'El Excel no dice el idioma de la presentación.', field: 'locale' },
  ],
  [
    /Single-value item attribute/i,
    {
      explanation:
        'Atributo de valor único del item (p. ej. par de imanes 2 × 1 ft): pertenece al item, no es una opción.',
      field: null,
    },
  ],
  [
    /clothing size excluded/i,
    {
      explanation:
        'Talla de gorra excluida del modelo en STEP 03: se conserva sólo como evidencia.',
      field: null,
    },
  ],
  [
    /modalidad transformed/i,
    {
      explanation:
        'La modalidad Blank/Personalizada se transformó en política de decoración, nunca en opción.',
      field: 'decorationPolicy',
    },
  ],
];

export function explainIssue(
  code: string,
  message: string,
  detail: Record<string, unknown> | null,
): IssueExplanation {
  switch (code) {
    case 'IMPORT_UNMAPPED_CATEGORY':
      return {
        explanation:
          'La categoría del Excel no tiene equivalente en Product Engine. Se muestra como evidencia; elegir la categoría es una decisión (no bloquea la aprobación).',
        field: 'categoryKey',
      };
    case 'IMPORT_UNKNOWN_STATUS':
      return {
        explanation:
          'El Excel no asigna un estado comercial reconocible; el estado de catálogo queda sin resolver.',
        field: 'status',
      };
    case 'IMPORT_FORMULA_VALUE_UNRESOLVED':
      return {
        explanation:
          'La celda tiene una fórmula que el parser no evalúa; revisar el valor en caché en la procedencia.',
        field: null,
      };
    case 'IMPORT_UNMAPPED_OPTION':
      return {
        explanation: 'La opción necesita revisar su significado: elegir o crear su definición.',
        field: 'definition',
      };
    case 'IMPORT_POSSIBLE_DUPLICATE':
      return {
        explanation:
          'Señal de posible duplicado entre items del Excel. Nunca se fusiona automáticamente.',
        field: null,
      };
    case 'IMPORT_DUPLICATE_REVIEW': {
      const kind = typeof detail?.kind === 'string' ? detail.kind : '';
      return {
        explanation:
          kind === 'RELATIONSHIP_NOT_DUPLICATE'
            ? 'Relación entre items (p. ej. componente de un X-Banner), no un duplicado. Revisar por separado.'
            : 'Par probable de duplicados. Revisar ambos; no hay fusión automática.',
        field: null,
      };
    }
    case 'IMPORT_DOMAIN_MAPPING_QUESTION': {
      const hit = DOMAIN_QUESTIONS.find(([re]) => re.test(message));
      return hit ? hit[1] : { explanation: 'Requiere una decisión de dominio.', field: null };
    }
    default:
      return { explanation: message, field: null };
  }
}

export const BLOCKING_EXPLANATIONS: Record<string, string> = {
  PARSER_REJECTED: 'El parser rechazó el registro de origen.',
  SOURCE_ERROR: 'El registro de origen tiene un issue ERROR.',
  EMPTY_NAME: 'El item no tiene nombre en el Excel.',
  BUNDLE_NOT_SUPPORTED: 'Bundle no está implementado.',
  PRICE_MODEL_NOT_SUPPORTED: 'Modelo de precio no soportado.',
  PRICE_NOT_AUTHORIZED_IN_SOURCE: 'El Excel no marca este precio como autorizado.',
  PRICE_CURRENCY_UNKNOWN: 'Moneda desconocida.',
  MX_PRICE_EVIDENCE_ONLY: 'Un precio en MXN del Excel es evidencia; México se deriva de USA.',
  PRICE_AMOUNT_INVALID: 'Importe inválido.',
  PRICE_QUANTITY_NOT_EXACT: 'Una matriz necesita cantidades exactas.',
  PRICE_CONFLICT: 'Dos importes distintos para la misma cantidad.',
  PRICE_DUPLICATE_BREAK: 'Cantidad repetida en la matriz.',
  FIXED_PRICE_MULTIPLE_OBSERVATIONS: 'Un precio fijo con varias observaciones.',
  UNSUPPORTED_CONDITION_OPERATOR: 'Operador de condición no soportado.',
  PRESENTATION_WITHOUT_NAME: 'Presentación sin nombre.',
  REFERENCE_MISSING: 'Falta la referencia al item.',
};

export const REVIEW_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pendiente de validar',
  VALID: 'Válido',
  WARNING: 'Con avisos',
  BLOCKED: 'Bloqueado',
  APPROVED: 'Aprobado',
  REJECTED: 'Rechazado',
  PUBLISHED: 'Publicado',
};

export const KIND_LABELS: Record<string, string> = {
  CATALOG_ITEM: 'Item de catálogo',
  OPTION: 'Opción',
  DECORATION: 'Decoración',
  COMPOSITION: 'Composición',
  PRICE: 'Precio',
  PRESENTATION: 'Presentación',
};

export const SKIP_REASON_LABELS: Record<string, string> = {
  OTHER_KIND: 'otro tipo de candidato',
  BLOCKED: 'bloqueado (no se puede aprobar)',
  APPROVED_LOCKED: 'aprobado (retirar la aprobación primero)',
  TERMINAL: 'publicado o rechazado',
  NOT_VALIDATED: 'sin validar',
  FIELD_NOT_APPLICABLE: 'el campo no aplica',
  DIFFERENT_NOT_CONFIRMED: 'tenía otro valor (no se sobrescribe sin confirmar)',
};
