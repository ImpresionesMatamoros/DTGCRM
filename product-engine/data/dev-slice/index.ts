import type {
  CatalogItem,
  CatalogStatus,
  DecorationPolicy,
  SaleUnit,
} from '../../src/domain/catalog';
import type { OptionDefinition, OptionValue, OptionValueSpec } from '../../src/domain/options';
import type { PriceCondition, PriceDefinition, PriceRule } from '../../src/domain/pricing-model';
import type { EntityType, SourceReference } from '../../src/domain/provenance';
import { seedId } from '../ids';
import { REF } from '../reference';
import { emptyDataset, type SeedDataset } from '../types';
import authorizedPrices from './authorized-prices.v1_2.json';

/**
 * DEV SLICE (ADR-0013): the 16 items of the STEP 03 vertical slice.
 * Real authorized prices; provisional statuses (P1-01). Not production truth.
 */

const EXCEL = 'Design_To_Go_Catalog_v1.2_RC_MANGO_TANGO.xlsx';
const AUTHORIZED_AT = '2026-09-15T00:00:00Z';
const AUTHORIZED_BY = 'owner — entrevista 2026-09-15';
const CAPTURED_AT = '2026-09-29T00:00:00Z';

export const ITEM_KEYS = [
  'tarjeta_tradicional',
  'tarjeta_premium',
  'flyers',
  'imanes_par',
  'camiseta_algodon',
  'camiseta_dry_fit',
  'gorra',
  'xbanner_completo',
  'xbanner_estructura',
  'xbanner_grafica',
  'yard_sign',
  'estaca_yard_sign',
  'aplicacion_dtf_cliente',
  'dtf_transfer',
  'dtf_gang_sheet',
  'invitacion_evento',
] as const;
export type ItemKey = (typeof ITEM_KEYS)[number];

export const itemId = (k: ItemKey) => seedId(`catalog_item:${k}`);
export const optionDefId = (key: string) => seedId(`option_definition:${key}`);
export const optionValueId = (key: string, code: string) => seedId(`option_value:${key}:${code}`);

interface ItemSpec {
  key: ItemKey;
  kind: 'PRODUCT' | 'SERVICE';
  name: string;
  status: CatalogStatus | null;
  saleUnit: SaleUnit | null;
  decoration: DecorationPolicy;
  legacyIds: string[];
  category: string | null;
  customerSupplied?: 'REQUIRED';
}

// Statuses: v1.2 `Estado_comercial` (Activo/Candidato) or, for 1–4, owner-authorized current price.
const ITEMS: ItemSpec[] = [
  {
    key: 'tarjeta_tradicional',
    kind: 'PRODUCT',
    name: 'Tarjeta de presentación Tradicional',
    status: 'ACTIVE',
    saleUnit: 'PIECE',
    decoration: 'NONE',
    legacyIds: ['MIG1-O-008'],
    category: 'impresos_papel',
  },
  {
    key: 'tarjeta_premium',
    kind: 'PRODUCT',
    name: 'Tarjeta de presentación Premium / Gloss',
    status: 'ACTIVE',
    saleUnit: 'PIECE',
    decoration: 'NONE',
    legacyIds: ['MIG1-O-009'],
    category: 'impresos_papel',
  },
  {
    key: 'flyers',
    kind: 'PRODUCT',
    name: 'Flyers',
    status: 'ACTIVE',
    saleUnit: 'PIECE',
    decoration: 'NONE',
    legacyIds: ['MIG2-O-036'],
    category: 'impresos_papel',
  },
  {
    key: 'imanes_par',
    kind: 'PRODUCT',
    name: 'Imanes para vehículo — par 2 × 1 ft',
    status: 'ACTIVE',
    saleUnit: 'PAIR',
    decoration: 'NONE',
    legacyIds: ['MIGF-O-015'],
    category: 'servicios_especiales',
  },
  {
    key: 'camiseta_algodon',
    kind: 'PRODUCT',
    name: 'Camiseta de algodón cuello redondo',
    status: 'ACTIVE',
    saleUnit: 'PIECE',
    decoration: 'OPTIONAL',
    legacyIds: ['MIG1-O-004'],
    category: 'playeras_textiles',
  },
  {
    key: 'camiseta_dry_fit',
    kind: 'PRODUCT',
    name: 'Camiseta Dry Fit / poliéster',
    status: 'ACTIVE',
    saleUnit: 'PIECE',
    decoration: 'OPTIONAL',
    legacyIds: ['MIG1-O-005'],
    category: 'playeras_textiles',
  },
  {
    key: 'gorra',
    kind: 'PRODUCT',
    name: 'Gorra',
    status: 'ACTIVE',
    saleUnit: 'PIECE',
    decoration: 'OPTIONAL',
    legacyIds: ['MIG2-O-018', 'MIGF-O-004'],
    category: 'gorras_accesorios',
  },
  {
    key: 'xbanner_completo',
    kind: 'PRODUCT',
    name: 'X-Banner completo',
    status: 'ACTIVE',
    saleUnit: 'PIECE',
    decoration: 'NONE',
    legacyIds: ['MIG1-O-003'],
    category: 'banderas_displays',
  },
  {
    key: 'xbanner_estructura',
    kind: 'PRODUCT',
    name: 'Estructura X-Banner',
    status: 'ACTIVE',
    saleUnit: null,
    decoration: 'NONE',
    legacyIds: ['MIG1-O-021'],
    category: 'banderas_displays',
  },
  {
    key: 'xbanner_grafica',
    kind: 'PRODUCT',
    name: 'Gráfica impresa X-Banner',
    status: 'ACTIVE',
    saleUnit: null,
    decoration: 'NONE',
    legacyIds: ['OWN-O-003'],
    category: 'banderas_displays',
  },
  {
    key: 'yard_sign',
    kind: 'PRODUCT',
    name: 'Yard Sign / Realtor Sign 18 × 24 in',
    status: 'ACTIVE',
    saleUnit: 'PIECE',
    decoration: 'NONE',
    legacyIds: ['MIG1-O-020'],
    category: null,
  },
  {
    key: 'estaca_yard_sign',
    kind: 'PRODUCT',
    name: 'Estaca para yard sign',
    status: 'CANDIDATE',
    saleUnit: null,
    decoration: 'NONE',
    legacyIds: [],
    category: null,
  },
  {
    key: 'aplicacion_dtf_cliente',
    kind: 'SERVICE',
    name: 'Aplicación DTF sobre artículo del cliente',
    status: 'ACTIVE',
    saleUnit: null,
    decoration: 'REQUIRED',
    legacyIds: ['MIG1-O-018'],
    category: null,
    customerSupplied: 'REQUIRED',
  },
  {
    key: 'dtf_transfer',
    kind: 'PRODUCT',
    name: 'DTF Transfer individual',
    status: 'CANDIDATE',
    saleUnit: null,
    decoration: 'NONE',
    legacyIds: ['MIG1-O-015'],
    category: null,
  },
  {
    key: 'dtf_gang_sheet',
    kind: 'PRODUCT',
    name: 'DTF Gang Sheet',
    status: 'CANDIDATE',
    saleUnit: null,
    decoration: 'NONE',
    legacyIds: ['MIG1-O-016'],
    category: null,
  },
  {
    key: 'invitacion_evento',
    kind: 'PRODUCT',
    name: 'Invitación para evento',
    status: null,
    saleUnit: null,
    decoration: 'NONE',
    legacyIds: ['MIGF-O-010'],
    category: 'impresos_papel',
  },
];

const CATEGORIES: Record<string, string> = {
  impresos_papel: 'Impresos en Papel',
  playeras_textiles: 'Playeras y Textiles',
  gorras_accesorios: 'Gorras y Accesorios',
  banderas_displays: 'Banderas y Displays',
  servicios_especiales: 'Servicios Especiales',
};

type OptSpec = {
  key: string;
  label: string;
  kind: OptionDefinition['valueKind'];
  unit?: 'in' | 'ft' | 'oz';
  values: { code: string; label?: string; spec?: OptionValueSpec }[];
};

const OPTIONS: OptSpec[] = [
  {
    key: 'caras',
    label: 'Caras impresas',
    kind: 'ENUM',
    values: [
      { code: '1', label: '1 cara' },
      { code: '2', label: '2 caras' },
    ],
  },
  { key: 'papel', label: 'Papel', kind: 'ENUM', values: [{ code: 'Bond' }, { code: 'Premium' }] },
  {
    key: 'tamano_papel',
    label: 'Tamaño de papel',
    kind: 'ENUM',
    values: [{ code: 'Carta' }, { code: 'Media carta' }, { code: '1/4 carta' }],
  },
  // S–XL provisional (Excel documents only 2XL/3XL, "no exhaustiva") — P2-01.
  {
    key: 'talla',
    label: 'Talla',
    kind: 'ENUM',
    values: ['S', 'M', 'L', 'XL', '2XL', '3XL'].map((code) => ({ code })),
  },
  { key: 'color', label: 'Color', kind: 'TEXT', values: [] },
  {
    key: 'estructura',
    label: 'Estructura',
    kind: 'ENUM',
    values: [{ code: 'Structured' }, { code: 'Unstructured' }],
  },
  {
    key: 'ajuste',
    label: 'Ajuste',
    kind: 'ENUM',
    values: [{ code: 'Fitted' }, { code: 'Adjustable' }],
  },
  {
    key: 'paneles',
    label: 'Paneles',
    kind: 'ENUM',
    values: [{ code: '5-panel' }, { code: '6-panel' }],
  },
  {
    key: 'tamano_display',
    label: 'Tamaño del display',
    kind: 'DIMENSIONS',
    unit: 'in',
    values: [
      { code: '24x63', label: '24 × 63 in', spec: { w: 24, h: 63 } },
      { code: '32x72', label: '32 × 72 in', spec: { w: 32, h: 72 } },
      { code: '48x78', label: '48 × 78 in', spec: { w: 48, h: 78 } },
    ],
  },
];

const ITEM_OPTIONS: {
  item: ItemKey;
  option: string;
  required: boolean;
  distributable?: boolean;
  values?: string[];
}[] = [
  { item: 'tarjeta_tradicional', option: 'caras', required: true },
  { item: 'tarjeta_premium', option: 'caras', required: true },
  { item: 'flyers', option: 'papel', required: true },
  { item: 'flyers', option: 'tamano_papel', required: true },
  { item: 'flyers', option: 'caras', required: true },
  { item: 'camiseta_algodon', option: 'talla', required: true, distributable: true },
  { item: 'camiseta_algodon', option: 'color', required: false },
  { item: 'camiseta_dry_fit', option: 'talla', required: true, distributable: true },
  { item: 'camiseta_dry_fit', option: 'color', required: false },
  // Gorra: NO talla — OWN-OP-007 was an Excel defect (BR-026).
  { item: 'gorra', option: 'estructura', required: false },
  { item: 'gorra', option: 'ajuste', required: false },
  { item: 'gorra', option: 'paneles', required: false },
  { item: 'xbanner_completo', option: 'tamano_display', required: true },
];

const CAPABILITIES: { item: ItemKey; methods: (keyof typeof REF.method)[] }[] = [
  { item: 'camiseta_algodon', methods: ['DTF', 'EMBROIDERY', 'SCREEN_PRINTING', 'HTV'] },
  { item: 'camiseta_dry_fit', methods: ['DTF', 'EMBROIDERY', 'SCREEN_PRINTING', 'HTV'] },
  { item: 'gorra', methods: ['DTF', 'EMBROIDERY', 'SCREEN_PRINTING', 'HTV'] },
  { item: 'aplicacion_dtf_cliente', methods: ['DTF'] },
];

/** Historical unauthorized prices: evidence only, never price definitions (ADR-0005). */
const HISTORICAL: {
  item: ItemKey;
  excelPriceId: string;
  amount: string;
  condition: string | null;
}[] = [
  {
    item: 'xbanner_completo',
    excelPriceId: 'MIG1-P-003',
    amount: '65',
    condition: 'tamaño=24 x 63 in',
  },
  {
    item: 'xbanner_completo',
    excelPriceId: 'MIG1-P-004',
    amount: '85',
    condition: 'tamaño=32 x 72 in',
  },
  {
    item: 'xbanner_completo',
    excelPriceId: 'MIG2-P-009',
    amount: '120',
    condition: 'tamaño=48 x 78 in',
  },
  { item: 'camiseta_algodon', excelPriceId: 'MIG1-P-005', amount: '15', condition: null },
  { item: 'camiseta_dry_fit', excelPriceId: 'MIG1-P-006', amount: '18', condition: null },
  { item: 'gorra', excelPriceId: 'MIG2-P-013', amount: '15', condition: null },
];

const LEGACY_TO_ITEM: Record<string, ItemKey> = {
  'MIG1-O-008': 'tarjeta_tradicional',
  'MIG1-O-009': 'tarjeta_premium',
  'MIG2-O-036': 'flyers',
  'MIGF-O-015': 'imanes_par',
};
const LEGACY_OPTION_KEY: Record<string, string> = {
  caras: 'caras',
  papel: 'papel',
  tamaño: 'tamano_papel',
};

interface ExtractedDefinition {
  item: string;
  conditions: Record<string, string>;
  excel_model: string;
  base: string;
  breaks: { qty_from: number | null; qty_to: number | null; amount: number }[];
  lineage: string[];
}

function sourceRef(
  entityType: EntityType,
  entityId: string,
  kind: SourceReference['sourceKind'],
  locator: string,
  payload: Record<string, unknown> | null = null,
  field: string | null = null,
): SourceReference {
  return {
    id: seedId(`source_reference:${entityType}:${entityId}:${kind}:${locator}`),
    entityType,
    entityId,
    field,
    sourceKind: kind,
    sourceLocator: locator,
    payload,
    capturedAt: CAPTURED_AT,
  };
}

const amountString = (n: number) => n.toFixed(2);

export function devSliceDataset(): SeedDataset {
  const d = emptyDataset();

  for (const [key, name] of Object.entries(CATEGORIES)) {
    d.categories.push({
      id: seedId(`category:${key}`),
      key,
      name,
      parentId: null,
      sort: 0,
      isActive: true,
    });
  }

  ITEMS.forEach((s, i) => {
    const base = {
      id: itemId(s.key),
      publicCode: `DTG-${String(i + 1).padStart(5, '0')}`,
      canonicalName: s.name,
      status: s.status,
      saleUnit: s.saleUnit,
      measurementSpec: null,
      decorationPolicy: s.decoration,
      descriptionInternal: null,
      mergedIntoId: null,
    };
    const item: CatalogItem =
      s.kind === 'SERVICE'
        ? { ...base, kind: 'SERVICE', customerSuppliedItem: s.customerSupplied ?? 'NOT_APPLICABLE' }
        : { ...base, kind: 'PRODUCT', customerSuppliedItem: 'NOT_APPLICABLE' };
    d.items.push(item);
    if (s.category) {
      d.itemCategories.push({
        itemId: item.id,
        categoryId: seedId(`category:${s.category}`),
        isPrimary: true,
      });
    }
    for (const legacy of s.legacyIds) {
      d.sourceReferences.push(sourceRef('catalog_item', item.id, 'LEGACY_ID', legacy));
      d.sourceReferences.push(
        sourceRef('catalog_item', item.id, 'EXCEL_ROW', `${EXCEL}!OFERTAS[Oferta_ID=${legacy}]`),
      );
    }
    d.presentations.push({
      id: seedId(`presentation:${s.key}:es:default`),
      itemId: item.id,
      locale: 'es',
      occasion: null,
      displayName: s.name,
      shortDescription: null,
      aliases: [],
      seoKeywords: [],
      isDefault: true,
      status: 'DRAFT',
    });
  });

  const stake = itemId('estaca_yard_sign');
  d.sourceReferences.push(
    sourceRef('catalog_item', stake, 'OWNER_INTERVIEW', `${EXCEL}!OFERTAS[MIG1-O-020].Notas`, {
      quote:
        'OWNER 2026-09-15: NO incluye estaca metálica por defecto; no proveedor estable. Accesorio futuro.',
    }),
  );

  // Aliases stated by the owner (Notas OWNER 2026-09-15).
  const aliases: Partial<Record<ItemKey, { es: string[]; en: string[] }>> = {
    // STEP 10 · search vocabulary for the CRM picker (the owner and the CRM say "business card",
    // "flyer", "magnet"). Aliases only: they widen search, never change names or prices.
    tarjeta_tradicional: {
      es: ['tarjeta', 'tarjetas', 'tarjeta de negocio'],
      en: ['Business card', 'business cards', 'traditional business card'],
    },
    tarjeta_premium: {
      es: ['tarjeta', 'tarjetas', 'tarjeta de negocio'],
      en: ['Premium business card', 'business card', 'business cards', 'gloss business card'],
    },
    flyers: { es: ['volante', 'volantes'], en: ['Flyer', 'flyers'] },
    imanes_par: {
      es: ['imán', 'iman', 'imanes'],
      en: ['Vehicle magnet', 'car magnet', 'magnets'],
    },
    camiseta_algodon: {
      es: ['playera', 'camiseta'],
      en: ['cotton crew-neck T-shirt', 't-shirt', 'tee'],
    },
    yard_sign: {
      es: ['letrero de jardín'],
      en: ['yard sign', 'realtor sign', 'lawn sign', 'real estate sign', 'coroplast sign'],
    },
  };
  for (const [key, a] of Object.entries(aliases) as [ItemKey, { es: string[]; en: string[] }][]) {
    const es = d.presentations.find((p) => p.itemId === itemId(key) && p.isDefault);
    if (es) es.aliases = a.es;
    d.presentations.push({
      id: seedId(`presentation:${key}:en:default`),
      itemId: itemId(key),
      locale: 'en',
      occasion: null,
      displayName: a.en[0] as string,
      shortDescription: null,
      aliases: a.en,
      seoKeywords: [],
      isDefault: true,
      status: 'DRAFT',
    });
  }
  // Occasion = presentation, not product (MIGF-PR-001…003).
  (['XV', 'Boda', 'Cumpleaños'] as const).forEach((occasion, i) => {
    const id = seedId(`presentation:invitacion_evento:es:${occasion}`);
    d.presentations.push({
      id,
      itemId: itemId('invitacion_evento'),
      locale: 'es',
      occasion,
      displayName: `Invitación para ${occasion === 'XV' ? 'XV años' : occasion.toLowerCase()}`,
      shortDescription: null,
      aliases: [],
      seoKeywords: [],
      isDefault: false,
      status: 'DRAFT',
    });
    d.sourceReferences.push(
      sourceRef('presentation', id, 'EXCEL_ROW', `${EXCEL}!PRESENTACIONES[MIGF-PR-00${i + 1}]`),
    );
  });

  // Options
  for (const o of OPTIONS) {
    const id = optionDefId(o.key);
    d.optionDefinitions.push(
      o.kind === 'DIMENSIONS' || o.kind === 'QUANTITY' || o.kind === 'LENGTH'
        ? { id, key: o.key, label: o.label, scope: 'ITEM', valueKind: o.kind, unit: o.unit ?? 'in' }
        : { id, key: o.key, label: o.label, scope: 'ITEM', valueKind: o.kind, unit: null },
    );
    o.values.forEach((v, i) => {
      const value: OptionValue = {
        id: optionValueId(o.key, v.code),
        optionDefinitionId: id,
        code: v.code,
        label: v.label ?? v.code,
        spec: v.spec ?? null,
        sort: i + 1,
        isActive: true,
      };
      d.optionValues.push(value);
    });
  }
  ITEM_OPTIONS.forEach((io, i) => {
    const def = OPTIONS.find((o) => o.key === io.option);
    if (!def) throw new Error(`unknown option ${io.option}`);
    d.itemOptions.push({
      itemId: itemId(io.item),
      optionDefinitionId: optionDefId(io.option),
      isRequired: io.required,
      selectionMode: 'SINGLE',
      isDistributable: io.distributable ?? false,
      sort: i + 1,
      defaultValueId: null,
    });
    (io.values ?? def.values.map((v) => v.code)).forEach((code, j) =>
      d.itemOptionValues.push({
        itemId: itemId(io.item),
        optionDefinitionId: optionDefId(io.option),
        optionValueId: optionValueId(io.option, code),
        sort: j + 1,
        isActive: true,
      }),
    );
  });

  for (const c of CAPABILITIES) {
    for (const m of c.methods) {
      d.decorationCapabilities.push({
        itemId: itemId(c.item),
        methodId: REF.method[m],
        constraints: null,
        note: null,
      });
    }
  }

  // Composition: X-Banner complete = stand + graphic (OWN-CO-001/002); yard sign → optional stake.
  const comp = (parent: ItemKey, child: ItemKey, role: 'INCLUDED' | 'OPTIONAL', sort: number) =>
    d.compositionLines.push({
      id: seedId(`composition_line:${parent}:${child}`),
      parentItemId: itemId(parent),
      childItemId: itemId(child),
      quantity: 1,
      role,
      sort,
      note: null,
    });
  comp('xbanner_completo', 'xbanner_estructura', 'INCLUDED', 1);
  comp('xbanner_completo', 'xbanner_grafica', 'INCLUDED', 2);
  comp('yard_sign', 'estaca_yard_sign', 'OPTIONAL', 1);

  // Authorized prices (131 rows → 14 definitions, ADR-0006).
  for (const ex of authorizedPrices as unknown as ExtractedDefinition[]) {
    const key = LEGACY_TO_ITEM[ex.item];
    if (!key) throw new Error(`unmapped legacy item ${ex.item}`);
    const idSeed = `price_definition:${key}:${Object.entries(ex.conditions)
      .map(([k, v]) => `${k}=${v}`)
      .sort()
      .join('|')}`;
    const common = {
      id: seedId(idSeed),
      itemId: itemId(key),
      priceBookId: REF.bookUSA,
      component: 'ITEM' as const,
      status: 'AUTHORIZED' as const,
      validFrom: AUTHORIZED_AT,
      validTo: null,
      version: 1,
      supersedesId: null,
      authorizedBy: AUTHORIZED_BY,
      authorizedAt: AUTHORIZED_AT,
    };
    let def: PriceDefinition;
    if (key === 'imanes_par') {
      // Single-valued pseudo-options (Par, 2 × 1 ft) are item identity, not conditions.
      def = {
        ...common,
        conditions: [],
        model: 'FIXED',
        amount: amountString(ex.breaks[0]!.amount),
        maxQuantity: 1,
      };
    } else {
      const conditions: PriceCondition[] = Object.entries(ex.conditions).map(([k, v]) => {
        const optKey = LEGACY_OPTION_KEY[k];
        if (!optKey) throw new Error(`unmapped condition ${k}`);
        return {
          id: seedId(`${idSeed}:cond:${optKey}`),
          kind: 'OPTION_VALUE',
          optionDefinitionId: optionDefId(optKey),
          optionValueId: optionValueId(optKey, v),
        };
      });
      def = {
        ...common,
        conditions,
        model: 'EXACT_QUANTITY_MATRIX',
        breaks: ex.breaks
          .map((b) => ({
            quantity: b.qty_from as number,
            amount: amountString(b.amount),
            amountBasis: 'TOTAL' as const,
          }))
          .sort((a, b) => a.quantity - b.quantity),
      };
    }
    d.priceDefinitions.push(def);
    d.sourceReferences.push(
      sourceRef(
        'price_definition',
        def.id,
        'EXCEL_ROW',
        `${EXCEL}!PRECIOS[${ex.lineage.join(',')}]`,
        {
          excelModel: ex.excel_model,
          excelBase: ex.base,
        },
      ),
    );
  }

  // Size surcharges (BR-026). Scope: items whose owner notes carry the rule (P1-05 to confirm more).
  const rule = (code: string, size: string, amount: string): PriceRule => ({
    id: seedId(`price_rule:${code}:v1`),
    priceBookId: REF.bookUSA,
    code,
    label: `Recargo talla ${size}`,
    kind: 'ADD_PER_UNIT',
    amount,
    exclusivityKey: 'size_surcharge',
    status: 'AUTHORIZED',
    validFrom: AUTHORIZED_AT,
    validTo: null,
    version: 1,
    supersedesId: null,
    authorizedBy: AUTHORIZED_BY,
    authorizedAt: AUTHORIZED_AT,
    conditions: [
      {
        id: seedId(`price_rule:${code}:v1:cond`),
        kind: 'OPTION_VALUE',
        optionDefinitionId: optionDefId('talla'),
        optionValueId: optionValueId('talla', size),
      },
    ],
    itemIds: [itemId('camiseta_algodon'), itemId('camiseta_dry_fit')],
  });
  d.priceRules.push(rule('size_2xl', '2XL', '2.00'), rule('size_3xl', '3XL', '3.00'));

  for (const h of HISTORICAL) {
    d.sourceReferences.push(
      sourceRef(
        'catalog_item',
        itemId(h.item),
        'HISTORICAL_PRICE_EVIDENCE',
        `${EXCEL}!PRECIOS[${h.excelPriceId}]`,
        {
          amount: h.amount,
          currency: 'USD',
          condition: h.condition,
          status: 'HISTÓRICO / NO AUTORIZADO para cotizar (OWNER 2026-09-15)',
        },
      ),
    );
  }

  // Publication demo (real authorized prices only). Publishing for real needs owner approval.
  for (const k of ['tarjeta_tradicional', 'tarjeta_premium', 'flyers', 'imanes_par'] as ItemKey[]) {
    for (const profile of [REF.profile.catalog, REF.profile.usa]) {
      d.publicationAssignments.push({
        profileId: profile,
        itemId: itemId(k),
        presentationId: null,
        isIncluded: true,
        sort: null,
      });
    }
  }

  const decision = (
    code: string,
    title: string,
    status: 'OPEN' | 'DECIDED',
    statement: string,
    items: ItemKey[],
    decided?: { by: string; at: string; source: string },
  ) =>
    d.decisionRecords.push({
      id: seedId(`decision:${code}`),
      code,
      title,
      status,
      statement,
      decidedBy: decided?.by ?? null,
      decidedAt: decided?.at ?? null,
      source: decided?.source ?? null,
      subjects: items.map((k) => ({ entityType: 'catalog_item' as const, entityId: itemId(k) })),
    });
  decision(
    'P1-01',
    'Confirmar estado comercial de los items del slice',
    'OPEN',
    'Estados sembrados provisionalmente desde v1.2 (Activo/Candidato) o por tener precio autorizado vigente.',
    [...ITEM_KEYS],
  );
  decision(
    'P1-03',
    'Imanes: ¿2 pares = 130 USD?',
    'OPEN',
    'Precio autorizado 65 USD por par; por ahora FIXED con máximo 1 par.',
    ['imanes_par'],
  );
  decision(
    'P1-05',
    'Alcance del recargo 2XL/3XL',
    'OPEN',
    'Asignado a camiseta algodón y Dry Fit (notas del dueño en esos registros). Polo, sudaderas: pendiente.',
    ['camiseta_algodon', 'camiseta_dry_fit'],
  );
  decision(
    'P2-01',
    'Lista de tallas y segmentos',
    'OPEN',
    'S–XL sembradas como vocabulario provisional; el Excel sólo documenta 2XL/3XL.',
    ['camiseta_algodon', 'camiseta_dry_fit'],
  );
  decision(
    'OD-SIZE-SURCHARGE',
    'Recargos por talla',
    'DECIDED',
    '2XL = +2 USD y 3XL = +3 USD por pieza, donde la regla aplique; nunca a gorras.',
    ['camiseta_algodon', 'camiseta_dry_fit', 'gorra'],
    { by: 'owner', at: '2026-09-29T00:00:00Z', source: 'OWNER_DECISIONS_POST_AUDIT.md' },
  );
  decision(
    'DQ-GORRA-TALLA',
    'Talla 2XL/3XL en Gorra no se migra',
    'DECIDED',
    'OWN-OP-007 era un defecto del Excel (C07, BR-026).',
    ['gorra'],
    { by: 'architecture', at: '2026-09-29T00:00:00Z', source: 'STEP 03 MIGRATION-MAPPING §2' },
  );

  return d;
}
