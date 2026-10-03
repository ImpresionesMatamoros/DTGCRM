import type { Uuid } from './catalog';

/**
 * A DecorationMethod is a process (DTF, embroidery…), never a product.
 * Products made with a method (DTF Transfer, Gang Sheet) are CatalogItems.
 * "Blank" is not a method nor an option: it is the absence of decoration selections.
 */
export interface DecorationMethod {
  id: Uuid;
  key: string;
  name: string;
  isActive: boolean;
}

export interface CapabilityConstraints {
  allowedPlacements?: string[];
  maxPrintSize?: string;
  minQuantity?: number;
}

export interface DecorationCapability {
  itemId: Uuid;
  methodId: Uuid;
  constraints: CapabilityConstraints | null;
  note: string | null;
}

/** Runtime selection inside a configured item. */
export interface DecorationSelection {
  methodKey: string;
  placementCode?: string;
  printSizeCode?: string;
}
