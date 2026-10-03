import { readdirSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { pool } from './helpers';

afterAll(() => pool.end());

const tables = async () =>
  (
    await pool.query(
      "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1",
    )
  ).rows.map((r) => r.table_name as string);

describe('schema is reproducible from git', () => {
  it('every migration file is recorded as applied, in order, with a checksum', async () => {
    const files = readdirSync('supabase/migrations')
      .filter((f) => f.endsWith('.sql'))
      .sort();
    const applied = (
      await pool.query('select version, checksum from schema_migrations order by version')
    ).rows;
    expect(applied.map((r) => r.version)).toEqual(files);
    expect(applied.every((r) => /^[0-9a-f]{64}$/.test(r.checksum))).toBe(true);
  });

  it('contains exactly the Foundation + import staging + review audit tables', async () => {
    expect(await tables()).toEqual([
      'candidate_disposition',
      'catalog_item',
      'catalog_item_category',
      'category',
      'category_mapping',
      'change_event',
      'composition_line',
      'decision_record',
      'decision_subject',
      'decoration_capability',
      'decoration_method',
      'import_batch',
      'import_candidate',
      'import_candidate_link',
      'import_candidate_source',
      'import_issue',
      'import_record',
      'item_market_policy',
      'item_option',
      'item_option_value',
      'market',
      'migration_permit',
      'migration_permit_item',
      'migration_publication',
      'option_definition',
      'option_value',
      'owner_decision_answer',
      'presentation',
      'price_book',
      'price_break',
      'price_condition',
      'price_definition',
      'price_rule',
      'price_rule_assignment',
      'pricing_parameter',
      'publication_assignment',
      'publication_profile',
      'quality_mark',
      'review_bulk_operation',
      'review_event',
      'schema_migrations',
      'source_reference',
    ]);
  });

  it('does not create deferred or out-of-scope structures (ADR-0007, STEP 04 boundary)', async () => {
    const present = new Set(await tables());
    for (const t of [
      'variant',
      'variant_option_value',
      'bundle_line',
      'brand',
      'supplier',
      'sourcing_option',
      'inventory',
      'purchase_order',
      'work_order',
      'production_route',
      'component',
      'quote',
      'customer',
      // STEP 05B: staging stays generic (JSONB + candidate kind), no per-concept staging tables.
      'staging_product',
      'staging_service',
      'staging_price',
      'staging_option',
      'import_variant',
    ]) {
      expect(present.has(t), t).toBe(false);
    }
    const kinds = (
      await pool.query('select unnest(enum_range(null::catalog_item_kind))::text as k')
    ).rows.map((r) => r.k);
    expect(kinds).toEqual(['PRODUCT', 'SERVICE']);
    const statuses = (
      await pool.query('select unnest(enum_range(null::catalog_status))::text as k')
    ).rows.map((r) => r.k);
    expect(statuses).toEqual(['CANDIDATE', 'PLANNED', 'ACTIVE', 'RETIRED']); // no fifth state
  });
});
