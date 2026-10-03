/**
 * Admin permissions (STEP 06 §32, STEP 07 §10). One place decides whether an actor may run a
 * capability. There is no enterprise auth yet.
 *
 * Technical authorization capability exists (`price.authorize`); production actor/role assignment
 * remains owner decision D-016 (STEP 05C). Until it is answered, the ONLY holder is the controlled
 * development role `local_price_authorizer`, which nobody gets by default: an actor receives it only
 * when its name is listed in the DTG_PRICE_AUTHORIZERS environment variable (local/dev/e2e).
 * Future real roles will only change ROLE_GRANTS, not the mutations.
 */

export const CAPABILITIES = [
  'review.resolve',
  'review.approve',
  'review.bulk',
  'catalog.edit',
  'fixture.publish',
  'price.edit',
  'price.authorize',
  'market.policy',
  'pricing.parameter',
  // STEP 08
  'quality.mark',
  'category.map',
  'decision.record',
  // STEP 09: scoped REAL migration (owner-only, OD-07)
  'migration.approve',
  'migration.publish',
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export interface Actor {
  /** Free-form local user context recorded in every audit row. */
  name: string;
  source: 'env' | 'cookie';
  role:
    | 'local_dev'
    | 'local_price_authorizer'
    | 'local_decision_recorder'
    | 'local_owner'
    | 'local_migration_owner';
}

const LOCAL_DEV: readonly Capability[] = [
  'review.resolve',
  'review.approve',
  'review.bulk',
  'catalog.edit',
  'fixture.publish',
  'price.edit',
  'market.policy',
  'pricing.parameter',
  'quality.mark',
  'category.map',
];

const ROLE_GRANTS: Record<Actor['role'], readonly Capability[]> = {
  local_dev: LOCAL_DEV,
  local_price_authorizer: [...LOCAL_DEV, 'price.authorize'],
  // STEP 08: recording an owner's answer is an explicit act, like authorizing a price: nobody has it by default.
  local_decision_recorder: [...LOCAL_DEV, 'decision.record'],
  local_owner: [...LOCAL_DEV, 'price.authorize', 'decision.record'],
  // STEP 09 (OD-05/OD-07): the master-price and first-REAL-publication authority. Nobody has it by default.
  local_migration_owner: [
    ...LOCAL_DEV,
    'price.authorize',
    'decision.record',
    'migration.approve',
    'migration.publish',
  ],
};

/** Names listed in DTG_PRICE_AUTHORIZERS (comma separated) act as the controlled dev authorizer. */
export function roleFor(
  name: string,
  authorizers: string | undefined,
  /** DTG_DECISION_RECORDERS: who may record the owner's decision answers (STEP 08). */
  recorders?: string | undefined,
  /** DTG_MIGRATION_OWNERS: who may approve a migration permit and run the scoped REAL publication (STEP 09). */
  migrationOwners?: string | undefined,
): Actor['role'] {
  const list = (v: string | undefined) =>
    (v ?? '')
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean);
  if (list(migrationOwners).includes(name)) return 'local_migration_owner';
  const auth = list(authorizers).includes(name);
  const rec = list(recorders).includes(name);
  return auth && rec
    ? 'local_owner'
    : auth
      ? 'local_price_authorizer'
      : rec
        ? 'local_decision_recorder'
        : 'local_dev';
}

export const DECISION_RECORD_BLOCKED =
  'Registrar la respuesta del owner requiere el permiso decision.record. La app nunca responde decisiones: en desarrollo sólo lo tiene un actor listado en DTG_DECISION_RECORDERS.';

export const MIGRATION_BLOCKED =
  'Aprobar o ejecutar una migración REAL requiere migration.approve / migration.publish (OD-07: Martín). En desarrollo sólo lo tiene un actor listado en DTG_MIGRATION_OWNERS.';

export const PRICE_AUTHORIZATION_BLOCKED =
  'Autorizar precios requiere el permiso price.authorize. La asignación real de quién autoriza sigue abierta (decisión D-016); en desarrollo sólo lo tiene un actor listado en DTG_PRICE_AUTHORIZERS.';

export type AuthorizationError =
  { code: 'ACTOR_REQUIRED'; message: string } | { code: 'FORBIDDEN'; message: string };

export function authorize(actor: Actor | null, capability: Capability): AuthorizationError | null {
  if (!actor || !actor.name.trim()) {
    return {
      code: 'ACTOR_REQUIRED',
      message: 'Indica quién eres (actor local) antes de hacer cambios.',
    };
  }
  if (!ROLE_GRANTS[actor.role].includes(capability)) {
    return {
      code: 'FORBIDDEN',
      message:
        capability === 'price.authorize'
          ? PRICE_AUTHORIZATION_BLOCKED
          : capability === 'decision.record'
            ? DECISION_RECORD_BLOCKED
            : capability === 'migration.approve' || capability === 'migration.publish'
              ? MIGRATION_BLOCKED
              : `${actor.name} no tiene el permiso ${capability}`,
    };
  }
  return null;
}

export const can = (actor: Actor | null, capability: Capability) =>
  authorize(actor, capability) === null;

/** Local actor names are audit context, not identities: keep them short and printable. */
export function normalizeActorName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return name.length >= 1 && name.length <= 60 ? name : null;
}
