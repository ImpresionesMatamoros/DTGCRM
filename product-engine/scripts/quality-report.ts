/**
 * Generates the STEP 08 real-data reports from the LOCAL database (read-only, except one demonstration
 * that runs inside a transaction which is always rolled back):
 *
 *   pnpm quality:report [--out docs/step08]
 *
 * Writes DATA_QUALITY_DRY_RUN.md, COMMERCIAL_PRINT_MIGRATION_GATE.md, STEP_09_COMMERCIAL_PRINT_INPUT.md,
 * data-quality-report.json and data-quality-findings.csv. Nothing is invented: every number is computed.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Actor } from '../src/admin/permissions';
import {
  decisionApplyHandler,
  decisionPreviewHandler,
  recordDecisionHandler,
} from '../src/admin/handlers';
import { createPool } from '../src/db/client';
import { qualityOverview, type Overview } from '../src/db/admin/quality-views';
import { setActorContext, type TxRunner } from '../src/db/admin/tx';
import { OWNER_DECISIONS } from '../src/decisions/reference';
import { diffRuns, runHash } from '../src/quality/engine';
import { buildExport, findingsToCsv } from '../src/quality/export';
import { RULES } from '../src/quality/rules';

for (const f of ['.env.local', '.env']) {
  if (existsSync(f) && !process.env.DATABASE_URL) process.loadEnvFile(f);
}
const host = new URL(process.env.DATABASE_URL ?? '').hostname;
if (!['localhost', '127.0.0.1', '::1', 'db'].includes(host))
  throw new Error(`non-local host ${host}`);

const i = process.argv.indexOf('--out');
const OUT = i >= 0 ? process.argv[i + 1]! : 'docs/step08';
mkdirSync(OUT, { recursive: true });

const table = (head: string[], rows: (string | number)[][]) =>
  [
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...rows.map(
      (r) => `| ${r.map((c) => String(c).replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ')} |`,
    ),
  ].join('\n');

const kv = (o: Record<string, number>) =>
  Object.entries(o)
    .map(([k, v]) => `${k}: ${v}`)
    .join(' · ') || '—';

const pool = createPool();

async function main() {
  const asOf = new Date();
  const o = await qualityOverview(pool, asOf);
  if (o.input.candidates.length === 0)
    throw new Error('no staging: restage the real workbooks first');
  const s = o.summary;
  const F = o.run.findings;
  const count = (p: (f: (typeof F)[number]) => boolean) => F.filter(p).length;
  const by = <K extends string>(key: (f: (typeof F)[number]) => K) => {
    const m: Record<string, number> = {};
    for (const f of F) m[key(f)] = (m[key(f)] ?? 0) + 1;
    return m;
  };
  const gate = o.gate;
  const cpIds = new Set(gate.items.map((x) => x.legacyId));
  const cp = F.filter((f) => f.itemLegacyId && cpIds.has(f.itemLegacyId));

  // ---------------------------------------------------------------- before / after demonstration (rolled back)
  const recorder: Actor = { name: 'demo-recorder', source: 'env', role: 'local_decision_recorder' };
  const dev: Actor = { name: 'demo-dev', source: 'env', role: 'local_dev' };
  const c = await pool.connect();
  let after: Overview | null = null;
  let demo = { applied: 0, candidates: 0 };
  try {
    await c.query('begin');
    const tx: TxRunner = async (actor, context, fn) => {
      await setActorContext(c, actor, context);
      return fn(c);
    };
    const d1 = OWNER_DECISIONS.find((d) => d.id === 'D-001')!;
    const rec = await recordDecisionHandler(tx, recorder, {
      decisionId: 'D-001',
      summary: 'DEMOSTRACIÓN (hipotética, se revierte): todos ACTIVE',
      assignments: [{ value: 'ACTIVE', legacyIds: d1.affected.map((a) => a.legacyId) }],
    });
    if (!rec.ok) throw new Error(JSON.stringify(rec));
    const prev = await decisionPreviewHandler(c, dev, { decisionId: 'D-001', index: 0 });
    if (!prev.ok) throw new Error(JSON.stringify(prev));
    const applied = await decisionApplyHandler(tx, dev, {
      decisionId: 'D-001',
      index: 0,
      planSha256: prev.plan.planSha256,
      overwrite: false,
      reason: 'demostración revertida',
    });
    if (!applied.ok) throw new Error(JSON.stringify(applied));
    demo = { applied: applied.written, candidates: applied.candidates };
    after = await qualityOverview(c, asOf);
  } finally {
    await c.query('rollback');
    c.release();
  }
  const check = await qualityOverview(pool, asOf);
  const untouched = runHash(check.run) === runHash(o.run);
  const diff = diffRuns(o.run, after!.run);
  const statusRule = (ov: Overview) =>
    ov.run.findings.filter((f) => f.ruleCode === 'DQ-CATALOG-002').length;

  // ---------------------------------------------------------------- DATA_QUALITY_DRY_RUN.md
  const ruleRows = o.inventory
    .filter((r) => r.affected > 0)
    .map((r) => [
      r.ruleCode,
      r.title,
      r.severity,
      r.affected,
      r.bulkResolvable,
      r.ownerDecisionRequired,
      r.manualReview,
      r.sourceFix,
      r.ownerDecisions.join(', ') || '—',
    ]);
  const decisionRows = OWNER_DECISIONS.map((d) => {
    const mine = F.filter((f) => f.decisions.some((x) => x.id === d.id));
    return [d.id, d.title, mine.length, new Set(mine.map((f) => f.itemLegacyId)).size];
  });
  const dry = `# STEP 08 — Data quality dry run (real staging)

Generado por \`pnpm quality:report\` el ${asOf.toISOString()} sobre la base local con el staging real
(${o.input.batches.length} lotes, ${s.candidates.total} candidatos). Todo número se calcula: nada se estima ni se
oculta. Lectura sin escritura (la demostración antes/después corre en una transacción que se revierte; la
base quedó idéntica: ${untouched ? 'verificado' : 'NO VERIFICADO'}).

Lotes: ${o.input.batches.map((b) => `${b.sourceFile} (${b.dataClass}, ${b.candidates} cand.)`).join('; ')}.
Reglas: ${o.inventory.length} (versión ${o.run.rulesVersion}); publicación habilitada sólo para: ${o.input.publicationEnabledFor.join(', ')}.

## 1. Totales

${table(
  ['Medida', 'Valor'],
  [
    ['Candidatos', s.candidates.total],
    ['Resueltos (sin campos abiertos)', s.candidates.resolved],
    ['Sin resolver', s.candidates.unresolved],
    ['Hallazgos', s.findings.total],
    ['BLOCKER', s.findings.blockers],
    ['WARNING', s.findings.warnings],
    ['INFO', s.findings.info],
    ['Esperan decisión del dueño (OWNER_DECISION_REQUIRED)', s.ownerDecisionRequired],
    ['Resolubles en masa (BULK_RESOLVABLE)', count((f) => f.remediation === 'BULK_RESOLVABLE')],
    ['Sólo manual (MANUAL_REVIEW)', count((f) => f.remediation === 'MANUAL_REVIEW')],
    ['Corrección en la fuente (SOURCE_FIX)', count((f) => f.remediation === 'SOURCE_FIX')],
  ],
)}

## 2. Por tipo de candidato

${table(
  ['Tipo', 'Candidatos', 'Resueltos', 'Sin resolver'],
  Object.entries(s.byKind).map(([k, r]) => [k, r.candidates, r.resolved, r.unresolved]),
)}

## 3. Por área

${table(
  ['Área', 'Hallazgos', 'Bloqueantes', 'Advertencias', 'Info'],
  Object.entries(s.byArea).map(([k, r]) => [k, r.total, r.blockers, r.warnings, r.info]),
)}

## 4. Por regla (sólo reglas con hallazgos)

${table(
  ['Regla', 'Título', 'Sev.', 'Afectados', 'En masa', 'Dueño', 'Manual', 'Fuente', 'Decisión'],
  ruleRows,
)}

Reglas sin hallazgos hoy: ${
    o.inventory
      .filter((r) => r.affected === 0)
      .map((r) => r.ruleCode)
      .join(', ') || 'ninguna'
  }.

## 5. Por decisión del dueño (hallazgos ligados)

${table(['Decisión', 'Título', 'Hallazgos', 'Artículos'], decisionRows)}

Ninguna decisión está respondida en el staging real: lo que depende de ellas figura como
\`OWNER_DECISION_REQUIRED\`, no como error técnico.

## 6. Preparación (4 dimensiones, ${o.readinessTotals.items} artículos)

${table(
  ['Dimensión', 'Estados'],
  [
    ['Revisión', kv(o.readinessTotals.review)],
    ['Dominio', kv(o.readinessTotals.domain)],
    ['Precios', kv(o.readinessTotals.pricing)],
    ['Publicación', kv(o.readinessTotals.publication)],
  ],
)}

Listos si se levantara la barrera de publicación REAL (que sigue cerrada): **${o.readinessTotals.readyIgnoringBarrier}**.

## 7. Subconjunto Commercial Print (${gate.totals.total} artículos)

Hallazgos de esos artículos: ${cp.length} (BLOCKER ${cp.filter((f) => f.severity === 'BLOCKER').length}, WARNING ${cp.filter((f) => f.severity === 'WARNING').length}, INFO ${cp.filter((f) => f.severity === 'INFO').length}).
Detalle por artículo en \`COMMERCIAL_PRINT_MIGRATION_GATE.md\`.

## 8. Demostración antes / después (transacción revertida)

Se registró una respuesta **hipotética** a D-001 («todos ACTIVE») con el rol de registro, se previsualizó y se
aplicó con el flujo real (origen DECISION_GROUP). **No es una decisión del dueño**: sólo muestra qué hace la
herramienta. Después se hizo \`rollback\`.

${table(
  ['Medida', 'Antes', 'Con la respuesta aplicada'],
  [
    [
      'Hallazgos DQ-CATALOG-002 (estado de catálogo sin resolver)',
      statusRule(o),
      statusRule(after!),
    ],
    ['Candidatos sin resolver', s.candidates.unresolved, after!.summary.candidates.unresolved],
    ['Hallazgos totales', s.findings.total, after!.summary.findings.total],
    ['BLOCKER', s.findings.blockers, after!.summary.findings.blockers],
    ['Esperan decisión del dueño', s.ownerDecisionRequired, after!.summary.ownerDecisionRequired],
    [
      'Artículos listos (dominio)',
      o.readinessTotals.domain.READY ?? 0,
      after!.readinessTotals.domain.READY ?? 0,
    ],
  ],
)}

Campos escritos en la demostración: ${demo.applied} en ${demo.candidates} candidatos. Hallazgos que desaparecen:
${diff.resolved.length}; aparecen: ${diff.appeared.length} (los demás bloqueos — unidad de venta, opciones,
precios, decisiones — siguen visibles).
`;
  writeFileSync(path.join(OUT, 'DATA_QUALITY_DRY_RUN.md'), dry);

  // ---------------------------------------------------------------- gate
  const t = gate.totals;
  const gateMd = `# STEP 08 — Compuerta de migración Commercial Print

Generado por \`pnpm quality:report\` el ${asOf.toISOString()}. Sólo lectura: **no migra, no publica y no marca nada como listo**.
Paquete: ${gate.meta.source} (candidatos sha256 \`${gate.meta.candidatesSha256}\`).

## Totales

${table(
  ['Medida', 'Valor'],
  [
    ['Artículos del paquete', t.total],
    ['En staging', t.staged],
    ['Revisión lista', t.reviewReady],
    ['Dominio listo', t.domainReady],
    ['Precios listos', t.pricingReady],
    ['Sólo cotización (QUOTE_ONLY)', t.quoteOnly],
    ['Podrían migrar si se levantara la barrera', t.publicationReadyIgnoringBarrier],
    ['Bloqueados por decisiones del dueño', t.blockedByOwnerDecisions],
    ['Sin unidad de venta', t.missingSaleUnit],
    ['Sin estado de catálogo', t.missingStatus],
    ['Sin categoría', t.missingCategory],
    ['Con bloqueos de opciones', t.withOptionBlockers],
    ['Con presentaciones sin resolver', t.withUnresolvedPresentations],
    ['Procedencia rota', t.brokenProvenance],
  ],
)}

Decisiones abiertas (artículos afectados): ${kv(t.openDecisionCounts)}.

## Por artículo

${table(
  [
    'Artículo',
    'ID',
    'Estado',
    'Unidad',
    'Categoría',
    'Precio',
    'Opciones sin res.',
    'Present. sin res.',
    'Procedencia',
    'Decisiones abiertas',
    'Migra',
  ],
  gate.items.map((x) => [
    x.name,
    x.legacyId,
    x.status.value ?? 'FALTA',
    x.saleUnit.value ?? 'FALTA',
    x.category.value ?? 'FALTA',
    x.price.state,
    `${x.options.unresolved}/${x.options.candidates}`,
    `${x.presentations.unresolved}/${x.presentations.candidates}`,
    x.provenance.state,
    x.openDecisions.join(', ') || '—',
    x.canMigrate ? 'sí*' : 'no',
  ]),
)}

\\* "sí" significa listo ignorando la barrera de publicación REAL, que sigue cerrada por diseño.
`;
  writeFileSync(path.join(OUT, 'COMMERCIAL_PRINT_MIGRATION_GATE.md'), gateMd);

  // ---------------------------------------------------------------- STEP 09 input
  const itemsMd = gate.items
    .map(
      (x) => `### ${x.name} (\`${x.legacyId}\`)

- Preparación: revisión ${x.readiness?.review.state ?? 'sin staging'} · dominio ${x.readiness?.domain.state ?? '—'} · precios ${x.readiness?.pricing.state ?? '—'} · publicación ${x.readiness?.publication.state ?? '—'}
- Decisiones abiertas: ${x.openDecisions.join(', ') || 'ninguna'}
- Categoría: ${x.category.value ?? 'FALTA (sin mapear)'} · unidad de venta: ${x.saleUnit.value ?? 'FALTA'} · estado: ${x.status.value ?? 'FALTA'}
- Precio: ${x.price.state}; ${x.price.evidenceObservations} observaciones de evidencia, ${x.price.priceCandidates} candidatos de precio
- Opciones: ${x.options.candidates} candidatos (${x.options.unresolved} sin resolver) · presentaciones: ${x.presentations.candidates} (${x.presentations.unresolved} sin resolver)
- Procedencia: ${x.provenance.state}
- Bloqueos: ${[...x.blockers.domain, ...x.blockers.option, ...x.blockers.pricing, ...x.blockers.decision].join('; ') || 'ninguno'}
- ${x.canMigrate ? 'Podría migrar (si se levanta la barrera REAL por decisión explícita).' : 'Debe esperar: ver bloqueos.'}`,
    )
    .join('\n\n');
  const step9 = `# Entrada para STEP 09 — Commercial Print

Generado el ${asOf.toISOString()}. Esto es **insumo**, no autorización: STEP 09 no empieza sin autorización explícita.

Resumen: ${t.staged}/${t.total} artículos en staging; ${t.publicationReadyIgnoringBarrier} podrían migrar hoy; ${t.blockedByOwnerDecisions} están bloqueados por decisiones abiertas;
${t.missingCategory} sin categoría, ${t.missingSaleUnit} sin unidad de venta, ${t.missingStatus} sin estado.

Qué puede avanzar sin dueño: mapear categorías (herramienta de categorías), resolver opciones/presentaciones marcadas
como resolubles en masa, completar estados/unidades **una vez registrada** la respuesta de D-001/D-002.
Qué debe esperar: todo lo ligado a D-008, D-010, D-011, D-016 y D-022 (precio/publicación) y México (IVA).

${itemsMd}
`;
  writeFileSync(path.join(OUT, 'STEP_09_COMMERCIAL_PRINT_INPUT.md'), step9);

  // ---------------------------------------------------------------- rules catalogue (generated from the code)
  const rulesMd = `# STEP 08 — Catálogo de reglas de calidad

Generado desde \`src/quality/rules.ts\` (${RULES.length} reglas, versión ${o.run.rulesVersion}). No editar a mano: \`pnpm quality:report\`.

## Semántica

- **Código estable** \`DQ-<ÁREA>-NNN\`: nunca se reutiliza con otro significado; si la semántica cambia sustancialmente se sube la \`versión\` de la regla y se documenta aquí.
- **Severidad**: BLOCKER = el objeto no puede considerarse listo para publicar/migrar; WARNING = conviene corregir; INFO = informativo.
- **Remediación**: BULK_RESOLVABLE (campo con herramienta masiva), MANUAL_REVIEW, OWNER_DECISION_REQUIRED (una decisión ligada está abierta y el artículo está en su alcance; **no es un error técnico**), SOURCE_FIX (corregir el Excel). Al registrarse una respuesta, la regla vuelve a su remediación propia.
- **Dimensión**: REVIEW, DOMAIN o PRICING (la publicación se deriva: depende de las tres, de decisiones bloqueantes abiertas y de la barrera de publicación REAL).
- Los precios históricos (23) son evidencia: sólo generan hallazgos si intentan alimentar precios vigentes.
- Solapamiento documentado: **DQ-CATALOG-003** (artículo sin unidad de venta) y **DQ-PRICE-003** (precio que depende de una unidad de venta ausente) miran la misma unidad desde lados distintos; ambos se resuelven con el mismo campo masivo \`saleUnit\` y se deduplican por clave (regla+sujeto), no entre reglas.
- México: no se cierra IVA/D-022; HALF_UP_2 sigue siendo "PROVISIONAL TECHNICAL BEHAVIOR" (DQ-PRICE-015/016).

## Reglas

${table(
  ['Código', 'v', 'Área', 'Dim.', 'Sev.', 'Título', 'Remediación', 'Campo masivo', 'Decisiones'],
  RULES.map((r) => [
    r.code,
    r.version,
    r.area,
    r.dimension,
    r.severity,
    r.title,
    r.remediation,
    r.bulk ? `${r.bulk.kind}.${r.bulk.field}` : '—',
    r.decisionTopics.join(', ') || '—',
  ]),
)}

## Descripciones

${RULES.map((r) => `- **${r.code}** — ${r.description}`).join('\n')}
`;
  writeFileSync(path.join(OUT, 'DATA_QUALITY_RULES.md'), rulesMd);

  // ---------------------------------------------------------------- machine-readable
  writeFileSync(
    path.join(OUT, 'data-quality-report.json'),
    JSON.stringify(buildExport(o.input, o.run), null, 2),
  );
  writeFileSync(path.join(OUT, 'data-quality-findings.csv'), findingsToCsv(F));
  console.log(
    JSON.stringify(
      {
        candidates: s.candidates,
        findings: s.findings,
        ownerDecisionRequired: s.ownerDecisionRequired,
        bulk: count((f) => f.remediation === 'BULK_RESOLVABLE'),
        gate: t,
        before_after: {
          status: [statusRule(o), statusRule(after!)],
          blockers: [s.findings.blockers, after!.summary.findings.blockers],
        },
        untouched,
        byRemediation: by((f) => f.remediation),
      },
      null,
      2,
    ),
  );
}

main().finally(() => pool.end());
