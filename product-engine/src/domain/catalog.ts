/**
 * CatalogItem: stable commercial identity (STEP 02 §3, ADR-0011).
 * Identity never depends on category, name or public code semantics.
 * BUNDLE is part of the conceptual model but not implemented (no evidence yet).
 */

export type Uuid = string;

export const CATALOG_ITEM_KINDS = ['PRODUCT', 'SERVICE'] as const;
export type CatalogItemKind = (typeof CATALOG_ITEM_KINDS)[number];

export const CATALOG_STATUSES = ['CANDIDATE', 'PLANNED', 'ACTIVE', 'RETIRED'] as const;
export type CatalogStatus = (typeof CATALOG_STATUSES)[number];

/** Units of sale with evidence in the audited catalog. */
export const SALE_UNITS = [
  'PIECE',
  'PAIR',
  'SET',
  'PACKAGE',
  'SHEET',
  'SQ_FT',
  'LINEAR_FT',
] as const;
export type SaleUnit = (typeof SALE_UNITS)[number];

export const DECORATION_POLICIES = ['NONE', 'OPTIONAL', 'REQUIRED'] as const;
export type DecorationPolicy = (typeof DECORATION_POLICIES)[number];

export const CUSTOMER_SUPPLIED_ITEM = ['NOT_APPLICABLE', 'ALLOWED', 'REQUIRED'] as const;
export type CustomerSuppliedItem = (typeof CUSTOMER_SUPPLIED_ITEM)[number];

export type LengthUnit = 'in' | 'ft';

/** What measurements a configured item must provide (area or length). */
export type MeasurementSpec =
  { kind: 'AREA'; unit: LengthUnit } | { kind: 'LENGTH'; unit: LengthUnit };

interface CatalogItemBase {
  id: Uuid;
  /** Human identifier `DTG-00001`; carries no meaning (ADR-0011). */
  publicCode: string;
  canonicalName: string;
  /** null = not assigned yet (migration only, ADR-0002). Never a fifth state. */
  status: CatalogStatus | null;
  saleUnit: SaleUnit | null;
  measurementSpec: MeasurementSpec | null;
  decorationPolicy: DecorationPolicy;
  descriptionInternal: string | null;
  mergedIntoId: Uuid | null;
}

export interface Product extends CatalogItemBase {
  kind: 'PRODUCT';
  customerSuppliedItem: 'NOT_APPLICABLE';
}

export interface Service extends CatalogItemBase {
  kind: 'SERVICE';
  customerSuppliedItem: CustomerSuppliedItem;
}

export type CatalogItem = Product | Service;

export const isProduct = (i: CatalogItem): i is Product => i.kind === 'PRODUCT';
export const isService = (i: CatalogItem): i is Service => i.kind === 'SERVICE';

// ---------------------------------------------------------------- public code

export const PUBLIC_CODE_PATTERN = /^DTG-[0-9]{5,}$/;

export function isValidPublicCode(code: string): boolean {
  return PUBLIC_CODE_PATTERN.test(code);
}

export function formatPublicCode(sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new RangeError(`Public code sequence must be a positive integer (got ${sequence})`);
  }
  return `DTG-${String(sequence).padStart(5, '0')}`;
}

// ---------------------------------------------------------------- lifecycle

/** An item is offered only when its status is ACTIVE. Unset status is never offered. */
export function isSellable(item: CatalogItem): boolean {
  return item.status === 'ACTIVE';
}

/** Status can move between business states; it can never go back to "unset". */
export function canChangeStatus(from: CatalogStatus | null, to: CatalogStatus | null): boolean {
  if (to === null) return from === null;
  return true;
}

export type CatalogItemIssue =
  | 'INVALID_PUBLIC_CODE'
  | 'EMPTY_NAME'
  | 'CUSTOMER_SUPPLIED_ONLY_FOR_SERVICE'
  | 'MERGE_REQUIRES_RETIRED'
  | 'MERGE_INTO_SELF';

/** Structural invariants of a single item (mirrors database checks). */
export function validateCatalogItem(item: CatalogItem): CatalogItemIssue[] {
  const issues: CatalogItemIssue[] = [];
  if (!isValidPublicCode(item.publicCode)) issues.push('INVALID_PUBLIC_CODE');
  if (item.canonicalName.trim() === '') issues.push('EMPTY_NAME');
  if (item.kind === 'PRODUCT' && item.customerSuppliedItem !== 'NOT_APPLICABLE') {
    issues.push('CUSTOMER_SUPPLIED_ONLY_FOR_SERVICE');
  }
  if (item.mergedIntoId !== null) {
    if (item.status !== 'RETIRED') issues.push('MERGE_REQUIRES_RETIRED');
    if (item.mergedIntoId === item.id) issues.push('MERGE_INTO_SELF');
  }
  return issues;
}

// ---------------------------------------------------------------- taxonomy

/** Mutable classification. Moving an item between categories never changes its identity. */
export interface Category {
  id: Uuid;
  key: string;
  name: string;
  parentId: Uuid | null;
  sort: number;
  isActive: boolean;
}

export interface CatalogItemCategory {
  itemId: Uuid;
  categoryId: Uuid;
  isPrimary: boolean;
}
