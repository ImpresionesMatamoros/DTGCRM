import { describe, expect, it } from 'vitest';
import { GET } from '@/app/api/v1/health/route';

describe('health endpoint', () => {
  it('reports liveness without touching the database', async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      service: 'dtg-product-engine',
      status: 'ok',
      stage: 'foundation',
    });
  });
});
