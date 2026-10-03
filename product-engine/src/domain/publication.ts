import type { CatalogItem, CatalogStatus, Uuid } from './catalog';

/**
 * Presentation = how an item is shown (name, occasion, language, aliases).
 * Publication = where it appears. Both are independent of lifecycle and of
 * each other; outputs are queries, never copies (STEP 02 §17).
 */

export type Locale = 'es' | 'en';

export interface Presentation {
  id: Uuid;
  itemId: Uuid;
  locale: Locale;
  occasion: string | null;
  displayName: string;
  shortDescription: string | null;
  aliases: string[];
  seoKeywords: string[];
  isDefault: boolean;
  status: 'DRAFT' | 'READY';
}

export interface PublicationProfile {
  id: Uuid;
  key: string;
  name: string;
  inclusionMode: 'ALL_MATCHING' | 'EXPLICIT';
  allowedStatuses: CatalogStatus[];
  showsPrices: boolean;
  priceBookId: Uuid | null;
  locale: Locale;
}

export interface PublicationAssignment {
  profileId: Uuid;
  itemId: Uuid;
  presentationId: Uuid | null;
  isIncluded: boolean;
  sort: number | null;
}

/**
 * Membership rule (mirrors view `v_publication_membership`):
 * an item with unset status is never published, whatever its assignments.
 */
export function isPublished(
  item: CatalogItem,
  profile: PublicationProfile,
  assignment: PublicationAssignment | undefined,
  availableInProfileMarket = true,
): boolean {
  if (item.status === null) return false;
  if (!profile.allowedStatuses.includes(item.status)) return false;
  if (!availableInProfileMarket) return false;
  if (profile.inclusionMode === 'ALL_MATCHING') return assignment?.isIncluded !== false;
  return assignment?.isIncluded === true;
}
