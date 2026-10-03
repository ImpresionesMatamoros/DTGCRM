import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/** Liveness only. Business endpoints (search, schema, price) are STEP 05+. */
export function GET() {
  return NextResponse.json({ service: 'dtg-product-engine', status: 'ok', stage: 'foundation' });
}
