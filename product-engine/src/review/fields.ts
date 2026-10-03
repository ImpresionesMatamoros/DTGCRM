import {
  CATALOG_STATUSES,
  CUSTOMER_SUPPLIED_ITEM,
  DECORATION_POLICIES,
  SALE_UNITS,
} from '../domain/catalog';
import { canonicalJson } from '../import/keys';
import type { CandidateKind, Proposal } from '../import/proposal';
import { unresolvedFields } from '../import/requirements';

/**
 * Review field catalogue (STEP 06). Describes, per candidate kind, which
 * resolution fields a person may decide, how to show them and what the source
 * said. It decides nothing: whether a field is still open always comes from
 * `unresolvedFields` (src/import/requirements), and every value is validated by
 * the resolution schemas (src/import/resolution) on the server.
 */

export type Draft = Record<string, unknown>;

export type FieldControl =
  | { type: 'enum'; options: readonly { value: string | null; label: string }[] }
  | { type: 'boolean'; trueLabel: string; falseLabel: string }
  | { type: 'datetime' }
  | { type: 'int' }
  | { type: 'text' }
  | { type: 'category' }
  | { type: 'method' }
  | { type: 'target' }
  | { type: 'optionDefinition' }
  | { type: 'optionValues' };

export interface FieldDef {
  field: string;
  label: string;
  help: string;
  control: FieldControl;
  /** Can be applied to many candidates at once (compatible, scalar). */
  bulk: boolean;
  /** Whether the field makes sense for this proposal (+ draft). */
  applies: (p: Proposal, draft: Draft) => boolean;
  /** What the source said. `undefined` = the source does not say (never a default). */
  sourceValue: (p: Proposal) => unknown;
  /** Human-readable evidence that is NOT a decision (legacy category, suggestion…). */
  evidence?: (p: Proposal) => string | null;
}

const always = () => true;
const nothing = () => undefined;
const enumOptions = (values: readonly string[]) => values.map((v) => ({ value: v, label: v }));

const effectiveItemType = (p: Proposal, draft: Draft): string | null =>
  p.kind === 'CATALOG_ITEM' ? ((draft.itemType as string | undefined) ?? p.itemType) : null;

const text = (v: string | null | undefined) => (v === null || v === undefined ? null : v);

export const FIELD_DEFS: Record<CandidateKind, readonly FieldDef[]> = {
  CATALOG_ITEM: [
    {
      field: 'itemType',
      label: 'Tipo de item',
      help: 'PRODUCT o SERVICE. Viene de la columna Clase; en blanco o sin mapear queda sin resolver.',
      control: { type: 'enum', options: enumOptions(['PRODUCT', 'SERVICE']) },
      bulk: true,
      applies: always,
      sourceValue: (p) => (p.kind === 'CATALOG_ITEM' ? (p.itemType ?? undefined) : undefined),
      evidence: (p) =>
        p.kind === 'CATALOG_ITEM' && p.itemTypeEvidence ? `Clase: ${p.itemTypeEvidence}` : null,
    },
    {
      field: 'status',
      label: 'Estado de catálogo',
      help: 'CANDIDATE, PLANNED, ACTIVE o RETIRED. Sin estado un item nunca se ofrece ni se publica.',
      control: { type: 'enum', options: enumOptions(CATALOG_STATUSES) },
      bulk: true,
      applies: always,
      sourceValue: (p) => (p.kind === 'CATALOG_ITEM' ? (p.status ?? undefined) : undefined),
    },
    {
      field: 'decorationPolicy',
      label: 'Política de decoración',
      help: 'NONE: no se decora. OPTIONAL: se vende blank o decorado. REQUIRED: siempre lleva decoración. El Excel nunca la dice: siempre es una decisión.',
      control: { type: 'enum', options: enumOptions(DECORATION_POLICIES) },
      bulk: true,
      applies: always,
      sourceValue: nothing,
    },
    {
      field: 'customerSuppliedItem',
      label: 'Artículo del cliente',
      help: 'Sólo para SERVICE: ALLOWED (acepta artículo del cliente), REQUIRED (siempre sobre artículo del cliente) o NOT_APPLICABLE.',
      control: { type: 'enum', options: enumOptions(CUSTOMER_SUPPLIED_ITEM) },
      bulk: true,
      applies: (p, d) => effectiveItemType(p, d) === 'SERVICE',
      sourceValue: nothing,
      evidence: (p) =>
        p.kind === 'CATALOG_ITEM' && p.customerSuppliedEvidence !== null
          ? `Excel · Acepta material del cliente: ${p.customerSuppliedEvidence ? 'Sí' : 'No'} (evidencia, no decide ALLOWED vs REQUIRED)`
          : null,
    },
    {
      field: 'categoryKey',
      label: 'Categoría Product Engine',
      help: 'Categoría primaria existente. La categoría del Excel es sólo evidencia; nunca se asigna sola. No es obligatoria para aprobar.',
      control: { type: 'category' },
      bulk: true,
      applies: always,
      sourceValue: nothing,
      evidence: (p) =>
        p.kind === 'CATALOG_ITEM' && p.categoryLegacy
          ? `Categoría en el Excel: ${p.categoryLegacy}`
          : null,
    },
    {
      field: 'saleUnit',
      label: 'Unidad de venta',
      help: 'Sin unidad de venta no hay precio automático. “Sin unidad” es una decisión explícita.',
      control: {
        type: 'enum',
        options: [...enumOptions(SALE_UNITS), { value: null, label: 'Sin unidad (null)' }],
      },
      bulk: true,
      applies: always,
      sourceValue: (p) => (p.kind === 'CATALOG_ITEM' ? (p.saleUnit ?? undefined) : undefined),
    },
    {
      field: 'canonicalName',
      label: 'Nombre canónico',
      help: 'Por defecto el nombre del Excel. Un nombre nunca es identidad.',
      control: { type: 'text' },
      bulk: false,
      applies: always,
      sourceValue: (p) => (p.kind === 'CATALOG_ITEM' ? (text(p.name) ?? undefined) : undefined),
    },
    {
      field: 'target',
      label: 'Destino',
      help: 'Crear un item nuevo o vincular el candidato a un item que ya existe (obligatorio si su LEGACY_ID ya está en el dominio).',
      control: { type: 'target' },
      bulk: false,
      applies: always,
      sourceValue: nothing,
    },
  ],
  OPTION: [
    {
      field: 'isRequired',
      label: 'Obligatoria',
      help: 'Si la opción debe elegirse siempre. La columna Obligatoria vacía queda sin resolver: nunca se asume “no”.',
      control: { type: 'boolean', trueLabel: 'Obligatoria (true)', falseLabel: 'Opcional (false)' },
      bulk: true,
      applies: always,
      sourceValue: (p) => (p.kind === 'OPTION' ? (p.required ?? undefined) : undefined),
    },
    {
      field: 'selectionMode',
      label: 'Modo de selección',
      help: 'SINGLE: un valor. MULTI: varios valores a la vez.',
      control: { type: 'enum', options: enumOptions(['SINGLE', 'MULTI']) },
      bulk: true,
      applies: always,
      sourceValue: nothing,
    },
    {
      field: 'isDistributable',
      label: 'Distribuible',
      help: 'Puede variar entre renglones de una misma cantidad (corrida de tallas). Sólo SINGLE + ENUM.',
      control: { type: 'boolean', trueLabel: 'Sí (true)', falseLabel: 'No (false)' },
      bulk: true,
      applies: always,
      sourceValue: nothing,
    },
    {
      field: 'definition',
      label: 'Definición de opción',
      help: 'Una definición por significado (tamano_papel ≠ tamano_display): elegir una existente o crear una nueva.',
      control: { type: 'optionDefinition' },
      bulk: false,
      applies: always,
      sourceValue: nothing,
      evidence: (p) =>
        p.kind === 'OPTION'
          ? `Excel · nombre: ${p.name ?? '—'} · captura: ${p.captureType ?? '—'}`
          : null,
    },
    {
      field: 'values',
      label: 'Valores',
      help: 'Para cada valor del Excel: usar un valor existente, crear uno nuevo o excluirlo con motivo.',
      control: { type: 'optionValues' },
      bulk: false,
      applies: (p) => p.kind === 'OPTION' && p.values.length > 0,
      sourceValue: nothing,
    },
  ],
  DECORATION: [
    {
      field: 'methodKey',
      label: 'Método de decoración',
      help: 'Confirmar qué método del dominio es. Una asociación de proceso de producción no prueba que sea una decoración seleccionable.',
      control: { type: 'method' },
      bulk: true,
      applies: (p) => p.kind === 'DECORATION' && p.subtype === 'METHOD_ASSOCIATION',
      sourceValue: nothing,
      evidence: (p) =>
        p.kind === 'DECORATION' && p.subtype === 'METHOD_ASSOCIATION'
          ? `Excel · ${p.methodLabels.filter(Boolean).join(', ') || '—'}${p.suggestedMethodKey ? ` · sugerencia: ${p.suggestedMethodKey} (no es decisión)` : ' · sin sugerencia'}`
          : null,
    },
    {
      field: 'decorationPolicy',
      label: 'Política de decoración',
      help: 'Blank/Personalizada ⇒ OPTIONAL (ADR-0004).',
      control: { type: 'enum', options: enumOptions(DECORATION_POLICIES) },
      bulk: false,
      applies: (p) => p.kind === 'DECORATION' && p.subtype === 'POLICY',
      sourceValue: (p) =>
        p.kind === 'DECORATION' && p.subtype === 'POLICY' ? p.decorationPolicy : undefined,
    },
  ],
  COMPOSITION: [
    {
      field: 'childLegacyId',
      label: 'Componente (LEGACY_ID)',
      help: 'Item hijo de la composición.',
      control: { type: 'text' },
      bulk: false,
      applies: (p) => p.kind === 'COMPOSITION' && p.subtype === 'POLICY',
      sourceValue: nothing,
    },
    {
      field: 'role',
      label: 'Rol',
      help: 'INCLUDED: viene incluido. OPTIONAL: se puede agregar.',
      control: { type: 'enum', options: enumOptions(['INCLUDED', 'OPTIONAL']) },
      bulk: false,
      applies: always,
      sourceValue: (p) =>
        p.kind === 'COMPOSITION' && p.subtype === 'RELATION' ? (p.role ?? undefined) : undefined,
    },
    {
      field: 'quantity',
      label: 'Cantidad',
      help: 'Unidades del hijo por unidad del padre.',
      control: { type: 'int' },
      bulk: false,
      applies: always,
      sourceValue: (p) =>
        p.kind === 'COMPOSITION' && p.subtype === 'RELATION'
          ? (p.quantity ?? undefined)
          : undefined,
    },
  ],
  PRICE: [
    {
      field: 'validFrom',
      label: 'Vigente desde',
      help: 'Cuándo empieza a valer en Product Engine. Nunca se asume “ahora”.',
      control: { type: 'datetime' },
      bulk: true,
      applies: always,
      sourceValue: nothing,
    },
    {
      field: 'amountBasis',
      label: 'Base del importe',
      help: 'TOTAL: el importe es el total del paquete. UNIT: importe por unidad.',
      control: { type: 'enum', options: enumOptions(['TOTAL', 'UNIT']) },
      bulk: true,
      applies: always,
      sourceValue: (p) => (p.kind === 'PRICE' ? (p.amountBasis ?? undefined) : undefined),
      evidence: (p) =>
        p.kind === 'PRICE' && p.amountBasisEvidence
          ? `Excel · Base de cobro: ${p.amountBasisEvidence}`
          : null,
    },
    {
      field: 'maxQuantity',
      label: 'Cantidad del precio fijo',
      help: 'Un precio FIXED necesita la cantidad exacta que cubre.',
      control: { type: 'int' },
      bulk: false,
      applies: (p) => p.kind === 'PRICE' && p.model === 'FIXED',
      sourceValue: (p) =>
        p.kind === 'PRICE' && p.model === 'FIXED' && p.observations.length === 1
          ? (p.observations[0]!.quantity ?? undefined)
          : undefined,
    },
    {
      field: 'target',
      label: 'Destino',
      help: 'Crear la definición o vincularla a una existente idéntica.',
      control: { type: 'target' },
      bulk: false,
      applies: always,
      sourceValue: nothing,
    },
  ],
  PRESENTATION: [
    {
      field: 'locale',
      label: 'Idioma',
      help: 'es o en. Si el Excel no lo dice, queda sin resolver.',
      control: { type: 'enum', options: enumOptions(['es', 'en']) },
      bulk: true,
      applies: always,
      sourceValue: (p) => (p.kind === 'PRESENTATION' ? (p.locale ?? undefined) : undefined),
      evidence: (p) =>
        p.kind === 'PRESENTATION' && p.languageEvidence
          ? `Excel · idioma: ${p.languageEvidence}`
          : null,
    },
    {
      field: 'isDefault',
      label: 'Presentación default',
      help: 'A lo sumo una default por item e idioma.',
      control: { type: 'boolean', trueLabel: 'Default (true)', falseLabel: 'No default (false)' },
      bulk: true,
      applies: always,
      sourceValue: nothing,
      evidence: (p) => (p.kind === 'PRESENTATION' && p.role ? `Excel · rol: ${p.role}` : null),
    },
    {
      field: 'displayName',
      label: 'Nombre visible',
      help: 'Por defecto el nombre del Excel.',
      control: { type: 'text' },
      bulk: false,
      applies: always,
      sourceValue: (p) =>
        p.kind === 'PRESENTATION' ? (text(p.displayName) ?? undefined) : undefined,
    },
    {
      field: 'target',
      label: 'Destino',
      help: 'Crear la presentación o vincularla a una existente.',
      control: { type: 'target' },
      bulk: false,
      applies: always,
      sourceValue: nothing,
    },
  ],
};

export function fieldDef(kind: CandidateKind, field: string): FieldDef | undefined {
  return FIELD_DEFS[kind].find((f) => f.field === field);
}

/** Where the current value of a field comes from. */
export type FieldState =
  | 'REVIEWED' // decided by a person (draft or approved resolution)
  | 'SOURCE' // stated explicitly by the source
  | 'UNRESOLVED' // required and unknown: must be decided before approval
  | 'NOT_SET'; // optional and unknown (e.g. category, target)

export interface FieldView {
  field: string;
  label: string;
  help: string;
  control: FieldControl;
  bulk: boolean;
  state: FieldState;
  /** Draft value if reviewed; otherwise the source value; otherwise undefined. */
  value: unknown;
  sourceValue: unknown;
  evidence: string | null;
  /** Needed for approval when unknown (listed by `unresolvedFields`). */
  requiredWhenUnknown: boolean;
}

const hasKey = (d: Draft | null | undefined, k: string) =>
  d !== null && d !== undefined && Object.prototype.hasOwnProperty.call(d, k) && d[k] !== undefined;

/**
 * Field-by-field view of a candidate: source vs human decision vs still open.
 * `requiredWhenUnknown` comes from `unresolvedFields(proposal)` (no resolution).
 */
export function fieldViews(proposal: Proposal, draft: Draft | null): FieldView[] {
  const d = draft ?? {};
  const requiredUnknown = new Set(unresolvedFields(proposal));
  const open = new Set(unresolvedFields(proposal, d));
  return FIELD_DEFS[proposal.kind]
    .filter((f) => f.applies(proposal, d))
    .map((f) => {
      const source = f.sourceValue(proposal);
      const reviewed = hasKey(d, f.field);
      const state: FieldState = reviewed
        ? 'REVIEWED'
        : open.has(f.field)
          ? 'UNRESOLVED'
          : source !== undefined
            ? 'SOURCE'
            : 'NOT_SET';
      return {
        field: f.field,
        label: f.label,
        help: f.help,
        control: f.control,
        bulk: f.bulk,
        state,
        value: reviewed ? d[f.field] : source,
        sourceValue: source,
        evidence: f.evidence?.(proposal) ?? null,
        requiredWhenUnknown: requiredUnknown.has(f.field) || open.has(f.field),
      };
    });
}

/** Fields still open after the draft (the only truth for "can this be approved?"). */
export function openFields(proposal: Proposal, draft: Draft | null): string[] {
  return unresolvedFields(proposal, draft ?? {});
}

export interface DraftChange {
  field: string;
  action: 'SET' | 'CLEAR';
  /** undefined = absent from the draft. */
  oldValue: unknown;
  newValue: unknown;
}

const same = (a: unknown, b: unknown) =>
  a === undefined || b === undefined ? a === b : canonicalJson(a) === canonicalJson(b);

/** Applies `set`/`clear` to a draft and returns the new draft plus the field-level changes. */
export function applyDraftPatch(
  current: Draft | null,
  patch: { set?: Draft; clear?: readonly string[] },
): { draft: Draft; changes: DraftChange[] } {
  const next: Draft = { ...(current ?? {}) };
  const changes: DraftChange[] = [];
  for (const field of patch.clear ?? []) {
    if (hasKey(next, field)) {
      changes.push({ field, action: 'CLEAR', oldValue: next[field], newValue: undefined });
      delete next[field];
    }
  }
  for (const [field, value] of Object.entries(patch.set ?? {})) {
    if (value === undefined) continue;
    const old = hasKey(next, field) ? next[field] : undefined;
    if (same(old, value)) continue;
    changes.push({ field, action: 'SET', oldValue: old, newValue: value });
    next[field] = value;
  }
  return { draft: next, changes };
}
