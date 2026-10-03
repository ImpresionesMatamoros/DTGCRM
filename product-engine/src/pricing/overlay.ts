import type { PriceDefinition } from '../domain/pricing-model';
import type { CatalogSnapshot } from '../domain/snapshot';

/**
 * Draft simulation (STEP 07 §21). Returns a COPY of the snapshot in which `draft` behaves as if it were
 * authorized, and its predecessor (if any) is closed where the draft starts. Pure and in-memory: the
 * database is untouched and normal resolution (which never loads drafts) is unaffected.
 */
export function overlayDraft(snapshot: CatalogSnapshot, draft: PriceDefinition): CatalogSnapshot {
  const simulated: PriceDefinition = {
    ...draft,
    status: 'AUTHORIZED',
    authorizedBy: draft.authorizedBy ?? 'simulation',
    authorizedAt: draft.authorizedAt ?? draft.validFrom,
  };
  const others = snapshot.priceDefinitions
    .filter((d) => d.id !== draft.id)
    .map((d) =>
      d.id === draft.supersedesId &&
      (d.validTo === null || Date.parse(d.validTo) > Date.parse(draft.validFrom))
        ? { ...d, validTo: draft.validFrom }
        : d,
    );
  return { ...snapshot, priceDefinitions: [...others, simulated] };
}
