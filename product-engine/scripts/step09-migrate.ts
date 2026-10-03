/**
 * STEP 09 · Commercial Print migration driver (LOCAL database only). Every step goes through the same
 * audited handlers the Admin uses — there are no manual DB edits.
 *
 *   tsx scripts/step09-migrate.ts decisions   record OD-01..OD-09 answers, apply them to the eligible items,
 *                                             resolve their candidates, reject inherent-process decorations, approve
 *   tsx scripts/step09-migrate.ts gate        print the item-aware migration gate
 *   tsx scripts/step09-migrate.ts dry-run     simulate the whole REAL publication in a rolled-back transaction
 *   tsx scripts/step09-migrate.ts permit      the owner approves the scoped permit
 *   tsx scripts/step09-migrate.ts publish     the owner runs the scoped REAL publication
 *   tsx scripts/step09-migrate.ts reports     write docs/step09/*.md from the live state
 *
 * Idempotent: running a step twice changes nothing the second time.
 */
import { existsSync } from 'node:fs';
import type { PoolClient } from 'pg';
import type { Actor } from '../src/admin/permissions';
import {
  approveHandler,
  bulkApplyHandler,
  bulkPreviewHandler,
  decisionApplyHandler,
  decisionPreviewHandler,
  recordDecisionHandler,
  rejectHandler,
  saveDraftHandler,
} from '../src/admin/handlers';
import { createPool } from '../src/db/client';
import { currentAnswer } from '../src/db/admin/decision-answers';
import { poolTxRunner, setActorContext } from '../src/db/admin/tx';
import { buildContext, ownerLegacyOf } from '../src/quality/context';
import { qualityReport } from '../src/db/admin/quality';
import {
  currentMigrationGate,
  createMigrationPermit,
  publishUnderPermit,
  simulateMigration,
  activePermit,
  SCOPE_KEY,
  COMMERCIAL_PRINT_PERMIT,
} from '../src/db/migration/permit';
import {
  OD01_ACTIVE,
  OWNER_ACTOR,
  STEP09_ANSWERS,
  STEP09_DEFAULT_MARKETS,
  STEP09_PRICE_VALID_FROM,
} from '../src/decisions/step09-owner-decisions';
import {
  CANONICAL,
  CANONICAL_IDS,
  COMPLETION_ANSWERS,
  COMPLETION_CATEGORY,
  COMPLETION_PERMIT_DECISIONS,
  DISPOSITION_SPECS,
  SPEC_REF,
} from '../src/decisions/owner-decisions-v1';
import { recordDisposition } from '../src/db/migration/disposition';

for (const f of ['.env.local', '.env']) {
  if (existsSync(f) && !process.env.DATABASE_URL) process.loadEnvFile(f);
}
const host = new URL(process.env.DATABASE_URL ?? '').hostname;
if (!['localhost', '127.0.0.1', '::1', 'db'].includes(host))
  throw new Error(`non-local host ${host}`);

export const OWNER: Actor = { name: OWNER_ACTOR, source: 'env', role: 'local_migration_owner' };
export const PREPARER: Actor = { name: 'step09-preparer', source: 'env', role: 'local_dev' };

const pool = createPool();
const tx = poolTxRunner(pool);
type Row = Record<string, unknown>;

const OPTION_KEY: Record<string, string> = {
  caras: 'caras',
  papel: 'papel',
  tamaño: 'tamano_papel',
};
const CATEGORY_OF: Record<string, string> = {
  'MIG1-O-008': 'impresos_papel',
  'MIG1-O-009': 'impresos_papel',
  'MIG2-O-036': 'impresos_papel',
  'MIG2-O-040': 'impresos_papel',
  'MIGF-O-015': 'servicios_especiales',
};
const must = <T extends { ok: boolean }>(what: string, r: T): T => {
  if (!r.ok) throw new Error(`${what}: ${JSON.stringify(r)}`);
  return r;
};

async function candidatesOf(legacyIds: readonly string[]) {
  const report = await qualityReport(pool, new Date(), { dataClass: 'REAL' });
  const ctx = buildContext(report.input);
  return ctx.candidates.filter((c) => {
    const o = ownerLegacyOf(c);
    return o !== null && legacyIds.includes(o) && c.reviewStatus !== 'REJECTED';
  });
}

// ---------------------------------------------------------------- decisions
async function decisions() {
  // 1 · the owner's answers
  for (const a of STEP09_ANSWERS) {
    const cur = await currentAnswer(pool, a.decisionId);
    if (cur && cur.summary === a.summary) {
      console.log(`= ${a.decisionId} already recorded`);
      continue;
    }
    must(
      a.decisionId,
      await recordDecisionHandler(tx, OWNER, {
        decisionId: a.decisionId,
        summary: a.summary,
        notes: `${a.notes} Registrado desde el mensaje de Martín (OD-01..OD-09) por la sesión de STEP 09.`,
        ...(a.assignments ? { assignments: a.assignments } : {}),
        ...(a.covers ? { covers: a.covers } : {}),
      }),
    );
    console.log(`+ ${a.decisionId} recorded`);
  }
  // 2 · apply the machine-applicable assignments (status, sale unit)
  for (const a of STEP09_ANSWERS.filter((x) => x.assignments)) {
    const prev = await decisionPreviewHandler(pool, PREPARER, {
      decisionId: a.decisionId,
      index: 0,
    });
    if (!prev.ok) throw new Error(`${a.decisionId} preview: ${JSON.stringify(prev)}`);
    const plan = (prev as unknown as { plan: { planSha256: string; counts: { write?: number } } })
      .plan;
    const r = await decisionApplyHandler(tx, PREPARER, {
      decisionId: a.decisionId,
      index: 0,
      planSha256: plan.planSha256,
      overwrite: false,
      reason: `Respuesta registrada de ${a.decisionId}`,
    });
    console.log(r.ok ? `+ ${a.decisionId} applied` : `· ${a.decisionId}: ${JSON.stringify(r)}`);
  }
  // 3 · category, per item (scoped: never a source-category sweep)
  for (const cat of new Set(Object.values(CATEGORY_OF))) {
    const ids = Object.entries(CATEGORY_OF)
      .filter(([, k]) => k === cat)
      .map(([l]) => l);
    const cs = (await candidatesOf(ids)).filter((c) => c.kind === 'CATALOG_ITEM');
    const req = {
      candidateIds: cs.map((c) => c.id),
      kind: 'CATALOG_ITEM',
      changes: { categoryKey: cat },
      strict: true,
    };
    const prev = await bulkPreviewHandler(pool, PREPARER, req);
    if (!prev.ok) throw new Error(JSON.stringify(prev));
    const plan = (prev as unknown as { plan: { planSha256: string } }).plan;
    const r = await bulkApplyHandler(tx, PREPARER, {
      ...req,
      planSha256: plan.planSha256,
      overwrite: false,
      reason: `Categoría revisada por item: ${ids.join(', ')} → ${cat} (evidencia: definición Commercial Print de STEP 05C y dev slice; el texto legacy no se reescribe)`,
    });
    console.log(r.ok ? `+ category ${cat}` : `· category ${cat}: ${JSON.stringify(r)}`);
  }
  // 4 · per-candidate resolutions
  const eligible = [...OD01_ACTIVE];
  const cs = await candidatesOf(eligible);
  const existingItem = async (legacy: string) =>
    (
      (
        await pool.query(
          `select entity_id from source_reference where source_kind='LEGACY_ID' and entity_type='catalog_item' and source_locator=$1`,
          [legacy],
        )
      ).rows[0] as Row | undefined
    )?.entity_id as string | undefined;
  for (const c of cs) {
    if (c.reviewStatus === 'APPROVED' || c.reviewStatus === 'PUBLISHED') continue;
    const legacy = ownerLegacyOf(c)!;
    const set: Record<string, unknown> = {};
    const p = c.proposal;
    if (p.kind === 'CATALOG_ITEM') {
      set.decorationPolicy = 'NONE';
      const id = await existingItem(legacy);
      set.target = id ? { mode: 'LINK_EXISTING', entityId: id } : { mode: 'CREATE' };
    } else if (p.kind === 'OPTION') {
      const key = OPTION_KEY[(p.name ?? '').toLowerCase()];
      if (!key) throw new Error(`no option definition for ${String(p.name)}`);
      const vals = (
        await pool.query(
          `select v.code from option_value v join option_definition d on d.id=v.option_definition_id where d.key=$1`,
          [key],
        )
      ).rows.map((r) => r.code as string);
      set.definition = { mode: 'EXISTING', key };
      set.isRequired = true;
      set.selectionMode = 'SINGLE';
      set.isDistributable = false;
      set.values = Object.fromEntries(
        p.values.map((v) => {
          if (!v.label || !vals.includes(v.label))
            throw new Error(`value ${String(v.label)} not in ${key}`);
          return [v.recordKey, { mode: 'EXISTING', code: v.label }];
        }),
      );
    } else if (p.kind === 'PRICE') {
      set.validFrom = STEP09_PRICE_VALID_FROM;
      if (p.model === 'FIXED') set.maxQuantity = 1; // OD-08: one pair, never 2 pairs = 2×
      const target = await existingPriceTarget(legacy, p);
      if (target) set.target = { mode: 'LINK_EXISTING', entityId: target };
    } else if (p.kind === 'DECORATION') {
      must(
        'reject',
        await rejectHandler(tx, PREPARER, {
          candidateId: c.id,
          reason:
            'OD-04: el proceso/técnica de impresión es interno (DTG decide), no una opción del cliente ni una decoración elegible; el item queda con decorationPolicy NONE.',
        }),
      );
      console.log(`- rejected decoration ${c.id.slice(0, 8)} (${legacy})`);
      continue;
    }
    if (Object.keys(set).length) {
      const r = await saveDraftHandler(tx, PREPARER, {
        candidateId: c.id,
        set,
        reason:
          'STEP 09: resolución desde decisiones OD-01..OD-09 y evidencia del dominio existente',
      });
      if (!r.ok && !JSON.stringify(r).includes('NOTHING_CHANGED'))
        throw new Error(JSON.stringify(r));
    }
  }
  // 5 · approve (only when nothing is left open)
  const again = await candidatesOf(eligible);
  const ctx = buildContext((await qualityReport(pool, new Date(), { dataClass: 'REAL' })).input);
  for (const c of again) {
    if (c.reviewStatus === 'APPROVED' || c.reviewStatus === 'PUBLISHED') continue;
    const open = ctx.openFields(c);
    if (open.length) {
      console.log(
        `· ${ownerLegacyOf(c)} ${c.kind} ${c.id.slice(0, 8)} still open: ${open.join(',')}`,
      );
      continue;
    }
    const r = await approveHandler(tx, PREPARER, {
      candidateId: c.id,
      reason: 'STEP 09: resuelto con OD y evidencia',
    });
    console.log(
      r.ok
        ? `+ approved ${ownerLegacyOf(c)} ${c.kind}`
        : `· approve ${c.id.slice(0, 8)}: ${JSON.stringify(r)}`,
    );
  }
}

/** Existing AUTHORIZED/DRAFT definition of the item whose condition set equals this price's (never guessed). */
async function existingPriceTarget(
  legacy: string,
  p: {
    conditions: { attribute: string | null; value: string | null; optionLegacyId: string | null }[];
  },
) {
  const itemId = (
    (
      await pool.query(
        `select entity_id from source_reference where source_kind='LEGACY_ID' and entity_type='catalog_item' and source_locator=$1`,
        [legacy],
      )
    ).rows[0] as Row | undefined
  )?.entity_id as string | undefined;
  if (!itemId) return null;
  const fixed = new Set(
    (
      (
        await pool.query(
          `select proposal from import_candidate where kind='CATALOG_ITEM' and proposal->>'legacyId'=$1 limit 1`,
          [legacy],
        )
      ).rows[0] as { proposal: { fixedAttributes: { optionLegacyId: string | null }[] } }
    ).proposal.fixedAttributes.flatMap((a) => (a.optionLegacyId ? [a.optionLegacyId] : [])),
  );
  const want = p.conditions
    .filter((c) => !(c.optionLegacyId && fixed.has(c.optionLegacyId)))
    .map((c) => `${OPTION_KEY[(c.attribute ?? '').toLowerCase()] ?? c.attribute}=${c.value}`)
    .sort()
    .join('|');
  const defs = (
    await pool.query(
      `select d.id, coalesce((select string_agg(od.key || '=' || ov.code, '|' order by od.key || '=' || ov.code)
                from price_condition pc join option_definition od on od.id = pc.option_definition_id
                join option_value ov on ov.id = pc.option_value_id
               where pc.price_definition_id = d.id and pc.kind = 'OPTION_VALUE'), '') as sig
         from price_definition d where d.item_id = $1 and d.component = 'ITEM' and d.status <> 'SUPERSEDED'`,
      [itemId],
    )
  ).rows as { id: string; sig: string }[];
  const m = defs.filter((d) => d.sig === want);
  return m.length === 1 ? m[0]!.id : null;
}

// ---------------------------------------------------------------- owner-decisions completion pass
/**
 * STEP 09 completion: applies OWNER_DECISION_SPEC_v1.0 to the 16 rows that stayed blocked. Eight rows become
 * canonical products (6 ACTIVE + 2 CANDIDATE, none with an invented price); eight are resolved as alias /
 * configuration / style / never-valid legacy labels (evidence kept, no CatalogItem). Idempotent.
 */
async function completion() {
  // 1 · revised owner answers (earlier answers stay in history)
  for (const a of COMPLETION_ANSWERS) {
    const cur = await currentAnswer(pool, a.decisionId);
    if (cur && cur.summary === a.summary) {
      console.log(`= ${a.decisionId} already recorded (rev ${cur.revision})`);
      continue;
    }
    must(
      a.decisionId,
      await recordDecisionHandler(tx, OWNER, {
        decisionId: a.decisionId,
        summary: a.summary,
        notes: a.notes,
        ...(a.assignments ? { assignments: a.assignments } : {}),
        ...(a.covers ? { covers: a.covers } : {}),
      }),
    );
    console.log(`+ ${a.decisionId} recorded`);
  }
  // 2 · apply every machine-applicable assignment (status / sale unit / item type), one by one
  for (const a of COMPLETION_ANSWERS.filter((x) => x.assignments)) {
    for (let index = 0; index < a.assignments!.length; index++) {
      const prev = await decisionPreviewHandler(pool, PREPARER, {
        decisionId: a.decisionId,
        index,
      });
      if (!prev.ok) throw new Error(`${a.decisionId}[${index}] preview: ${JSON.stringify(prev)}`);
      const plan = (prev as unknown as { plan: { planSha256: string } }).plan;
      const r = await decisionApplyHandler(tx, PREPARER, {
        decisionId: a.decisionId,
        index,
        planSha256: plan.planSha256,
        overwrite: false,
        reason: `Respuesta registrada de ${a.decisionId} (${SPEC_REF})`,
      });
      console.log(
        r.ok
          ? `+ ${a.decisionId}[${index}] applied`
          : `· ${a.decisionId}[${index}]: ${JSON.stringify(r)}`,
      );
    }
  }
  // 2b · safeguard: what the owner answered is what staging now says (an earlier, different draft value is
  // never silently kept: the bulk planner does not overwrite without confirmation, so we verify instead)
  {
    const ctx2 = buildContext((await qualityReport(pool, new Date(), { dataClass: 'REAL' })).input);
    const wrong: string[] = [];
    for (const c of (await candidatesOf(CANONICAL_IDS)).filter((x) => x.kind === 'CATALOG_ITEM')) {
      const l = ownerLegacyOf(c)! as keyof typeof CANONICAL;
      for (const f of ['status', 'saleUnit'] as const)
        if (ctx2.effective(c, f) !== CANONICAL[l][f])
          wrong.push(`${l}.${f}=${String(ctx2.effective(c, f))} ≠ ${CANONICAL[l][f]}`);
    }
    if (wrong.length)
      throw new Error(`owner answers not reflected in staging: ${wrong.join('; ')}`);
    console.log('= statuses and sale units match the owner answers');
  }
  // 3 · category (implementation taxonomy: existing category, per item)
  {
    const cs = (await candidatesOf(CANONICAL_IDS)).filter((c) => c.kind === 'CATALOG_ITEM');
    const req = {
      candidateIds: cs.map((c) => c.id),
      kind: 'CATALOG_ITEM',
      changes: { categoryKey: COMPLETION_CATEGORY },
      strict: true,
    };
    const prev = await bulkPreviewHandler(pool, PREPARER, req);
    if (!prev.ok) throw new Error(JSON.stringify(prev));
    const plan = (prev as unknown as { plan: { planSha256: string } }).plan;
    const r = await bulkApplyHandler(tx, PREPARER, {
      ...req,
      planSha256: plan.planSha256,
      overwrite: false,
      reason: `Categoría por item (taxonomía de implementación, no una pregunta de negocio): ${CANONICAL_IDS.join(', ')} → ${COMPLETION_CATEGORY}. El texto legacy no se reescribe.`,
    });
    console.log(r.ok ? `+ category ${COMPLETION_CATEGORY}` : `· category: ${JSON.stringify(r)}`);
  }
  // 4 · non-product rows: record the disposition first, then reject every candidate of the row (evidence stays)
  for (const d of DISPOSITION_SPECS) {
    const why = `${SPEC_REF}: ${d.detail}`;
    const rec = await tx(OWNER.name, 'step09:disposition', (db) =>
      recordDisposition(db, { ...d, reason: why }, OWNER.name),
    );
    if (!rec.ok) throw new Error(`${d.itemLegacyId}: ${JSON.stringify(rec.errors)}`);
    const own = await candidatesOf([d.itemLegacyId]);
    for (const c of own)
      must(
        'reject',
        await rejectHandler(tx, PREPARER, {
          candidateId: c.id,
          reason: `${why}. Evidencia conservada en staging; no se crea CatalogItem (${d.disposition}${d.canonicalLegacyIds.length ? ' → ' + d.canonicalLegacyIds.join(', ') : ''}; ${d.decisionId}).`,
        }),
      );
    console.log(
      `${rec.created ? '+' : '='} ${d.itemLegacyId} ${d.disposition} (${own.length} candidates rejected)`,
    );
  }
  // 5 · canonical rows: resolutions
  const cs = await candidatesOf(CANONICAL_IDS);
  for (const c of cs) {
    if (c.reviewStatus === 'APPROVED' || c.reviewStatus === 'PUBLISHED') continue;
    const legacy = ownerLegacyOf(c)! as keyof typeof CANONICAL;
    const set: Record<string, unknown> = {};
    const p = c.proposal;
    if (p.kind === 'CATALOG_ITEM') {
      set.decorationPolicy = 'NONE';
      set.target = { mode: 'CREATE' };
      const name = (CANONICAL[legacy] as { canonicalName?: string }).canonicalName;
      if (name) set.canonicalName = name;
    } else if (p.kind === 'OPTION') {
      // Menús · "acabado: Laminado" — an optional commercial finish (decisions 13/14); nothing else is invented.
      set.definition = {
        mode: 'CREATE',
        key: 'acabado',
        label: 'Acabado',
        valueKind: 'ENUM',
        unit: null,
        scope: 'ITEM',
      };
      set.isRequired = false;
      set.selectionMode = 'SINGLE';
      set.isDistributable = false;
      set.values = Object.fromEntries(
        p.values.map((v) => [
          v.recordKey,
          { mode: 'CREATE', code: 'laminado', label: v.label, spec: null },
        ]),
      );
    } else if (p.kind === 'PRESENTATION') {
      set.locale = 'es';
      set.isDefault = true;
    } else if (p.kind === 'DECORATION') {
      must(
        'reject',
        await rejectHandler(tx, PREPARER, {
          candidateId: c.id,
          reason:
            'OD-04 / spec 136: la impresión es proceso interno (DTG decide), no una decoración elegible; el item queda con decorationPolicy NONE.',
        }),
      );
      console.log(`- rejected decoration ${c.id.slice(0, 8)} (${legacy})`);
      continue;
    } else throw new Error(`unexpected ${p.kind} candidate on ${legacy}`);
    const r = await saveDraftHandler(tx, PREPARER, {
      candidateId: c.id,
      set,
      reason: `Cierre de STEP 09: resolución desde ${SPEC_REF}`,
    });
    if (!r.ok && !JSON.stringify(r).includes('NOTHING_CHANGED')) throw new Error(JSON.stringify(r));
  }
  // 6 · approve what has nothing left open
  const ctx = buildContext((await qualityReport(pool, new Date(), { dataClass: 'REAL' })).input);
  for (const c of await candidatesOf(CANONICAL_IDS)) {
    if (c.reviewStatus === 'APPROVED' || c.reviewStatus === 'PUBLISHED') continue;
    const open = ctx.openFields(c);
    if (open.length) {
      console.log(
        `· ${ownerLegacyOf(c)} ${c.kind} ${c.id.slice(0, 8)} still open: ${open.join(',')}`,
      );
      continue;
    }
    const r = await approveHandler(tx, PREPARER, {
      candidateId: c.id,
      reason: `Cierre de STEP 09: resuelto con ${SPEC_REF}`,
    });
    console.log(
      r.ok
        ? `+ approved ${ownerLegacyOf(c)} ${c.kind}`
        : `· approve ${c.id.slice(0, 8)}: ${JSON.stringify(r)}`,
    );
  }
}

// ---------------------------------------------------------------- gate / dry-run / permit / publish
async function gate() {
  const { gate } = await currentMigrationGate(pool, STEP09_DEFAULT_MARKETS);
  for (const i of gate.items)
    console.log(
      `${i.verdict.padEnd(10)} ${i.legacyId.padEnd(14)} ${i.name} ${i.reasons.length ? '← ' + i.reasons.join(' · ') : ''}`,
    );
  console.log(
    `scoped=${gate.scoped} publishable=${gate.publishable} (published=${gate.published}) resolved=${gate.resolved} blocked=${gate.blocked}`,
  );
}

const COMPLETION = process.argv.includes('--completion');
const permitInput = COMPLETION
  ? {
      ...COMMERCIAL_PRINT_PERMIT,
      decisionIds: COMPLETION_PERMIT_DECISIONS,
      markets: [...STEP09_DEFAULT_MARKETS],
      reason:
        'OD-07 + Owner spec v1.0: Martín autoriza ampliar la publicación REAL de Commercial Print (mercado USA) a los productos canónicos resueltos. CANDIDATE se migra internamente sin publicarse; alias/configuraciones/estilos/legacy no se publican.',
    }
  : {
      ...COMMERCIAL_PRINT_PERMIT,
      markets: [...STEP09_DEFAULT_MARKETS],
      reason:
        'OD-07: Martín autoriza la primera publicación REAL de Commercial Print (mercado USA). Sólo los items que pasan su compuerta; el resto sigue bloqueado en staging.',
    };

async function inTx<T>(actor: Actor, ctxName: string, fn: (db: PoolClient) => Promise<T>) {
  return tx(actor.name, ctxName, fn);
}

export async function dryRun() {
  return inTx(OWNER, 'step09:dry-run', (db) => simulateMigration(db, permitInput, OWNER.name));
}

async function main() {
  const cmd = process.argv[2];
  if (cmd === 'decisions') await decisions();
  else if (cmd === 'completion') await completion();
  else if (cmd === 'gate') await gate();
  else if (cmd === 'dry-run') console.log(JSON.stringify(await dryRun(), null, 1));
  else if (cmd === 'permit') {
    const r = await inTx(OWNER, 'step09:permit', (db) =>
      createMigrationPermit(db, permitInput, OWNER.name),
    );
    console.log(
      JSON.stringify(
        r.ok ? { created: r.created, id: r.permit.id, included: r.permit.included.length } : r,
      ),
    );
  } else if (cmd === 'publish') {
    const p = await activePermit(pool, SCOPE_KEY);
    if (!p) throw new Error('no active permit');
    const r = await inTx(OWNER, 'step09:publish', (db) => publishUnderPermit(db, p.id, OWNER.name));
    console.log(JSON.stringify(r, null, 1));
  } else throw new Error(`unknown command ${cmd}`);
  void setActorContext;
}
if (process.argv[1]?.endsWith('step09-migrate.ts')) main().finally(() => pool.end());
