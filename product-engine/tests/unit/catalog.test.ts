import { describe, expect, it } from 'vitest';
import {
  canChangeStatus,
  formatPublicCode,
  isSellable,
  isValidPublicCode,
  validateCatalogItem,
  type CatalogItem,
} from '@/domain/catalog';
import { isPublished, type PublicationProfile } from '@/domain/publication';
import { devSliceDataset } from '../../data/dev-slice';

const product: CatalogItem = {
  id: '6a0d0a2b-1111-4111-8111-111111111111',
  kind: 'PRODUCT',
  publicCode: 'DTG-00042',
  canonicalName: 'Gorra',
  status: 'ACTIVE',
  saleUnit: 'PIECE',
  measurementSpec: null,
  decorationPolicy: 'OPTIONAL',
  customerSuppliedItem: 'NOT_APPLICABLE',
  descriptionInternal: null,
  mergedIntoId: null,
};

describe('CatalogItem identity (ADR-0011)', () => {
  it('public code is DTG + at least 5 digits and carries no meaning', () => {
    expect(formatPublicCode(1)).toBe('DTG-00001');
    expect(formatPublicCode(123456)).toBe('DTG-123456');
    expect(isValidPublicCode('DTG-00001')).toBe(true);
    for (const bad of ['DTG-1', 'TXT-00001', 'DTG-GOR-001', 'dtg-00001']) {
      expect(isValidPublicCode(bad)).toBe(false);
    }
    expect(() => formatPublicCode(0)).toThrow(RangeError);
  });

  it('identity does not depend on category, name or code', () => {
    const d = devSliceDataset();
    const item = d.items[0]!;
    const before = { id: item.id, code: item.publicCode };
    // Re-classify: categories live in a separate relation; the item is untouched.
    d.itemCategories = d.itemCategories.map((c) =>
      c.itemId === item.id ? { ...c, categoryId: 'other' } : c,
    );
    const renamed = { ...item, canonicalName: 'Otro nombre' };
    expect({ id: renamed.id, code: renamed.publicCode }).toEqual(before);
    expect(Object.keys(item)).not.toContain('categoryId');
  });

  it('dev slice public codes are unique and valid', () => {
    const codes = devSliceDataset().items.map((i) => i.publicCode);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.every(isValidPublicCode)).toBe(true);
  });

  it('customer-supplied item only makes sense for a Service', () => {
    const bad = { ...product, customerSuppliedItem: 'REQUIRED' } as unknown as CatalogItem;
    expect(validateCatalogItem(bad)).toContain('CUSTOMER_SUPPLIED_ONLY_FOR_SERVICE');
    expect(validateCatalogItem(product)).toEqual([]);
  });

  it('merged items must be RETIRED and point elsewhere', () => {
    expect(validateCatalogItem({ ...product, mergedIntoId: product.id })).toEqual([
      'MERGE_REQUIRES_RETIRED',
      'MERGE_INTO_SELF',
    ]);
  });
});

describe('CatalogStatus (ADR-0002)', () => {
  it('has no fifth state; unset (null) can be assigned once and never restored', () => {
    expect(canChangeStatus(null, 'ACTIVE')).toBe(true);
    expect(canChangeStatus('ACTIVE', null)).toBe(false);
    expect(canChangeStatus(null, null)).toBe(true);
    expect(canChangeStatus('CANDIDATE', 'RETIRED')).toBe(true);
  });

  it('only ACTIVE is sellable; unset is never published even if assigned', () => {
    const profile: PublicationProfile = {
      id: 'p',
      key: 'catalog_general',
      name: 'x',
      inclusionMode: 'EXPLICIT',
      allowedStatuses: ['ACTIVE'],
      showsPrices: false,
      priceBookId: null,
      locale: 'es',
    };
    const assignment = {
      profileId: 'p',
      itemId: product.id,
      presentationId: null,
      isIncluded: true,
      sort: null,
    };
    expect(isSellable(product)).toBe(true);
    expect(isPublished(product, profile, assignment)).toBe(true);
    const unset = { ...product, status: null };
    expect(isSellable(unset)).toBe(false);
    expect(isPublished(unset, profile, assignment)).toBe(false);
    expect(isPublished(product, profile, undefined)).toBe(false); // EXPLICIT needs an assignment
    expect(isPublished(product, { ...profile, inclusionMode: 'ALL_MATCHING' }, undefined)).toBe(
      true,
    );
    expect(
      isPublished(
        product,
        { ...profile, inclusionMode: 'ALL_MATCHING' },
        { ...assignment, isIncluded: false },
      ),
    ).toBe(false);
  });
});
