import { qualityOverview } from '@/db/admin/quality-views';
import { buildExport, findingsToCsv } from '@/quality/export';
import { applyFindingFilters, parseFindingFilters } from '@/quality/filter';
import { adminPool } from '../../_server/db';

export const dynamic = 'force-dynamic';

/** Machine-readable report (STEP 08 §23): JSON with the findings, or CSV of the (filtered) findings. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const o = await qualityOverview(adminPool());
  if (url.searchParams.get('format') === 'csv') {
    const filters = parseFindingFilters(Object.fromEntries(url.searchParams));
    return new Response(findingsToCsv(applyFindingFilters(o.run.findings, filters)), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="data-quality-findings.csv"',
      },
    });
  }
  return new Response(JSON.stringify(buildExport(o.input, o.run), null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': 'attachment; filename="data-quality-report.json"',
    },
  });
}
