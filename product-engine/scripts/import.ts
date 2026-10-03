/**
 * Import pipeline CLI (local database only; STEP 05B).
 *
 *   pnpm import:stage <file.envelope.json…> [--rerun] [--lineage KEY]
 *   pnpm import:status
 *   pnpm import:dry-run [--envelopes DIR] [--report FILE]
 *
 * Staging persists import evidence; nothing here approves or publishes. The dry
 * run stages every envelope (idempotently), validates it, runs the domain
 * adapter on every candidate of the primary batch without writing, and writes
 * IMPORT-DRY-RUN-REPORT.md.
 */
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createPool } from '../src/db/client';
import { batchStatistics, type BatchStatistics } from '../src/db/import/dry-run';
import { stageEnvelope, validateBatch, type StageResult } from '../src/db/import/staging';
import { parseImportEnvelope, type ImportEnvelope } from '../src/import/contract';
import { MAPPING_VERSION } from '../src/import/mappings';

for (const f of ['.env.local', '.env']) {
  if (existsSync(f) && !process.env.DATABASE_URL) process.loadEnvFile(f);
}
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'db']);

function assertLocal(): void {
  const host = new URL(process.env.DATABASE_URL ?? '').hostname;
  if (!LOCAL_HOSTS.has(host)) throw new Error(`Refusing to touch non-local database host ${host}`);
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function loadEnvelope(file: string): { envelope: ImportEnvelope; ms: number } {
  const t = performance.now();
  const r = parseImportEnvelope(JSON.parse(readFileSync(file, 'utf8')));
  if (!r.ok) {
    throw new Error(
      `${path.basename(file)} is not a valid ImportEnvelope v1:\n${r.errors.map((e) => `  ${e.path}: ${e.message}`).join('\n')}`,
    );
  }
  return { envelope: r.envelope, ms: Math.round(performance.now() - t) };
}

const pool = createPool();

async function inTransaction<T>(fn: (c: import('pg').PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    const out = await fn(c);
    await c.query('commit');
    return out;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}

async function stage(files: string[]) {
  for (const file of files) {
    const { envelope } = loadEnvelope(file);
    const r = await inTransaction(async (c) => {
      const s = await stageEnvelope(c, envelope, {
        rerun: process.argv.includes('--rerun'),
        lineageKey: arg('--lineage'),
      });
      const v = await validateBatch(c, s.batchId);
      return { ...s, validation: v.byStatus };
    });
    console.log(
      `${r.status === 'STAGED' ? '✓' : '='} ${path.basename(file)} → batch ${r.batchId} (attempt ${r.attempt}, ${r.status})`,
    );
    console.log(
      `  records ${r.records} · candidates ${r.candidates} · issues ${r.issues} · review ${JSON.stringify(r.validation)}`,
    );
  }
}

async function status() {
  const res = await pool.query(
    `select b.id, b.source_file, b.data_class, b.fixture_name, b.attempt, b.status, b.record_count, b.candidate_count,
            b.staged_at, (select count(*) from import_candidate c where c.batch_id = b.id and c.review_status = 'PUBLISHED')::int as published
       from import_batch b order by b.staged_at`,
  );
  if (res.rows.length === 0) console.log('no import batches');
  for (const b of res.rows) {
    console.log(
      `${b.id} ${b.data_class}${b.fixture_name ? `(${b.fixture_name})` : ''} ${b.source_file} #${b.attempt} ${b.status} records=${b.record_count} candidates=${b.candidate_count} published=${b.published}`,
    );
  }
}

// ---------------------------------------------------------------- dry run

interface BatchRun {
  file: string;
  envelope: ImportEnvelope;
  zodMs: number;
  first: StageResult;
  second: StageResult;
  validation: Record<string, number>;
}

const sha256File = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');

async function dryRun() {
  const dir = arg('--envelopes') ?? '.import/envelopes';
  const report = arg('--report') ?? 'docs/import/IMPORT-DRY-RUN-REPORT.md';
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.envelope.json'))
    .sort()
    .map((f) => path.join(dir, f));
  if (files.length === 0)
    throw new Error(`no *.envelope.json in ${dir} (run pnpm importer:envelopes)`);
  const sources = process.env.DTG_SOURCES;
  const hashesBefore = sources
    ? Object.fromEntries(
        readdirSync(sources)
          .filter((f) => f.endsWith('.xlsx'))
          .sort()
          .map((f) => [f, sha256File(path.join(sources, f))]),
      )
    : null;
  const domainSql = `select (select count(*) from catalog_item)::int as items, (select count(*) from price_definition)::int as prices,
                            (select count(*) from source_reference)::int as refs, (select count(*) from option_value)::int as values,
                            (select count(*) from composition_line)::int as lines, (select count(*) from presentation)::int as presentations`;
  const domainBefore = (await pool.query(domainSql)).rows[0];
  const revisionsBefore = (await pool.query('select * from v_revisions')).rows[0];

  const runs: BatchRun[] = [];
  for (const file of files) {
    const { envelope, ms } = loadEnvelope(file);
    const first = await inTransaction((c) => stageEnvelope(c, envelope));
    const validation = await inTransaction(
      async (c) => (await validateBatch(c, first.batchId)).byStatus,
    );
    const second = await inTransaction((c) => stageEnvelope(c, envelope));
    runs.push({ file: path.basename(file), envelope, zodMs: ms, first, second, validation });
    console.log(`${path.basename(file)}: ${first.status} → re-stage ${second.status}`);
  }
  const primary = runs.find((r) => r.envelope.import_batch.source_role === 'PRIMARY_RC');
  if (!primary) throw new Error('primary workbook envelope not found');
  console.log('running the domain adapter on every primary candidate (dry run, no writes)…');
  const stats = await batchStatistics(pool, primary.first.batchId, true);
  const domainAfter = (await pool.query(domainSql)).rows[0];
  const revisionsAfter = (await pool.query('select * from v_revisions')).rows[0];
  const hashesAfter = sources
    ? Object.fromEntries(
        Object.keys(hashesBefore!).map((f) => [f, sha256File(path.join(sources, f))]),
      )
    : null;

  const md = renderReport({
    runs,
    stats,
    domainBefore,
    domainAfter,
    revisionsBefore,
    revisionsAfter,
    hashesBefore,
    hashesAfter,
  });
  writeFileSync(report, md);
  console.log(`wrote ${report}`);
}

interface ReportInput {
  runs: BatchRun[];
  stats: BatchStatistics;
  domainBefore: Record<string, number>;
  domainAfter: Record<string, number>;
  revisionsBefore: Record<string, unknown>;
  revisionsAfter: Record<string, unknown>;
  hashesBefore: Record<string, string> | null;
  hashesAfter: Record<string, string> | null;
}

const table = (head: string[], body: (string | number | null | undefined)[][]) =>
  [
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...body.map((r) => `| ${r.map((x) => String(x ?? '—').replace(/\|/g, '\\|')).join(' | ')} |`),
  ].join('\n');

function renderReport(x: ReportInput): string {
  const { runs, stats: s } = x;
  const primary = runs.find((r) => r.envelope.import_batch.source_role === 'PRIMARY_RC')!;
  const env = primary.envelope;
  const count = (kind: string) =>
    s.candidatesByKindStatus.filter((r) => r.kind === kind).reduce((n, r) => n + r.n, 0);
  const status = (st: string) =>
    s.candidatesByKindStatus.filter((r) => r.review_status === st).reduce((n, r) => n + r.n, 0);
  const realRecords = s.recordsByType.filter((r) => !r.synthetic).reduce((n, r) => n + r.n, 0);
  const testRecords = s.recordsByType.filter((r) => r.synthetic).reduce((n, r) => n + r.n, 0);
  const priceObs = s.priceGroups.reduce((n, g) => n + g.observations, 0);
  const matrixBreaks = s.priceGroups
    .filter((g) => g.model === 'EXACT_QUANTITY_MATRIX')
    .reduce((n, g) => n + g.observations, 0);
  const statusNull = s.statuses.find((r) => r.status === null)?.n ?? 0;
  const head = (() => {
    try {
      return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    } catch {
      return 'unknown';
    }
  })();
  const variantSignals = s.issues
    .filter((i) => i.code === 'VARIANT_MATERIALIZATION_CANDIDATE')
    .reduce((n, i) => n + i.n, 0);
  const domainUnchanged =
    JSON.stringify(x.domainBefore) === JSON.stringify(x.domainAfter) &&
    JSON.stringify(x.revisionsBefore) === JSON.stringify(x.revisionsAfter);
  const sourcesUnchanged =
    x.hashesBefore === null
      ? null
      : JSON.stringify(x.hashesBefore) === JSON.stringify(x.hashesAfter);
  const hashMatches =
    x.hashesBefore === null
      ? null
      : runs.every(
          (r) =>
            x.hashesBefore![r.envelope.import_batch.source_file] ===
            r.envelope.import_batch.source_sha256,
        );

  const L: string[] = [];
  L.push('# Import dry-run report (STEP 05B)', '');
  L.push(
    `Generated by \`pnpm import:dry-run\` at repository HEAD \`${head}\` against the **local** database. Contract \`${env.contract}\` v${env.contract_version}, exporter ${env.producer.exporter_version}, parser \`${env.producer.parser_name}\` ${env.producer.parser_version}, mapping tables ${MAPPING_VERSION}.`,
    '',
  );
  L.push(
    'Nothing was approved or published. The domain adapter ran on every primary candidate **as proposed** (no human resolution) in dry-run mode, without writing.',
    '',
  );
  L.push('## Summary', '');
  L.push(
    table(
      ['Metric', 'Value'],
      [
        ['Workbooks / envelopes staged', runs.length],
        ['Primary records parsed (real / TEST)', `${realRecords} / ${testRecords}`],
        ['Primary candidates', s.candidatesByKindStatus.reduce((n, r) => n + r.n, 0)],
        ['CATALOG_ITEM', count('CATALOG_ITEM')],
        ['OPTION', count('OPTION')],
        ['DECORATION', count('DECORATION')],
        ['COMPOSITION', count('COMPOSITION')],
        [
          'PRICE (PriceDefinition hypotheses)',
          `${count('PRICE')} (${priceObs} observations: ${matrixBreaks} exact-matrix breaks + ${priceObs - matrixBreaks} FIXED)`,
        ],
        ['PRESENTATION', count('PRESENTATION')],
        ['Historical prices (evidence only, excluded)', s.historical.length],
        ['Unknown commercial status (stays null)', statusNull],
        ['Issues (primary, distinct)', s.issues.reduce((n, i) => n + i.n, 0)],
        [
          'Warnings / errors / info',
          `${s.issues.filter((i) => i.severity === 'WARNING').reduce((n, i) => n + i.n, 0)} / ${s.issues.filter((i) => i.severity === 'ERROR').reduce((n, i) => n + i.n, 0)} / ${s.issues.filter((i) => i.severity === 'INFO').reduce((n, i) => n + i.n, 0)}`,
        ],
        [
          'Review status VALID / WARNING / BLOCKED',
          `${status('VALID')} / ${status('WARNING')} / ${status('BLOCKED')}`,
        ],
        [
          'Adaptable as proposed (no human resolution)',
          `${s.adapter.adaptableAsProposed} (${s.adapter.linkOnly} only reconcile with rows already seeded in the dev slice)`,
        ],
        [
          'Publishable in STEP 05B (REAL data)',
          '0 — publication of REAL batches is disabled; every candidate needs human approval',
        ],
        [
          'Possible duplicates (review pairs)',
          s.duplicates.filter((d) => d.severity === 'WARNING').length,
        ],
        [
          'Relationship pairs (not duplicates)',
          s.duplicates.filter((d) => d.severity === 'INFO').length,
        ],
        ['VARIANT_MATERIALIZATION_CANDIDATE signals', variantSignals],
        [
          'Idempotent re-stage (same hash + parser)',
          runs.every(
            (r) => r.second.status === 'ALREADY_STAGED' && r.second.batchId === r.first.batchId,
          )
            ? 'yes — every envelope returned ALREADY_STAGED'
            : 'NO',
        ],
        ['Domain tables unchanged by the dry run', domainUnchanged ? 'yes' : 'NO'],
        [
          'Source workbooks unchanged',
          sourcesUnchanged === null
            ? 'not checked (DTG_SOURCES not set)'
            : sourcesUnchanged
              ? 'yes (SHA-256 before = after)'
              : 'NO',
        ],
        [
          'Envelope hashes match the workbooks',
          hashMatches === null ? 'not checked' : hashMatches ? 'yes' : 'NO',
        ],
      ],
    ),
    '',
  );

  L.push('## Batches', '');
  L.push(
    table(
      [
        'File',
        'Role',
        'SHA-256',
        'Records',
        'Parser candidates',
        'Staged candidates',
        'Issues',
        'Historical',
        'Zod',
        'First run',
        'Re-run',
      ],
      runs.map((r) => {
        const b = r.envelope.import_batch;
        return [
          r.file.replace('.envelope.json', '.xlsx'),
          b.source_role,
          `\`${b.source_sha256.slice(0, 12)}…\``,
          b.record_count,
          b.candidate_count,
          r.first.candidates,
          r.first.issues,
          b.historical_price_count,
          `${r.zodMs} ms`,
          r.first.status,
          r.second.status,
        ];
      }),
    ),
    '',
  );
  L.push(
    'Parser candidates count every price observation (131) plus the presentation candidates; staged candidates group the price observations into PriceDefinition hypotheses (14).',
    '',
  );
  L.push(
    'Only the primary workbook (v1.2 RC) produces candidates; the other workbooks are staged as evidence (records and issues).',
    '',
  );

  L.push('## Primary records by table', '');
  L.push(
    table(
      ['Table', 'Real', 'TEST (never candidates)'],
      [...new Set(s.recordsByType.map((r) => r.record_type))].map((t) => [
        t,
        s.recordsByType.find((r) => r.record_type === t && !r.synthetic)?.n ?? 0,
        s.recordsByType.find((r) => r.record_type === t && r.synthetic)?.n ?? 0,
      ]),
    ),
    '',
  );

  L.push('## Candidates by kind and review status', '');
  L.push(
    table(
      ['Kind', 'Review status', 'Count'],
      s.candidatesByKindStatus.map((r) => [r.kind, r.review_status, r.n]),
    ),
    '',
  );
  L.push(
    `Item type (Clase): ${s.itemTypes.map((r) => `${r.item_type ?? 'unknown (null)'} ${r.n}`).join(' · ')}. Commercial status: ${s.statuses.map((r) => `${r.status ?? 'unknown (null)'} ${r.n}`).join(' · ')}. Unknown values are not converted: no item becomes CANDIDATE and no \`Obligatoria\` blank becomes false.`,
    '',
  );

  L.push('## Blocked candidates', '');
  L.push(
    s.blocked.length === 0
      ? 'None. (Blocking = parser rejection, source ERROR, unsupported model/operator, price not authorized in the source, MXN evidence, conflicting breaks, missing reference.)'
      : table(
          ['Lineage', 'Reasons'],
          s.blocked.map((b) => [b.lineage_key, b.blocking_reasons.join(', ')]),
        ),
    '',
  );

  L.push('## Fields a person must resolve before approval', '');
  L.push(
    table(
      ['Kind', 'Field', 'Candidates'],
      s.unresolved.map((u) => [u.kind, u.field, u.n]),
    ),
    '',
  );

  L.push('## Issues', '');
  L.push(
    table(
      ['Code', 'Severity', 'Origin', 'Distinct', 'Occurrences'],
      s.issues.map((i) => [i.code, i.severity, i.origin, i.n, i.occurrences]),
    ),
    '',
  );

  L.push('## Price definitions (grouped observations)', '');
  L.push(
    'Grouping key: item × currency × model × amount basis × exact condition set (option, attribute, operator, value, unit). Quantities are breaks; nothing is interpolated.',
    '',
  );
  L.push(
    table(
      ['Lineage', 'Model', 'Obs.', 'Quantities', 'Amounts (USD)', 'Status'],
      s.priceGroups.map((g) => [
        g.lineage_key.replace(/^PRICE:/, ''),
        g.model,
        g.observations,
        g.quantities.length ? g.quantities.join(', ') : 'unknown (FIXED)',
        g.amounts.join(', '),
        g.review_status,
      ]),
    ),
    '',
  );
  L.push(
    `Quantity 750 in any matrix: ${s.priceGroups.some((g) => g.quantities.includes(750)) ? 'PRESENT (error)' : 'absent — resolves to QUOTE_ONLY / QUANTITY_NOT_IN_MATRIX'}.`,
    '',
  );

  L.push('## Historical prices (never price definitions)', '');
  L.push(
    table(
      ['Item', 'Price', 'Amount', 'Currency', 'Model', 'Source note'],
      s.historical.map((h) => [
        h.item,
        h.price,
        h.amount,
        h.currency,
        h.model,
        (h.notes ?? '').slice(0, 90),
      ]),
    ),
    '',
  );

  L.push('## Duplicate review (never merged automatically)', '');
  L.push(
    table(
      ['Kind', 'Pair', 'Signals'],
      s.duplicates.map((d) => [
        String(d.detail.kind),
        (d.detail.legacyIds as string[]).join(' / '),
        (d.detail.signals as string[]).join('; '),
      ]),
    ),
    '',
  );

  L.push('## Decoration method associations (suggestion ≠ decision)', '');
  L.push(
    table(
      ['Excel label', 'Suggested method', 'Associations'],
      s.decorationSuggestions.map((d) => [
        d.labels,
        d.suggestion ?? '— (production process, not a decoration method)',
        d.n,
      ]),
    ),
    '',
  );

  L.push('## Presentation evidence', '');
  L.push(
    table(
      ['Link', 'Item', 'Name', 'Occasion', 'Locale'],
      s.presentations.map((p) => [
        p.lineage_key.replace(/^PRESENTATION:/, ''),
        p.item,
        p.name,
        p.occasion,
        p.locale ?? 'unresolved',
      ]),
    ),
    '',
  );

  L.push('## Domain adapter dry run (proposals as-is)', '');
  L.push(
    table(
      ['Kind', 'Adaptable', 'Rejected'],
      Object.entries(s.adapter.byKind).map(([k, v]) => [k, v.ok, v.failed]),
    ),
    '',
  );
  L.push('', 'First rejection reason per candidate:', '');
  L.push(
    table(
      ['Reason', 'Candidates'],
      Object.entries(s.adapter.byFirstError)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => [k, v]),
    ),
    '',
  );
  const creating = s.adapter.adaptableAsProposed - s.adapter.linkOnly;
  L.push(
    `${s.adapter.linkOnly} of the ${s.adapter.adaptableAsProposed} adaptable candidates would only link to rows that the dev slice already seeded (e.g. X-Banner composition, Blank/Personalizada policies); ${creating === 0 ? 'none' : creating} would create domain rows without a human resolution.`,
    '',
  );
  L.push(
    'A candidate becomes publishable only after a person resolves its unknown fields, approves it, and a later step enables publication of REAL data.',
    '',
  );

  L.push('## Lineage', '');
  L.push(
    table(
      ['Status vs previous batch', 'Candidates'],
      s.lineage.map((l) => [l.lineage_status, l.n]),
    ),
    '',
  );

  if (x.hashesBefore) {
    L.push('## Source integrity', '');
    L.push(
      table(
        ['Workbook', 'SHA-256 before', 'After'],
        Object.keys(x.hashesBefore).map((f) => [
          f,
          `\`${x.hashesBefore![f]}\``,
          x.hashesAfter![f] === x.hashesBefore![f] ? 'identical' : 'CHANGED',
        ]),
      ),
      '',
    );
  }
  return L.join('\n') + '\n';
}

// ---------------------------------------------------------------- main

async function main() {
  assertLocal();
  const cmd = process.argv[2];
  try {
    if (cmd === 'stage')
      await stage(
        process.argv
          .slice(3)
          .filter((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--lineage'),
      );
    else if (cmd === 'status') await status();
    else if (cmd === 'dry-run') await dryRun();
    else
      throw new Error(
        'usage: import.ts stage <files…> | status | dry-run [--envelopes DIR] [--report FILE]',
      );
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
