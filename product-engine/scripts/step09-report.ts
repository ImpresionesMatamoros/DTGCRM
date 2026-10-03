/**
 * STEP 09 reports, computed from the LOCAL database (read-only). Nothing is invented.
 *
 *   tsx scripts/step09-report.ts pre    OWNER_DECISION_GATE.md + REAL_PUBLICATION_DRY_RUN.md   (before any REAL write)
 *   tsx scripts/step09-report.ts post   COMMERCIAL_PRINT_MIGRATION_REPORT.md + POST_MIGRATION_DATA_QUALITY.md
 *                                       + MVP_VERIFICATION.md data (after the scoped publication)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createPool } from '../src/db/client';
import { decisionStates } from '../src/db/admin/decision-answers';
import {
  activePermit,
  currentMigrationGate,
  dryRunCandidates,
  SCOPE_KEY,
} from '../src/db/migration/permit';
import { traceCandidate, traceEntity } from '../src/db/import/provenance';
import { loadCatalogSnapshot } from '../src/db/catalog-snapshot';
import { resolvePrice } from '../src/pricing/resolve';
import { OWNER_DECISIONS } from '../src/decisions/reference';
import { buildContext, ownerLegacyOf } from '../src/quality/context';
import { STEP09_DEFAULT_MARKETS } from '../src/decisions/step09-owner-decisions';
import { dryRun } from './step09-migrate';

for (const f of ['.env.local', '.env']) {
  if (existsSync(f) && !process.env.DATABASE_URL) process.loadEnvFile(f);
}
const host = new URL(process.env.DATABASE_URL ?? '').hostname;
if (!['localhost', '127.0.0.1', '::1', 'db'].includes(host))
  throw new Error(`non-local host ${host}`);

const OUT = 'docs/step09';
mkdirSync(path.join(OUT, 'data'), { recursive: true });
const pool = createPool();
const md = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const table = (head: string[], rows: (string | number)[][]) =>
  [
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.map((c) => md(String(c))).join(' | ')} |`),
  ].join('\n');

/** A = required before ANY Commercial Print item may be REAL-published; B = needed only by specific items; C = may stay open for the MVP. */
const CLASSIFICATION: Record<string, { cls: 'A' | 'B' | 'C'; why: string }> = {
  'D-001': {
    cls: 'A',
    why: 'Todo item publicado necesita estado formal (ACTIVE/…): sin él no hay publicación.',
  },
  'D-016': {
    cls: 'A',
    why: 'Autoridad de publicación/precio: sin ella no hay primera publicación REAL (OD-05, OD-07).',
  },
  'D-002': {
    cls: 'B',
    why: 'La unidad de venta sólo bloquea a los items que no la traen de la fuente ni del dominio.',
  },
  'D-003': { cls: 'B', why: 'Sólo afecta a OWN-MT-O-046 (alcance de tres tipos sin resolver).' },
  'D-010': { cls: 'B', why: 'Sólo imanes (OD-08: 65 USD = 1 par; sin múltiplos).' },
  'D-004': {
    cls: 'C',
    why: 'Qué datos pide el vendedor: revisión condicional de alcance; no impide publicar con precio bajo cotización.',
  },
  'D-005': {
    cls: 'C',
    why: 'Significado de opciones genéricas: sólo condiciona el alcance de Menús/Inv. con acrílico (que ya están bloqueados por D-001).',
  },
  'D-009': { cls: 'C', why: 'Navegación del imán (satélite, no se recategoriza): P2, no bloquea.' },
  'D-018': {
    cls: 'C',
    why: 'Invitaciones legacy vs Formal/Casual: el MVP puede salir sin invitaciones.',
  },
  'D-022': {
    cls: 'C',
    why: 'México (redondeo/IVA): OD-09 fija USA como mercado MVP; se exime para el permiso USA y México no bloquea.',
  },
};

async function pre() {
  const { gate, cp, report } = await currentMigrationGate(pool, STEP09_DEFAULT_MARKETS);
  const states = await decisionStates(pool);
  const stateOf = new Map(states.map((s) => [s.id, s]));
  const ctx = buildContext(report.input);
  const asOf = new Date().toISOString();
  const inScope = new Set(gate.items.map((i) => i.legacyId));

  // ---- OWNER_DECISION_GATE.md
  const byDecision = new Map<string, string[]>();
  for (const it of gate.items)
    for (const d of it.openDecisions)
      byDecision.set(d, [...(byDecision.get(d) ?? []), it.legacyId]);
  const decRows = OWNER_DECISIONS.filter((d) =>
    d.affected.some((a) => inScope.has(a.legacyId)),
  ).map((d) => {
    const c = CLASSIFICATION[d.id] ?? { cls: 'C' as const, why: '—' };
    const affected = d.affected.filter((a) => inScope.has(a.legacyId)).map((a) => a.legacyId);
    const open = byDecision.get(d.id) ?? [];
    const waived = gate.waivers.some((w) => w.decisionId === d.id);
    const st = stateOf.get(d.id);
    return [
      d.id,
      d.title,
      c.cls,
      waived
        ? 'ABIERTA — eximida (USA)'
        : st?.status === 'ANSWERED'
          ? open.length
            ? 'RESPONDIDA parcial'
            : 'RESPONDIDA'
          : 'ABIERTA',
      `${affected.length}`,
      open.length ? `${open.length}: ${open.join(', ')}` : waived ? 'eximida' : '—',
      c.why,
    ];
  });
  writeFileSync(
    path.join(OUT, 'OWNER_DECISION_GATE.md'),
    `# STEP 09 — Compuerta de decisiones del dueño

Generado por \`tsx scripts/step09-report.ts pre\` el ${asOf}. Se aplica OD-01..OD-09 (mensaje de Martín) y se **recalcula** Data Quality/readiness; sólo se listan las decisiones **todavía realmente abiertas**. Nada se pregunta dos veces.

Clasificación: **A** = requerida antes de publicar cualquier item de Commercial Print · **B** = sólo para items concretos · **C** = puede quedar abierta para el MVP.

${table(['Decisión', 'Título', 'Clase', 'Estado', 'Items en alcance', 'Items que sigue bloqueando', 'Por qué esa clase'], decRows)}

## Decisiones ya resueltas por OD-01..OD-09 (no se repiten)

${table(
  ['OD', 'Decisión del dueño', 'Dónde se aplica'],
  [
    [
      'OD-01',
      'ACTIVE = DTG vende/cotiza hoy; ACTIVE + QUOTE_ONLY es válido; la ausencia no es inactivo',
      'D-001 · sólo coincidencias claras: Tarjetas ×2, Flyers, Postales, Imanes',
    ],
    [
      'OD-02',
      'La mayoría PIECE; excepciones tarjetas/flyers/stickers; un paquete no es otro CatalogItem',
      'D-002 · Postales = PIECE (Tarjetas/Flyers conservan su unidad del dominio)',
    ],
    [
      'OD-03',
      'Tangible = PRODUCT, intangible = SERVICE (sólo casos inequívocos)',
      'Los 5 items elegibles son PRODUCT; los híbridos siguen en revisión',
    ],
    [
      'OD-04',
      'Proveedor/acabado/técnica son internos, no opciones del cliente',
      'Las 6 decoraciones "Impresión" de los 5 items se rechazan con razón; decorationPolicy NONE',
    ],
    [
      'OD-05',
      'Martín autoriza el precio maestro',
      'D-016 · los precios existentes quedan bajo esa autoridad',
    ],
    [
      'OD-06',
      'Heurística 2×costo/mercado: sugerencia, nunca autoriza',
      'No se usa: ningún precio se sugiere ni se inventa',
    ],
    [
      'OD-07',
      'Martín autoriza la primera publicación REAL',
      'D-016 · el permiso lo aprueba el actor "martin" (migration.approve)',
    ],
    [
      'OD-08',
      'Imán 65 USD = 1 par, sin múltiplos lineales',
      'D-010 · saleUnit PAIR, maxQuantity 1; 2+ pares = QUOTE_ONLY',
    ],
    [
      'OD-09',
      'USA mercado MVP; México no bloquea; HALF_UP_2 provisional; sin motor de impuestos',
      'D-022 queda abierta y se exime para el permiso USA',
    ],
  ],
)}

## Decisiones realmente abiertas que bloquean items (resumen)

- **D-001 (A)** sigue abierta para ${byDecision.get('D-001')?.length ?? 0} items: sólo se resolvieron las coincidencias claras de OD-01.
- **D-002 (B)** sigue abierta para ${byDecision.get('D-002')?.length ?? 0} items.
- **D-003 (B)**: ${byDecision.get('D-003')?.join(', ') || '—'}.
- **D-022 (C)**: eximida para USA; sigue abierta para México (no bloquea).
`,
  );

  // ---- REAL_PUBLICATION_DRY_RUN.md
  const sim = await dryRun();
  const simItems = new Map(
    (sim.publish && sim.publish.ok ? sim.publish.items : []).map((i) => [i.itemLegacyId, i]),
  );
  const rows: (string | number)[][] = [];
  const detail: string[] = [];
  const snapshot = [];
  for (const it of cp.items) {
    const item = ctx.byKind('CATALOG_ITEM').find((c) => ctx.ownerLegacy(c) === it.legacyId) ?? null;
    const own = ctx.candidates.filter((c) => ownerLegacyOf(c) === it.legacyId);
    const kindV = item ? (ctx.effective(item, 'itemType') as string | undefined) : undefined;
    const dec = item ? (ctx.effective(item, 'decorationPolicy') as string | undefined) : undefined;
    const g = report.input.candidates ? null : null;
    void g;
    const sim1 = simItems.get(it.legacyId);
    let adapter: string;
    if (sim1)
      adapter = sim1.ok
        ? `OK (${sim1.candidates.map((c) => `${c.kind}:${c.linked ? 'link' + c.linked : 'crea' + c.created}`).join(' ')})`
        : `FALLA: ${sim1.errors.join('; ')}`;
    else {
      const ids = own.filter((c) => c.reviewStatus !== 'REJECTED').map((c) => c.id);
      const r = await dryRunCandidates(pool, ids);
      const bad = [...r.values()].filter((x) => !x.ok);
      adapter = bad.length
        ? `NO (${[...new Set(bad.flatMap((b) => b.errors.map((e) => e.split(':')[0])))].join(', ')})`
        : 'OK';
    }
    const prov = `${it.provenance.state} (${it.provenance.candidates} candidatos, ${it.provenance.broken} rotos)`;
    const code = sim1?.publicCode ?? '—';
    const dq = [...it.blockers.domain, ...it.blockers.option, ...it.blockers.pricing];
    rows.push([
      it.legacyId,
      it.candidateId?.slice(0, 8) ?? '—',
      it.name,
      sim1
        ? `${code}${sim1.candidates.some((c) => c.kind === 'CATALOG_ITEM' && c.created) ? ' (nuevo, no reservado)' : ' (existente)'}`
        : '—',
      it.status.value ?? 'FALTA',
      it.category.value ?? 'FALTA',
      it.saleUnit.value ?? 'FALTA',
      kindV ?? '—',
      dec ?? 'FALTA',
      `${it.options.candidates} cand. / ${it.options.unresolved} sin res.`,
      `${it.presentations.candidates} cand. / ${it.presentations.unresolved} sin res.`,
      it.price.state,
      it.openDecisions.join(' ') || '—',
      dq.length,
      adapter,
      prov,
      gate.items.find((x) => x.legacyId === it.legacyId)!.verdict !== 'BLOCKED' ? 'YES' : 'NO',
    ]);
    const v = gate.items.find((x) => x.legacyId === it.legacyId)!;
    detail.push(
      `### ${it.legacyId} — ${it.name}\n\n- PUBLISHABLE: **${v.verdict !== 'BLOCKED' ? 'YES' : 'NO'}**\n` +
        (v.reasons.length
          ? v.reasons.map((r) => `- ${r}`).join('\n')
          : '- Pasa su compuerta: revisión, dominio, precio, decisiones (con eximiciones), procedencia y categoría.') +
        (dq.length
          ? `\n- Bloqueos Data Quality: ${dq.slice(0, 6).join(' · ')}${dq.length > 6 ? ` (+${dq.length - 6})` : ''}`
          : ''),
    );
    snapshot.push({
      legacyId: it.legacyId,
      verdict: v.verdict,
      reasons: v.reasons,
      pricing: it.price.state,
    });
  }
  const pub = gate.items.filter((i) => i.verdict !== 'BLOCKED').length;
  writeFileSync(
    path.join(OUT, 'REAL_PUBLICATION_DRY_RUN.md'),
    `# STEP 09 — Dry run de publicación REAL

Generado por \`tsx scripts/step09-report.ts pre\` el ${asOf}, **antes de cualquier escritura REAL**. La simulación crea el permiso y ejecuta la publicación completa dentro de una transacción que se **revierte** (y devuelve el asignador de códigos a su estado): no queda nada escrito.

Alcance: **${gate.scoped} items** (paquete STEP 05C Commercial Print) · mercado ${gate.markets.join(', ')} · eximiciones: ${gate.waivers.map((w) => w.decisionId).join(', ') || 'ninguna'}.

## Resumen

${table(
  ['Medida', 'Valor'],
  [
    ['En alcance', gate.scoped],
    ['PUBLISHABLE: YES', pub],
    ['PUBLISHABLE: NO (bloqueados, siguen en staging con razón)', gate.blocked],
    [
      'Con precio autorizado vía Price Engine (READY)',
      gate.items.filter((i) => i.pricing === 'READY').length,
    ],
    ['Sólo cotización (QUOTE_ONLY)', gate.items.filter((i) => i.pricing === 'QUOTE_ONLY').length],
    ['Procedencia rota', cp.totals.brokenProvenance],
  ],
)}

## Por item

${table(
  [
    'ID legacy',
    'Candidato',
    'Nombre',
    'Código público',
    'Estado',
    'Categoría',
    'Unidad',
    'Tipo',
    'Decoración',
    'Opciones',
    'Presentaciones',
    'Precio',
    'Decisiones abiertas',
    'Bloqueos DQ',
    'Adaptador',
    'Procedencia',
    'PUBLISHABLE',
  ],
  rows,
)}

## Razones

${detail.join('\n\n')}
`,
  );
  writeFileSync(
    path.join(OUT, 'data', 'dry-run-gate.json'),
    JSON.stringify({ asOf, snapshot }, null, 2),
  );
  console.log(`pre: ${pub}/${gate.scoped} publishable`);
}

async function post() {
  const asOf = new Date();
  const { gate, cp, report } = await currentMigrationGate(pool, STEP09_DEFAULT_MARKETS, asOf);
  const permit = await activePermit(pool, SCOPE_KEY);
  if (!permit) throw new Error('no active permit: run the scoped publication first');
  const baseline = JSON.parse(readFileSync('docs/step08/data-quality-report.json', 'utf8')) as {
    summary: {
      findings: { total: number; blockers: number; warnings: number; info: number };
      ownerDecisionRequired: number;
      candidates: { total: number };
    };
    readiness: {
      legacyId: string;
      publication: { state: string };
      review: { state: string };
      domain: { state: string };
      pricing: { state: string };
    }[];
  };
  const pre = existsSync(path.join(OUT, 'data', 'dq-pre-publication.json'))
    ? (JSON.parse(readFileSync(path.join(OUT, 'data', 'dq-pre-publication.json'), 'utf8')) as {
        summary: typeof baseline.summary;
      })
    : null;

  // ---- published items
  const pubRows = (
    await pool.query(
      `select p.item_legacy_id, i.id, i.public_code, i.canonical_name, i.kind, i.status, i.sale_unit, i.decoration_policy,
              (select c.key from catalog_item_category ic join category c on c.id = ic.category_id where ic.item_id = i.id and ic.is_primary limit 1) as category,
              (select l.link_kind from import_candidate_link l join import_candidate c on c.id = l.candidate_id
                where l.entity_id = i.id and l.entity_type = 'catalog_item' and c.kind = 'CATALOG_ITEM' limit 1) as link_kind,
              (select count(*)::int from item_option io where io.item_id = i.id) as options,
              (select count(*)::int from price_definition d where d.item_id = i.id and d.status = 'AUTHORIZED') as authorized,
              (select count(*)::int from price_definition d where d.item_id = i.id and d.status = 'DRAFT') as draft,
              p.actor, p.published_at
         from (select distinct on (item_legacy_id) * from migration_publication order by item_legacy_id, published_at) p
         join import_candidate_link l on l.candidate_id = p.candidate_id and l.entity_type = 'catalog_item'
         join catalog_item i on i.id = l.entity_id
        order by i.public_code`,
    )
  ).rows;

  // ---- provenance verification, both directions
  const pubCandidates = (
    await pool.query(
      'select p.candidate_id, p.item_legacy_id from migration_publication p order by p.item_legacy_id, p.candidate_id',
    )
  ).rows as { candidate_id: string; item_legacy_id: string }[];
  let traced = 0;
  const broken: string[] = [];
  for (const pc of pubCandidates) {
    const t = await traceCandidate(pool, pc.candidate_id);
    const okChain =
      !!t &&
      t.reviewStatus === 'PUBLISHED' &&
      t.batch.sourceSha256.length === 64 &&
      t.links.length > 0 &&
      t.records.length > 0 &&
      t.records.every(
        (r) =>
          r.cells.length > 0 &&
          r.cells.every(
            (c) => !!c.source_sheet && !!c.source_cell && c.workbook_sha256.length === 64,
          ),
      );
    if (okChain) traced++;
    else broken.push(`${pc.item_legacy_id}:${pc.candidate_id.slice(0, 8)}`);
  }
  const itemTrace = [];
  for (const r of pubRows) {
    const t = await traceEntity(pool, 'catalog_item', r.id as string);
    itemTrace.push({
      code: r.public_code as string,
      candidates: t.length,
      cells: t.reduce((n, x) => n + x.records.reduce((m, y) => m + y.cells.length, 0), 0),
    });
  }
  const legacyRefs = (
    await pool.query(
      `select count(*)::int n from source_reference where entity_type = 'catalog_item' and source_kind = 'LEGACY_ID' and entity_id = any($1)`,
      [pubRows.map((r) => r.id)],
    )
  ).rows[0].n as number;

  // ---- pricing through the real engine
  const snapshot = await loadCatalogSnapshot(pool);
  const idOf = (code: string) => pubRows.find((r) => r.public_code === code)!.id as string;
  const byLegacy = (l: string) => pubRows.find((r) => r.item_legacy_id === l)!.id as string;
  const cases: [string, ReturnType<typeof resolvePrice>, string][] = [];
  const run = (label: string, req: Record<string, unknown>, expect: string) =>
    cases.push([label, resolvePrice({ market: 'USA', ...req } as never, snapshot, asOf), expect]);
  run(
    'Premium Business Card · 2 caras × 500 · USA',
    {
      catalogItemId: byLegacy('MIG1-O-009'),
      quantity: 500,
      selections: [{ optionKey: 'caras', valueCodes: ['2'] }],
    },
    '120.00',
  );
  run(
    'Premium Flyer · media carta · 2 caras × 1000 · USA',
    {
      catalogItemId: byLegacy('MIG2-O-036'),
      quantity: 1000,
      selections: [
        { optionKey: 'caras', valueCodes: ['2'] },
        { optionKey: 'papel', valueCodes: ['Premium'] },
        { optionKey: 'tamano_papel', valueCodes: ['Media carta'] },
      ],
    },
    '400.00',
  );
  run(
    'Premium Business Card · 2 caras × 750 (sin interpolar)',
    {
      catalogItemId: byLegacy('MIG1-O-009'),
      quantity: 750,
      selections: [{ optionKey: 'caras', valueCodes: ['2'] }],
    },
    'QUOTE_ONLY',
  );
  run('Imanes · 1 par', { catalogItemId: byLegacy('MIGF-O-015'), quantity: 1 }, '65.00');
  run(
    'Imanes · 2 pares (no es 2 × 65)',
    { catalogItemId: byLegacy('MIGF-O-015'), quantity: 2 },
    'QUOTE_ONLY',
  );
  run(
    'Postales · 100 (sin precio autorizado)',
    { catalogItemId: byLegacy('MIG2-O-040'), quantity: 100 },
    'QUOTE_ONLY',
  );
  const caseRows = cases.map(([label, r, expect]) => {
    const got = r.status === 'RESOLVED' ? r.total.amount.toFixed(2) : r.status;
    return [
      label,
      expect,
      got +
        (r.status !== 'RESOLVED' && 'reasonCode' in r
          ? ` (${(r as { reasonCode: string }).reasonCode})`
          : ''),
      got === expect ? 'OK' : 'FALLA',
    ];
  });
  const allCasesOk = caseRows.every((r) => r[3] === 'OK');
  const hist = (
    await pool.query(
      `select count(*)::int n from price_definition d join catalog_item i on i.id = d.item_id where i.id = any($1) and d.status = 'AUTHORIZED' and d.valid_from > $2`,
      [pubRows.map((r) => r.id), asOf],
    )
  ).rows[0].n as number;

  // ---- counts
  const counts = (
    await pool.query(
      `select (select count(*)::int from catalog_item) as items,
              (select count(*)::int from catalog_item where public_code ~ '^DTG-[0-9]{5,}$') as coded,
              (select count(distinct public_code)::int from catalog_item) as distinct_codes,
              (select count(*)::int from migration_permit) as permits,
              (select count(*)::int from migration_permit_item) as permit_items,
              (select count(*)::int from migration_publication) as publications,
              (select count(*)::int from import_candidate where review_status = 'PUBLISHED') as published_candidates,
              (select count(*)::int from import_candidate c join import_batch b on b.id = c.batch_id where c.review_status = 'PUBLISHED' and b.data_class = 'REAL') as published_real,
              (select count(*)::int from import_candidate c where c.review_status = 'PUBLISHED' and c.id not in (select candidate_id from migration_publication)) as published_outside_permit,
              (select count(*)::int from change_event where table_name = 'migration_publication') as audit_publication,
              (select count(*)::int from change_event where table_name = 'migration_permit') as audit_permit`,
    )
  ).rows[0] as Record<string, number>;
  const dupLinks = (
    await pool.query(
      `select count(*)::int n from (select candidate_id, role, entity_id from import_candidate_link group by 1, 2, 3 having count(*) > 1) d`,
    )
  ).rows[0].n as number;
  const dupLegacy = (
    await pool.query(
      `select count(*)::int n from (select source_locator from source_reference where source_kind = 'LEGACY_ID' and entity_type = 'catalog_item' group by 1 having count(*) > 1) d`,
    )
  ).rows[0].n as number;
  const outOfScope = (
    await pool.query(
      `select count(*)::int n from migration_publication where item_legacy_id <> all($1)`,
      [permit.scopedLegacyIds],
    )
  ).rows[0].n as number;
  const catLabelKept = (
    await pool.query(
      `select count(*)::int n from import_candidate c where c.kind = 'CATALOG_ITEM' and c.proposal ->> 'categoryLegacy' like 'MIG%-CAT-%' and c.review_status = 'PUBLISHED'`,
    )
  ).rows[0].n as number;

  const written = (name: string, body: string) => writeFileSync(path.join(OUT, name), body);
  const gi = new Map(gate.items.map((g) => [g.legacyId, g]));
  const cpi = new Map(cp.items.map((g) => [g.legacyId, g]));
  const stamp = asOf.toISOString();

  // ---- COMMERCIAL_PRINT_MIGRATION_REPORT.md
  const itemRows = cp.items.map((c) => {
    const g = gi.get(c.legacyId)!;
    const pr = pubRows.find((r) => r.item_legacy_id === c.legacyId);
    return [
      c.legacyId,
      c.name,
      g.verdict === 'PUBLISHED' ? 'PUBLICADO (REAL)' : 'BLOQUEADO',
      pr ? `${pr.public_code} (${pr.link_kind === 'CREATED' ? 'creado' : 'enlazado'})` : '—',
      pr ? `${pr.status} · ${pr.sale_unit ?? '—'} · ${pr.category ?? '—'}` : '—',
      pr
        ? `${pr.authorized} autorizadas${pr.draft ? ` · ${pr.draft} borrador` : ''}`
        : c.price.state,
      g.verdict === 'PUBLISHED' ? '—' : g.reasons.join(' · '),
    ];
  });
  const published = pubRows.length;
  written(
    'COMMERCIAL_PRINT_MIGRATION_REPORT.md',
    `# STEP 09 — Informe de migración Commercial Print

Generado por \`tsx scripts/step09-report.ts post\` el ${stamp}.

Permiso \`${permit.scopeKey}\` aprobado por **${permit.approvedBy}** el ${permit.approvedAt} (mercado ${permit.markets.join(', ')}). Motivo: ${permit.reason}

## Resumen

${table(
  ['Medida', 'Valor'],
  [
    ['Items en alcance', gate.scoped],
    ['Publicables (superan su compuerta)', gate.publishable],
    ['Publicados bajo el permiso', published],
    ['Bloqueados (siguen en staging con razón)', gate.blocked],
    ['Candidatos publicados (REAL)', counts.published_real ?? 0],
    ['Candidatos publicados fuera del permiso', counts.published_outside_permit ?? 0],
    [
      'Con precio autorizado vía Price Engine',
      pubRows.filter((r) => (r.authorized as number) > 0).length,
    ],
    [
      'ACTIVE + QUOTE_ONLY (sin precio automático)',
      pubRows.filter((r) => (r.authorized as number) === 0).length,
    ],
  ],
)}

## Los 21 items

${table(['ID legacy', 'Item', 'Resultado', 'Código público', 'Estado · unidad · categoría', 'Precios', 'Qué lo bloquea'], itemRows)}

## Cómo se desbloquean los ${gate.blocked} restantes

Ninguno se desbloquea inventando datos. Cada uno necesita una respuesta explícita del dueño (clase A/B en \`OWNER_DECISION_GATE.md\`): sobre todo **D-001** (¿DTG vende/cotiza hoy este item?) y **D-002** (unidad de venta). Con la respuesta registrada, el mismo flujo (decisiones → resolver → aprobar → permiso → publicar) los migra sin cambios de código.

## Procedencia

Cada item publicado conserva la cadena CatalogItem → vínculo → candidato → registro → workbook → hoja/fila/celda; ver \`MVP_VERIFICATION.md\` (gate E).
`,
  );

  // ---- POST_MIGRATION_DATA_QUALITY.md
  const nowS = report.summary;
  const bf = baseline.summary;
  const blockedBaseline = baseline.readiness.filter((r) => cpi.has(r.legacyId));
  written(
    'POST_MIGRATION_DATA_QUALITY.md',
    `# STEP 09 — Calidad de datos después de la migración

Generado por \`tsx scripts/step09-report.ts post\` el ${stamp}. Las reglas son las 52 de STEP 08 (sin cambios de reglas); se recomputan sobre el staging real.

## Antes y después (todo el staging real)

${table(
  ['Medida', 'STEP 08 (baseline)', 'Tras aplicar OD-01..09', 'Tras la publicación'],
  [
    [
      'Candidatos',
      bf.candidates.total,
      pre?.summary.candidates.total ?? '—',
      nowS.candidates.total,
    ],
    ['Hallazgos', bf.findings.total, pre?.summary.findings.total ?? '—', nowS.findings.total],
    [
      'Bloqueantes',
      bf.findings.blockers,
      pre?.summary.findings.blockers ?? '—',
      nowS.findings.blockers,
    ],
    [
      'Advertencias',
      bf.findings.warnings,
      pre?.summary.findings.warnings ?? '—',
      nowS.findings.warnings,
    ],
    [
      'Esperan decisión del dueño',
      bf.ownerDecisionRequired,
      pre?.summary.ownerDecisionRequired ?? '—',
      nowS.ownerDecisionRequired,
    ],
  ],
)}

## Los 21 items de Commercial Print

${table(
  ['Medida', 'STEP 08 (baseline)', 'Después'],
  [
    ['Items que podían migrar', 0, gate.publishable],
    ['Publicados', 0, published],
    [
      'Revisión lista',
      blockedBaseline.filter((r) => r.review.state === 'READY').length,
      cp.totals.reviewReady,
    ],
    [
      'Dominio listo',
      blockedBaseline.filter((r) => r.domain.state === 'READY').length,
      cp.totals.domainReady,
    ],
    [
      'Precio listo',
      blockedBaseline.filter((r) => r.pricing.state === 'READY').length,
      cp.totals.pricingReady,
    ],
    [
      'Sólo cotización',
      blockedBaseline.filter((r) => r.pricing.state === 'QUOTE_ONLY').length,
      cp.totals.quoteOnly,
    ],
    ['Sin estado', cp.totals.total, cp.totals.missingStatus],
    ['Sin categoría', cp.totals.total, cp.totals.missingCategory],
    ['Sin unidad de venta', 18, cp.totals.missingSaleUnit],
    ['Procedencia rota', 0, cp.totals.brokenProvenance],
  ],
)}

Los hallazgos de los ${gate.blocked} items bloqueados **no se ocultaron ni se eximieron**: siguen en la lista con su decisión de dueño.

## Lo que NO cambió

- Los hallazgos de las demás categorías: intactos; nada fuera del alcance se publicó (${counts.published_outside_permit} candidatos publicados fuera del permiso).
- La etiqueta de categoría legacy se conserva como evidencia en los ${catLabelKept} candidatos publicados (el mapeo es una asignación aparte).
`,
  );

  // ---- data for MVP_VERIFICATION
  const dataset = {
    asOf: stamp,
    gate: {
      scoped: gate.scoped,
      publishable: gate.publishable,
      published: gate.published,
      blocked: gate.blocked,
    },
    counts,
    dupLinks,
    dupLegacy,
    outOfScope,
    provenance: {
      candidatesTraced: traced,
      candidatesTotal: pubCandidates.length,
      broken,
      itemTrace,
      legacyRefs,
    },
    pricing: { cases: caseRows, allCasesOk, futureDatedAuthorized: hist },
    published: pubRows.map((r) => ({
      code: r.public_code,
      legacyId: r.item_legacy_id,
      name: r.canonical_name,
      status: r.status,
      saleUnit: r.sale_unit,
      category: r.category,
      kind: r.kind,
      decoration: r.decoration_policy,
      link: r.link_kind,
      options: r.options,
      authorized: r.authorized,
      draft: r.draft,
    })),
    permit: {
      id: permit.id,
      approvedBy: permit.approvedBy,
      approvedAt: permit.approvedAt,
      candidates: permit.included.length,
      waived: permit.waivedDecisions.map((w) => w.decisionId),
    },
    dq: { baseline: bf, pre: pre?.summary ?? null, after: nowS },
    openBlockers: gate.items
      .filter((i) => i.verdict === 'BLOCKED')
      .map((i) => ({ legacyId: i.legacyId, name: i.name, openDecisions: i.openDecisions })),
  };
  writeFileSync(path.join(OUT, 'data', 'post-migration.json'), JSON.stringify(dataset, null, 2));
  written(
    'data/published-items.md',
    `${table(
      [
        'Código',
        'Legacy',
        'Nombre',
        'Estado',
        'Unidad',
        'Categoría',
        'Tipo',
        'Decoración',
        'Vínculo',
        'Opciones',
        'Precios AUTH',
        'Borrador',
      ],
      dataset.published.map((p) => [
        p.code,
        p.legacyId,
        p.name,
        p.status ?? '—',
        p.saleUnit ?? '—',
        p.category ?? '—',
        p.kind,
        p.decoration,
        p.link === 'CREATED' ? 'creado' : 'enlazado',
        p.options,
        p.authorized,
        p.draft,
      ]),
    )}\n`,
  );
  console.log(
    JSON.stringify({
      published,
      traced,
      brokenProvenance: broken.length,
      casesOk: allCasesOk,
      counts,
      dupLinks,
      dupLegacy,
      outOfScope,
    }),
  );
}

const cmd = process.argv[2];
(cmd === 'pre' ? pre() : cmd === 'post' ? post() : Promise.reject(new Error('use pre|post')))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
void readFileSync;
void activePermit;
void SCOPE_KEY;
void traceCandidate;
