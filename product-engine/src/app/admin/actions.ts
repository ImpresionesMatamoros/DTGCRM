'use server';

import { cookies } from 'next/headers';
import { refresh, revalidatePath } from 'next/cache';
import {
  approveHandler,
  authorizePriceHandler,
  bulkApplyHandler,
  bulkPreviewHandler,
  categoryApplyHandler,
  categoryPreviewHandler,
  decisionApplyHandler,
  decisionPreviewHandler,
  markDuplicateHandler,
  migrationPermitHandler,
  migrationPublishHandler,
  migrationSimulateHandler,
  recordDecisionHandler,
  remediationApplyHandler,
  remediationPreviewHandler,
  cloneToDraftHandler,
  createItemHandler,
  createPriceDraftHandler,
  deletePriceDraftHandler,
  fxRevisionHandler,
  publishFixtureHandler,
  rejectHandler,
  saveDraftHandler,
  setMarketPolicyHandler,
  simulateHandler,
  updateItemHandler,
  updatePriceDraftHandler,
  withdrawHandler,
} from '@/admin/handlers';
import { normalizeActorName } from '@/admin/permissions';
import { ACTOR_COOKIE, getActor } from './_server/actor';
import { adminPool, adminTx } from './_server/db';

/**
 * Server Actions of the Admin. They are thin: resolve the local actor, hand the
 * raw input to the server-side handler (Zod + capability + service inside one
 * audited transaction) and refresh the affected pages. Server Actions can be
 * POSTed directly, so nothing here trusts the browser.
 *
 * Price authorization exists (STEP 07) but only as a capability-gated handler (`price.authorize`);
 * production role assignment is still owner decision D-016. There is deliberately NO action to
 * publish REAL data globally. STEP 09 adds ONE permit-bound migration publication
 * (`runMigrationPublicationAction`) that needs the migration.publish capability, an ACTIVE permit that names
 * each candidate, and an explicit click.
 */

const done = <T extends { ok: boolean }>(r: T, ...paths: string[]): T => {
  if (r.ok) {
    for (const p of paths) revalidatePath(p);
    refresh();
  }
  return r;
};

export async function setActorAction(formData: FormData) {
  const name = normalizeActorName(formData.get('actor'));
  const jar = await cookies();
  if (name) jar.set(ACTOR_COOKIE, name, { httpOnly: true, sameSite: 'strict', path: '/admin' });
  else jar.delete(ACTOR_COOKIE);
  refresh();
}

export async function saveDraftAction(input: unknown) {
  return done(
    await saveDraftHandler(adminTx(), await getActor(), input),
    '/admin/review',
    '/admin',
  );
}

export async function approveAction(input: unknown) {
  return done(await approveHandler(adminTx(), await getActor(), input), '/admin/review', '/admin');
}

export async function rejectAction(input: unknown) {
  return done(await rejectHandler(adminTx(), await getActor(), input), '/admin/review', '/admin');
}

export async function withdrawApprovalAction(input: unknown) {
  return done(await withdrawHandler(adminTx(), await getActor(), input), '/admin/review', '/admin');
}

export async function publishFixtureAction(input: unknown) {
  return done(
    await publishFixtureHandler(adminTx(), await getActor(), input),
    '/admin/review',
    '/admin/catalog',
    '/admin',
  );
}

export async function bulkPreviewAction(input: unknown) {
  return bulkPreviewHandler(adminPool(), await getActor(), input);
}

export async function bulkApplyAction(input: unknown) {
  return done(
    await bulkApplyHandler(adminTx(), await getActor(), input),
    '/admin/review',
    '/admin',
  );
}

export async function createCatalogItemAction(input: unknown) {
  return done(
    await createItemHandler(adminTx(), await getActor(), input),
    '/admin/catalog',
    '/admin',
  );
}

export async function updateCatalogItemAction(input: unknown) {
  return done(await updateItemHandler(adminTx(), await getActor(), input), '/admin/catalog');
}

export async function simulatePriceAction(input: unknown) {
  // Read-only: the pricing domain with an explicit instant (ADR-0009).
  return simulateHandler(adminPool(), input, new Date());
}

// ---------------------------------------------------------------- pricing administration (STEP 07)

const PRICING = '/admin/pricing';

export async function createPriceDraftAction(input: unknown) {
  return done(
    await createPriceDraftHandler(adminTx(), await getActor(), input, new Date()),
    PRICING,
  );
}

export async function updatePriceDraftAction(input: unknown) {
  return done(
    await updatePriceDraftHandler(adminTx(), await getActor(), input, new Date()),
    PRICING,
  );
}

export async function deletePriceDraftAction(input: unknown) {
  return done(
    await deletePriceDraftHandler(adminTx(), await getActor(), input, new Date()),
    PRICING,
  );
}

export async function cloneToDraftAction(input: unknown) {
  return done(await cloneToDraftHandler(adminTx(), await getActor(), input, new Date()), PRICING);
}

export async function authorizePriceRevisionAction(input: unknown) {
  return done(await authorizePriceHandler(adminTx(), await getActor(), input, new Date()), PRICING);
}

export async function setMarketPolicyAction(input: unknown) {
  return done(
    await setMarketPolicyHandler(adminTx(), await getActor(), input, new Date()),
    PRICING,
  );
}

export async function fxRevisionAction(input: unknown) {
  return done(await fxRevisionHandler(adminTx(), await getActor(), input, new Date()), PRICING);
}

// ---------------------------------------------------------------- STEP 08 · data quality
// Thin wrappers like the rest. There is no action that answers a decision on its own, publishes REAL
// data or merges items: recording an answer needs `decision.record` and is always an explicit act.

export async function recordDecisionAction(input: unknown) {
  return done(
    await recordDecisionHandler(adminTx(), await getActor(), input),
    '/admin/decisions',
    '/admin/data-quality',
  );
}

export async function decisionPreviewAction(input: unknown) {
  return decisionPreviewHandler(adminPool(), await getActor(), input);
}

export async function decisionApplyAction(input: unknown) {
  return done(
    await decisionApplyHandler(adminTx(), await getActor(), input),
    '/admin/decisions',
    '/admin/data-quality',
    '/admin/review',
  );
}

export async function categoryPreviewAction(input: unknown) {
  return categoryPreviewHandler(adminPool(), await getActor(), input);
}

export async function categoryApplyAction(input: unknown) {
  return done(
    await categoryApplyHandler(adminTx(), await getActor(), input),
    '/admin/data-quality',
    '/admin/review',
  );
}

export async function markDuplicateAction(input: unknown) {
  return done(
    await markDuplicateHandler(adminTx(), await getActor(), input),
    '/admin/data-quality',
  );
}

export async function remediationPreviewAction(input: unknown) {
  return remediationPreviewHandler(adminPool(), await getActor(), input);
}

export async function remediationApplyAction(input: unknown) {
  return done(
    await remediationApplyHandler(adminTx(), await getActor(), input),
    '/admin/data-quality',
    '/admin/review',
  );
}

// ---------------------------------------------------------------- STEP 09 · scoped migration

export async function approveMigrationPermitAction(input: unknown) {
  return done(await migrationPermitHandler(adminTx(), await getActor(), input), '/admin/migration');
}

export async function simulateMigrationAction(input: unknown) {
  return migrationSimulateHandler(adminTx(), await getActor(), input);
}

export async function runMigrationPublicationAction(input: unknown) {
  return done(
    await migrationPublishHandler(adminTx(), await getActor(), input),
    '/admin/migration',
    '/admin/catalog',
    '/admin/pricing',
    '/admin',
  );
}
