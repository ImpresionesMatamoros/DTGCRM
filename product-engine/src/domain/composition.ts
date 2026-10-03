import type { Uuid } from './catalog';

/**
 * "Component" is a role a CatalogItem plays inside another one; there is no
 * parallel component master (STEP 02 §7). Roles implemented: INCLUDED, OPTIONAL.
 * REQUIRED/REPLACEMENT stay reserved until a real case exists (STEP 03 audit).
 */
export type CompositionRole = 'INCLUDED' | 'OPTIONAL';

export interface CompositionLine {
  id: Uuid;
  parentItemId: Uuid;
  childItemId: Uuid;
  quantity: number;
  role: CompositionRole;
  sort: number;
  note: string | null;
}

export const MAX_COMPOSITION_DEPTH = 2;

export type CompositionIssue =
  | { code: 'SELF_REFERENCE'; lineId: Uuid }
  | { code: 'NON_POSITIVE_QUANTITY'; lineId: Uuid }
  | { code: 'DUPLICATE_PAIR'; lineId: Uuid }
  | { code: 'CYCLE'; path: Uuid[] }
  | { code: 'TOO_DEEP'; path: Uuid[] };

/** Validates the whole composition graph: no self-links, duplicates, cycles or depth > 2. */
export function validateComposition(lines: readonly CompositionLine[]): CompositionIssue[] {
  const issues: CompositionIssue[] = [];
  const children = new Map<Uuid, Uuid[]>();
  const pairs = new Set<string>();
  for (const l of lines) {
    if (l.parentItemId === l.childItemId) issues.push({ code: 'SELF_REFERENCE', lineId: l.id });
    if (!(l.quantity > 0) || !Number.isInteger(l.quantity)) {
      issues.push({ code: 'NON_POSITIVE_QUANTITY', lineId: l.id });
    }
    const pair = `${l.parentItemId}>${l.childItemId}`;
    if (pairs.has(pair)) issues.push({ code: 'DUPLICATE_PAIR', lineId: l.id });
    pairs.add(pair);
    children.set(l.parentItemId, [...(children.get(l.parentItemId) ?? []), l.childItemId]);
  }
  const walk = (node: Uuid, path: Uuid[]): void => {
    for (const child of children.get(node) ?? []) {
      const next = [...path, child];
      if (path.includes(child)) {
        issues.push({ code: 'CYCLE', path: next });
        continue;
      }
      if (next.length - 1 > MAX_COMPOSITION_DEPTH) {
        issues.push({ code: 'TOO_DEEP', path: next });
        continue;
      }
      walk(child, next);
    }
  };
  for (const root of children.keys()) walk(root, [root]);
  return dedupeIssues(issues);
}

function dedupeIssues(issues: CompositionIssue[]): CompositionIssue[] {
  const seen = new Set<string>();
  return issues.filter((i) => {
    const k = JSON.stringify(i);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function optionalChildrenOf(
  parentId: Uuid,
  lines: readonly CompositionLine[],
): CompositionLine[] {
  return lines.filter((l) => l.parentItemId === parentId && l.role === 'OPTIONAL');
}

export function includedChildrenOf(
  parentId: Uuid,
  lines: readonly CompositionLine[],
): CompositionLine[] {
  return lines
    .filter((l) => l.parentItemId === parentId && l.role === 'INCLUDED')
    .sort((a, b) => a.sort - b.sort);
}
