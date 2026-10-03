import { describe, expect, it } from 'vitest';
import { adaptCandidate, type AdapterContext, type DomainOp } from '@/import/adapter';
import type {
  CatalogItemProposal,
  CompositionProposal,
  DecorationProposal,
  OptionProposal,
  PresentationProposal,
  PriceProposal,
} from '@/import/proposal';

/**
 * Adapter unit tests with a hand-built domain context (FIXTURE data only).
 * The adapter is pure: every fact about the domain comes from the context.
 */

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ITEM = U(1);
const CHILD = U(2);
const BOOK_USA = U(10);
const DEF_CARAS = U(20);
const VAL_1 = U(21);
const VAL_2 = U(22);
const DTF = U(30);
const K = (n: number) => n.toString(16).padStart(24, '0');

function ctx(over: Partial<AdapterContext> = {}): AdapterContext {
  return {
    mode: 'PUBLISH',
    dataClass: 'FIXTURE',
    publicationEnabledFor: ['FIXTURE'],
    batchId: U(100),
    candidateId: U(101),
    sourceFile: 'fixture.xlsx',
    blockingReasons: [],
    sourceRecords: [
      {
        recordId: U(200),
        recordKey: K(1),
        recordType: 'OFERTAS',
        legacyId: 'FX-O-1',
        role: 'PRIMARY',
        sheet: 'OFERTAS',
        firstCell: 'A5',
        lastCell: 'Q5',
        workbookSha256: 'f'.repeat(64),
      },
    ],
    itemsByLegacy: { 'FX-O-1': [ITEM], 'FX-O-2': [CHILD] },
    items: {
      [ITEM]: {
        id: ITEM,
        kind: 'PRODUCT',
        status: 'ACTIVE',
        saleUnit: 'PIECE',
        decorationPolicy: 'NONE',
      },
      [CHILD]: {
        id: CHILD,
        kind: 'PRODUCT',
        status: 'ACTIVE',
        saleUnit: 'PIECE',
        decorationPolicy: 'NONE',
      },
    },
    fixedAttributeOptionsByItemLegacy: {},
    historicalByItemLegacy: {},
    existingSourceLocators: {},
    optionDefinitions: { caras: { id: DEF_CARAS, key: 'caras', valueKind: 'ENUM', unit: null } },
    optionValues: { caras: { '1': VAL_1, '2': VAL_2 } },
    itemOptions: {},
    decorationMethods: { DTF },
    capabilities: [],
    optionLinks: {},
    compositionLines: [],
    priceBooks: { USA: { id: BOOK_USA, currency: 'USD' }, MX: { id: U(11), currency: 'MXN' } },
    priceDefinitionsByItem: {},
    presentationsByItem: {},
    ...over,
  };
}

const item = (over: Partial<CatalogItemProposal> = {}): CatalogItemProposal => ({
  kind: 'CATALOG_ITEM',
  legacyId: 'FX-O-9',
  legacySku: null,
  name: 'Fixture item',
  itemType: 'PRODUCT',
  itemTypeEvidence: 'PRODUCT',
  status: null,
  saleUnit: 'PIECE',
  customerSuppliedEvidence: null,
  categoryLegacy: null,
  familyEvidence: null,
  notesEvidence: null,
  fixedAttributes: [],
  ...over,
});

const codes = (r: { ok: boolean; errors?: { code: string }[] }) =>
  r.ok ? [] : r.errors!.map((e) => e.code);
const ops = (r: ReturnType<typeof adaptCandidate>): DomainOp[] => {
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.plan.ops;
};

describe('adapter · CatalogItem', () => {
  it('adapts a resolved item into CREATE + LEGACY_ID + EXCEL_ROW provenance (public code left to the database)', () => {
    const plan = ops(
      adaptCandidate(item(), { status: 'CANDIDATE', decorationPolicy: 'NONE' }, ctx()),
    );
    const create = plan.find((o) => o.op === 'CREATE_CATALOG_ITEM');
    expect(create && create.op === 'CREATE_CATALOG_ITEM' && create.values).toEqual({
      kind: 'PRODUCT',
      canonicalName: 'Fixture item',
      status: 'CANDIDATE',
      saleUnit: 'PIECE',
      decorationPolicy: 'NONE',
      customerSuppliedItem: 'NOT_APPLICABLE',
    });
    expect(JSON.stringify(plan)).not.toMatch(/DTG-\d+/);
    const refs = plan.flatMap((o) => (o.op === 'ADD_SOURCE_REFERENCE' ? [o.sourceKind] : []));
    expect(refs).toEqual(['LEGACY_ID', 'EXCEL_ROW']);
    expect(plan.find((o) => o.op === 'LINK')).toMatchObject({
      role: 'catalog_item',
      linkKind: 'CREATED',
    });
  });

  it('rejects unresolved status and unknown kind with structured errors', () => {
    const r = adaptCandidate(
      item({ itemType: null, itemTypeEvidence: null }),
      { decorationPolicy: 'NONE' },
      ctx(),
    );
    expect(codes(r).sort()).toEqual(['KIND_UNRESOLVED', 'UNRESOLVED_FIELD']);
    if (!r.ok) expect(r.errors.find((e) => e.code === 'UNRESOLVED_FIELD')?.field).toBe('status');
  });

  it('rejects an empty name and a customer-supplied PRODUCT', () => {
    const r = adaptCandidate(
      item({ name: '  ' }),
      { status: 'ACTIVE', decorationPolicy: 'NONE', customerSuppliedItem: 'ALLOWED' },
      ctx(),
    );
    expect(codes(r).sort()).toEqual(['INVALID_VALUE', 'INVALID_VALUE']);
  });

  it('customer-supplied evidence: SERVICE needs an explicit choice, PRODUCT contradicts it', () => {
    const service = item({
      itemType: 'SERVICE',
      itemTypeEvidence: 'SERVICE',
      customerSuppliedEvidence: true,
    });
    const r = adaptCandidate(service, { status: 'ACTIVE', decorationPolicy: 'OPTIONAL' }, ctx());
    expect(!r.ok && r.errors.map((e) => e.field)).toEqual(['customerSuppliedItem']);
    const ok = ops(
      adaptCandidate(
        service,
        { status: 'ACTIVE', decorationPolicy: 'OPTIONAL', customerSuppliedItem: 'REQUIRED' },
        ctx(),
      ),
    );
    expect(ok.find((o) => o.op === 'CREATE_CATALOG_ITEM')).toMatchObject({
      values: { customerSuppliedItem: 'REQUIRED' },
    });
    const product = item({ customerSuppliedEvidence: true });
    expect(
      codes(adaptCandidate(product, { status: 'ACTIVE', decorationPolicy: 'NONE' }, ctx())),
    ).toEqual(['INVALID_VALUE']);
  });

  it('never creates a second item for a legacy id already in the domain', () => {
    const r = adaptCandidate(
      item({ legacyId: 'FX-O-1' }),
      { status: 'ACTIVE', decorationPolicy: 'NONE', target: { mode: 'CREATE' } },
      ctx(),
    );
    expect(codes(r)).toEqual(['LINEAGE_EXISTS']);
    const noTarget = adaptCandidate(
      item({ legacyId: 'FX-O-1' }),
      { status: 'ACTIVE', decorationPolicy: 'NONE' },
      ctx(),
    );
    expect(codes(noTarget)).toEqual(['LINEAGE_EXISTS']);
  });

  it('links an existing item without changing it and reports the differences', () => {
    const r = adaptCandidate(
      item({ legacyId: 'FX-O-1' }),
      {
        status: 'PLANNED',
        decorationPolicy: 'NONE',
        target: { mode: 'LINK_EXISTING', entityId: ITEM },
      },
      ctx(),
    );
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.plan.ops.some((o) => o.op === 'CREATE_CATALOG_ITEM')).toBe(false);
    expect(r.plan.ops.find((o) => o.op === 'LINK')).toMatchObject({
      linkKind: 'LINKED_EXISTING',
      entity: { id: ITEM },
    });
    expect(r.plan.notes.join(' ')).toContain('status=ACTIVE');
  });

  it('refuses blocked candidates and REAL data in STEP 05B', () => {
    expect(
      codes(
        adaptCandidate(
          item(),
          { status: 'ACTIVE', decorationPolicy: 'NONE' },
          ctx({ blockingReasons: ['SOURCE_ERROR'] }),
        ),
      ),
    ).toEqual(['BLOCKED']);
    expect(
      codes(
        adaptCandidate(
          item(),
          { status: 'ACTIVE', decorationPolicy: 'NONE' },
          ctx({ dataClass: 'REAL' }),
        ),
      ),
    ).toEqual(['NOT_PUBLISHABLE_IN_THIS_STEP']);
    // A dry run over REAL data is allowed (no writes).
    expect(
      adaptCandidate(
        item(),
        { status: 'ACTIVE', decorationPolicy: 'NONE' },
        ctx({ dataClass: 'REAL', mode: 'DRY_RUN' }),
      ).ok,
    ).toBe(true);
  });

  it('attaches historical prices as HISTORICAL_PRICE_EVIDENCE, never as prices', () => {
    const plan = ops(
      adaptCandidate(
        item(),
        { status: 'ACTIVE', decorationPolicy: 'NONE' },
        ctx({
          historicalByItemLegacy: {
            'FX-O-9': [
              {
                recordId: U(300),
                recordKey: K(3),
                priceLegacyId: 'FX-P-1',
                amount: '65',
                currency: 'USD',
                conditions: [],
              },
            ],
          },
        }),
      ),
    );
    expect(
      plan.filter(
        (o) => o.op === 'ADD_SOURCE_REFERENCE' && o.sourceKind === 'HISTORICAL_PRICE_EVIDENCE',
      ),
    ).toHaveLength(1);
    expect(plan.some((o) => o.op === 'CREATE_PRICE_DEFINITION')).toBe(false);
  });
});

describe('adapter · options', () => {
  const option = (): OptionProposal => ({
    kind: 'OPTION',
    optionLegacyId: 'FX-OP-1',
    itemLegacyId: 'FX-O-1',
    name: 'caras',
    captureType: 'Lista',
    required: null,
    values: [
      { recordKey: K(11), label: '1', measurement: null },
      { recordKey: K(12), label: '2', measurement: null },
    ],
  });
  const good = {
    definition: { mode: 'EXISTING', key: 'caras' },
    isRequired: true,
    selectionMode: 'SINGLE',
    isDistributable: false,
    values: { [K(11)]: { mode: 'EXISTING', code: '1' }, [K(12)]: { mode: 'EXISTING', code: '2' } },
  };

  it('creates the item option and its controlled value subset', () => {
    const plan = ops(adaptCandidate(option(), good, ctx()));
    expect(plan.filter((o) => o.op === 'CREATE_ITEM_OPTION')).toHaveLength(1);
    expect(plan.filter((o) => o.op === 'CREATE_ITEM_OPTION_VALUE')).toHaveLength(2);
    expect(plan.filter((o) => o.op === 'LINK' && o.role === 'option_value')).toHaveLength(2);
  });

  it('requires an explicit isRequired (null never becomes false)', () => {
    const { isRequired: _omit, ...rest } = good;
    void _omit;
    const r = adaptCandidate(option(), rest, ctx());
    expect(codes(r)).toEqual(['UNRESOLVED_FIELD']);
  });

  it('rejects unmapped values, unknown codes and distributable non-ENUM', () => {
    expect(
      codes(
        adaptCandidate(
          option(),
          { ...good, values: { [K(11)]: { mode: 'EXISTING', code: '1' } } },
          ctx(),
        ),
      ),
    ).toEqual(['OPTION_VALUE_UNMAPPED']);
    expect(
      codes(
        adaptCandidate(
          option(),
          {
            ...good,
            values: {
              [K(11)]: { mode: 'EXISTING', code: '9' },
              [K(12)]: { mode: 'EXCLUDE', reason: 'x' },
            },
          },
          ctx(),
        ),
      ),
    ).toEqual(['OPTION_VALUE_INVALID']);
    const text = {
      ...good,
      definition: {
        mode: 'CREATE',
        key: 'nota',
        label: 'Nota',
        valueKind: 'TEXT',
        unit: null,
        scope: 'ITEM',
      },
      isDistributable: true,
      values: {
        [K(11)]: { mode: 'EXCLUDE', reason: 'free text' },
        [K(12)]: { mode: 'EXCLUDE', reason: 'free text' },
      },
    };
    expect(codes(adaptCandidate(option(), text, ctx()))).toEqual(['INVALID_VALUE']);
  });

  it('detects a conflicting existing item option', () => {
    const c = ctx({
      itemOptions: {
        [`${ITEM}:${DEF_CARAS}`]: {
          isRequired: false,
          selectionMode: 'SINGLE',
          isDistributable: false,
          valueIds: [VAL_1, VAL_2],
        },
      },
    });
    expect(codes(adaptCandidate(option(), good, c))).toEqual(['ITEM_OPTION_CONFLICT']);
    const same = ctx({
      itemOptions: {
        [`${ITEM}:${DEF_CARAS}`]: {
          isRequired: true,
          selectionMode: 'SINGLE',
          isDistributable: false,
          valueIds: [VAL_1, VAL_2],
        },
      },
    });
    const plan = ops(adaptCandidate(option(), good, same));
    expect(plan.every((o) => o.op === 'LINK' && o.linkKind === 'LINKED_EXISTING')).toBe(true);
  });

  it('validates the spec of created dimension values', () => {
    const def = {
      mode: 'CREATE',
      key: 'tamano_x',
      label: 'Tamaño',
      valueKind: 'DIMENSIONS',
      unit: 'in',
      scope: 'ITEM',
    };
    const bad = {
      ...good,
      definition: def,
      values: {
        [K(11)]: { mode: 'CREATE', code: '2x1', label: '2×1', spec: { value: 2 } },
        [K(12)]: { mode: 'EXCLUDE', reason: 'n/a' },
      },
    };
    expect(codes(adaptCandidate(option(), bad, ctx()))).toEqual(['OPTION_VALUE_INVALID']);
    const ok = {
      ...bad,
      values: {
        ...bad.values,
        [K(11)]: { mode: 'CREATE', code: '2x1', label: '2×1', spec: { w: 2, h: 1 } },
      },
    };
    expect(adaptCandidate(option(), ok, ctx()).ok).toBe(true);
  });
});

describe('adapter · decoration', () => {
  const method = (): DecorationProposal => ({
    kind: 'DECORATION',
    subtype: 'METHOD_ASSOCIATION',
    associationLegacyId: 'FX-OM-1',
    itemLegacyId: 'FX-O-1',
    methodLegacyId: 'FX-MET-1',
    methodLabels: ['DTF textil'],
    suggestedMethodKey: 'DTF',
  });
  it('a suggestion is not a decision: methodKey must be resolved', () => {
    expect(codes(adaptCandidate(method(), {}, ctx()))).toEqual(['UNRESOLVED_FIELD']);
  });
  it('rejects capabilities on items that do not accept decoration (blank = no selection)', () => {
    expect(codes(adaptCandidate(method(), { methodKey: 'DTF' }, ctx()))).toEqual([
      'DECORATION_POLICY_NONE',
    ]);
    expect(codes(adaptCandidate(method(), { methodKey: 'SUBLIMATION' }, ctx()))).toEqual([
      'DECORATION_METHOD_NOT_FOUND',
    ]);
  });
  it('creates the capability when the item accepts decoration', () => {
    const c = ctx({
      items: {
        [ITEM]: {
          id: ITEM,
          kind: 'PRODUCT',
          status: 'ACTIVE',
          saleUnit: 'PIECE',
          decorationPolicy: 'OPTIONAL',
        },
      },
    });
    expect(ops(adaptCandidate(method(), { methodKey: 'DTF' }, c)).map((o) => o.op)).toEqual([
      'CREATE_DECORATION_CAPABILITY',
      'LINK',
    ]);
  });
  it('Blank/Personalizada sets an OPTIONAL policy (no Blank option)', () => {
    const policy: DecorationProposal = {
      kind: 'DECORATION',
      subtype: 'POLICY',
      optionLegacyId: 'FX-OP-2',
      itemLegacyId: 'FX-O-1',
      valueLabels: ['Blank', 'Personalizada'],
      decorationPolicy: 'OPTIONAL',
    };
    const plan = ops(adaptCandidate(policy, {}, ctx()));
    expect(plan[0]).toEqual({
      op: 'SET_DECORATION_POLICY',
      itemId: ITEM,
      from: 'NONE',
      to: 'OPTIONAL',
    });
    expect(
      plan.some((o) => o.op === 'CREATE_OPTION_DEFINITION' || o.op === 'CREATE_ITEM_OPTION'),
    ).toBe(false);
  });
});

describe('adapter · composition', () => {
  const rel = (
    over: Partial<Extract<CompositionProposal, { subtype: 'RELATION' }>> = {},
  ): CompositionProposal => ({
    kind: 'COMPOSITION',
    subtype: 'RELATION',
    componentLegacyId: 'FX-C-1',
    parentLegacyId: 'FX-O-1',
    childLegacyId: 'FX-O-2',
    quantity: 1,
    role: 'INCLUDED',
    ...over,
  });
  it('creates a composition line between two catalog items', () => {
    expect(ops(adaptCandidate(rel(), {}, ctx())).map((o) => o.op)).toEqual([
      'CREATE_COMPOSITION_LINE',
      'LINK',
      'ADD_SOURCE_REFERENCE',
    ]);
  });
  it('rejects cycles and unpublished dependencies', () => {
    const cyc = ctx({
      compositionLines: [
        {
          id: U(400),
          parentItemId: CHILD,
          childItemId: ITEM,
          quantity: 1,
          role: 'INCLUDED',
          sort: 0,
          note: null,
        },
      ],
    });
    expect(codes(adaptCandidate(rel(), {}, cyc))).toEqual(['COMPOSITION_INVALID']);
    expect(codes(adaptCandidate(rel({ childLegacyId: 'FX-O-404' }), {}, ctx()))).toEqual([
      'DEPENDENCY_NOT_PUBLISHED',
    ]);
  });
});

describe('adapter · prices', () => {
  const matrix = (over: Partial<PriceProposal> = {}): PriceProposal => ({
    kind: 'PRICE',
    itemLegacyId: 'FX-O-1',
    currency: 'USD',
    market: 'USA',
    model: 'EXACT_QUANTITY_MATRIX',
    sourceModel: 'Por tabla',
    amountBasisEvidence: 'Por paquete',
    amountBasis: 'TOTAL',
    mexicoEvidence: null,
    conditions: [
      {
        conditionLegacyId: 'FX-CP-1',
        optionLegacyId: 'FX-OP-1',
        attribute: 'caras',
        operator: 'Igual',
        value: '2',
        unit: null,
        recordKey: K(40),
      },
    ],
    observations: [
      {
        parserCandidateKey: K(41),
        priceLegacyId: 'FX-P-1',
        recordKey: K(42),
        quantity: 250,
        amount: '70',
        classification: 'EXACT_QUANTITY_MATRIX',
        authorizationEvidence: true,
      },
      {
        parserCandidateKey: K(43),
        priceLegacyId: 'FX-P-2',
        recordKey: K(44),
        quantity: 500,
        amount: '120',
        classification: 'EXACT_QUANTITY_MATRIX',
        authorizationEvidence: true,
      },
    ],
    ...over,
  });
  const published = ctx({
    optionLinks: {
      'FX-OP-1': {
        itemId: ITEM,
        definitionId: DEF_CARAS,
        valueIdByRecordKey: { [K(11)]: VAL_1, [K(12)]: VAL_2 },
        labelByRecordKey: { [K(11)]: '1', [K(12)]: '2' },
      },
    },
  });
  const when = { validFrom: '2026-10-01T00:00:00Z' };

  it('publishes a DRAFT definition with Money breaks and mapped conditions (no interpolation)', () => {
    const plan = ops(adaptCandidate(matrix(), when, published));
    const def = plan.find((o) => o.op === 'CREATE_PRICE_DEFINITION');
    if (!def || def.op !== 'CREATE_PRICE_DEFINITION') throw new Error('missing');
    expect(def.values.status).toBe('DRAFT');
    expect(
      def.breaks.map((b) => [b.quantity, b.amount.amount.toFixed(2), b.amount.currency]),
    ).toEqual([
      [250, '70.00', 'USD'],
      [500, '120.00', 'USD'],
    ]);
    expect(def.conditions).toEqual([{ optionDefinitionId: DEF_CARAS, optionValueId: VAL_2 }]);
  });

  it('requires the option to be published first and the value to exist', () => {
    expect(codes(adaptCandidate(matrix(), when, ctx()))).toEqual(['CONDITION_UNMAPPED']);
    const three = matrix({ conditions: [{ ...matrix().conditions[0]!, value: '3' }] });
    expect(codes(adaptCandidate(three, when, published))).toEqual(['CONDITION_VALUE_UNMAPPED']);
  });

  it('never defaults validity, never rounds silently, never mixes currencies', () => {
    expect(codes(adaptCandidate(matrix(), {}, published))).toEqual(['UNRESOLVED_FIELD']);
    const precise = matrix({ observations: [{ ...matrix().observations[0]!, amount: '70.005' }] });
    expect(codes(adaptCandidate(precise, when, published))).toEqual(['MONEY_INVALID']);
    const wrongBook = ctx({
      ...published,
      priceBooks: { USA: { id: BOOK_USA, currency: 'MXN' }, MX: { id: U(11), currency: 'MXN' } },
    });
    expect(codes(adaptCandidate(matrix(), when, wrongBook))).toEqual(['MONEY_CURRENCY_MISMATCH']);
  });

  it('FIXED needs an explicit max quantity; fixed attributes are not conditions', () => {
    const fixed = matrix({
      model: 'FIXED',
      amountBasisEvidence: 'Total',
      conditions: [
        {
          conditionLegacyId: 'FX-CP-9',
          optionLegacyId: 'FX-OP-9',
          attribute: 'presentación',
          operator: 'Igual',
          value: 'Par',
          unit: null,
          recordKey: K(50),
        },
      ],
      observations: [
        {
          parserCandidateKey: K(51),
          priceLegacyId: 'FX-P-9',
          recordKey: K(52),
          quantity: null,
          amount: '65',
          classification: 'FIXED',
          authorizationEvidence: true,
        },
      ],
    });
    const c = ctx({ fixedAttributeOptionsByItemLegacy: { 'FX-O-1': ['FX-OP-9'] } });
    expect(codes(adaptCandidate(fixed, when, c))).toEqual(['UNRESOLVED_FIELD']);
    const plan = ops(adaptCandidate(fixed, { ...when, maxQuantity: 1 }, c));
    const def = plan.find((o) => o.op === 'CREATE_PRICE_DEFINITION');
    expect(
      def && def.op === 'CREATE_PRICE_DEFINITION' && [def.values.maxQuantity, def.conditions],
    ).toEqual([1, []]);
  });

  it('links an identical existing definition and rejects a different one', () => {
    const existing = {
      id: U(500),
      itemId: ITEM,
      priceBookId: BOOK_USA,
      component: 'ITEM' as const,
      model: 'EXACT_QUANTITY_MATRIX',
      status: 'AUTHORIZED',
      amount: null,
      maxQuantity: null,
      conditionSignature: [`${DEF_CARAS}=${VAL_2}`],
      breaks: [
        { quantity: 250, amount: '70.00', amountBasis: 'TOTAL' as const },
        { quantity: 500, amount: '120.00', amountBasis: 'TOTAL' as const },
      ],
    };
    const c = ctx({ ...published, priceDefinitionsByItem: { [ITEM]: [existing] } });
    expect(codes(adaptCandidate(matrix(), when, c))).toEqual(['PRICE_DEFINITION_EXISTS']);
    const link = ops(
      adaptCandidate(matrix(), { ...when, target: { mode: 'LINK_EXISTING', entityId: U(500) } }, c),
    );
    expect(link.find((o) => o.op === 'LINK')).toMatchObject({ linkKind: 'LINKED_EXISTING' });
    const differs = ctx({
      ...published,
      priceDefinitionsByItem: { [ITEM]: [{ ...existing, breaks: [existing.breaks[0]!] }] },
    });
    expect(
      codes(
        adaptCandidate(
          matrix(),
          { ...when, target: { mode: 'LINK_EXISTING', entityId: U(500) } },
          differs,
        ),
      ),
    ).toEqual(['PRICE_MISMATCH_WITH_EXISTING']);
  });

  it('keeps MXN evidence out: blocked candidates never adapt', () => {
    const mx = matrix({ currency: 'MXN', market: 'MX' });
    expect(
      codes(
        adaptCandidate(
          mx,
          when,
          ctx({ ...published, blockingReasons: ['MX_PRICE_EVIDENCE_ONLY'] }),
        ),
      ),
    ).toEqual(['BLOCKED']);
  });
});

describe('adapter · presentation', () => {
  const pres = (): PresentationProposal => ({
    kind: 'PRESENTATION',
    linkLegacyId: 'FX-PO-1',
    presentationLegacyId: 'FX-PR-1',
    itemLegacyId: 'FX-O-1',
    displayName: 'Invitación para boda',
    occasion: 'Boda',
    channel: null,
    languageEvidence: null,
    locale: null,
    publicationStateEvidence: 'Borrador',
    role: 'Principal',
    order: 1,
  });
  it('needs locale and default flag; creates a DRAFT presentation (not a product, not a publication)', () => {
    expect(codes(adaptCandidate(pres(), {}, ctx())).sort()).toEqual([
      'UNRESOLVED_FIELD',
      'UNRESOLVED_FIELD',
    ]);
    const plan = ops(adaptCandidate(pres(), { locale: 'es', isDefault: false }, ctx()));
    expect(plan[0]).toMatchObject({
      op: 'CREATE_PRESENTATION',
      values: { locale: 'es', occasion: 'Boda', isDefault: false },
    });
    expect(plan.some((o) => o.op === 'CREATE_CATALOG_ITEM')).toBe(false);
  });
  it('a same-named presentation is not linked by name: the reviewer must choose the target', () => {
    const c = ctx({
      presentationsByItem: {
        [ITEM]: [
          { id: U(601), locale: 'es', displayName: 'Invitación para boda', isDefault: false },
        ],
      },
    });
    expect(codes(adaptCandidate(pres(), { locale: 'es', isDefault: false }, c))).toEqual([
      'PRESENTATION_EXISTS',
    ]);
    const linked = ops(
      adaptCandidate(
        pres(),
        { locale: 'es', isDefault: false, target: { mode: 'LINK_EXISTING', entityId: U(601) } },
        c,
      ),
    );
    expect(linked[0]).toMatchObject({
      op: 'LINK',
      linkKind: 'LINKED_EXISTING',
      entity: { id: U(601) },
    });
  });
  it('refuses a second default presentation for the same locale', () => {
    const c = ctx({
      presentationsByItem: {
        [ITEM]: [{ id: U(600), locale: 'es', displayName: 'Otro', isDefault: true }],
      },
    });
    expect(codes(adaptCandidate(pres(), { locale: 'es', isDefault: true }, c))).toEqual([
      'PRESENTATION_DEFAULT_EXISTS',
    ]);
  });
});
