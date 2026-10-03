import { cookies } from 'next/headers';
import { normalizeActorName, roleFor, type Actor } from '@/admin/permissions';

export const ACTOR_COOKIE = 'dtg_admin_actor';

/**
 * Local/dev actor (STEP 06 §32): DTG_ADMIN_ACTOR from the environment wins;
 * otherwise the name chosen in the admin header (cookie). No default actor:
 * without one, every mutation is refused with ACTOR_REQUIRED.
 */
export async function getActor(): Promise<Actor | null> {
  const env = normalizeActorName(process.env.DTG_ADMIN_ACTOR);
  if (env)
    return {
      name: env,
      source: 'env',
      role: roleFor(
        env,
        process.env.DTG_PRICE_AUTHORIZERS,
        process.env.DTG_DECISION_RECORDERS,
        process.env.DTG_MIGRATION_OWNERS,
      ),
    };
  const fromCookie = normalizeActorName((await cookies()).get(ACTOR_COOKIE)?.value);
  return fromCookie
    ? {
        name: fromCookie,
        source: 'cookie',
        role: roleFor(
          fromCookie,
          process.env.DTG_PRICE_AUTHORIZERS,
          process.env.DTG_DECISION_RECORDERS,
          process.env.DTG_MIGRATION_OWNERS,
        ),
      }
    : null;
}
