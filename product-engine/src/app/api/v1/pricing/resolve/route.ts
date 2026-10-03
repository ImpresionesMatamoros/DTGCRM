import { productionDeps } from '@/db/crm-api-deps';
import { resolve } from '@/api/crm-handlers';

export const dynamic = 'force-dynamic';

export function POST(req: Request) {
  return resolve(req, productionDeps());
}
