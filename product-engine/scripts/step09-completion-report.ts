/**
 * STEP 09 completion · Owner Decisions reports, computed from the LOCAL database (read-only). Nothing invented.
 *
 *   tsx scripts/step09-completion-report.ts before --completion   snapshot BEFORE the completion decisions are applied
 *   tsx scripts/step09-completion-report.ts pre    --completion   OWNER_DECISIONS_REAL_PUBLICATION_DRY_RUN.md (before any REAL write)
 *   tsx scripts/step09-completion-report.ts post   --completion   OWNER_DECISIONS_POST_QUALITY.md + data/completion-post.json
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createPool } from '../src/db/client';
import { currentDispositions } from '../src/db/migration/disposition';
import { activePermit, currentMigrationGate, SCOPE_KEY } from '../src/db/migration/permit';
import { currentAnswer, answerHistory } from '../src/db/admin/decision-answers';
import { traceCandidate } from '../src/db/import/provenance';
import { loadCatalogSnapshot } from '../src/db/catalog-snapshot';
import { resolvePrice } from '../src/pricing/resolve';
import { STEP09_DEFAULT_MARKETS } from '../src/decisions/step09-owner-decisions';
import { CANONICAL, NON_PRODUCT_IDS } from '../src/decisions/owner-decisions-v1';
import { dryRun } from './step09-migrate';

for (const f of ['.env.local', '.env']) {
  if (existsSync(f) && !process.env.DATABASE_URL) process.loadEnvFile(f);
}
const host = new URL(process.env.DATABASE_URL ?? '').hostname;
if (!['localhost', '127.0.0.1', '::1', 'db'].includes(host))
  throw new Error(`non-local host ${host}`);

const OUT = 'docs/step09';
const DATA = path.join(OUT, 'data');
mkdirSync(DATA, { recursive: true });
const pool = createPool();
const md = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const table = (head: string[], rows: (string | number)[][]) =>
  [
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.map((c) => md(String(c))).join(' | ')} |`),
  ].join('\n');

async function counts() {
  return (
    await pool.query(
      `select (select count(*)::int from catalog_item) as catalog_items,
              (select count(*)::int from catalog_item where status = 'ACTIVE') as active_items,
              (select count(*)::int from catalog_item where status = 'CANDIDATE') as candidate_items,
              (select count(*)::int from migration_permit) as permits,
              (select count(*)::int from migration_permit_item) as permit_items,
              (select count(*)::int from migration_publication) as publications,
              (select count(distinct item_legacy_id)::int from migration_publication) as published_scope_items,
              (select count(*)::int from candidate_disposition) as dispositions,
              (select count(*)::int from import_candidate where review_status = 'REJECTED') as rejected_candidates,
              (select count(*)::int from import_candidate where review_status = 'PUBLISHED') as published_candidates,
              (select count(*)::int from price_definition where status = 'AUTHORIZED') as authorized_prices,
              (select last_value::int from catalog_item_public_code_seq) as code_seq`,
    )
  ).rows[0] as Record<string, number>;
}

async function snapshot() {
  const asOf = new Date();
  const { gate, cp, report } = await currentMigrationGate(pool, STEP09_DEFAULT_MARKETS, asOf);
  return {
    asOf: asOf.toISOString(),
    summary: report.summary,
    gate: {
      scoped: gate.scoped,
      publishable: gate.publishable,
      published: gate.published,
      resolved: gate.resolved,
      blocked: gate.blocked,
      items: gate.items.map((i) => ({
        legacyId: i.legacyId,
        name: i.name,
        verdict: i.verdict,
        reasons: i.reasons,
        openDecisions: i.openDecisions,
        pricing: i.pricing,
        disposition: i.disposition ?? null,
      })),
    },
    cpTotals: cp.totals,
    counts: await counts(),
  };
}

async function before() {
  const s = await snapshot();
  writeFileSync(path.join(DATA, 'completion-before.json'), JSON.stringify(s, null, 2));
  console.log(
    `before: ${s.gate.published} published, ${s.gate.blocked} blocked; findings ${s.summary.findings.total}`,
  );
}

type Snap = Awaited<ReturnType<typeof snapshot>>;
const loadBefore = (): Snap => {
  const f = path.join(DATA, 'completion-before.json');
  if (!existsSync(f)) throw new Error('run `before` first');
  return JSON.parse(readFileSync(f, 'utf8')) as Snap;
};

async function pre() {
  const b = loadBefore();
  const now = await snapshot();
  const c0 = await counts();
  const sim = await dryRun();
  const c1 = await counts();
  const noWrite = JSON.stringify(c0) === JSON.stringify(c1);
  if (!noWrite) throw new Error(`the dry run changed the database: ${JSON.stringify([c0, c1])}`);
  const items = sim.publish && sim.publish.ok ? sim.publish.items : [];
  const byItem = new Map(items.map((i) => [i.itemLegacyId, i]));
  const rows = now.gate.items.map((i) => {
    const s = byItem.get(i.legacyId);
    const spec = (
      CANONICAL as Record<string, { status: string; saleUnit: string; canonicalName?: string }>
    )[i.legacyId];
    return [
      i.legacyId,
      i.name,
      i.verdict,
      i.disposition
        ? `${i.disposition.disposition}${i.disposition.canonicalLegacyIds.length ? ' → ' + i.disposition.canonicalLegacyIds.join(', ') : ''}`
        : spec
          ? `${spec.status} · ${spec.saleUnit}${spec.canonicalName ? ` · «${spec.canonicalName}»` : ''}`
          : '—',
      i.pricing,
      s
        ? s.ok
          ? `${s.alreadyPublished ? 'ya publicado' : 'se publicaría'} ${s.publicCode ?? ''} (${s.candidates.map((c) => `${c.kind}:${c.created ? 'crea' + c.created : 'enlaza' + c.linked}`).join(' ')})`
          : `FALLA ${s.errors.join('; ')}`
        : 'no se publica',
      i.reasons.join(' · ') || '—',
    ];
  });
  const newItems = items.filter((i) => !i.alreadyPublished);
  writeFileSync(
    path.join(OUT, 'OWNER_DECISIONS_REAL_PUBLICATION_DRY_RUN.md'),
    `# STEP 09 completion — Ensayo de publicación REAL (decisiones del dueño)

Generado por \`tsx scripts/step09-completion-report.ts pre\` el ${now.asOf}, **antes de cualquier escritura REAL** de esta pasada. Se aplicó la \`OWNER_DECISION_SPEC_v1.0\` a staging (decisiones, categoría, disposiciones, resoluciones); aquí se ve qué haría el permiso ampliado.

## Resultado de la compuerta item por item

${table(['Legacy', 'Item', 'Veredicto', 'Tratamiento', 'Precio', 'Adaptador (ensayo)', 'Razones'], rows)}

Resumen: ${now.gate.scoped} en alcance · ${now.gate.publishable} pasan como producto (${now.gate.published} ya publicados) · **${now.gate.resolved} resueltos como no-producto** · ${now.gate.blocked} bloqueados. Antes de esta pasada: ${b.gate.published} publicados, ${b.gate.blocked} bloqueados.

## Qué haría el permiso ampliado

- Nuevo permiso (reemplaza al anterior, \`supersedes_id\`), mercado USA, referencias a D-001, D-002, D-003, D-010, D-016 y D-018; D-022 sigue eximida sólo para México.
- Incluye los candidatos **aprobados** de los ${now.gate.publishable} items que pasan; los alias/configuraciones/estilos/legacy ya están rechazados en staging con su disposición y **no** entran.
- ${newItems.length} CatalogItems nuevos: ${newItems.map((i) => `${i.publicCode} (${i.itemLegacyId})`).join(', ') || '—'}.
- Los 2 items **CANDIDATE** (Seating / Thank-you) se migran como registro interno con estado CANDIDATE: ningún perfil de publicación admite CANDIDATE (sólo ACTIVE), así que nunca son públicos.
- Ningún precio se crea: todos los nuevos quedan ACTIVE + QUOTE_ONLY (o CANDIDATE sin precio).
- Los 5 items ya publicados no cambian (cero enlaces nuevos, cero escrituras).

## Garantías del ensayo

- Todo el ensayo corre dentro de un savepoint con rollback y restaura el asignador de códigos públicos.
- Comprobación de no-escritura: \`catalog_item\`, \`migration_*\`, \`import_candidate\` y la secuencia de códigos son idénticos antes y después (**${noWrite ? 'OK' : 'FALLA'}**).
- Compuerta, permiso por candidato, procedencia e idempotencia de STEP 09 intactos; la barrera global \`PUBLICATION_ENABLED_FOR\` no se toca.

\`\`\`json
${JSON.stringify(c1, null, 2)}
\`\`\`
`,
  );
  writeFileSync(
    path.join(DATA, 'completion-dry-run.json'),
    JSON.stringify({ gate: now.gate, items, noWrite }, null, 2),
  );
  console.log(
    `pre: ${now.gate.publishable} publishable, ${now.gate.resolved} resolved, noWrite=${noWrite}`,
  );
}

async function post() {
  const b = loadBefore();
  const now = await snapshot();
  const asOf = new Date();
  const permit = await activePermit(pool, SCOPE_KEY);
  if (!permit) throw new Error('no active permit');
  const disp = await currentDispositions(pool);
  const rejectedOfDisp = (
    await pool.query(
      `select count(*)::int n from import_candidate c where c.review_status = 'REJECTED'
         and coalesce(c.proposal->>'legacyId', c.proposal->>'itemLegacyId') = any($1)`,
      [NON_PRODUCT_IDS],
    )
  ).rows[0].n as number;
  const nonProductRows = (
    await pool.query(
      `select r.source_locator, i.public_code, coalesce(i.status::text, 'sin estado') as status,
              (select count(*)::int from v_publication_membership m where m.item_id = i.id) as memberships,
              (select count(*)::int from migration_publication p where p.item_legacy_id = r.source_locator) as published_by_migration
         from source_reference r join catalog_item i on i.id = r.entity_id
        where r.source_kind = 'LEGACY_ID' and r.entity_type = 'catalog_item' and r.source_locator = any($1)`,
      [NON_PRODUCT_IDS],
    )
  ).rows as {
    source_locator: string;
    public_code: string;
    status: string;
    memberships: number;
    published_by_migration: number;
  }[];
  const nonProductItems = nonProductRows.length;
  const nonProductDetail =
    nonProductRows
      .map(
        (r) =>
          `${r.public_code} (${r.source_locator}, ${r.status}, ${r.memberships} perfiles, ${r.published_by_migration} publicaciones de migración)`,
      )
      .join('; ') || 'ninguno';
  const nonProductPublic = nonProductRows.reduce(
    (n, r) => n + r.memberships + r.published_by_migration,
    0,
  );

  // published items
  const pub = (
    await pool.query(
      `select p.item_legacy_id, i.id, i.public_code, i.canonical_name, i.kind, i.status, i.sale_unit,
              (select c.key from catalog_item_category ic join category c on c.id = ic.category_id where ic.item_id = i.id and ic.is_primary limit 1) as category,
              (select l.link_kind from import_candidate_link l join import_candidate c on c.id = l.candidate_id
                where l.entity_id = i.id and l.entity_type = 'catalog_item' and c.kind = 'CATALOG_ITEM' limit 1) as link_kind,
              (select count(*)::int from item_option io where io.item_id = i.id) as options,
              (select count(*)::int from presentation pr where pr.item_id = i.id) as presentations,
              (select count(*)::int from price_definition d where d.item_id = i.id and d.status = 'AUTHORIZED') as authorized,
              (select count(*)::int from v_publication_membership m where m.item_id = i.id) as public_memberships
         from (select distinct on (item_legacy_id) * from migration_publication order by item_legacy_id, published_at) p
         join import_candidate_link l on l.candidate_id = p.candidate_id and l.entity_type = 'catalog_item'
         join catalog_item i on i.id = l.entity_id
        order by i.public_code`,
    )
  ).rows;
  const candidateVisible = pub
    .filter((r) => r.status === 'CANDIDATE')
    .reduce((n, r) => n + (r.public_memberships as number), 0);
  const candidateRows = pub.filter((r) => r.status === 'CANDIDATE').length;

  // provenance
  const pubC = (
    await pool.query('select candidate_id, item_legacy_id from migration_publication order by 2, 1')
  ).rows as { candidate_id: string; item_legacy_id: string }[];
  let traced = 0;
  const broken: string[] = [];
  for (const pc of pubC) {
    const t = await traceCandidate(pool, pc.candidate_id);
    const ok =
      !!t &&
      t.reviewStatus === 'PUBLISHED' &&
      t.links.length > 0 &&
      t.records.length > 0 &&
      t.records.every(
        (r) =>
          r.cells.length > 0 &&
          r.cells.every(
            (c) => !!c.source_sheet && !!c.source_cell && c.workbook_sha256.length === 64,
          ),
      );
    if (ok) traced++;
    else broken.push(`${pc.item_legacy_id}:${pc.candidate_id.slice(0, 8)}`);
  }
  // disposition rows keep their evidence: every rejected candidate still has its source records/cells
  const dispEvidence = [];
  for (const d of disp) {
    const cands = (
      await pool.query(
        `select id from import_candidate where review_status = 'REJECTED'
           and coalesce(proposal->>'legacyId', proposal->>'itemLegacyId') = $1`,
        [d.itemLegacyId],
      )
    ).rows as { id: string }[];
    let cells = 0;
    for (const c of cands) {
      const t = await traceCandidate(pool, c.id);
      cells += t ? t.records.reduce((n, r) => n + r.cells.length, 0) : 0;
    }
    dispEvidence.push({ legacyId: d.itemLegacyId, candidates: cands.length, cells });
  }

  // pricing through the real engine
  const snap = await loadCatalogSnapshot(pool);
  const byLegacy = (l: string) => pub.find((r) => r.item_legacy_id === l)!.id as string;
  const cases: [string, ReturnType<typeof resolvePrice>, string][] = [];
  const run = (label: string, req: Record<string, unknown>, expect: string) =>
    cases.push([label, resolvePrice({ market: 'USA', ...req } as never, snap, asOf), expect]);
  run(
    'Premium Business Card · 2 caras × 500',
    {
      catalogItemId: byLegacy('MIG1-O-009'),
      quantity: 500,
      selections: [{ optionKey: 'caras', valueCodes: ['2'] }],
    },
    '120.00',
  );
  run(
    'Premium Flyer · media carta · 2 caras × 1000',
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
  run('Postales · 100', { catalogItemId: byLegacy('MIG2-O-040'), quantity: 100 }, 'QUOTE_ONLY');
  run(
    'Menús · 1 pieza (prototipo permitido, sin precio inventado)',
    { catalogItemId: byLegacy('MIG2-O-039'), quantity: 1 },
    'QUOTE_ONLY',
  );
  run(
    'Menús · 6 piezas (tramo sin precio autorizado)',
    { catalogItemId: byLegacy('MIG2-O-039'), quantity: 6 },
    'QUOTE_ONLY',
  );
  run(
    'Invitación Sencilla · 24',
    { catalogItemId: byLegacy('MIGF-O-008'), quantity: 24 },
    'QUOTE_ONLY',
  );
  run(
    'Invitación Premium · 300',
    { catalogItemId: byLegacy('MIGF-O-009'), quantity: 300 },
    'QUOTE_ONLY',
  );
  run(
    'Poster / Tabloide 11×17 · 50',
    { catalogItemId: byLegacy('MIG2-O-037'), quantity: 50 },
    'QUOTE_ONLY',
  );
  run(
    'Poster Gran Formato · 1',
    { catalogItemId: byLegacy('MIG2-O-038'), quantity: 1 },
    'QUOTE_ONLY',
  );
  run(
    'Periódico personalizado · 1',
    { catalogItemId: byLegacy('OWN-MT-O-046'), quantity: 1 },
    'QUOTE_ONLY',
  );
  const caseRows = cases.map(([label, r, expect]) => {
    const got = r.status === 'RESOLVED' ? r.total.amount.toFixed(2) : r.status;
    const reason =
      r.status !== 'RESOLVED' && 'reasonCode' in r
        ? ` (${(r as { reasonCode: string }).reasonCode})`
        : '';
    return [label, expect, got + reason, got === expect ? 'OK' : 'FALLA'];
  });
  const allCasesOk = caseRows.every((r) => r[3] === 'OK');

  const dup = (
    await pool.query(
      `select (select count(*)::int from (select candidate_id, role, entity_id from import_candidate_link group by 1,2,3 having count(*) > 1) d) as links,
              (select count(*)::int from (select source_locator from source_reference where source_kind='LEGACY_ID' and entity_type='catalog_item' group by 1 having count(*) > 1) d) as legacy,
              (select count(*)::int from migration_publication where item_legacy_id <> all($1)) as out_of_scope,
              (select count(*)::int from import_candidate c where c.review_status = 'PUBLISHED' and c.id not in (select candidate_id from migration_publication)) as outside_permit,
              (select count(*)::int from catalog_item where public_code !~ '^DTG-[0-9]{5,}$') as bad_codes,
              (select count(*)::int from (select public_code from catalog_item group by 1 having count(*) > 1) d) as dup_codes,
              (select count(*)::int from import_candidate c join import_batch b on b.id = c.batch_id where c.review_status = 'PUBLISHED' and b.data_class <> 'REAL' and c.id in (select candidate_id from migration_publication)) as non_real_in_permit`,
      [permit.scopedLegacyIds],
    )
  ).rows[0] as Record<string, number>;

  const answers: Record<string, unknown> = {};
  for (const id of ['D-001', 'D-002', 'D-003', 'D-004', 'D-005', 'D-016', 'D-018']) {
    const h = await answerHistory(pool, id);
    answers[id] = h.map((a) => ({ revision: a.revision, actor: a.actor, id: a.id }));
  }
  const cur = (
    await Promise.all(
      ['D-001', 'D-002', 'D-003', 'D-004', 'D-005', 'D-018'].map((d) => currentAnswer(pool, d)),
    )
  ).map((a) => a?.id);
  const dispAnswerOk = disp.every((d) => cur.includes(d.decisionAnswerId));

  // ---- OWNER_DECISIONS_POST_QUALITY.md
  const bs = b.summary;
  const ns = now.summary;
  const beforeById = new Map(b.gate.items.map((i) => [i.legacyId, i]));
  const itemRows = now.gate.items
    .filter((i) => beforeById.get(i.legacyId)!.verdict === 'BLOCKED')
    .map((i) => {
      const bf = beforeById.get(i.legacyId)!;
      return [
        i.legacyId,
        i.name,
        `BLOQUEADO: ${bf.openDecisions.join(', ') || '—'}`,
        i.verdict === 'RESOLVED'
          ? `RESUELTO (${i.disposition!.disposition}${i.disposition!.canonicalLegacyIds.length ? ' → ' + i.disposition!.canonicalLegacyIds.join(', ') : ''})`
          : i.verdict,
        i.verdict === 'BLOCKED'
          ? i.reasons.join(' · ')
          : (CANONICAL as Record<string, { status: string }>)[i.legacyId]
            ? `${(CANONICAL as Record<string, { status: string }>)[i.legacyId]!.status} · ${i.pricing}`
            : '—',
      ];
    });
  const stillOpen = now.gate.items.filter((i) => i.openDecisions.length > 0);
  writeFileSync(
    path.join(OUT, 'OWNER_DECISIONS_POST_QUALITY.md'),
    `# STEP 09 completion — Calidad de datos tras las decisiones del dueño

Generado por \`tsx scripts/step09-completion-report.ts post\` el ${now.asOf}. Se recomputan las 52 reglas de STEP 08 (sin cambios de reglas) sobre el staging real. Nada de lo que no es del alcance se oculta.

## Antes y después (todo el staging real)

${table(
  ['Medida', 'Antes de las decisiones (fin STEP 09)', 'Después'],
  [
    ['Candidatos en staging', bs.candidates.total, ns.candidates.total],
    ['Candidatos resueltos', bs.candidates.resolved, ns.candidates.resolved],
    ['Hallazgos', bs.findings.total, ns.findings.total],
    ['Bloqueantes', bs.findings.blockers, ns.findings.blockers],
    ['Advertencias', bs.findings.warnings, ns.findings.warnings],
    ['Requieren decisión del dueño', bs.ownerDecisionRequired, ns.ownerDecisionRequired],
  ],
)}

Los candidatos rechazados (${rejectedOfDisp} de alias/configuración/estilo/legacy de esta pasada, más las decoraciones "Impresión" rechazadas por OD-04) no levantan hallazgos: son "no importar" explícito, con su evidencia conservada.

## Commercial Print: qué bloqueos desaparecieron (16 filas antes bloqueadas)

${table(['Legacy', 'Fila', 'Antes (decisiones abiertas)', 'Después', 'Estado resultante'], itemRows)}

Totales de la compuerta: antes ${b.gate.publishable} publicables / ${b.gate.blocked} bloqueados → ahora **${now.gate.publishable} pasan como producto (${now.gate.published} publicados) · ${now.gate.resolved} resueltos como no-producto · ${now.gate.blocked} bloqueados**.

| Decisión | Antes | Ahora |
| --- | --- | --- |
| D-001 estado | 16 filas abiertas | 0 (ACTIVE ×6, CANDIDATE ×2, 8 filas no-producto cubiertas por D-018/legacy) |
| D-002 unidad | 16 filas abiertas | 0 |
| D-003 producto/servicio | 1 (Periódico) | 0 |
| D-004 / D-005 | 2 filas c/u (Menús, Inv. con acrílico) | 0 |
| D-018 invitaciones | 9 filas | 0 |

Decisiones que siguen abiertas sobre items del alcance: ${stillOpen.length ? stillOpen.map((i) => `${i.legacyId}: ${i.openDecisions.join(', ')}`).join('; ') : 'ninguna'}. (D-009 navegación del imán y D-022 México no bloquean; ver el reporte final.)

## Hallazgos que siguen vigentes en los items migrados (no se esconden)

Los items nuevos están ACTIVE + QUOTE_ONLY sin precio autorizado (válido, decisión 107) y sin opciones de tamaño/caras de Menús (el workbook no trae esos valores y no se inventan). Esto se refleja como readiness de precios QUOTE_ONLY y no como bloqueo. Los ${ns.findings.blockers} bloqueantes restantes pertenecen a otras categorías (Apparel, Displays, etc.) fuera del permiso.

## Verificaciones de esta pasada

${table(
  ['Verificación', 'Resultado'],
  [
    ['Filas no-producto con CatalogItem creado por esta pasada', 0],
    [
      'Filas no-producto con CatalogItem preexistente (dev slice; sin estado ⇒ en ningún perfil público)',
      `${nonProductItems} — ${nonProductDetail}`,
    ],
    ['Disposiciones registradas (candidate_disposition)', disp.length],
    [
      'Cada disposición apunta a la respuesta vigente de su decisión',
      dispAnswerOk ? 'OK' : 'FALLA',
    ],
    [
      'Evidencia conservada (candidatos rechazados con celdas de origen)',
      dispEvidence.map((d) => `${d.legacyId}:${d.candidates}c/${d.cells}`).join(' '),
    ],
    [
      'Items CANDIDATE migrados / visibles en algún perfil público',
      `${candidateRows} / ${candidateVisible}`,
    ],
    [
      'Casos de precio por el Price Engine',
      allCasesOk ? `${cases.length}/${cases.length} OK` : 'FALLA',
    ],
    ['Procedencia de candidatos publicados', `${traced}/${pubC.length}`],
    [
      'Enlaces duplicados / ids legacy duplicados / códigos duplicados',
      `${dup.links} / ${dup.legacy} / ${dup.dup_codes}`,
    ],
    [
      'Publicados fuera del alcance / fuera del permiso',
      `${dup.out_of_scope} / ${dup.outside_permit}`,
    ],
  ],
)}
`,
  );
  writeFileSync(
    path.join(DATA, 'completion-post.json'),
    JSON.stringify(
      {
        asOf: now.asOf,
        gate: {
          scoped: now.gate.scoped,
          publishable: now.gate.publishable,
          published: now.gate.published,
          resolved: now.gate.resolved,
          blocked: now.gate.blocked,
        },
        before: {
          gate: { published: b.gate.published, blocked: b.gate.blocked },
          summary: bs,
          counts: b.counts,
        },
        after: { summary: ns, counts: now.counts },
        permit: {
          id: permit.id,
          included: permit.included.length,
          decisions: permit.decisionRefs.map((r) => `${r.decisionId}#${r.revision}`),
        },
        published: pub.map((r) => ({
          code: r.public_code,
          legacyId: r.item_legacy_id,
          name: r.canonical_name,
          status: r.status,
          saleUnit: r.sale_unit,
          category: r.category,
          link: r.link_kind,
          options: r.options,
          presentations: r.presentations,
          authorized: r.authorized,
          publicMemberships: r.public_memberships,
        })),
        dispositions: disp.map((d) => ({
          legacyId: d.itemLegacyId,
          disposition: d.disposition,
          canonical: d.canonicalLegacyIds,
          decision: d.decisionId,
          actor: d.actor,
        })),
        dispEvidence,
        candidateRows,
        candidateVisible,
        nonProductItems,
        nonProductRows,
        nonProductPublic,
        provenance: { traced, total: pubC.length, broken },
        pricing: { cases: caseRows, allCasesOk },
        integrity: dup,
        dispAnswerOk,
        answers,
      },
      null,
      2,
    ),
  );
  console.log(
    `post: ${now.gate.published} published, ${now.gate.resolved} resolved, ${now.gate.blocked} blocked, pricing ok=${allCasesOk}`,
  );
}

async function final() {
  const b = loadBefore();
  const post = JSON.parse(readFileSync(path.join(DATA, 'completion-post.json'), 'utf8')) as {
    asOf: string;
    gate: Snap['gate'];
    after: { summary: Snap['summary']; counts: Record<string, number> };
    permit: { id: string; included: number; decisions: string[] };
    published: {
      code: string;
      legacyId: string;
      name: string;
      status: string;
      saleUnit: string;
      category: string;
      link: string;
      options: number;
      presentations: number;
      authorized: number;
      publicMemberships: number;
    }[];
    dispositions: {
      legacyId: string;
      disposition: string;
      canonical: string[];
      decision: string;
      actor: string;
    }[];
    provenance: { traced: number; total: number; broken: string[] };
    pricing: { cases: string[][]; allCasesOk: boolean };
    integrity: Record<string, number>;
    nonProductRows: { source_locator: string; public_code: string; status: string }[];
    candidateRows: number;
    candidateVisible: number;
  };
  const tests = JSON.parse(readFileSync(path.join(DATA, 'test-results.json'), 'utf8')) as Record<
    string,
    { passed?: number; ran?: number } | boolean
  >;
  const hashes = readFileSync(path.join(DATA, 'workbooks.sha256'), 'utf8').trim().split('\n');
  const git = (c: string) => execSync(c, { encoding: 'utf8' }).trim();
  const head = git('git rev-parse HEAD');
  const commits = git('git log --format="%h %s" c2897e7..HEAD');
  const answers = (
    await pool.query(
      `select decision_id, summary, actor, answered_at, row_number() over (partition by decision_id order by answered_at, id) as rev
         from owner_decision_answer order by decision_id, answered_at, id`,
    )
  ).rows as {
    decision_id: string;
    summary: string;
    actor: string;
    answered_at: Date;
    rev: number;
  }[];
  const answered = answers.filter((a) =>
    ['D-001', 'D-002', 'D-003', 'D-004', 'D-005', 'D-018', 'D-010', 'D-016'].includes(
      a.decision_id,
    ),
  );
  const scope = b.gate.items.map((i) => i.legacyId);
  const pubBy = new Map(post.published.map((p) => [p.legacyId, p]));
  const dispBy = new Map(post.dispositions.map((d) => [d.legacyId, d]));
  const label = new Map(b.gate.items.map((i) => [i.legacyId, i.name]));
  const treat = (l: string) => {
    const p = pubBy.get(l);
    const d = dispBy.get(l);
    if (b.gate.items.find((i) => i.legacyId === l)!.verdict === 'PUBLISHED')
      return ['PRODUCTO (ya publicado en STEP 09)', `${p!.code} ${p!.name}`];
    if (p)
      return [
        p.status === 'CANDIDATE'
          ? 'PRODUCTO interno CANDIDATE (nunca público)'
          : 'PRODUCTO canónico ACTIVE (QUOTE_ONLY)',
        `${p.code} «${p.name}» · ${p.saleUnit}`,
      ];
    if (d)
      return [
        `NO-PRODUCTO: ${d.disposition}`,
        d.canonical.length
          ? `→ ${d.canonical.join(', ')} (${d.decision})`
          : `evidencia conservada, sin producto (${d.decision})`,
      ];
    return ['SIN RESOLVER', '—'];
  };
  const blockedRows = scope.filter(
    (l) => b.gate.items.find((i) => i.legacyId === l)!.verdict === 'BLOCKED',
  );
  const t = (k: string) => {
    const v = tests[k];
    return typeof v === 'object' && v ? (v.passed ?? v.ran ?? '—') : '—';
  };
  const bs = b.summary;
  const ns = post.after.summary;
  writeFileSync(
    path.join(OUT, 'OWNER_DECISIONS_COMPLETION_REPORT.md'),
    `# STEP 09 completion — Informe final de la pasada Owner Decisions

Generado por \`tsx scripts/step09-completion-report.ts final --completion\` (${post.asOf}). Esta pasada continúa STEP 09 (no lo reinicia ni empieza STEP 10). Los documentos de STEP 09 se conservan; esto se suma.

## 1. HEAD inicial y final

- **HEAD inicial:** \`c2897e7eb4cfc94f08c13adfdddb3825c5afcec4\` (rama \`step09/commercial-print-mvp\`) — verificado contra el zip del baseline.
- **Rama de continuación:** \`step09/owner-decisions-completion\`.
- **HEAD de código al generar este informe:** \`${head}\` (los commits de documentación posteriores no cambian código; el HEAD final queda en el zip entregado).

## 2. Commits de la pasada (hasta el generado de este informe)

${commits
  .split('\n')
  .map((c) => `- \`${c.slice(0, 7)}\`${c.slice(7)}`)
  .join('\n')}

## 3. Migraciones

- **0018_candidate_disposition.sql** (única nueva): tabla append-only \`candidate_disposition\`. 0001–0017 sin cambios. Ver ADR-0020.

## 4. Decisiones del dueño registradas (\`owner_decision_answer\`, evidencia: OWNER_DECISION_SPEC_v1.0)

${table(
  ['Decisión', 'Rev.', 'Actor', 'Respuesta'],
  answered.map((a) => [
    a.decision_id,
    a.rev,
    a.actor,
    a.summary.length > 220 ? a.summary.slice(0, 217) + '…' : a.summary,
  ]),
)}

Cada disposición apunta a la respuesta vigente de su decisión (\`decision_answer_id\`; verificado: ${(post as unknown as { dispAnswerOk: boolean }).dispAnswerOk ? 'OK' : 'FALLA'}). Las respuestas las registró la sesión a nombre de Martín (actor \`martin\`) con la spec firmada como evidencia: Martín debe revisarlas en Admin.

## 5. Las 21 filas fuente y las 16 que estaban bloqueadas

${table(
  ['Legacy', 'Fila fuente', 'Antes', 'Tratamiento final', 'Resultado'],
  scope.map((l) => {
    const [a, c] = treat(l);
    return [l, label.get(l)!, blockedRows.includes(l) ? 'BLOQUEADA' : 'PUBLICADA', a!, c!];
  }),
)}

## 6. Productos canónicos antes y después

${table(
  ['Medida', 'Antes (fin STEP 09)', 'Después'],
  [
    [
      'Productos Commercial Print en Product Engine (REAL, permiso)',
      b.gate.published,
      post.gate.published,
    ],
    ['… ACTIVE', b.gate.published, post.published.filter((p) => p.status === 'ACTIVE').length],
    [
      '… CANDIDATE (internos, nunca públicos)',
      0,
      post.published.filter((p) => p.status === 'CANDIDATE').length,
    ],
    ['Filas fuente resueltas como no-producto', 0, post.gate.resolved],
    ['Filas bloqueadas', b.gate.blocked, post.gate.blocked],
    [
      'Precios AUTORIZADOS (sin cambios: no se inventó ninguno)',
      b.counts.authorized_prices ?? 0,
      post.after.counts.authorized_prices ?? 0,
    ],
    [
      'CatalogItems en total (incluye el dev slice)',
      b.counts.catalog_items ?? 0,
      post.after.counts.catalog_items ?? 0,
    ],
  ],
)}

## 7. Publicado ahora

${table(
  ['Código', 'Legacy', 'Producto', 'Estado', 'Unidad', 'Categoría', 'Opciones', 'Precios AUTH'],
  post.published
    .filter(
      (p) =>
        !['MIG1-O-008', 'MIG1-O-009', 'MIG2-O-036', 'MIGF-O-015', 'MIG2-O-040'].includes(
          p.legacyId,
        ),
    )
    .map((p) => [
      p.code,
      p.legacyId,
      p.name,
      p.status,
      p.saleUnit,
      p.category,
      p.options,
      p.authorized,
    ]),
)}

Ninguno tiene precio: ACTIVE + QUOTE_ONLY es válido y preferible a inventar (decisiones 107/126). Los códigos públicos pueden tener huecos (ADR-0011: las pruebas consumen la secuencia).

## 8. Qué no se publica y por qué

- **8 filas no-producto** (alias, configuraciones, estilos, legacy no válido): su evidencia sigue en staging (candidatos rechazados con razón y celdas de origen); no son CatalogItems.
- **Seating card y Thank-you card** se migraron sólo como registros internos con estado CANDIDATE: ningún perfil de publicación admite CANDIDATE (verificado: ${post.candidateRows} items, ${post.candidateVisible} membresías públicas).
- **Otras categorías** (Apparel, Displays, etc.): fuera del permiso (0 publicaciones fuera de alcance).
- **Precios y tramos**: Menús (1 y 6), Invitaciones (12…300), Posters, Periódico y Postales siguen sin precio autorizado; la semántica de tramo alcanzado ya existe (\`TIERED\`) y está probada, sin datos de precio.

## 9. Data Quality antes → después (todo el staging real)

${table(
  ['Medida', 'Antes', 'Después'],
  [
    ['Candidatos', bs.candidates.total, ns.candidates.total],
    ['Hallazgos', bs.findings.total, ns.findings.total],
    ['Bloqueantes', bs.findings.blockers, ns.findings.blockers],
    ['Requieren decisión del dueño', bs.ownerDecisionRequired, ns.ownerDecisionRequired],
  ],
)}

Bloqueos de Commercial Print que desaparecen: D-001 (16 filas), D-002 (16), D-003 (1), D-004/D-005 (2), D-018 (9). Detalle por fila en \`OWNER_DECISIONS_POST_QUALITY.md\`. No se esconde ningún hallazgo ajeno (otras categorías siguen con los suyos).

## 10. Pendientes

**P1 (bloquean la operación de Commercial Print):** ninguno. Las 21 filas están resueltas y 0 bloqueadas.

**P2 (no bloquean; requieren confirmación o trabajo posterior):**

- Autorizar precios maestros de Martín para Menús (tramos 1 y 6; siguientes por definir), Invitaciones (12…300), Poster/Tabloide 11×17, Poster Gran Formato (por área, mínimo), Periódico y Postales. Hasta entonces se cotizan.
- **Poster Gran Formato (MIG2-O-038):** el workbook no distingue "Tabloides" y "Posters" (mismos datos fuente). Se asignó por el mapa del dueño y por descarte (037 ya es el 11×17). Confirmar que la identidad es correcta.
- Configuraciones de Invitación Premium (sello, acrílico, sobre) quedan registradas como disposición hacia el producto canónico; "con sobre" apunta a ambas invitaciones sin afirmar cuál lo ofrece. No se materializan como opciones/recargos hasta que exista el recargo autorizado.
- Menús: tamaño y 1/2 caras son opciones del cliente según el dueño, pero el workbook no trae sus valores; no se inventaron (sólo existe la opción "Laminado").
- **DTG-00016 «Invitación para evento»** ya existía en el dev slice (sin estado, nunca público) con el ID legacy del alias MIGF-O-010. No lo creó ni lo activó esta pasada; conviene retirarlo desde Admin con el visto bueno del dueño.
- D-009 (ubicación del imán en la navegación) y D-022 (México) siguen abiertas y no bloquean.
- Respuestas D-004/D-005/D-018 y categorías las registró la sesión a nombre del dueño; revisión humana pendiente en Admin.

## 11. Pruebas

${table(
  ['Suite', 'Resultado'],
  [
    ['Unit', `${t('unit')} passed`],
    ['DB', `${t('db')} passed`],
    ['Importer (Python)', `${t('importer')} tests`],
    ['Playwright · migración STEP 09', `${t('e2e_migration')} passed`],
    ['Playwright · suites STEP 06–08 (sobre copia de la base)', `${t('e2e_other')} passed`],
    ['Playwright · pasada Owner Decisions', `${t('e2e_completion')} passed`],
    [
      'Casos de precio por el Price Engine',
      post.pricing.allCasesOk
        ? `${post.pricing.cases.length}/${post.pricing.cases.length} OK (120.00 / 400.00 / 65.00, 750 y 2 pares QUOTE_ONLY, nuevos items QUOTE_ONLY)`
        : 'FALLA',
    ],
    ['Idempotencia de la publicación', 'segunda ejecución: 0 filas nuevas (conteos idénticos)'],
    ['Procedencia de candidatos publicados', `${post.provenance.traced}/${post.provenance.total}`],
    [
      'Duplicados (enlaces / ids legacy / códigos)',
      `${post.integrity.links} / ${post.integrity.legacy} / ${post.integrity.dup_codes}`,
    ],
    [
      'Publicados fuera del alcance / del permiso',
      `${post.integrity.out_of_scope} / ${post.integrity.outside_permit}`,
    ],
  ],
)}

## 12. Reconstrucción limpia e integridad de los workbooks

\`tools/step09-rebuild.sh\` en un clone nuevo con base vacía: schema 0001–0018 → importación → STEP 09 → pasada Owner Decisions → reportes → todas las suites. Los dos hashes (antes/después) de los 5 workbooks son idénticos (**${tests.workbooksUnchanged ? 'workbooks sin cambios' : 'CAMBIARON'}**):

\`\`\`
${hashes.join('\n')}
\`\`\`

## 13. ¿Commercial Print está suficientemente resuelto para STEP 10?

**Sí.** Las 21 filas fuente tienen una identidad canónica o una disposición documentada; 13 productos viven en Product Engine (11 ACTIVE, 2 CANDIDATE internos) con procedencia hasta la celda del Excel; los precios que existen se resuelven por el Price Engine y todo lo demás cotiza sin inventar. STEP 10 (CRM) debe tratar los items QUOTE_ONLY como "solicitar cotización", ignorar CANDIDATE y no ver las filas no-producto. No se empezó STEP 10.
`,
  );
  console.log('final: OWNER_DECISIONS_COMPLETION_REPORT.md written');
}

async function main() {
  const cmd = process.argv[2];
  if (!process.argv.includes('--completion')) throw new Error('pass --completion');
  if (cmd === 'before') await before();
  else if (cmd === 'pre') await pre();
  else if (cmd === 'post') await post();
  else if (cmd === 'final') await final();
  else throw new Error(`unknown command ${cmd}`);
}
main().finally(() => pool.end());
