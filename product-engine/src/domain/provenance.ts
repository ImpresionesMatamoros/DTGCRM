import type { Uuid } from './catalog';

/**
 * Provenance lives beside the catalog, never inside names, codes or notes
 * (STEP 02 §18). Historical unauthorized prices are HISTORICAL_PRICE_EVIDENCE
 * source references (ADR-0005): the pricing resolver never reads them.
 */

export type EntityType =
  | 'catalog_item'
  | 'option_definition'
  | 'option_value'
  | 'composition_line'
  | 'price_definition'
  | 'price_rule'
  | 'presentation'
  | 'category';

export type SourceKind =
  'LEGACY_ID' | 'EXCEL_ROW' | 'OWNER_INTERVIEW' | 'DOCUMENT' | 'HISTORICAL_PRICE_EVIDENCE';

export interface SourceReference {
  id: Uuid;
  entityType: EntityType;
  entityId: Uuid;
  field: string | null;
  sourceKind: SourceKind;
  sourceLocator: string;
  payload: Record<string, unknown> | null;
  capturedAt: string;
}

export type DecisionStatus = 'OPEN' | 'DECIDED' | 'SUPERSEDED';

export interface DecisionRecord {
  id: Uuid;
  code: string;
  title: string;
  status: DecisionStatus;
  statement: string;
  decidedBy: string | null;
  decidedAt: string | null;
  source: string | null;
  subjects: { entityType: EntityType; entityId: Uuid }[];
}

export type ChangeScope = 'CATALOG' | 'PRICING';

/** Append-only audit log written by database triggers. */
export interface ChangeEvent {
  id: number;
  revision: number;
  scope: ChangeScope;
  tableName: string;
  entityKey: string;
  action: 'INSERT' | 'UPDATE' | 'DELETE';
  changedAt: string;
  changedBy: string;
}
