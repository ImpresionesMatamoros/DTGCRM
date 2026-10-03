import type { CandidateKind } from '../import/proposal';
import { normalizeText } from './context';
import type {
  Area,
  DataQualityRule,
  Dimension,
  Hit,
  QCandidate,
  Remediation,
  RuleContext,
  Severity,
} from './types';

/**
 * The data-quality rule catalogue (STEP 08). Codes are stable (ADR-0018): `DQ-<AREA>-NNN` is never reused
 * for a different meaning; a substantial semantic change bumps `version` and is written in
 * docs/step08/DATA_QUALITY_RULES.md. A rule only DETECTS: it never defaults, infers or writes.
 */

const hit = (
  candidate: QCandidate | null,
  subject: string,
  message: string,
  evidence: Record<string, unknown> = {},
): Hit => ({ candidate, subject, message, evidence });

type Base = Omit<DataQualityRule, 'version' | 'evaluate' | 'decisionTopics'> & {
  decisionTopics?: readonly string[];
};
const rule = (base: Base, evaluate: (ctx: RuleContext) => Hit[], version = 1): DataQualityRule => ({
  decisionTopics: [],
  version,
  ...base,
  evaluate,
});

/** A rule that fires while a resolution field of a candidate kind is still open (src/import unresolvedFields). */
function openField(spec: {
  code: string;
  kind: CandidateKind;
  field: string;
  area: Area;
  title: string;
  description: string;
  remediation: Remediation;
  bulk?: boolean;
  topics?: readonly string[];
  severity?: Severity;
  dimension?: Dimension;
}): DataQualityRule {
  return rule(
    {
      code: spec.code,
      scope: spec.kind,
      area: spec.area,
      dimension: spec.dimension ?? 'REVIEW',
      severity: spec.severity ?? 'BLOCKER',
      title: spec.title,
      description: spec.description,
      remediation: spec.remediation,
      decisionTopics: spec.topics ?? [],
      ...(spec.bulk ? { bulk: { kind: spec.kind, field: spec.field } } : {}),
    },
    (ctx) =>
      ctx
        .byKind(spec.kind)
        .filter((c) => ctx.openFields(c).includes(spec.field))
        .map((c) => hit(c, spec.field, `${spec.field} sin resolver`, { field: spec.field })),
  );
}

const items = (ctx: RuleContext) => ctx.byKind('CATALOG_ITEM');

// ------------------------------------------------------------------ catalog items

const CATALOG: DataQualityRule[] = [
  openField({
    code: 'DQ-CATALOG-001',
    kind: 'CATALOG_ITEM',
    field: 'itemType',
    area: 'CATALOG_ITEM',
    title: 'Producto/Servicio sin resolver',
    description:
      'La columna Clase está vacía o sin mapear: PRODUCT o SERVICE debe decidirse explícitamente.',
    remediation: 'BULK_RESOLVABLE',
    bulk: true,
    topics: ['D-003'],
  }),
  openField({
    code: 'DQ-CATALOG-002',
    kind: 'CATALOG_ITEM',
    field: 'status',
    area: 'CATALOG_ITEM',
    title: 'Estado de catálogo sin resolver',
    description:
      'Sin CatalogStatus un item nunca se ofrece ni se publica. Nunca se asigna por defecto.',
    remediation: 'BULK_RESOLVABLE',
    bulk: true,
    topics: ['D-001'],
  }),
  openField({
    code: 'DQ-CATALOG-005',
    kind: 'CATALOG_ITEM',
    field: 'decorationPolicy',
    area: 'CATALOG_ITEM',
    title: 'Política de decoración sin resolver',
    description: 'El Excel nunca dice NONE/OPTIONAL/REQUIRED: siempre es una decisión.',
    remediation: 'BULK_RESOLVABLE',
    bulk: true,
  }),
  openField({
    code: 'DQ-CATALOG-006',
    kind: 'CATALOG_ITEM',
    field: 'customerSuppliedItem',
    area: 'CATALOG_ITEM',
    title: 'Material del cliente sin resolver (servicio)',
    description:
      '“Acepta material del cliente = Sí” no distingue ALLOWED de REQUIRED. Sólo aplica a SERVICE.',
    remediation: 'BULK_RESOLVABLE',
    bulk: true,
    topics: ['D-013'],
  }),
  rule(
    {
      code: 'DQ-CATALOG-003',
      scope: 'CATALOG_ITEM',
      area: 'CATALOG_ITEM',
      dimension: 'DOMAIN',
      severity: 'BLOCKER',
      title: 'Unidad de venta ausente',
      description:
        'Sin unidad de venta no hay precio automático. “Sin unidad” (null) es una decisión explícita; no se inventan unidades.',
      remediation: 'BULK_RESOLVABLE',
      bulk: { kind: 'CATALOG_ITEM', field: 'saleUnit' },
      decisionTopics: ['D-002'],
    },
    (ctx) =>
      items(ctx)
        .filter((c) => ctx.effective(c, 'saleUnit') === undefined)
        .map((c) => hit(c, 'saleUnit', 'unidad de venta no definida', { saleUnit: null })),
  ),
  rule(
    {
      code: 'DQ-CATALOG-004',
      scope: 'CATALOG_ITEM',
      area: 'CATEGORY',
      dimension: 'DOMAIN',
      severity: 'WARNING',
      title: 'Categoría sin mapear',
      description:
        'La categoría del Excel es sólo evidencia: nunca se asigna sola. Se resuelve con una categoría existente de Product Engine.',
      remediation: 'BULK_RESOLVABLE',
      bulk: { kind: 'CATALOG_ITEM', field: 'categoryKey' },
      decisionTopics: ['D-009'],
    },
    (ctx) => {
      const mapped = new Map(
        ctx.input.categoryMappings.map((m) => [m.sourceCategory, m.categoryKey]),
      );
      return items(ctx)
        .filter((c) => ctx.effective(c, 'categoryKey') === undefined)
        .map((c) => {
          const src = c.proposal.kind === 'CATALOG_ITEM' ? c.proposal.categoryLegacy : null;
          return hit(
            c,
            'categoryKey',
            src ? 'categoría de origen sin mapear' : 'sin categoría de origen',
            {
              sourceCategory: src,
              recordedMapping: src ? (mapped.get(src) ?? null) : null,
            },
          );
        });
    },
  ),
  rule(
    {
      code: 'DQ-CATALOG-009',
      scope: 'CATALOG_ITEM',
      area: 'CATEGORY',
      dimension: 'DOMAIN',
      severity: 'BLOCKER',
      title: 'Categoría resuelta inexistente',
      description: 'El borrador apunta a una categoría que no existe en el dominio.',
      remediation: 'MANUAL_REVIEW',
    },
    (ctx) => {
      const known = new Set(ctx.input.categoryKeys);
      return items(ctx)
        .filter((c) => {
          const k = ctx.effective(c, 'categoryKey');
          return typeof k === 'string' && !known.has(k);
        })
        .map((c) =>
          hit(c, 'categoryKey', 'categoría inexistente', {
            categoryKey: ctx.effective(c, 'categoryKey'),
          }),
        );
    },
  ),
  rule(
    {
      code: 'DQ-CATALOG-007',
      scope: 'CATALOG_ITEM',
      area: 'CATALOG_ITEM',
      dimension: 'DOMAIN',
      severity: 'WARNING',
      title: 'Posible duplicado',
      description:
        'El importador señaló dos items que podrían ser el mismo. Se revisa lado a lado; nunca se fusiona. DISTINCT lo silencia, REVIEWED lo baja a INFO.',
      remediation: 'MANUAL_REVIEW',
    },
    (ctx) => {
      const marks = new Map(ctx.input.duplicateMarks.map((m) => [m.pairKey, m.mark]));
      const out: Hit[] = [];
      for (const sig of ctx.input.duplicateSignals) {
        if (sig.kind !== 'PROBABLE_DUPLICATE') continue;
        const key = ctx.pairKey(sig.legacyIds[0], sig.legacyIds[1]);
        const mark = marks.get(key);
        if (mark === 'DISTINCT') continue;
        for (const legacy of sig.legacyIds) {
          const c = ctx.itemByLegacy(legacy);
          if (!c || c.reviewStatus === 'REJECTED') continue;
          out.push(
            hit(c, key, 'posible duplicado', {
              pair: sig.legacyIds,
              signals: sig.signals,
              mark: mark ?? null,
              reviewed: mark === 'REVIEWED',
            }),
          );
        }
      }
      return out;
    },
  ),
];

// ------------------------------------------------------------------ provenance & import

const PROVENANCE: DataQualityRule[] = [
  rule(
    {
      code: 'DQ-PROV-001',
      scope: 'PROVENANCE',
      area: 'PROVENANCE',
      dimension: 'REVIEW',
      severity: 'BLOCKER',
      title: 'Candidate sin registro fuente',
      description:
        'La cadena candidate → record → workbook está rota: no hay registro que respalde al candidate.',
      remediation: 'SOURCE_FIX',
    },
    (ctx) =>
      ctx.candidates
        .filter((c) => c.provenance.records === 0)
        .map((c) => hit(c, 'records', 'sin registros fuente', { records: 0 })),
  ),
  rule(
    {
      code: 'DQ-PROV-002',
      scope: 'PROVENANCE',
      area: 'PROVENANCE',
      dimension: 'REVIEW',
      severity: 'BLOCKER',
      title: 'Registro sin hoja/fila/celda',
      description: 'Un registro fuente no puede rastrearse a hoja, fila y celda del workbook.',
      remediation: 'SOURCE_FIX',
    },
    (ctx) =>
      ctx.candidates
        .filter(
          (c) => c.provenance.records > 0 && c.provenance.recordsWithCell < c.provenance.records,
        )
        .map((c) =>
          hit(c, 'cells', 'registro sin celda de origen', {
            records: c.provenance.records,
            recordsWithCell: c.provenance.recordsWithCell,
          }),
        ),
  ),
  rule(
    {
      code: 'DQ-PROV-003',
      scope: 'DOMAIN',
      area: 'PROVENANCE',
      dimension: 'DOMAIN',
      severity: 'WARNING',
      title: 'Objeto de dominio sin rastro',
      description:
        'Un artículo del dominio no tiene evidencia de origen ni evento de auditoría con actor. Lo creado a mano debe tener al menos el actor.',
      remediation: 'MANUAL_REVIEW',
    },
    (ctx) =>
      ctx.input.domainItems
        .filter((i) => !i.traceable)
        .map((i) => ({
          candidate: null,
          subject: i.id,
          message: 'artículo sin evidencia de origen ni auditoría',
          evidence: { itemId: i.id, publicCode: i.publicCode },
          itemLegacyId: i.legacyId,
          itemName: i.publicCode,
        })),
  ),
  rule(
    {
      code: 'DQ-IMPORT-001',
      scope: 'PROVENANCE',
      area: 'IMPORT',
      dimension: 'REVIEW',
      severity: 'BLOCKER',
      title: 'Candidate bloqueado por el importador',
      description:
        'El candidate nunca podrá aprobarse sin corregir la fuente (modelo no soportado, importe inválido, bundle, etc.). Las razones ya cubiertas por reglas específicas no se repiten.',
      remediation: 'SOURCE_FIX',
    },
    (ctx) => {
      const COVERED = new Set([
        'REFERENCE_MISSING',
        'PRICE_CURRENCY_UNKNOWN',
        'PRICE_QUANTITY_NOT_EXACT',
        'PRESENTATION_WITHOUT_NAME',
      ]);
      const out: Hit[] = [];
      for (const c of ctx.candidates)
        for (const r of c.blockingReasons)
          if (!COVERED.has(r)) out.push(hit(c, r, `bloqueo del importador: ${r}`, { reason: r }));
      return out;
    },
  ),
];

// ------------------------------------------------------------------ options

const options = (ctx: RuleContext) =>
  ctx.byKind('OPTION').flatMap((c) => (c.proposal.kind === 'OPTION' ? [{ c, p: c.proposal }] : []));

type DefinitionDraft =
  | { mode: 'EXISTING'; key: string }
  | {
      mode: 'CREATE';
      key: string;
      label: string;
      valueKind: string;
      unit: string | null;
      scope: string;
    };
const definitionOf = (c: QCandidate): DefinitionDraft | null => {
  const d = c.resolution?.definition;
  return d && typeof d === 'object' ? (d as DefinitionDraft) : null;
};

const OPTION: DataQualityRule[] = [
  openField({
    code: 'DQ-OPTION-001',
    kind: 'OPTION',
    field: 'isRequired',
    area: 'OPTION',
    title: 'Opción obligatoria sin resolver',
    description: 'La columna Obligatoria vacía queda sin resolver: nunca se asume “no”.',
    remediation: 'BULK_RESOLVABLE',
    bulk: true,
    topics: ['D-004'],
  }),
  rule(
    {
      code: 'DQ-OPTION-002',
      scope: 'OPTION',
      area: 'OPTION',
      dimension: 'REVIEW',
      severity: 'BLOCKER',
      title: 'Definición de opción sin resolver / nombre genérico',
      description:
        'Una definición por significado (tamano_papel ≠ tamano_display). Los nombres genéricos (color, tamano, acabado, modelo) exigen mapeo explícito.',
      remediation: 'MANUAL_REVIEW',
      decisionTopics: ['D-005'],
    },
    (ctx) =>
      options(ctx)
        .filter(({ c }) => ctx.openFields(c).includes('definition'))
        .map(({ c, p }) =>
          hit(c, 'definition', 'definición sin resolver', {
            name: p.name,
            genericNameIssue: c.issueCodes.includes('IMPORT_UNMAPPED_OPTION'),
          }),
        ),
  ),
  openField({
    code: 'DQ-OPTION-003',
    kind: 'OPTION',
    field: 'selectionMode',
    area: 'OPTION',
    title: 'Modo de selección sin resolver',
    description: 'SINGLE o MULTI: el Excel no lo dice.',
    remediation: 'BULK_RESOLVABLE',
    bulk: true,
    topics: ['D-004'],
  }),
  openField({
    code: 'DQ-OPTION-004',
    kind: 'OPTION',
    field: 'isDistributable',
    area: 'OPTION',
    title: 'Distribuible sin resolver',
    description: 'Si la opción puede variar entre renglones de una cantidad. Sólo SINGLE + ENUM.',
    remediation: 'BULK_RESOLVABLE',
    bulk: true,
    topics: ['D-007'],
  }),
  openField({
    code: 'DQ-OPTION-005',
    kind: 'OPTION',
    field: 'values',
    area: 'OPTION',
    title: 'Valores de opción sin mapear',
    description:
      'Cada valor del Excel debe usar un valor existente, crear uno o excluirse con motivo.',
    remediation: 'MANUAL_REVIEW',
    topics: ['D-005'],
  }),
  rule(
    {
      code: 'DQ-OPTION-006',
      scope: 'OPTION',
      area: 'OPTION',
      dimension: 'DOMAIN',
      severity: 'BLOCKER',
      title: 'OptionDefinition duplicada o en conflicto',
      description:
        'Dos candidates crean la misma clave con significado distinto, o una “nueva” definición ya existe en el dominio (hay que usar EXISTING).',
      remediation: 'MANUAL_REVIEW',
    },
    (ctx) => {
      const out: Hit[] = [];
      const existing = new Set(ctx.input.optionDefinitionKeys);
      const creators = new Map<
        string,
        { c: QCandidate; d: DefinitionDraft & { mode: 'CREATE' } }[]
      >();
      for (const { c } of options(ctx)) {
        const d = definitionOf(c);
        if (d?.mode !== 'CREATE') continue;
        if (existing.has(d.key))
          out.push(
            hit(c, `exists:${d.key}`, 'la definición ya existe en el dominio', { key: d.key }),
          );
        const list = creators.get(d.key) ?? [];
        list.push({ c, d });
        creators.set(d.key, list);
      }
      for (const [key, list] of [...creators].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
        const shapes = new Set(list.map((x) => `${x.d.valueKind}|${x.d.scope}|${x.d.unit}`));
        if (shapes.size > 1)
          for (const { c } of list)
            out.push(
              hit(c, `conflict:${key}`, 'la misma clave se crea con significados distintos', {
                key,
                shapes: [...shapes].sort(),
              }),
            );
      }
      return out;
    },
  ),
  rule(
    {
      code: 'DQ-OPTION-007',
      scope: 'OPTION',
      area: 'OPTION',
      dimension: 'DOMAIN',
      severity: 'WARNING',
      title: 'Opción duplicada en el mismo item',
      description: 'Dos candidates de opción del mismo item con el mismo nombre normalizado.',
      remediation: 'MANUAL_REVIEW',
    },
    (ctx) => {
      const groups = new Map<string, QCandidate[]>();
      for (const { c, p } of options(ctx)) {
        const k = `${p.itemLegacyId}|${normalizeText(p.name)}`;
        if (!normalizeText(p.name)) continue;
        groups.set(k, [...(groups.get(k) ?? []), c]);
      }
      return [...groups]
        .filter(([, list]) => list.length > 1)
        .flatMap(([k, list]) =>
          list.map((c) => hit(c, k, 'opción repetida en el item', { count: list.length })),
        );
    },
  ),
  rule(
    {
      code: 'DQ-OPTION-008',
      scope: 'OPTION',
      area: 'OPTION',
      dimension: 'DOMAIN',
      severity: 'WARNING',
      title: 'Valores de opción repetidos (origen)',
      description:
        'Dos valores del Excel de una misma opción tienen la misma etiqueta normalizada.',
      remediation: 'MANUAL_REVIEW',
    },
    (ctx) =>
      options(ctx).flatMap(({ c, p }) => {
        const seen = new Map<string, number>();
        for (const v of p.values) {
          const k = normalizeText(v.label);
          if (k) seen.set(k, (seen.get(k) ?? 0) + 1);
        }
        const dups = [...seen].filter(([, n]) => n > 1).map(([k]) => k);
        return dups.length
          ? [hit(c, 'labels', 'etiquetas repetidas', { labels: dups.sort() })]
          : [];
      }),
  ),
  rule(
    {
      code: 'DQ-OPTION-009',
      scope: 'OPTION',
      area: 'OPTION',
      dimension: 'DOMAIN',
      severity: 'BLOCKER',
      title: 'Valores de opción resueltos duplicados',
      description: 'Dos valores del Excel se resolvieron al mismo código de OptionValue.',
      remediation: 'MANUAL_REVIEW',
    },
    (ctx) =>
      options(ctx).flatMap(({ c }) => {
        const values = c.resolution?.values;
        if (!values || typeof values !== 'object') return [];
        const codes = new Map<string, number>();
        for (const v of Object.values(values as Record<string, { mode: string; code?: string }>))
          if (v.mode !== 'EXCLUDE' && v.code) codes.set(v.code, (codes.get(v.code) ?? 0) + 1);
        const dups = [...codes].filter(([, n]) => n > 1).map(([k]) => k);
        return dups.length
          ? [hit(c, 'codes', 'código de valor repetido', { codes: dups.sort() })]
          : [];
      }),
  ),
  rule(
    {
      code: 'DQ-OPTION-010',
      scope: 'OPTION',
      area: 'OPTION',
      dimension: 'DOMAIN',
      severity: 'BLOCKER',
      title: 'Valores incompatibles con el tipo de opción',
      description:
        'La forma del valor (ancho×alto, cantidad, longitud, texto) no corresponde al tipo de la definición elegida o la definición EXISTING no existe.',
      remediation: 'MANUAL_REVIEW',
    },
    (ctx) => {
      const existing = new Set(ctx.input.optionDefinitionKeys);
      const out: Hit[] = [];
      for (const { c } of options(ctx)) {
        const d = definitionOf(c);
        if (!d) continue;
        if (d.mode === 'EXISTING' && !existing.has(d.key)) {
          out.push(hit(c, `unknown:${d.key}`, 'definición existente desconocida', { key: d.key }));
          continue;
        }
        if (d.mode !== 'CREATE') continue;
        const values = (c.resolution?.values ?? {}) as Record<
          string,
          { mode: string; spec?: Record<string, number> | null }
        >;
        for (const [k, v] of Object.entries(values).sort()) {
          if (v.mode !== 'CREATE') continue;
          const spec = v.spec ?? null;
          const ok =
            d.valueKind === 'DIMENSIONS'
              ? spec !== null && 'w' in spec && 'h' in spec
              : d.valueKind === 'QUANTITY' || d.valueKind === 'LENGTH'
                ? spec !== null && 'value' in spec
                : spec === null;
          if (!ok)
            out.push(
              hit(c, `spec:${k}`, `el valor no cabe en una opción ${d.valueKind}`, {
                valueKind: d.valueKind,
                recordKey: k,
              }),
            );
        }
      }
      return out;
    },
  ),
];

// ------------------------------------------------------------------ decoration

const decorations = (ctx: RuleContext) =>
  ctx
    .byKind('DECORATION')
    .flatMap((c) => (c.proposal.kind === 'DECORATION' ? [{ c, p: c.proposal }] : []));

const DECORATION: DataQualityRule[] = [
  openField({
    code: 'DQ-DECOR-001',
    kind: 'DECORATION',
    field: 'methodKey',
    area: 'DECORATION',
    title: 'Método de decoración sin clasificar',
    description:
      'Una asociación de proceso de producción no prueba que sea una decoración elegible por el cliente: debe confirmarse el método (o excluirse).',
    remediation: 'BULK_RESOLVABLE',
    bulk: true,
    topics: ['D-006'],
  }),
  rule(
    {
      code: 'DQ-DECOR-002',
      scope: 'DECORATION',
      area: 'DECORATION',
      dimension: 'DOMAIN',
      severity: 'BLOCKER',
      title: 'Método de decoración desconocido',
      description: 'El methodKey resuelto no existe en los métodos del dominio.',
      remediation: 'MANUAL_REVIEW',
    },
    (ctx) => {
      const known = new Set(ctx.input.decorationMethodKeys);
      return decorations(ctx)
        .filter(({ c }) => {
          const k = ctx.effective(c, 'methodKey');
          return typeof k === 'string' && !known.has(k);
        })
        .map(({ c }) =>
          hit(c, 'methodKey', 'método inexistente', { methodKey: ctx.effective(c, 'methodKey') }),
        );
    },
  ),
  rule(
    {
      code: 'DQ-DECOR-003',
      scope: 'DECORATION',
      area: 'DECORATION',
      dimension: 'DOMAIN',
      severity: 'BLOCKER',
      title: 'Decoración sin item válido',
      description:
        'La asociación apunta a un item que no existe entre los candidates o fue rechazado.',
      remediation: 'SOURCE_FIX',
    },
    (ctx) =>
      decorations(ctx)
        .filter(({ c, p }) => {
          const item = ctx.itemByLegacy(p.itemLegacyId);
          return !item || item.reviewStatus === 'REJECTED' || c.id === item.id;
        })
        .map(({ c, p }) =>
          hit(c, 'item', 'item inexistente o rechazado', { itemLegacyId: p.itemLegacyId }),
        ),
  ),
  rule(
    {
      code: 'DQ-DECOR-004',
      scope: 'DECORATION',
      area: 'DECORATION',
      dimension: 'DOMAIN',
      severity: 'WARNING',
      title: 'Asociación de decoración duplicada',
      description: 'Mismo item y mismo método más de una vez.',
      remediation: 'MANUAL_REVIEW',
    },
    (ctx) => {
      const groups = new Map<string, QCandidate[]>();
      for (const { c, p } of decorations(ctx)) {
        if (p.subtype !== 'METHOD_ASSOCIATION') continue;
        const method = (ctx.effective(c, 'methodKey') as string | undefined) ?? p.methodLegacyId;
        if (!method) continue;
        const k = `${p.itemLegacyId}|${method}`;
        groups.set(k, [...(groups.get(k) ?? []), c]);
      }
      return [...groups]
        .filter(([, l]) => l.length > 1)
        .flatMap(([k, l]) => l.map((c) => hit(c, k, 'asociación repetida', { count: l.length })));
    },
  ),
];

// ------------------------------------------------------------------ composition

const compositions = (ctx: RuleContext) =>
  ctx
    .byKind('COMPOSITION')
    .flatMap((c) => (c.proposal.kind === 'COMPOSITION' ? [{ c, p: c.proposal }] : []));

const childOf = (ctx: RuleContext, c: QCandidate): string | null => {
  const p = c.proposal;
  if (p.kind !== 'COMPOSITION') return null;
  if (p.subtype === 'RELATION') return p.childLegacyId;
  const r = c.resolution?.childLegacyId;
  return typeof r === 'string' ? r : null;
};

const COMPOSITION: DataQualityRule[] = [
  rule(
    {
      code: 'DQ-COMP-001',
      scope: 'COMPOSITION',
      area: 'COMPOSITION',
      dimension: 'DOMAIN',
      severity: 'BLOCKER',
      title: 'Composición sin padre o sin hijo',
      description: 'Falta uno de los dos extremos de la relación.',
      remediation: 'MANUAL_REVIEW',
    },
    (ctx) =>
      compositions(ctx)
        .filter(({ c, p }) => !childOf(ctx, c) || (p.subtype === 'RELATION' && !p.parentLegacyId))
        .map(({ c, p }) =>
          hit(c, 'ends', 'falta padre o hijo', {
            parent: p.subtype === 'RELATION' ? p.parentLegacyId : p.itemLegacyId,
            child: childOf(ctx, c),
          }),
        ),
  ),
  rule(
    {
      code: 'DQ-COMP-002',
      scope: 'COMPOSITION',
      area: 'COMPOSITION',
      dimension: 'DOMAIN',
      severity: 'BLOCKER',
      title: 'Hijo de composición aún no utilizable',
      description:
        'El item hijo no existe entre los candidates o fue rechazado/bloqueado por el importador.',
      remediation: 'MANUAL_REVIEW',
    },
    (ctx) =>
      compositions(ctx).flatMap(({ c }) => {
        const child = childOf(ctx, c);
        if (!child) return [];
        const item = ctx.itemByLegacy(child);
        const unusable =
          !item || item.reviewStatus === 'REJECTED' || item.blockingReasons.length > 0;
        return unusable
          ? [hit(c, `child:${child}`, 'hijo inexistente o no utilizable', { child })]
          : [];
      }),
  ),
  rule(
    {
      code: 'DQ-COMP-003',
      scope: 'COMPOSITION',
      area: 'COMPOSITION',
      dimension: 'DOMAIN',
      severity: 'BLOCKER',
      title: 'Relación circular',
      description: 'La cadena padre → hijo vuelve al mismo item.',
      remediation: 'SOURCE_FIX',
    },
    (ctx) => {
      const edges = new Map<string, string[]>();
      const rows = compositions(ctx).flatMap(({ c, p }) => {
        const parent = p.subtype === 'RELATION' ? p.parentLegacyId : p.itemLegacyId;
        const child = childOf(ctx, c);
        return parent && child ? [{ c, parent, child }] : [];
      });
      for (const r of rows) edges.set(r.parent, [...(edges.get(r.parent) ?? []), r.child]);
      const reaches = (from: string, target: string): boolean => {
        const seen = new Set<string>();
        const stack = [from];
        while (stack.length) {
          const n = stack.pop()!;
          if (n === target) return true;
          if (seen.has(n)) continue;
          seen.add(n);
          stack.push(...(edges.get(n) ?? []));
        }
        return false;
      };
      return rows
        .filter((r) => r.parent === r.child || reaches(r.child, r.parent))
        .map((r) => hit(r.c, `cycle:${r.parent}>${r.child}`, 'ciclo en la composición', r));
    },
  ),
  rule(
    {
      code: 'DQ-COMP-004',
      scope: 'COMPOSITION',
      area: 'COMPOSITION',
      dimension: 'REVIEW',
      severity: 'BLOCKER',
      title: 'Cantidad de composición ausente o inválida',
      description:
        'La cantidad del hijo por unidad del padre debe ser un entero positivo y explícito.',
      remediation: 'MANUAL_REVIEW',
    },
    (ctx) =>
      compositions(ctx)
        .filter(({ c }) => {
          const q = ctx.effective(c, 'quantity');
          return (
            ctx.openFields(c).includes('quantity') ||
            (q !== undefined && !(Number.isInteger(q) && (q as number) > 0))
          );
        })
        .map(({ c }) =>
          hit(c, 'quantity', 'cantidad sin resolver o inválida', {
            quantity: ctx.effective(c, 'quantity') ?? null,
          }),
        ),
  ),
  openField({
    code: 'DQ-COMP-005',
    kind: 'COMPOSITION',
    field: 'role',
    area: 'COMPOSITION',
    title: 'Incluido/Opcional sin resolver',
    description: 'INCLUDED u OPTIONAL: el Excel no lo dice.',
    remediation: 'MANUAL_REVIEW',
  }),
];

// ------------------------------------------------------------------ presentations

const presentations = (ctx: RuleContext) =>
  ctx
    .byKind('PRESENTATION')
    .flatMap((c) => (c.proposal.kind === 'PRESENTATION' ? [{ c, p: c.proposal }] : []));

const PRESENTATION: DataQualityRule[] = [
  openField({
    code: 'DQ-PRES-001',
    kind: 'PRESENTATION',
    field: 'locale',
    area: 'PRESENTATION',
    title: 'Presentación sin idioma',
    description: 'El Excel no dice es/en: la presentación queda sin mapear.',
    remediation: 'BULK_RESOLVABLE',
    bulk: true,
  }),
  openField({
    code: 'DQ-PRES-002',
    kind: 'PRESENTATION',
    field: 'isDefault',
    area: 'PRESENTATION',
    title: 'Presentación default sin resolver',
    description: 'A lo sumo una default por item e idioma; debe elegirse.',
    remediation: 'BULK_RESOLVABLE',
    bulk: true,
  }),
  rule(
    {
      code: 'DQ-PRES-003',
      scope: 'PRESENTATION',
      area: 'PRESENTATION',
      dimension: 'DOMAIN',
      severity: 'BLOCKER',
      title: 'Presentación sin item',
      description: 'La presentación no apunta a ningún item existente.',
      remediation: 'SOURCE_FIX',
    },
    (ctx) =>
      presentations(ctx)
        .filter(({ p }) => {
          const item = ctx.itemByLegacy(p.itemLegacyId);
          return !item || item.reviewStatus === 'REJECTED';
        })
        .map(({ c, p }) => hit(c, 'item', 'item inexistente', { itemLegacyId: p.itemLegacyId })),
  ),
  rule(
    {
      code: 'DQ-PRES-004',
      scope: 'PRESENTATION',
      area: 'PRESENTATION',
      dimension: 'DOMAIN',
      severity: 'WARNING',
      title: 'Presentaciones duplicadas',
      description: 'Mismo item, mismo nombre visible e idioma efectivo.',
      remediation: 'MANUAL_REVIEW',
    },
    (ctx) => {
      const groups = new Map<string, QCandidate[]>();
      for (const { c, p } of presentations(ctx)) {
        const name = normalizeText(
          (ctx.effective(c, 'displayName') as string | undefined) ?? p.displayName,
        );
        if (!p.itemLegacyId || !name) continue;
        const k = `${p.itemLegacyId}|${name}|${String(ctx.effective(c, 'locale') ?? '?')}`;
        groups.set(k, [...(groups.get(k) ?? []), c]);
      }
      return [...groups]
        .filter(([, l]) => l.length > 1)
        .flatMap(([k, l]) => l.map((c) => hit(c, k, 'presentación repetida', { count: l.length })));
    },
  ),
  rule(
    {
      code: 'DQ-PRES-005',
      scope: 'PRESENTATION',
      area: 'PRESENTATION',
      dimension: 'DOMAIN',
      severity: 'BLOCKER',
      title: 'Más de una presentación default',
      description: 'Dos presentaciones marcadas default para el mismo item e idioma.',
      remediation: 'MANUAL_REVIEW',
    },
    (ctx) => {
      const groups = new Map<string, QCandidate[]>();
      for (const { c, p } of presentations(ctx)) {
        if (ctx.effective(c, 'isDefault') !== true || !p.itemLegacyId) continue;
        const k = `${p.itemLegacyId}|${String(ctx.effective(c, 'locale') ?? '?')}`;
        groups.set(k, [...(groups.get(k) ?? []), c]);
      }
      return [...groups]
        .filter(([, l]) => l.length > 1)
        .flatMap(([k, l]) => l.map((c) => hit(c, k, 'varias default', { count: l.length })));
    },
  ),
];

// ------------------------------------------------------------------ pricing (consumes STEP 07, rebuilds nothing)

const prices = (ctx: RuleContext) =>
  ctx.byKind('PRICE').flatMap((c) => (c.proposal.kind === 'PRICE' ? [{ c, p: c.proposal }] : []));

const defsByLegacy = (ctx: RuleContext) => {
  const m = new Map<string, typeof ctx.input.domainDefinitions>();
  for (const d of ctx.input.domainDefinitions)
    if (d.legacyId) m.set(d.legacyId, [...(m.get(d.legacyId) ?? []), d]);
  return m;
};

const hasPriceEvidenceOrDefinition = (ctx: RuleContext) => {
  const set = new Set<string>();
  for (const { p } of prices(ctx)) set.add(p.itemLegacyId);
  for (const d of ctx.input.domainDefinitions) if (d.legacyId) set.add(d.legacyId);
  return set;
};

/** An owner-decision gate: fires on the affected catalog items while the decision has no recorded answer. */
function decisionGate(spec: {
  code: string;
  decision: string;
  title: string;
  description: string;
  severity?: Severity;
  only?: (ctx: RuleContext) => Set<string> | null;
}): DataQualityRule {
  return rule(
    {
      code: spec.code,
      scope: 'PRICING',
      area: 'PRICING',
      dimension: 'PRICING',
      severity: spec.severity ?? 'BLOCKER',
      title: spec.title,
      description: spec.description,
      remediation: 'OWNER_DECISION_REQUIRED',
      decisionTopics: [spec.decision],
    },
    (ctx) => {
      const only = spec.only?.(ctx) ?? null;
      return items(ctx)
        .filter(
          (c) =>
            c.proposal.kind === 'CATALOG_ITEM' &&
            ctx.decisionAffects(spec.decision, c.proposal.legacyId) &&
            ctx.decisionOpen(spec.decision, c.proposal.legacyId) &&
            (only === null || only.has(c.proposal.legacyId)),
        )
        .map((c) => hit(c, spec.decision, `${spec.decision} abierta`, { decision: spec.decision }));
    },
  );
}

const PRICING: DataQualityRule[] = [
  rule(
    {
      code: 'DQ-PRICE-001',
      scope: 'PRICING',
      area: 'PRICING',
      dimension: 'PRICING',
      severity: 'WARNING',
      title: 'Evidencia de precio sin PriceDefinition',
      description:
        'El Excel trae precio actual pero no existe ninguna PriceDefinition del dominio. Es el estado esperado antes de migrar; se crea un BORRADOR con el editor de STEP 07 (nunca se autoriza solo).',
      remediation: 'MANUAL_REVIEW',
    },
    (ctx) => {
      const defs = defsByLegacy(ctx);
      return prices(ctx)
        .filter(({ p }) => !defs.has(p.itemLegacyId))
        .map(({ c, p }) =>
          hit(c, 'definition', 'hay evidencia pero no PriceDefinition', {
            model: p.model,
            currency: p.currency,
            observations: p.observations.length,
          }),
        );
    },
  ),
  rule(
    {
      code: 'DQ-PRICE-002',
      scope: 'PRICING',
      area: 'PRICING',
      dimension: 'PRICING',
      severity: 'WARNING',
      title: 'PriceDefinition aún en DRAFT',
      description: 'El precio existe pero nadie lo ha autorizado (STEP 07 lifecycle).',
      remediation: 'MANUAL_REVIEW',
    },
    (ctx) =>
      ctx.input.domainDefinitions
        .filter((d) => d.status === 'DRAFT')
        .map((d) => ({
          candidate: null,
          subject: d.id,
          message: 'definición en DRAFT',
          evidence: { definitionId: d.id, model: d.model, currency: d.currency },
          itemLegacyId: d.legacyId,
          itemName: d.legacyId,
        })),
  ),
  rule(
    {
      code: 'DQ-PRICE-003',
      scope: 'CATALOG_ITEM',
      area: 'PRICING',
      dimension: 'PRICING',
      severity: 'BLOCKER',
      title: 'Item con precio pero sin unidad de venta',
      description: 'No puede haber precio automático sin unidad de venta (ni se inventa una).',
      remediation: 'BULK_RESOLVABLE',
      bulk: { kind: 'CATALOG_ITEM', field: 'saleUnit' },
      decisionTopics: ['D-002'],
    },
    (ctx) => {
      const withPrice = hasPriceEvidenceOrDefinition(ctx);
      return items(ctx)
        .filter(
          (c) =>
            c.proposal.kind === 'CATALOG_ITEM' &&
            withPrice.has(c.proposal.legacyId) &&
            ctx.effective(c, 'saleUnit') === undefined,
        )
        .map((c) => hit(c, 'saleUnit', 'tiene precio pero no unidad de venta', {}));
    },
  ),
  rule(
    {
      code: 'DQ-PRICE-004',
      scope: 'PRICING',
      area: 'PRICING',
      dimension: 'PRICING',
      severity: 'BLOCKER',
      title: 'Precio sin moneda',
      description: 'La moneda del precio no se pudo determinar de la fuente.',
      remediation: 'SOURCE_FIX',
    },
    (ctx) =>
      prices(ctx)
        .filter(
          ({ c, p }) => p.currency === null || c.blockingReasons.includes('PRICE_CURRENCY_UNKNOWN'),
        )
        .map(({ c }) => hit(c, 'currency', 'moneda desconocida', {})),
  ),
  rule(
    {
      code: 'DQ-PRICE-005',
      scope: 'PRICING',
      area: 'PRICING',
      dimension: 'PRICING',
      severity: 'BLOCKER',
      title: 'Semántica de cantidad/base sin resolver',
      description:
        'El precio no dice a qué cantidad exacta aplica o si el importe es TOTAL o UNIT. No se asume umbral ni cantidad.',
      remediation: 'MANUAL_REVIEW',
      decisionTopics: ['D-010', 'D-011'],
    },
    (ctx) =>
      prices(ctx)
        .filter(
          ({ c }) =>
            ctx.openFields(c).some((f) => f === 'maxQuantity' || f === 'amountBasis') ||
            c.blockingReasons.includes('PRICE_QUANTITY_NOT_EXACT'),
        )
        .map(({ c }) =>
          hit(c, 'quantity', 'cantidad o base sin resolver', {
            open: ctx.openFields(c).filter((f) => f === 'maxQuantity' || f === 'amountBasis'),
          }),
        ),
  ),
  openField({
    code: 'DQ-PRICE-009',
    kind: 'PRICE',
    field: 'validFrom',
    area: 'PRICING',
    title: 'Vigencia del precio sin decidir',
    description: 'validFrom nunca se asume “ahora”: es una decisión explícita.',
    remediation: 'BULK_RESOLVABLE',
    bulk: true,
    dimension: 'PRICING',
  }),
  rule(
    {
      code: 'DQ-PRICE-006',
      scope: 'PRICING',
      area: 'PRICING',
      dimension: 'PRICING',
      severity: 'BLOCKER',
      title: 'Evidencia histórica usada como precio actual',
      description:
        'Un precio histórico (sólo evidencia) alimenta un candidate de precio actual o una definición. Los históricos NO son defectos mientras sean evidencia.',
      remediation: 'SOURCE_FIX',
    },
    (ctx) => {
      const hist = new Set(ctx.input.historicalPriceLegacyIds);
      const out: Hit[] = [];
      for (const { c, p } of prices(ctx)) {
        const bad = p.observations
          .filter((o) => hist.has(o.priceLegacyId))
          .map((o) => o.priceLegacyId);
        if (bad.length)
          out.push(
            hit(c, 'historical', 'observación histórica en precio actual', { priceLegacyIds: bad }),
          );
      }
      for (const d of ctx.input.domainDefinitions)
        if (d.sourceKinds.includes('HISTORICAL_PRICE_EVIDENCE'))
          out.push({
            candidate: null,
            subject: d.id,
            message: 'definición respaldada por evidencia histórica',
            evidence: { definitionId: d.id },
            itemLegacyId: d.legacyId,
            itemName: d.legacyId,
          });
      return out;
    },
  ),
  rule(
    {
      code: 'DQ-PRICE-007',
      scope: 'PRICING',
      area: 'PRICING',
      dimension: 'PRICING',
      severity: 'BLOCKER',
      title: 'Definiciones de precio traslapadas',
      description:
        'Dos definiciones vivas del mismo alcance se traslapan (price_definition_find_clash, STEP 07).',
      remediation: 'MANUAL_REVIEW',
    },
    (ctx) =>
      ctx.input.domainDefinitions
        .filter((d) => d.clashesWith.some((o) => o > d.id))
        .map((d) => ({
          candidate: null,
          subject: d.id,
          message: 'traslape de vigencias',
          evidence: { definitionId: d.id, clashesWith: [...d.clashesWith].sort() },
          itemLegacyId: d.legacyId,
          itemName: d.legacyId,
        })),
  ),
  rule(
    {
      code: 'DQ-PRICE-008',
      scope: 'PRICING',
      area: 'PRICING',
      dimension: 'PRICING',
      severity: 'WARNING',
      title: 'Cantidad esperada sin cobertura',
      description:
        'La evidencia trae cantidades que la matriz AUTORIZADA no cubre: esas cantidades cotizan sólo bajo petición.',
      remediation: 'MANUAL_REVIEW',
    },
    (ctx) => {
      const defs = defsByLegacy(ctx);
      const out: Hit[] = [];
      for (const { c, p } of prices(ctx)) {
        const authorized = (defs.get(p.itemLegacyId) ?? []).filter(
          (d) => d.status === 'AUTHORIZED' && d.model === 'EXACT_QUANTITY_MATRIX',
        );
        if (authorized.length === 0) continue;
        const covered = new Set(authorized.flatMap((d) => d.breakQuantities));
        const missing = [
          ...new Set(
            p.observations
              .map((o) => o.quantity)
              .filter((q): q is number => q !== null && !covered.has(q)),
          ),
        ].sort((a, b) => a - b);
        if (missing.length) out.push(hit(c, 'coverage', 'cantidades sin cobertura', { missing }));
      }
      return out;
    },
  ),
  decisionGate({
    code: 'DQ-PRICE-010',
    decision: 'D-008',
    title: 'D-008 · alcance del recargo por talla',
    description:
      'El recargo 2XL/3XL sólo existe donde ya estaba asignado; extenderlo requiere la decisión del owner.',
  }),
  decisionGate({
    code: 'DQ-PRICE-011',
    decision: 'D-010',
    title: 'D-010 · varios pares de imanes',
    description:
      '1 par tiene precio fijo; varios pares siguen en QUOTE_ONLY hasta que el owner decida.',
  }),
  decisionGate({
    code: 'DQ-PRICE-012',
    decision: 'D-011',
    title: 'D-011 · tarifas de Yard Sign',
    description:
      'Moneda y semántica de cantidad (exacta vs umbral) sin definir; es evidencia, no PriceDefinition.',
  }),
  decisionGate({
    code: 'DQ-PRICE-013',
    decision: 'D-016',
    title: 'D-016 · autoridad para autorizar/publicar precios',
    description:
      'No está definido quién autoriza precios en producción. Sólo existe la capacidad técnica price.authorize (rol local de desarrollo).',
    only: (ctx) => hasPriceEvidenceOrDefinition(ctx),
  }),
  decisionGate({
    code: 'DQ-PRICE-014',
    decision: 'D-022',
    title: 'D-022 · IVA / impuestos México sin resolver',
    description:
      'No se agrega ni se infiere ningún impuesto; la política fiscal de México está abierta.',
  }),
  rule(
    {
      code: 'DQ-PRICE-015',
      scope: 'PRICING',
      area: 'PRICING',
      dimension: 'PRICING',
      severity: 'WARNING',
      title: 'Evidencia de México sin política de mercado',
      description:
        'Hay evidencia de precio de México pero el item no tiene una política de mercado MX definida.',
      remediation: 'MANUAL_REVIEW',
      decisionTopics: ['D-022'],
    },
    (ctx) => {
      const byLegacy = new Map(
        ctx.input.domainItems.filter((i) => i.legacyId).map((i) => [i.legacyId!, i]),
      );
      return prices(ctx)
        .filter(({ p }) => {
          if (p.mexicoEvidence === null) return false;
          const item = byLegacy.get(p.itemLegacyId);
          return !item || !item.marketPolicies.some((m) => m.market === 'MX');
        })
        .map(({ c, p }) =>
          hit(c, 'mx', 'evidencia MX sin política de mercado', {
            mexicoEvidence: p.mexicoEvidence,
          }),
        );
    },
  ),
  rule(
    {
      code: 'DQ-PRICE-016',
      scope: 'PRICING',
      area: 'PRICING',
      dimension: 'PRICING',
      severity: 'INFO',
      title: 'Redondeo HALF_UP_2 provisional (México)',
      description:
        'El precio derivado de México usa HALF_UP_2 como PROVISIONAL TECHNICAL BEHAVIOR, no como política comercial (D-022).',
      remediation: 'OWNER_DECISION_REQUIRED',
      decisionTopics: ['D-022'],
    },
    (ctx) =>
      items(ctx)
        .filter(
          (c) =>
            c.proposal.kind === 'CATALOG_ITEM' &&
            ctx.decisionAffects('D-022', c.proposal.legacyId) &&
            ctx.decisionOpen('D-022', c.proposal.legacyId),
        )
        .map((c) =>
          hit(c, 'half-up-2', 'redondeo provisional', {
            rounding: 'HALF_UP_2',
            label: 'PROVISIONAL TECHNICAL BEHAVIOR',
          }),
        ),
  ),
];

export const RULES: readonly DataQualityRule[] = [
  ...CATALOG,
  ...OPTION,
  ...DECORATION,
  ...COMPOSITION,
  ...PRESENTATION,
  ...PRICING,
  ...PROVENANCE,
].sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));

export const RULES_VERSION = 1;
export const ruleByCode = (code: string) => RULES.find((r) => r.code === code) ?? null;
