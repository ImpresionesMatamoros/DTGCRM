import { ZodError } from 'zod';
import type { CatalogSnapshot } from '../domain/snapshot';
import type { Presentation } from '../domain/publication';
import { resolvePrice } from '../pricing/resolve';
import { parsePriceRequest, priceResultToWire } from './contracts';
import { findVisibleItem, searchItems, toDetail, type CrmCatalogInput } from './crm-catalog';
import {
  CONTRACT_VERSION,
  ItemDetailResponseSchema,
  ItemListResponseSchema,
  ListQuerySchema,
  ResolveEnvelopeSchema,
} from './crm-contracts';
import { authorize, errorResponse, jsonResponse, zodIssues } from './http';

/** Everything the handlers need from the outside world; injectable for tests. */
export interface CrmApiDeps {
  loadSnapshot(): Promise<CatalogSnapshot>;
  loadPresentations(): Promise<Presentation[]>;
  now(): Date;
  env?: Record<string, string | undefined>;
}

async function input(deps: CrmApiDeps, asOf: Date): Promise<CrmCatalogInput> {
  const [snapshot, presentations] = await Promise.all([
    deps.loadSnapshot(),
    deps.loadPresentations(),
  ]);
  return { snapshot, presentations, asOf };
}

function guard(req: Request, deps: CrmApiDeps): Response | null {
  return authorize(req, deps.env);
}

async function safely(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    // Never echo internals; the cause stays in the server log.
    console.error('[crm-api]', e);
    return errorResponse(500, 'INTERNAL', 'Unexpected server error');
  }
}

export function listItems(req: Request, deps: CrmApiDeps): Promise<Response> {
  return safely(async () => {
    const denied = guard(req, deps);
    if (denied) return denied;
    const url = new URL(req.url);
    const raw: Record<string, string> = {};
    for (const [k, v] of url.searchParams) {
      if (k in raw) return errorResponse(400, 'INVALID_QUERY', `Duplicate query parameter "${k}"`);
      raw[k] = v;
    }
    const parsed = ListQuerySchema.safeParse(raw);
    if (!parsed.success) {
      return errorResponse(
        400,
        'INVALID_QUERY',
        'Invalid query parameters',
        zodIssues(parsed.error),
      );
    }
    const asOf = deps.now();
    const out = searchItems(await input(deps, asOf), {
      q: parsed.data.q || undefined,
      market: parsed.data.market,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
    });
    return jsonResponse(
      ItemListResponseSchema.parse({ contract_version: CONTRACT_VERSION, ...out }),
    );
  });
}

export function getItem(req: Request, idOrCode: string, deps: CrmApiDeps): Promise<Response> {
  return safely(async () => {
    const denied = guard(req, deps);
    if (denied) return denied;
    if (!/^[0-9a-fA-F-]{36}$|^DTG-[0-9]{5,}$/i.test(idOrCode)) {
      return errorResponse(404, 'ITEM_NOT_FOUND', 'Item not found');
    }
    const inp = await input(deps, deps.now());
    const item = findVisibleItem(inp.snapshot, idOrCode);
    if (!item) return errorResponse(404, 'ITEM_NOT_FOUND', 'Item not found');
    return jsonResponse(
      ItemDetailResponseSchema.parse({
        contract_version: CONTRACT_VERSION,
        ...toDetail(inp, item),
      }),
    );
  });
}

export function resolve(req: Request, deps: CrmApiDeps): Promise<Response> {
  return safely(async () => {
    const denied = guard(req, deps);
    if (denied) return denied;
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return errorResponse(400, 'INVALID_JSON', 'Body must be valid JSON');
    }
    let env;
    try {
      env = ResolveEnvelopeSchema.parse(body);
    } catch (e) {
      if (e instanceof ZodError) {
        return errorResponse(400, 'INVALID_REQUEST', 'Invalid pricing request', zodIssues(e));
      }
      throw e;
    }
    const asOf = env.as_of ? new Date(env.as_of) : deps.now();
    const snapshot = await deps.loadSnapshot();
    const domainReq = parsePriceRequest(env.request);
    // Only items that the CRM can see may be priced through this API (no probing of internal items).
    const ids = [
      domainReq.catalogItemId,
      ...(domainReq.optionalComponents ?? []).map((c) => c.catalogItemId),
    ];
    if (!ids.every((id) => findVisibleItem(snapshot, id))) {
      return errorResponse(404, 'ITEM_NOT_FOUND', 'Item not found');
    }
    const wire = priceResultToWire(resolvePrice(domainReq, snapshot, asOf));
    return jsonResponse(wire);
  });
}
