import { timingSafeEqual } from 'node:crypto';
import type { z } from 'zod';
import {
  CONTRACT_HEADER,
  CONTRACT_VERSION,
  ErrorResponseSchema,
  type ErrorResponse,
} from './crm-contracts';

const BASE_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  [CONTRACT_HEADER]: CONTRACT_VERSION,
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: BASE_HEADERS });
}

export function errorResponse(
  status: number,
  code: ErrorResponse['error']['code'],
  message: string,
  issues?: { path: string; message: string }[],
): Response {
  const body = ErrorResponseSchema.parse({
    error: { code, message, ...(issues ? { issues } : {}) },
  });
  return jsonResponse(body, status);
}

export const zodIssues = (e: z.ZodError) =>
  e.issues.slice(0, 20).map((i) => ({ path: i.path.join('.') || '(root)', message: i.message }));

type Env = Record<string, string | undefined>;

function tokensFrom(env: Env): string[] {
  return (env.PRODUCT_ENGINE_API_TOKENS ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length >= 16);
}

const safeEqual = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * Minimal service-to-service policy (no SSO/RBAC, STEP 10 non-goal):
 * bearer token(s) from PRODUCT_ENGINE_API_TOKENS (each ≥ 16 chars).
 * Not configured → open in development/test, **fail closed (503) in production**.
 * Returns a Response when the request must be rejected, otherwise null.
 */
export function authorize(req: Request, env: Env = process.env as Env): Response | null {
  const tokens = tokensFrom(env);
  if (tokens.length === 0) {
    return env.NODE_ENV === 'production'
      ? errorResponse(503, 'AUTH_NOT_CONFIGURED', 'API tokens are not configured')
      : null;
  }
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') ?? '');
  const given = m?.[1]?.trim() ?? '';
  if (given && tokens.some((t) => safeEqual(t, given))) return null;
  return errorResponse(401, 'UNAUTHORIZED', 'Missing or invalid bearer token');
}
