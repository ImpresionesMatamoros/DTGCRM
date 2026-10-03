import type { LengthUnit, Uuid } from './catalog';

/**
 * Options = configuration dimensions (STEP 02 §8). One definition per meaning:
 * "tamaño" is split into typed definitions (tamano_papel, tamano_display, …).
 */

export type MeasureUnit = LengthUnit | 'oz';
export type OptionScope = 'ITEM' | 'DECORATION';

interface OptionDefinitionBase {
  id: Uuid;
  key: string;
  label: string;
  scope: OptionScope;
}

export type OptionDefinition =
  | (OptionDefinitionBase & { valueKind: 'ENUM' | 'TEXT' | 'BOOLEAN'; unit: null })
  | (OptionDefinitionBase & { valueKind: 'DIMENSIONS' | 'QUANTITY' | 'LENGTH'; unit: MeasureUnit });

export type OptionValueKind = OptionDefinition['valueKind'];

/** Structured value payload, typed by the definition's valueKind. */
export type OptionValueSpec = null | { w: number; h: number } | { value: number };

export interface OptionValue {
  id: Uuid;
  optionDefinitionId: Uuid;
  code: string;
  label: string;
  spec: OptionValueSpec;
  sort: number;
  isActive: boolean;
}

export type SelectionMode = 'SINGLE' | 'MULTI';

export interface ItemOption {
  itemId: Uuid;
  optionDefinitionId: Uuid;
  isRequired: boolean;
  selectionMode: SelectionMode;
  /** May vary across rows of a quantity distribution (ADR-0001). */
  isDistributable: boolean;
  sort: number;
  defaultValueId: Uuid | null;
}

/** Controlled subset of values allowed for one item. */
export interface ItemOptionValue {
  itemId: Uuid;
  optionDefinitionId: Uuid;
  optionValueId: Uuid;
  sort: number;
  isActive: boolean;
}

export const OPTION_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

/** Values are only enumerated for kinds that have a finite list. */
export function kindHasValues(kind: OptionValueKind): boolean {
  return kind === 'ENUM' || kind === 'DIMENSIONS' || kind === 'QUANTITY' || kind === 'LENGTH';
}

export function isSpecValidForKind(kind: OptionValueKind, spec: OptionValueSpec): boolean {
  switch (kind) {
    case 'ENUM':
      return spec === null;
    case 'DIMENSIONS':
      return spec !== null && 'w' in spec && spec.w > 0 && spec.h > 0;
    case 'QUANTITY':
    case 'LENGTH':
      return spec !== null && 'value' in spec && spec.value > 0;
    case 'TEXT':
    case 'BOOLEAN':
      return false; // no enumerated values
  }
}

export type ItemOptionIssue = 'DISTRIBUTABLE_REQUIRES_SINGLE_ENUM' | 'INVALID_KEY';

export function validateItemOption(
  itemOption: ItemOption,
  definition: OptionDefinition,
): ItemOptionIssue[] {
  const issues: ItemOptionIssue[] = [];
  if (!OPTION_KEY_PATTERN.test(definition.key)) issues.push('INVALID_KEY');
  if (
    itemOption.isDistributable &&
    (itemOption.selectionMode !== 'SINGLE' || definition.valueKind !== 'ENUM')
  ) {
    issues.push('DISTRIBUTABLE_REQUIRES_SINGLE_ENUM');
  }
  return issues;
}
