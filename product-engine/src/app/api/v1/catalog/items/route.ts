import { productionDeps } from '@/db/crm-api-deps';
import { listItems } from '@/api/crm-handlers';

export const dynamic = 'force-dynamic';

export function GET(req: Request) {
  return listItems(req, productionDeps());
}
