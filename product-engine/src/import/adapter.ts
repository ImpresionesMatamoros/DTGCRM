import { validateComposition, type CompositionLine } from '../domain/composition';
import type {
  CatalogItemKind,
  CatalogStatus,
  CustomerSuppliedItem,
  DecorationPolicy,
  SaleUnit,
  Uuid,
} from '../domain/catalog';
import { isSpecValidForKind, kindHasValues, type OptionValueKind } from '../domain/options';
import type { AmountBasis } from '../domain/pricing-model';
import { formatAmount, money, MoneyError, type CurrencyCode, type Money } from '../shared/money';
import type {
  CatalogItemProposal,
  CompositionProposal,
  DecorationProposal,
  OptionProposal,
  PresentationProposal,
  PriceProposal,
  Proposal,
} from './proposal';
import { unresolvedFields } from './requirements';
import type {
  CatalogItemResolution,
  CompositionResolution,
  DecorationResolution,
  OptionResolution,
  PresentationResolution,
  PriceResolution,
} from './resolution';

/**
 * Domain adapter: ImportCandidate (+ human resolution) → validated plan of
 * domain writes. Pure and deterministic: every fact about the current domain
 * comes from `AdapterContext`, built by the persistence layer. Staging JSONB
 * never reaches a domain table without passing through here.
 */

// ---------------------------------------------------------------- context

export interface DomainItemRef {
  id: Uuid;
  kind: CatalogItemKind;
  status: CatalogStatus | null;
  saleUnit: SaleUnit | null;
  decorationPolicy: DecorationPolicy;
}

export interface SourceRecordRef {
  recordId: Uuid;
  recordKey: string;
  recordType: string;
  legacyId: string | null;
  role: string;
  sheet: string;
  firstCell: string;
  lastCell: string;
  workbookSha256: string;
}

export interface HistoricalEvidenceRef {
  recordId: Uuid;
  recordKey: string;
  priceLegacyId: string;
  amount: string | null;
  currency: string | null;
  conditions: Record<string, unknown>[];
}

export interface OptionLinkRef {
  itemId: Uuid;
  definitionId: Uuid;
  /** Source LISTAS record key → published option value id. */
  valueIdByRecordKey: Record<string, Uuid>;
  /** Source LISTAS record key → label shown in the workbook. */
  labelByRecordKey: Record<string, string | null>;
}

export interface ExistingPriceDefinition {
  id: Uuid;
  itemId: Uuid;
  priceBookId: Uuid;
  component: 'ITEM' | 'DECORATION';
  model: string;
  status: string;
  amount: string | null;
  maxQuantity: number | null;
  breaks: { quantity: number; amount: string; amountBasis: AmountBasis }[];
  /** `optionDefinitionId=optionValueId` pairs, sorted. */
  conditionSignature: string[];
}

export interface AdapterContext {
  mode: 'DRY_RUN' | 'PUBLISH';
  dataClass: 'REAL' | 'FIXTURE';
  /** Data classes whose candidates may write to the domain in this step. */
  publicationEnabledFor: readonly ('REAL' | 'FIXTURE')[];
  batchId: Uuid;
  candidateId: Uuid;
  sourceFile: string;
  blockingReasons: readonly string[];
  sourceRecords: readonly SourceRecordRef[];
  /** LEGACY_ID lineage: legacy id → catalog items carrying it. */
  itemsByLegacy: Readonly<Record<string, readonly Uuid[]>>;
  items: Readonly<Record<Uuid, DomainItemRef>>;
  /** Option legacy ids that are fixed single-value attributes of an item (not options). */
  fixedAttributeOptionsByItemLegacy: Readonly<Record<string, readonly string[]>>;
  historicalByItemLegacy: Readonly<Record<string, readonly HistoricalEvidenceRef[]>>;
  existingSourceLocators: Readonly<Record<Uuid, readonly string[]>>;
  optionDefinitions: Readonly<
    Record<string, { id: Uuid; key: string; valueKind: OptionValueKind; unit: string | null }>
  >;
  /** definition key → value code → id */
  optionValues: Readonly<Record<string, Readonly<Record<string, Uuid>>>>;
  itemOptions: Readonly<
    Record<
      string,
      {
        isRequired: boolean;
        selectionMode: 'SINGLE' | 'MULTI';
        isDistributable: boolean;
        valueIds: readonly Uuid[];
      }
    >
  >;
  decorationMethods: Readonly<Record<string, Uuid>>;
  capabilities: readonly string[];
  optionLinks: Readonly<Record<string, OptionLinkRef>>;
  compositionLines: readonly CompositionLine[];
  priceBooks: Readonly<Record<'USA' | 'MX', { id: Uuid; currency: CurrencyCode }>>;
  priceDefinitionsByItem: Readonly<Record<Uuid, readonly ExistingPriceDefinition[]>>;
  presentationsByItem: Readonly<
    Record<Uuid, readonly { id: Uuid; locale: string; displayName: string; isDefault: boolean }[]>
  >;
  /** STEP 06: existing categories by key (optional for older callers). */
  categories?: Readonly<Record<string, { id: Uuid; isActive: boolean }>>;
  /** STEP 06: current primary category of each domain item. */
  primaryCategoryByItem?: Readonly<Record<Uuid, Uuid>>;
}

// ---------------------------------------------------------------- output

export type EntityRef = { id: Uuid } | { ref: string };

export type DomainOp =
  | {
      op: 'CREATE_CATALOG_ITEM';
      ref: string;
      values: {
        kind: CatalogItemKind;
        canonicalName: string;
        status: CatalogStatus;
        saleUnit: SaleUnit | null;
        decorationPolicy: DecorationPolicy;
        customerSuppliedItem: CustomerSuppliedItem;
      };
    }
  | {
      op: 'CREATE_OPTION_DEFINITION';
      ref: string;
      values: {
        key: string;
        label: string;
        valueKind: OptionValueKind;
        unit: string | null;
        scope: 'ITEM' | 'DECORATION';
      };
    }
  | {
      op: 'CREATE_OPTION_VALUE';
      ref: string;
      definition: EntityRef;
      values: { code: string; label: string; spec: unknown; sort: number };
    }
  | {
      op: 'CREATE_ITEM_OPTION';
      itemId: Uuid;
      definition: EntityRef;
      values: {
        isRequired: boolean;
        selectionMode: 'SINGLE' | 'MULTI';
        isDistributable: boolean;
        sort: number;
      };
    }
  | {
      op: 'CREATE_ITEM_OPTION_VALUE';
      itemId: Uuid;
      definition: EntityRef;
      value: EntityRef;
      sort: number;
    }
  | { op: 'CREATE_DECORATION_CAPABILITY'; itemId: Uuid; methodId: Uuid }
  | { op: 'ASSIGN_CATEGORY'; item: EntityRef; categoryId: Uuid; categoryKey: string }
  | { op: 'SET_DECORATION_POLICY'; itemId: Uuid; from: DecorationPolicy; to: DecorationPolicy }
  | {
      op: 'CREATE_COMPOSITION_LINE';
      ref: string;
      values: {
        parentItemId: Uuid;
        childItemId: Uuid;
        quantity: number;
        role: 'INCLUDED' | 'OPTIONAL';
      };
    }
  | {
      op: 'CREATE_PRICE_DEFINITION';
      ref: string;
      values: {
        itemId: Uuid;
        priceBookId: Uuid;
        component: 'ITEM';
        model: 'EXACT_QUANTITY_MATRIX' | 'FIXED';
        amount: Money | null;
        maxQuantity: number | null;
        validFrom: string;
        status: 'DRAFT';
      };
      breaks: { quantity: number; amount: Money; amountBasis: AmountBasis }[];
      conditions: { optionDefinitionId: Uuid; optionValueId: Uuid }[];
    }
  | {
      op: 'CREATE_PRESENTATION';
      ref: string;
      values: {
        itemId: Uuid;
        locale: 'es' | 'en';
        occasion: string | null;
        displayName: string;
        isDefault: boolean;
      };
    }
  | {
      op: 'ADD_SOURCE_REFERENCE';
      entityType: string;
      entity: EntityRef;
      sourceKind: 'LEGACY_ID' | 'EXCEL_ROW' | 'HISTORICAL_PRICE_EVIDENCE';
      locator: string;
      payload: Record<string, unknown> | null;
    }
  | {
      op: 'LINK';
      role: string;
      entityType: string;
      entity: EntityRef;
      linkKind: 'CREATED' | 'LINKED_EXISTING';
      detail: Record<string, unknown> | null;
    };

export type AdapterErrorCode =
  | 'NOT_PUBLISHABLE_IN_THIS_STEP'
  | 'BLOCKED'
  | 'UNRESOLVED_FIELD'
  | 'KIND_UNRESOLVED'
  | 'INVALID_VALUE'
  | 'LINEAGE_EXISTS'
  | 'LINEAGE_AMBIGUOUS'
  | 'LINK_TARGET_NOT_FOUND'
  | 'LINK_TARGET_MISMATCH'
  | 'DEPENDENCY_NOT_PUBLISHED'
  | 'OPTION_DEFINITION_NOT_FOUND'
  | 'OPTION_DEFINITION_EXISTS'
  | 'OPTION_VALUE_UNMAPPED'
  | 'OPTION_VALUE_INVALID'
  | 'ITEM_OPTION_CONFLICT'
  | 'DECORATION_METHOD_NOT_FOUND'
  | 'DECORATION_POLICY_NONE'
  | 'DECORATION_POLICY_CONFLICT'
  | 'COMPOSITION_INVALID'
  | 'COMPOSITION_CONFLICT'
  | 'PRICE_BOOK_NOT_FOUND'
  | 'MONEY_CURRENCY_MISMATCH'
  | 'MONEY_INVALID'
  | 'CONDITION_UNMAPPED'
  | 'CONDITION_VALUE_UNMAPPED'
  | 'PRICE_DEFINITION_EXISTS'
  | 'PRICE_MISMATCH_WITH_EXISTING'
  | 'PRESENTATION_DEFAULT_EXISTS'
  | 'PRESENTATION_EXISTS'
  | 'CATEGORY_NOT_FOUND'
  | 'CATEGORY_CONFLICT';

export interface AdapterError {
  code: AdapterErrorCode;
  field?: string;
  message: string;
  detail?: Record<string, unknown>;
}

export interface AdapterPlan {
  kind: Proposal['kind'];
  ops: DomainOp[];
  /** Non-blocking notes for the reviewer (e.g. link keeps a different domain status). */
  notes: string[];
}

export type AdapterResult = { ok: true; plan: AdapterPlan } | { ok: false; errors: AdapterError[] };

// ---------------------------------------------------------------- entry point

export function adaptCandidate(
  proposal: Proposal,
  resolution: Record<string, unknown> | null,
  ctx: AdapterContext,
): AdapterResult {
  const errors: AdapterError[] = [];
  if (ctx.mode === 'PUBLISH' && !ctx.publicationEnabledFor.includes(ctx.dataClass)) {
    errors.push({
      code: 'NOT_PUBLISHABLE_IN_THIS_STEP',
      message: `${ctx.dataClass} candidates cannot be published in this step (only ${ctx.publicationEnabledFor.join(', ')})`,
    });
  }
  if (ctx.blockingReasons.length > 0) {
    errors.push({
      code: 'BLOCKED',
      message: `candidate is blocked: ${ctx.blockingReasons.join(', ')}`,
      detail: { reasons: [...ctx.blockingReasons] },
    });
  }
  for (const field of unresolvedFields(proposal, resolution)) {
    errors.push({
      code: field === 'itemType' ? 'KIND_UNRESOLVED' : 'UNRESOLVED_FIELD',
      field,
      message: `${field} is unknown in the source and has no human resolution`,
    });
  }
  if (errors.length > 0) return { ok: false, errors };

  const r = resolution ?? {};
  const b = new Builder(ctx);
  switch (proposal.kind) {
    case 'CATALOG_ITEM':
      adaptCatalogItem(proposal, r as CatalogItemResolution, b);
      break;
    case 'OPTION':
      adaptOption(proposal, r as OptionResolution, b);
      break;
    case 'DECORATION':
      adaptDecoration(proposal, r as DecorationResolution, b);
      break;
    case 'COMPOSITION':
      adaptComposition(proposal, r as CompositionResolution, b);
      break;
    case 'PRICE':
      adaptPrice(proposal, r as PriceResolution, b);
      break;
    case 'PRESENTATION':
      adaptPresentation(proposal, r as PresentationResolution, b);
      break;
  }
  if (b.errors.length > 0) return { ok: false, errors: b.errors };
  return { ok: true, plan: { kind: proposal.kind, ops: b.ops, notes: b.notes } };
}

class Builder {
  ops: DomainOp[] = [];
  errors: AdapterError[] = [];
  notes: string[] = [];
  constructor(readonly ctx: AdapterContext) {}

  error(code: AdapterErrorCode, message: string, extra: Partial<AdapterError> = {}): void {
    this.errors.push({ code, message, ...extra });
  }

  /** Exactly one domain item must carry the legacy id (LEGACY_ID lineage). */
  item(legacy: string | null, field: string): DomainItemRef | null {
    if (!legacy) {
      this.error('DEPENDENCY_NOT_PUBLISHED', `${field}: no legacy reference`, { field });
      return null;
    }
    const ids = this.ctx.itemsByLegacy[legacy] ?? [];
    if (ids.length === 0) {
      this.error(
        'DEPENDENCY_NOT_PUBLISHED',
        `${field}: catalog item ${legacy} is not in the domain yet`,
        {
          field,
          detail: { legacyId: legacy },
        },
      );
      return null;
    }
    if (ids.length > 1) {
      this.error('LINEAGE_AMBIGUOUS', `${field}: ${legacy} maps to ${ids.length} catalog items`, {
        field,
        detail: { legacyId: legacy, itemIds: [...ids] },
      });
      return null;
    }
    const item = this.ctx.items[ids[0]!];
    if (!item) {
      this.error('LINK_TARGET_NOT_FOUND', `${field}: item ${ids[0]} not loaded`, { field });
      return null;
    }
    return item;
  }

  /** Explicitly chosen Product Engine category (never inferred from the legacy category). */
  category(key: string): { id: Uuid; key: string } | null {
    const c = this.ctx.categories?.[key];
    if (!c || !c.isActive) {
      this.error('CATEGORY_NOT_FOUND', `category ${key} does not exist or is inactive`, {
        field: 'categoryKey',
      });
      return null;
    }
    return { id: c.id, key };
  }

  link(
    role: string,
    entityType: string,
    entity: EntityRef,
    linkKind: 'CREATED' | 'LINKED_EXISTING',
    detail: Record<string, unknown> | null = null,
  ) {
    this.ops.push({ op: 'LINK', role, entityType, entity, linkKind, detail });
  }

  /** EXCEL_ROW provenance for each source record, unless the entity already has it. */
  excelRows(entityType: string, entity: EntityRef, roles?: readonly string[]) {
    const existing =
      'id' in entity
        ? new Set(this.ctx.existingSourceLocators[entity.id] ?? [])
        : new Set<string>();
    for (const s of this.ctx.sourceRecords) {
      if (roles && !roles.includes(s.role)) continue;
      const locator = `${this.ctx.sourceFile}!${s.sheet}!${s.firstCell}:${s.lastCell}`;
      if (existing.has(locator)) continue;
      existing.add(locator);
      this.ops.push({
        op: 'ADD_SOURCE_REFERENCE',
        entityType,
        entity,
        sourceKind: 'EXCEL_ROW',
        locator,
        payload: {
          importBatchId: this.ctx.batchId,
          importCandidateId: this.ctx.candidateId,
          importRecordId: s.recordId,
          recordKey: s.recordKey,
          recordType: s.recordType,
          legacyId: s.legacyId,
          workbookSha256: s.workbookSha256,
        },
      });
    }
  }
}

// ---------------------------------------------------------------- CATALOG_ITEM

function adaptCatalogItem(p: CatalogItemProposal, r: CatalogItemResolution, b: Builder) {
  const kind = (r.itemType ?? p.itemType)!;
  const status = (r.status ?? p.status)!;
  const decorationPolicy = r.decorationPolicy!;
  const name = (r.canonicalName ?? p.name ?? '').trim();
  const saleUnit = r.saleUnit !== undefined ? r.saleUnit : p.saleUnit;
  let customerSupplied: CustomerSuppliedItem;
  if (kind === 'PRODUCT') {
    if (r.customerSuppliedItem && r.customerSuppliedItem !== 'NOT_APPLICABLE') {
      b.error('INVALID_VALUE', 'customer supplied item applies only to SERVICE', {
        field: 'customerSuppliedItem',
      });
    }
    if (p.customerSuppliedEvidence === true) {
      b.error(
        'INVALID_VALUE',
        'the source says the item accepts customer material, which only a SERVICE can',
        {
          field: 'itemType',
        },
      );
    }
    customerSupplied = 'NOT_APPLICABLE';
  } else {
    customerSupplied = r.customerSuppliedItem!; // required for SERVICE (requirements)
  }
  if (name === '') b.error('INVALID_VALUE', 'canonical name is empty', { field: 'canonicalName' });

  const lineage = b.ctx.itemsByLegacy[p.legacyId] ?? [];
  const target = r.target ?? (lineage.length === 0 ? { mode: 'CREATE' as const } : undefined);
  if (!target) {
    b.error(
      'LINEAGE_EXISTS',
      `${p.legacyId} is already linked to ${lineage.join(', ')}; choose target LINK_EXISTING`,
      {
        field: 'target',
        detail: { legacyId: p.legacyId, itemIds: [...lineage] },
      },
    );
    return;
  }
  if (target.mode === 'CREATE') {
    if (lineage.length > 0) {
      b.error(
        'LINEAGE_EXISTS',
        `${p.legacyId} already exists in the domain; creating it again would duplicate it`,
        {
          field: 'target',
          detail: { itemIds: [...lineage] },
        },
      );
      return;
    }
    const category = r.categoryKey ? b.category(r.categoryKey) : null;
    if (r.categoryKey && !category) return;
    const ref = { ref: 'item' };
    b.ops.push({
      op: 'CREATE_CATALOG_ITEM',
      ref: 'item',
      values: {
        kind,
        canonicalName: name,
        status,
        saleUnit,
        decorationPolicy,
        customerSuppliedItem: customerSupplied,
      },
    });
    b.link('catalog_item', 'catalog_item', ref, 'CREATED', { legacyId: p.legacyId });
    b.ops.push({
      op: 'ADD_SOURCE_REFERENCE',
      entityType: 'catalog_item',
      entity: ref,
      sourceKind: 'LEGACY_ID',
      locator: p.legacyId,
      payload: null,
    });
    if (category) {
      b.ops.push({
        op: 'ASSIGN_CATEGORY',
        item: ref,
        categoryId: category.id,
        categoryKey: category.key,
      });
    }
    b.excelRows('catalog_item', ref, ['PRIMARY']);
    historicalEvidence(p.legacyId, ref, b);
    return;
  }
  const existing = b.ctx.items[target.entityId];
  if (!existing) {
    b.error('LINK_TARGET_NOT_FOUND', `catalog item ${target.entityId} does not exist`, {
      field: 'target',
    });
    return;
  }
  if (lineage.length > 0 && !lineage.includes(existing.id)) {
    b.error(
      'LINK_TARGET_MISMATCH',
      `${p.legacyId} belongs to ${lineage.join(', ')}, not ${existing.id}`,
      { field: 'target' },
    );
    return;
  }
  if (existing.kind !== kind) {
    b.error('LINK_TARGET_MISMATCH', `kind ${kind} differs from domain kind ${existing.kind}`, {
      field: 'itemType',
    });
    return;
  }
  let assignCategory: { id: Uuid; key: string } | null = null;
  if (r.categoryKey) {
    const category = b.category(r.categoryKey);
    if (!category) return;
    const current = b.ctx.primaryCategoryByItem?.[existing.id];
    if (current && current !== category.id) {
      b.error(
        'CATEGORY_CONFLICT',
        `item ${existing.id} already has another primary category; change it in the catalog, not in the import`,
        { field: 'categoryKey', detail: { currentCategoryId: current } },
      );
      return;
    }
    if (current === category.id) b.notes.push(`item already has primary category ${category.key}`);
    else assignCategory = category;
  }
  const ref = { id: existing.id };
  b.link('catalog_item', 'catalog_item', ref, 'LINKED_EXISTING', { legacyId: p.legacyId });
  if (assignCategory) {
    b.ops.push({
      op: 'ASSIGN_CATEGORY',
      item: ref,
      categoryId: assignCategory.id,
      categoryKey: assignCategory.key,
    });
  }
  if (lineage.length === 0) {
    b.ops.push({
      op: 'ADD_SOURCE_REFERENCE',
      entityType: 'catalog_item',
      entity: ref,
      sourceKind: 'LEGACY_ID',
      locator: p.legacyId,
      payload: null,
    });
  }
  b.excelRows('catalog_item', ref, ['PRIMARY']);
  historicalEvidence(p.legacyId, ref, b);
  const diff = (f: string, a: unknown, c: unknown) => {
    if (a !== c) b.notes.push(`link keeps domain ${f}=${String(c)} (import proposes ${String(a)})`);
  };
  diff('status', status, existing.status);
  diff('saleUnit', saleUnit, existing.saleUnit);
  diff('decorationPolicy', decorationPolicy, existing.decorationPolicy);
}

function historicalEvidence(legacy: string, entity: EntityRef, b: Builder) {
  const existing =
    'id' in entity ? new Set(b.ctx.existingSourceLocators[entity.id] ?? []) : new Set<string>();
  for (const h of b.ctx.historicalByItemLegacy[legacy] ?? []) {
    const locator = `${b.ctx.sourceFile}!PRECIOS[${h.priceLegacyId}]`;
    if (existing.has(locator)) continue;
    b.ops.push({
      op: 'ADD_SOURCE_REFERENCE',
      entityType: 'catalog_item',
      entity,
      sourceKind: 'HISTORICAL_PRICE_EVIDENCE',
      locator,
      payload: {
        amount: h.amount,
        currency: h.currency,
        conditions: h.conditions,
        importBatchId: b.ctx.batchId,
        importRecordId: h.recordId,
        recordKey: h.recordKey,
        status: 'HISTORICAL — never an active price (ADR-0005)',
      },
    });
  }
}

// ---------------------------------------------------------------- OPTION

function adaptOption(p: OptionProposal, r: OptionResolution, b: Builder) {
  const item = b.item(p.itemLegacyId, 'item');
  if (!item) return;
  const isRequired = r.isRequired ?? p.required;
  if (isRequired === null) return; // unreachable: requirements already enforce it
  let definition: EntityRef;
  let valueKind: OptionValueKind;
  let defKey: string;
  if (r.definition.mode === 'EXISTING') {
    const def = b.ctx.optionDefinitions[r.definition.key];
    if (!def) {
      b.error(
        'OPTION_DEFINITION_NOT_FOUND',
        `option definition ${r.definition.key} does not exist`,
        { field: 'definition' },
      );
      return;
    }
    definition = { id: def.id };
    valueKind = def.valueKind;
    defKey = def.key;
  } else {
    const d = r.definition;
    if (b.ctx.optionDefinitions[d.key]) {
      b.error(
        'OPTION_DEFINITION_EXISTS',
        `option definition ${d.key} already exists; use EXISTING`,
        { field: 'definition' },
      );
      return;
    }
    const measured =
      d.valueKind === 'DIMENSIONS' || d.valueKind === 'QUANTITY' || d.valueKind === 'LENGTH';
    if (measured !== (d.unit !== null)) {
      b.error(
        'INVALID_VALUE',
        `valueKind ${d.valueKind} ${measured ? 'needs' : 'cannot have'} a unit`,
        { field: 'definition.unit' },
      );
      return;
    }
    b.ops.push({
      op: 'CREATE_OPTION_DEFINITION',
      ref: 'definition',
      values: { key: d.key, label: d.label, valueKind: d.valueKind, unit: d.unit, scope: d.scope },
    });
    definition = { ref: 'definition' };
    valueKind = d.valueKind;
    defKey = d.key;
  }
  if (r.isDistributable && (r.selectionMode !== 'SINGLE' || valueKind !== 'ENUM')) {
    b.error('INVALID_VALUE', 'only SINGLE ENUM options can be distributable', {
      field: 'isDistributable',
    });
  }

  const sourceKeys = new Set(p.values.map((v) => v.recordKey));
  for (const k of Object.keys(r.values)) {
    if (!sourceKeys.has(k))
      b.error('OPTION_VALUE_INVALID', `value ${k} is not a source value of this option`, {
        field: `values.${k}`,
      });
  }
  const chosen: { recordKey: string; label: string | null; value: EntityRef; created: boolean }[] =
    [];
  const existingCodes = b.ctx.optionValues[defKey] ?? {};
  p.values.forEach((v, i) => {
    const choice = r.values[v.recordKey];
    if (!choice) {
      b.error(
        'OPTION_VALUE_UNMAPPED',
        `source value "${String(v.label)}" (${v.recordKey}) has no decision`,
        { field: `values.${v.recordKey}` },
      );
      return;
    }
    if (choice.mode === 'EXCLUDE') return;
    if (!kindHasValues(valueKind)) {
      b.error(
        'OPTION_VALUE_INVALID',
        `${valueKind} options have no enumerated values; exclude "${String(v.label)}"`,
        { field: `values.${v.recordKey}` },
      );
      return;
    }
    if (choice.mode === 'EXISTING') {
      const id = existingCodes[choice.code];
      if (!id || 'ref' in definition) {
        b.error('OPTION_VALUE_INVALID', `value code ${choice.code} does not exist in ${defKey}`, {
          field: `values.${v.recordKey}`,
        });
        return;
      }
      chosen.push({ recordKey: v.recordKey, label: v.label, value: { id }, created: false });
      return;
    }
    if (existingCodes[choice.code]) {
      b.error(
        'OPTION_VALUE_INVALID',
        `value code ${choice.code} already exists in ${defKey}; use EXISTING`,
        { field: `values.${v.recordKey}` },
      );
      return;
    }
    if (!isSpecValidForKind(valueKind, choice.spec as never)) {
      b.error('OPTION_VALUE_INVALID', `spec of ${choice.code} does not match ${valueKind}`, {
        field: `values.${v.recordKey}`,
      });
      return;
    }
    const ref = `value:${v.recordKey}`;
    b.ops.push({
      op: 'CREATE_OPTION_VALUE',
      ref,
      definition,
      values: { code: choice.code, label: choice.label, spec: choice.spec, sort: i },
    });
    chosen.push({ recordKey: v.recordKey, label: v.label, value: { ref }, created: true });
  });
  if (b.errors.length > 0) return;

  const existing =
    'id' in definition ? b.ctx.itemOptions[`${item.id}:${definition.id}`] : undefined;
  if (existing) {
    if (
      existing.isRequired !== isRequired ||
      existing.selectionMode !== r.selectionMode ||
      existing.isDistributable !== r.isDistributable
    ) {
      b.error('ITEM_OPTION_CONFLICT', `item option ${defKey} exists with different flags`, {
        detail: {
          existing: { ...existing, valueIds: [...existing.valueIds] },
          proposed: {
            isRequired,
            selectionMode: r.selectionMode,
            isDistributable: r.isDistributable,
          },
        },
      });
      return;
    }
    b.link('item_option', 'option_definition', definition, 'LINKED_EXISTING', {
      itemId: item.id,
      optionKey: defKey,
    });
  } else {
    b.ops.push({
      op: 'CREATE_ITEM_OPTION',
      itemId: item.id,
      definition,
      values: {
        isRequired,
        selectionMode: r.selectionMode,
        isDistributable: r.isDistributable,
        sort: r.sort ?? 0,
      },
    });
    b.link('item_option', 'option_definition', definition, 'CREATED', {
      itemId: item.id,
      optionKey: defKey,
    });
  }
  const enabled = new Set(existing?.valueIds ?? []);
  chosen.forEach((c, i) => {
    const already = 'id' in c.value && enabled.has(c.value.id);
    if (!already)
      b.ops.push({
        op: 'CREATE_ITEM_OPTION_VALUE',
        itemId: item.id,
        definition,
        value: c.value,
        sort: i,
      });
    b.link('option_value', 'option_value', c.value, already ? 'LINKED_EXISTING' : 'CREATED', {
      recordKey: c.recordKey,
      label: c.label,
      itemId: item.id,
    });
  });
}

// ---------------------------------------------------------------- DECORATION

function adaptDecoration(p: DecorationProposal, r: DecorationResolution, b: Builder) {
  const item = b.item(p.itemLegacyId, 'item');
  if (!item) return;
  if (p.subtype === 'METHOD_ASSOCIATION') {
    const key = r.methodKey!;
    const methodId = b.ctx.decorationMethods[key];
    if (!methodId) {
      b.error('DECORATION_METHOD_NOT_FOUND', `decoration method ${key} does not exist`, {
        field: 'methodKey',
      });
      return;
    }
    if (item.decorationPolicy === 'NONE') {
      b.error(
        'DECORATION_POLICY_NONE',
        `item ${item.id} does not accept decoration; publish its decoration policy first`,
        { field: 'item' },
      );
      return;
    }
    const exists = b.ctx.capabilities.includes(`${item.id}:${methodId}`);
    if (!exists) b.ops.push({ op: 'CREATE_DECORATION_CAPABILITY', itemId: item.id, methodId });
    b.link(
      'decoration_capability',
      'catalog_item',
      { id: item.id },
      exists ? 'LINKED_EXISTING' : 'CREATED',
      { methodKey: key, methodId },
    );
    return;
  }
  const to = r.decorationPolicy ?? p.decorationPolicy;
  if (item.decorationPolicy === to) {
    b.link('decoration_policy', 'catalog_item', { id: item.id }, 'LINKED_EXISTING', {
      decorationPolicy: to,
    });
    return;
  }
  if (to === 'NONE' && b.ctx.capabilities.some((c) => c.startsWith(`${item.id}:`))) {
    b.error(
      'DECORATION_POLICY_CONFLICT',
      'item has decoration capabilities; policy NONE is not possible',
      { field: 'decorationPolicy' },
    );
    return;
  }
  b.ops.push({ op: 'SET_DECORATION_POLICY', itemId: item.id, from: item.decorationPolicy, to });
  b.link('decoration_policy', 'catalog_item', { id: item.id }, 'CREATED', {
    from: item.decorationPolicy,
    to,
  });
}

// ---------------------------------------------------------------- COMPOSITION

function adaptComposition(p: CompositionProposal, r: CompositionResolution, b: Builder) {
  const parentLegacy = p.subtype === 'RELATION' ? p.parentLegacyId : p.itemLegacyId;
  const childLegacy = r.childLegacyId ?? (p.subtype === 'RELATION' ? p.childLegacyId : null);
  const parent = b.item(parentLegacy, 'parent');
  const child = b.item(childLegacy, 'child');
  if (!parent || !child) return;
  const quantity = (r.quantity ?? (p.subtype === 'RELATION' ? p.quantity : null))!;
  const role = (r.role ?? (p.subtype === 'RELATION' ? p.role : null))!;
  const existing = b.ctx.compositionLines.find(
    (l) => l.parentItemId === parent.id && l.childItemId === child.id,
  );
  if (existing) {
    if (existing.quantity !== quantity || existing.role !== role) {
      b.error('COMPOSITION_CONFLICT', 'composition line exists with a different quantity or role', {
        detail: {
          existing: { quantity: existing.quantity, role: existing.role },
          proposed: { quantity, role },
        },
      });
      return;
    }
    b.link('composition_line', 'composition_line', { id: existing.id }, 'LINKED_EXISTING', null);
    b.excelRows('composition_line', { id: existing.id }, ['PRIMARY']);
    return;
  }
  const probe: CompositionLine = {
    id: 'import-probe',
    parentItemId: parent.id,
    childItemId: child.id,
    quantity,
    role,
    sort: 0,
    note: null,
  };
  const issues = validateComposition([...b.ctx.compositionLines, probe]);
  if (issues.length > 0) {
    b.error(
      'COMPOSITION_INVALID',
      `composition would be invalid: ${issues.map((i) => i.code).join(', ')}`,
      { detail: { issues } },
    );
    return;
  }
  b.ops.push({
    op: 'CREATE_COMPOSITION_LINE',
    ref: 'line',
    values: { parentItemId: parent.id, childItemId: child.id, quantity, role },
  });
  b.link('composition_line', 'composition_line', { ref: 'line' }, 'CREATED', null);
  b.excelRows('composition_line', { ref: 'line' }, ['PRIMARY']);
}

// ---------------------------------------------------------------- PRICE

function toMoney(amount: string, currency: CurrencyCode, b: Builder, field: string): Money | null {
  try {
    const m = money(amount, currency);
    if (m.amount.decimalPlaces() > 2) {
      b.error('MONEY_INVALID', `${amount} has more than 2 decimals; it would be rounded silently`, {
        field,
      });
      return null;
    }
    if (m.amount.isNegative()) {
      b.error('MONEY_INVALID', `${amount} is negative`, { field });
      return null;
    }
    return m;
  } catch (e) {
    b.error('MONEY_INVALID', e instanceof MoneyError ? e.message : `invalid amount ${amount}`, {
      field,
    });
    return null;
  }
}

function adaptPrice(p: PriceProposal, r: PriceResolution, b: Builder) {
  const item = b.item(p.itemLegacyId, 'item');
  if (!item || p.market === null || p.currency === null || p.model === null) return;
  const book = b.ctx.priceBooks[p.market];
  if (!book) {
    b.error('PRICE_BOOK_NOT_FOUND', `no price book for market ${p.market}`);
    return;
  }
  if (book.currency !== p.currency) {
    b.error(
      'MONEY_CURRENCY_MISMATCH',
      `evidence currency ${p.currency} differs from book currency ${book.currency}`,
    );
    return;
  }
  const amountBasis = (r.amountBasis ?? p.amountBasis)!;
  const validFrom = r.validFrom!;
  if (item.saleUnit === null) {
    b.notes.push(
      'item has no sale unit: the DRAFT definition cannot be authorized until it has one',
    );
  }

  // Conditions: fixed single-value attributes are inherent to the item, not conditions.
  const fixed = new Set(b.ctx.fixedAttributeOptionsByItemLegacy[p.itemLegacyId] ?? []);
  const conditions: { optionDefinitionId: Uuid; optionValueId: Uuid }[] = [];
  for (const c of p.conditions) {
    if (c.optionLegacyId && fixed.has(c.optionLegacyId)) {
      b.notes.push(
        `condition ${c.attribute}=${c.value} is a fixed attribute of the item; not a price condition`,
      );
      continue;
    }
    const link = c.optionLegacyId ? b.ctx.optionLinks[c.optionLegacyId] : undefined;
    if (!link) {
      b.error(
        'CONDITION_UNMAPPED',
        `condition ${c.attribute}=${c.value}: option ${c.optionLegacyId} is not published`,
        {
          field: 'conditions',
          detail: { optionLegacyId: c.optionLegacyId },
        },
      );
      continue;
    }
    if (link.itemId !== item.id) {
      b.error('CONDITION_UNMAPPED', `option ${c.optionLegacyId} is published for another item`, {
        field: 'conditions',
      });
      continue;
    }
    const matches = Object.entries(link.labelByRecordKey).filter(
      ([, label]) => label !== null && label === c.value,
    );
    const valueId = matches.length === 1 ? link.valueIdByRecordKey[matches[0]![0]] : undefined;
    if (!valueId) {
      b.error(
        'CONDITION_VALUE_UNMAPPED',
        `condition ${c.attribute}=${c.value} matches ${matches.length} published values`,
        {
          field: 'conditions',
          detail: { optionLegacyId: c.optionLegacyId, value: c.value },
        },
      );
      continue;
    }
    conditions.push({ optionDefinitionId: link.definitionId, optionValueId: valueId });
  }
  if (b.errors.length > 0) return;

  let breaks: { quantity: number; amount: Money; amountBasis: AmountBasis }[] = [];
  let amount: Money | null = null;
  let maxQuantity: number | null = null;
  if (p.model === 'EXACT_QUANTITY_MATRIX') {
    breaks = p.observations.flatMap((o) => {
      const m = toMoney(o.amount!, p.currency!, b, `observations.${o.priceLegacyId}`);
      return m ? [{ quantity: o.quantity!, amount: m, amountBasis }] : [];
    });
  } else {
    const o = p.observations[0]!;
    amount = toMoney(o.amount!, p.currency, b, `observations.${o.priceLegacyId}`);
    maxQuantity = r.maxQuantity ?? o.quantity;
  }
  if (b.errors.length > 0) return;

  const signature = conditions.map((c) => `${c.optionDefinitionId}=${c.optionValueId}`).sort();
  const sameScope = (b.ctx.priceDefinitionsByItem[item.id] ?? []).filter(
    (d) =>
      d.priceBookId === book.id &&
      d.component === 'ITEM' &&
      d.conditionSignature.join('|') === signature.join('|'),
  );
  const target = r.target;
  if (target?.mode === 'LINK_EXISTING') {
    const d = sameScope.find((x) => x.id === target.entityId);
    if (!d) {
      b.error(
        'LINK_TARGET_MISMATCH',
        `price definition ${target.entityId} is not a definition of this item, book and condition set`,
        { field: 'target' },
      );
      return;
    }
    const diffs = comparePrice(d, p.model, amount, maxQuantity, breaks);
    if (diffs.length > 0) {
      b.error('PRICE_MISMATCH_WITH_EXISTING', `existing definition differs: ${diffs.join('; ')}`, {
        field: 'target',
        detail: { diffs },
      });
      return;
    }
    b.link('price_definition', 'price_definition', { id: d.id }, 'LINKED_EXISTING', {
      observations: p.observations.map((o) => o.priceLegacyId),
      status: d.status,
    });
    b.excelRows('price_definition', { id: d.id }, ['OBSERVATION']);
    return;
  }
  if (sameScope.length > 0) {
    b.error(
      'PRICE_DEFINITION_EXISTS',
      `a definition with the same scope exists (${sameScope.map((d) => `${d.id}:${d.status}`).join(', ')}); link it or version it explicitly`,
      {
        field: 'target',
        detail: { definitionIds: sameScope.map((d) => d.id) },
      },
    );
    return;
  }
  b.ops.push({
    op: 'CREATE_PRICE_DEFINITION',
    ref: 'price',
    values: {
      itemId: item.id,
      priceBookId: book.id,
      component: 'ITEM',
      model: p.model,
      amount,
      maxQuantity,
      validFrom,
      status: 'DRAFT',
    },
    breaks,
    conditions,
  });
  b.link('price_definition', 'price_definition', { ref: 'price' }, 'CREATED', {
    observations: p.observations.map((o) => o.priceLegacyId),
    status: 'DRAFT',
  });
  b.excelRows('price_definition', { ref: 'price' }, ['OBSERVATION']);
  b.notes.push('published as DRAFT: authorization in Product Engine is a separate act (P1-06)');
}

function comparePrice(
  d: ExistingPriceDefinition,
  model: 'EXACT_QUANTITY_MATRIX' | 'FIXED',
  amount: Money | null,
  maxQuantity: number | null,
  breaks: { quantity: number; amount: Money; amountBasis: AmountBasis }[],
): string[] {
  const diffs: string[] = [];
  if (d.model !== model) diffs.push(`model ${d.model} ≠ ${model}`);
  if (model === 'FIXED') {
    if (amount && d.amount !== formatAmount(amount))
      diffs.push(`amount ${d.amount} ≠ ${formatAmount(amount)}`);
    if (d.maxQuantity !== maxQuantity) diffs.push(`max quantity ${d.maxQuantity} ≠ ${maxQuantity}`);
  } else {
    const a = d.breaks.map((x) => `${x.quantity}:${x.amount}:${x.amountBasis}`).sort();
    const c = breaks.map((x) => `${x.quantity}:${formatAmount(x.amount)}:${x.amountBasis}`).sort();
    if (a.join('|') !== c.join('|')) diffs.push(`breaks ${a.join(',')} ≠ ${c.join(',')}`);
  }
  return diffs;
}

// ---------------------------------------------------------------- PRESENTATION

function adaptPresentation(p: PresentationProposal, r: PresentationResolution, b: Builder) {
  const item = b.item(p.itemLegacyId, 'item');
  if (!item) return;
  const locale = (r.locale ?? p.locale)!;
  const isDefault = r.isDefault!;
  const displayName = (r.displayName ?? p.displayName ?? '').trim();
  const existing = b.ctx.presentationsByItem[item.id] ?? [];
  const same = existing.find((x) => x.locale === locale && x.displayName === displayName);
  if (r.target?.mode === 'LINK_EXISTING') {
    const id = r.target.entityId;
    if (!existing.some((x) => x.id === id)) {
      b.error('LINK_TARGET_MISMATCH', `presentation ${id} does not belong to item ${item.id}`, {
        field: 'target',
      });
      return;
    }
    b.link('presentation', 'presentation', { id }, 'LINKED_EXISTING', null);
    b.excelRows('presentation', { id }, ['PRIMARY', 'REFERENCE']);
    return;
  }
  if (same) {
    // A matching name is a hint, never an identity: the reviewer must choose LINK_EXISTING.
    b.error(
      'PRESENTATION_EXISTS',
      `item already has a ${locale} presentation "${displayName}" (${same.id})`,
      {
        field: 'target',
        detail: { presentationId: same.id },
      },
    );
    return;
  }
  if (isDefault && existing.some((x) => x.locale === locale && x.isDefault)) {
    b.error('PRESENTATION_DEFAULT_EXISTS', `item already has a default ${locale} presentation`, {
      field: 'isDefault',
    });
    return;
  }
  b.ops.push({
    op: 'CREATE_PRESENTATION',
    ref: 'presentation',
    values: { itemId: item.id, locale, occasion: p.occasion, displayName, isDefault },
  });
  b.link('presentation', 'presentation', { ref: 'presentation' }, 'CREATED', null);
  b.excelRows('presentation', { ref: 'presentation' }, ['PRIMARY', 'REFERENCE']);
}
