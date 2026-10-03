/**
 * Generates the SQL seed files from the typed datasets (ADR-0013).
 *   pnpm seed:generate   → writes supabase/seeds/*.generated.sql
 *   pnpm seed:check      → fails if the committed SQL differs from the datasets
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { devSliceDataset } from '../data/dev-slice';
import { referenceDataset } from '../data/reference';
import type { SeedDataset } from '../data/types';

type SqlValue = string | number | boolean | null | undefined | SqlRaw;
class SqlRaw {
  constructor(readonly sql: string) {}
}
const raw = (sql: string) => new SqlRaw(sql);

function lit(v: SqlValue): string {
  if (v instanceof SqlRaw) return v.sql;
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return `'${v.replace(/'/g, "''")}'`;
}
const json = (v: unknown) =>
  v === null || v === undefined ? raw('null') : raw(`${lit(JSON.stringify(v))}::jsonb`);
const textArray = (a: string[]) =>
  raw(a.length ? `array[${a.map(lit).join(', ')}]::text[]` : `'{}'::text[]`);

function insert(table: string, rows: Record<string, SqlValue>[]): string {
  if (rows.length === 0) return '';
  const cols = Object.keys(rows[0] as object);
  const values = rows.map((r) => `  (${cols.map((c) => lit(r[c])).join(', ')})`).join(',\n');
  return `insert into ${table} (${cols.join(', ')}) values\n${values};\n`;
}

function datasetSql(d: SeedDataset): string {
  const out: string[] = [];
  out.push(
    insert(
      'market',
      d.markets.map((m) => ({
        id: m.id,
        code: m.code,
        name: m.name,
        default_currency: m.defaultCurrency,
      })),
    ),
  );
  // master books first (derived books reference them)
  const books = [...d.priceBooks].sort((a, b) =>
    a.mode === b.mode ? 0 : a.mode === 'MASTER' ? -1 : 1,
  );
  out.push(
    insert(
      'price_book',
      books.map((b) => ({
        id: b.id,
        code: b.code,
        market_id: b.marketId,
        currency: b.currency,
        mode: b.mode,
        source_price_book_id: b.sourcePriceBookId,
        default_factor: b.defaultFactor === null ? null : raw(b.defaultFactor),
      })),
    ),
  );
  out.push(
    insert(
      'pricing_parameter',
      d.pricingParameters.map((p) => ({
        id: p.id,
        key: p.key,
        value: raw(p.value),
        valid_from: p.validFrom,
        valid_to: p.validTo,
      })),
    ),
  );
  out.push(
    insert(
      'decoration_method',
      d.decorationMethods.map((m) => ({
        id: m.id,
        key: m.key,
        name: m.name,
        is_active: m.isActive,
      })),
    ),
  );
  out.push(
    insert(
      'publication_profile',
      d.publicationProfiles.map((p) => ({
        id: p.id,
        key: p.key,
        name: p.name,
        inclusion_mode: p.inclusionMode,
        allowed_statuses: raw(`array[${p.allowedStatuses.map(lit).join(', ')}]::catalog_status[]`),
        shows_prices: p.showsPrices,
        price_book_id: p.priceBookId,
        locale: p.locale,
      })),
    ),
  );
  out.push(
    insert(
      'category',
      d.categories.map((c) => ({
        id: c.id,
        key: c.key,
        name: c.name,
        parent_id: c.parentId,
        sort: c.sort,
        is_active: c.isActive,
      })),
    ),
  );
  out.push(
    insert(
      'catalog_item',
      d.items.map((i) => ({
        id: i.id,
        public_code: i.publicCode,
        kind: i.kind,
        canonical_name: i.canonicalName,
        status: i.status,
        sale_unit: i.saleUnit,
        measurement_spec: json(i.measurementSpec),
        decoration_policy: i.decorationPolicy,
        customer_supplied_item: i.customerSuppliedItem,
        description_internal: i.descriptionInternal,
        merged_into_id: i.mergedIntoId,
      })),
    ),
  );
  if (d.items.length > 0) {
    out.push(
      "select setval('catalog_item_public_code_seq', (select max(substring(public_code from 5)::bigint) from catalog_item));\n",
    );
  }
  out.push(
    insert(
      'catalog_item_category',
      d.itemCategories.map((c) => ({
        item_id: c.itemId,
        category_id: c.categoryId,
        is_primary: c.isPrimary,
      })),
    ),
  );
  out.push(
    insert(
      'option_definition',
      d.optionDefinitions.map((o) => ({
        id: o.id,
        key: o.key,
        label: o.label,
        value_kind: o.valueKind,
        unit: o.unit,
        scope: o.scope,
      })),
    ),
  );
  out.push(
    insert(
      'option_value',
      d.optionValues.map((v) => ({
        id: v.id,
        option_definition_id: v.optionDefinitionId,
        code: v.code,
        label: v.label,
        spec: json(v.spec),
        sort: v.sort,
        is_active: v.isActive,
      })),
    ),
  );
  out.push(
    insert(
      'item_option',
      d.itemOptions.map((o) => ({
        item_id: o.itemId,
        option_definition_id: o.optionDefinitionId,
        is_required: o.isRequired,
        selection_mode: o.selectionMode,
        is_distributable: o.isDistributable,
        sort: o.sort,
        default_value_id: o.defaultValueId,
      })),
    ),
  );
  out.push(
    insert(
      'item_option_value',
      d.itemOptionValues.map((v) => ({
        item_id: v.itemId,
        option_definition_id: v.optionDefinitionId,
        option_value_id: v.optionValueId,
        sort: v.sort,
        is_active: v.isActive,
      })),
    ),
  );
  out.push(
    insert(
      'decoration_capability',
      d.decorationCapabilities.map((c) => ({
        item_id: c.itemId,
        method_id: c.methodId,
        constraints: json(c.constraints),
        note: c.note,
      })),
    ),
  );
  out.push(
    insert(
      'composition_line',
      d.compositionLines.map((l) => ({
        id: l.id,
        parent_item_id: l.parentItemId,
        child_item_id: l.childItemId,
        quantity: l.quantity,
        role: l.role,
        sort: l.sort,
        note: l.note,
      })),
    ),
  );
  out.push(
    insert(
      'item_market_policy',
      d.itemMarketPolicies.map((p) => ({
        item_id: p.itemId,
        market_id: p.marketId,
        pricing_mode: p.pricingMode,
        factor_override: p.factorOverride === null ? null : raw(p.factorOverride),
        is_available: p.isAvailable,
      })),
    ),
  );

  // Prices: insert as DRAFT, add breaks and conditions, then authorize (the database
  // freezes children of AUTHORIZED definitions and validates authorization).
  for (const def of d.priceDefinitions) {
    out.push(
      insert('price_definition', [
        {
          id: def.id,
          item_id: def.itemId,
          price_book_id: def.priceBookId,
          component: def.component,
          model: def.model,
          amount: def.model === 'FIXED' || def.model === 'PER_UNIT' ? raw(def.amount) : null,
          rate: def.model === 'MEASURED' ? raw(def.rate) : null,
          rate_unit: def.model === 'MEASURED' ? def.rateUnit : null,
          min_charge:
            def.model === 'MEASURED' && def.minCharge !== null ? raw(def.minCharge) : null,
          min_quantity: def.model === 'PER_UNIT' ? def.minQuantity : null,
          max_quantity: def.model === 'FIXED' || def.model === 'PER_UNIT' ? def.maxQuantity : null,
          status: 'DRAFT',
          valid_from: def.validFrom,
          valid_to: def.validTo,
          version: def.version,
          supersedes_id: def.supersedesId,
          authorized_by: null,
          authorized_at: null,
        },
      ]),
    );
    if (def.model === 'EXACT_QUANTITY_MATRIX' || def.model === 'TIERED') {
      out.push(
        insert(
          'price_break',
          def.breaks.map((b) => ({
            price_definition_id: def.id,
            quantity: b.quantity,
            amount: raw(b.amount),
            amount_basis: b.amountBasis,
          })),
        ),
      );
    }
    out.push(
      insert(
        'price_condition',
        def.conditions.map((c) => conditionRow(c, { price_definition_id: def.id })),
      ),
    );
    if (def.status !== 'DRAFT') {
      out.push(
        `update price_definition set status = ${lit(def.status)}, authorized_by = ${lit(def.authorizedBy)}, authorized_at = ${lit(def.authorizedAt)} where id = ${lit(def.id)};\n`,
      );
    }
  }
  for (const r of d.priceRules) {
    out.push(
      insert('price_rule', [
        {
          id: r.id,
          price_book_id: r.priceBookId,
          code: r.code,
          label: r.label,
          kind: r.kind,
          amount: r.amount === null ? null : raw(r.amount),
          exclusivity_key: r.exclusivityKey,
          status: 'DRAFT',
          valid_from: r.validFrom,
          valid_to: r.validTo,
          version: r.version,
          supersedes_id: r.supersedesId,
          authorized_by: null,
          authorized_at: null,
        },
      ]),
    );
    out.push(
      insert(
        'price_condition',
        r.conditions.map((c) => conditionRow(c, { price_rule_id: r.id })),
      ),
    );
    out.push(
      insert(
        'price_rule_assignment',
        r.itemIds.map((itemId) => ({ price_rule_id: r.id, item_id: itemId })),
      ),
    );
    if (r.status !== 'DRAFT') {
      out.push(
        `update price_rule set status = ${lit(r.status)}, authorized_by = ${lit(r.authorizedBy)}, authorized_at = ${lit(r.authorizedAt)} where id = ${lit(r.id)};\n`,
      );
    }
  }

  out.push(
    insert(
      'presentation',
      d.presentations.map((p) => ({
        id: p.id,
        item_id: p.itemId,
        locale: p.locale,
        occasion: p.occasion,
        display_name: p.displayName,
        short_description: p.shortDescription,
        aliases: textArray(p.aliases),
        seo_keywords: textArray(p.seoKeywords),
        is_default: p.isDefault,
        status: p.status,
      })),
    ),
  );
  out.push(
    insert(
      'publication_assignment',
      d.publicationAssignments.map((a) => ({
        profile_id: a.profileId,
        item_id: a.itemId,
        presentation_id: a.presentationId,
        is_included: a.isIncluded,
        sort: a.sort,
      })),
    ),
  );
  out.push(
    insert(
      'source_reference',
      d.sourceReferences.map((r) => ({
        id: r.id,
        entity_type: r.entityType,
        entity_id: r.entityId,
        field: r.field,
        source_kind: r.sourceKind,
        source_locator: r.sourceLocator,
        payload: json(r.payload),
        captured_at: r.capturedAt,
      })),
    ),
  );
  out.push(
    insert(
      'decision_record',
      d.decisionRecords.map((r) => ({
        id: r.id,
        code: r.code,
        title: r.title,
        status: r.status,
        statement: r.statement,
        decided_by: r.decidedBy,
        decided_at: r.decidedAt,
        source: r.source,
      })),
    ),
  );
  out.push(
    insert(
      'decision_subject',
      d.decisionRecords.flatMap((r) =>
        r.subjects.map((s) => ({
          decision_id: r.id,
          entity_type: s.entityType,
          entity_id: s.entityId,
        })),
      ),
    ),
  );
  return out.filter(Boolean).join('\n');
}

function conditionRow(
  c: SeedDataset['priceDefinitions'][number]['conditions'][number],
  owner: { price_definition_id?: string; price_rule_id?: string },
): Record<string, SqlValue> {
  return {
    id: c.id,
    price_definition_id: owner.price_definition_id ?? null,
    price_rule_id: owner.price_rule_id ?? null,
    kind: c.kind,
    option_definition_id: c.kind === 'OPTION_VALUE' ? c.optionDefinitionId : null,
    option_value_id: c.kind === 'OPTION_VALUE' ? c.optionValueId : null,
    decoration_method_id: c.kind === 'DECORATION_METHOD' ? c.decorationMethodId : null,
  };
}

const HEADER = (layer: string, note: string) =>
  `-- GENERATED by scripts/generate-seeds.ts — DO NOT EDIT. Source: data/${layer}.\n-- ${note}\n\n`;

const FILES: { file: string; sql: () => string }[] = [
  {
    file: 'supabase/seeds/0001_reference.generated.sql',
    sql: () =>
      HEADER(
        'reference.ts',
        'REFERENCE DATA (ADR-0013). Provisional values: FX 16.50, MX factor 0.70.',
      ) + datasetSql(referenceDataset()),
  },
  {
    file: 'supabase/seeds/0002_dev_slice.generated.sql',
    sql: () =>
      HEADER(
        'dev-slice/',
        'DEV SLICE — development data, NOT production truth. Real authorized prices; provisional statuses (P1-01).',
      ) + datasetSql(devSliceDataset()),
  },
];

const check = process.argv.includes('--check');
let drift = false;
for (const f of FILES) {
  const target = path.resolve(f.file);
  const sql = f.sql();
  if (check) {
    const current = existsSync(target) ? readFileSync(target, 'utf8') : '';
    if (current !== sql) {
      drift = true;
      console.error(`✗ ${f.file} is out of date — run pnpm seed:generate`);
    } else console.log(`✓ ${f.file}`);
  } else {
    writeFileSync(target, sql);
    console.log(`wrote ${f.file}`);
  }
}
if (drift) process.exit(1);
