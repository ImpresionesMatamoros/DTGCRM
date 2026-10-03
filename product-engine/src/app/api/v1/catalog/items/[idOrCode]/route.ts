import { productionDeps } from '@/db/crm-api-deps';
import { getItem } from '@/api/crm-handlers';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ idOrCode: string }> }) {
  const { idOrCode } = await ctx.params;
  return getItem(req, decodeURIComponent(idOrCode), productionDeps());
}
