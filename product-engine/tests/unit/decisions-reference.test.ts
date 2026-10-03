import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  decisionById,
  DECISION_SOURCE,
  OWNER_DECISIONS,
  PRICING_DECISION_IDS,
  PRICING_RELEVANCE,
} from '@/decisions/reference';

describe('STEP 05C decision reference', () => {
  it('loads the 22 owner decisions D-001…D-022 (10 P1, 12 P2), all OPEN and unanswered', () => {
    expect(OWNER_DECISIONS.map((d) => d.id)).toEqual(
      Array.from({ length: 22 }, (_, i) => `D-${String(i + 1).padStart(3, '0')}`),
    );
    expect(OWNER_DECISIONS.filter((d) => d.priority === 'P1')).toHaveLength(10);
    expect(OWNER_DECISIONS.filter((d) => d.priority === 'P2')).toHaveLength(12);
    expect(OWNER_DECISIONS.every((d) => d.status === 'OPEN' && d.answer === null)).toBe(true);
    expect(DECISION_SOURCE.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('keeps the affected-candidate counts of STEP 05C', () => {
    const n = (id: string) => decisionById(id)!.affected.length;
    expect([
      n('D-001'),
      n('D-002'),
      n('D-008'),
      n('D-010'),
      n('D-011'),
      n('D-016'),
      n('D-022'),
    ]).toEqual([197, 117, 21, 1, 1, 220, 4]);
  });

  it('documents exactly the five pricing decisions and labels Mexico rounding as provisional', () => {
    expect(PRICING_DECISION_IDS.sort()).toEqual(['D-008', 'D-010', 'D-011', 'D-016', 'D-022']);
    expect(PRICING_RELEVANCE['D-022']!.frozenBehaviour).toMatch(/PROVISIONAL/);
    expect(PRICING_RELEVANCE['D-022']!.frozenBehaviour).toMatch(/IVA/);
    expect(PRICING_RELEVANCE['D-010']!.frozenBehaviour).toMatch(/QUOTE_ONLY/);
    expect(PRICING_RELEVANCE['D-011']!.frozenBehaviour).toMatch(/no existe PriceDefinition/);
  });

  it('is read-only reference data: no SQL write and no import of the pricing resolver', () => {
    for (const f of [
      'src/decisions/reference.ts',
      'src/db/admin/decisions.ts',
      'src/db/admin/readiness.ts',
    ]) {
      const src = readFileSync(f, 'utf8');
      expect(src).not.toMatch(/\b(insert\s+into|update\s+\w+\s+set|delete\s+from)\b/i);
      expect(src).not.toMatch(/@\/pricing/);
    }
  });
});
