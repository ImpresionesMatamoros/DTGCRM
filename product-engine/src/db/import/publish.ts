import type { CompositionLine } from '@/domain/composition';
import type { OptionValueKind } from '@/domain/options';
import {
  adaptCandidate,
  type AdapterContext,
  type AdapterError,
  type AdapterPlan,
  type DomainOp,
  type EntityRef,
  type ExistingPriceDefinition,
  type HistoricalEvidenceRef,
  type OptionLinkRef,
  type SourceRecordRef,
} from '@/import/adapter';
import { stableKey } from '@/import/keys';
import { OptionProposalSchema, ProposalSchema, type Proposal } from '@/import/proposal';
import { formatAmount, type CurrencyCode } from '@/shared/money';
import type { Queryable } from '../client';
import { approvalHash } from './review';

/**
 * Controlled publication of ONE approved candidate. No batch publication and
 * no automatic approval exist. In STEP 05B only FIXTURE (DEV/TEST) batches may
 * write to the domain; REAL batches can be validated and dry-run adapted only.
 */
export const PUBLICATION_ENABLED_FOR: readonly ('REAL' | 'FIXTURE')[] = ['FIXTURE'];

export interface PublishLink {
  role: string;
  entityType: string;
  entityId: string;
  linkKind: 'CREATED' | 'LINKED_EXISTING';
}

export type PublishError =
  | AdapterError
  | {
      code:
        | 'CANDIDATE_NOT_FOUND'
        | 'NOT_APPROVED'
        | 'APPROVAL_STALE'
        | 'PUBLISHER_REQUIRED'
        | 'DB_REJECTED';
      message: string;
    };

export type PublishResult =
  | {
      ok: true;
      candidateId: string;
      links: PublishLink[];
      notes: string[];
      publicCode: string | null;
    }
  | { ok: false; errors: PublishError[] };

interface CandidateRow {
  id: string;
  batch_id: string;
  kind: Proposal['kind'];
  proposal: unknown;
  payload_sha256: string;
  review_status: string;
  resolution: Record<string, unknown> | null;
  blocking_reasons: string[];
  approval_sha256: string | null;
  source_sha256: string;
  source_file: string;
  data_class: 'REAL' | 'FIXTURE';
}

async function loadCandidate(
  db: Queryable,
  candidateId: string,
  lock: boolean,
): Promise<CandidateRow | undefined> {
  return (
    await db.query(
      `select c.id, c.batch_id, c.kind, c.proposal, c.payload_sha256, c.review_status, c.resolution,
              c.blocking_reasons, c.approval_sha256, b.source_sha256, b.source_file, b.data_class
         from import_candidate c join import_batch b on b.id = c.batch_id
        where c.id = $1 ${lock ? 'for update of c' : ''}`,
      [candidateId],
    )
  ).rows[0] as CandidateRow | undefined;
}

/** Runs the adapter without writing (review screens, dry runs). */
export async function previewCandidate(
  db: Queryable,
  candidateId: string,
  resolution?: Record<string, unknown> | null,
): Promise<{ ok: true; plan: AdapterPlan } | { ok: false; errors: PublishError[] }> {
  const c = await loadCandidate(db, candidateId, false);
  if (!c)
    return {
      ok: false,
      errors: [{ code: 'CANDIDATE_NOT_FOUND', message: `candidate ${candidateId} not found` }],
    };
  const ctx = await buildAdapterContext(db, c, 'DRY_RUN');
  return adaptCandidate(ProposalSchema.parse(c.proposal), resolution ?? c.resolution, ctx);
}

export async function publishCandidate(
  db: Queryable,
  candidateId: string,
  input: { publisher: string; permitId?: string },
): Promise<PublishResult> {
  if (!input.publisher?.trim()) {
    return {
      ok: false,
      errors: [{ code: 'PUBLISHER_REQUIRED', message: 'publisher is required' }],
    };
  }
  const c = await loadCandidate(db, candidateId, true);
  if (!c)
    return {
      ok: false,
      errors: [{ code: 'CANDIDATE_NOT_FOUND', message: `candidate ${candidateId} not found` }],
    };
  if (c.review_status !== 'APPROVED' || c.resolution === null || c.approval_sha256 === null) {
    return {
      ok: false,
      errors: [
        {
          code: 'NOT_APPROVED',
          message: `candidate is ${c.review_status}; publication requires APPROVED`,
        },
      ],
    };
  }
  const expected = approvalHash({
    sourceSha256: c.source_sha256,
    payloadSha256: c.payload_sha256,
    kind: c.kind,
    resolution: c.resolution,
  });
  if (expected !== c.approval_sha256) {
    return {
      ok: false,
      errors: [
        { code: 'APPROVAL_STALE', message: 'approval does not match the current proposal/source' },
      ],
    };
  }
  const proposal = ProposalSchema.parse(c.proposal);
  const ctx = await buildAdapterContext(db, c, 'PUBLISH');
  if (input.permitId) {
    // STEP 09: the platform barrier stays closed; one ACTIVE permit that names THIS candidate opens it for THIS candidate only.
    const ok = await permitCoversCandidate(db, input.permitId, c.id);
    if (!ok)
      return {
        ok: false,
        errors: [
          {
            code: 'DB_REJECTED',
            message: `candidate ${c.id} is not included in an active migration permit`,
          },
        ],
      };
    ctx.publicationEnabledFor = [...PUBLICATION_ENABLED_FOR, c.data_class];
  }
  const adapted = adaptCandidate(proposal, c.resolution, ctx);
  if (!adapted.ok) {
    await recordAdapterIssues(db, c, adapted.errors);
    return adapted;
  }
  await db.query('savepoint publish_candidate');
  try {
    const { links, publicCode } = await execute(db, c.id, adapted.plan.ops);
    await db.query(
      `update import_candidate set review_status = 'PUBLISHED', published_by = $2, published_at = clock_timestamp() where id = $1`,
      [c.id, input.publisher.trim()],
    );
    await db.query('release savepoint publish_candidate');
    return { ok: true, candidateId: c.id, links, notes: adapted.plan.notes, publicCode };
  } catch (e) {
    await db.query('rollback to savepoint publish_candidate');
    const error: PublishError = {
      code: 'DB_REJECTED',
      message: e instanceof Error ? e.message : String(e),
    };
    return { ok: false, errors: [error] };
  }
}

export async function permitCoversCandidate(
  db: Queryable,
  permitId: string,
  candidateId: string,
): Promise<boolean> {
  const r = await db.query(
    `select 1 from migration_permit p
       join migration_permit_item i on i.permit_id = p.id and i.candidate_id = $2
      where p.id = $1 and p.status = 'ACTIVE'
        and not exists (select 1 from migration_permit n where n.supersedes_id = p.id)`,
    [permitId, candidateId],
  );
  return r.rows.length === 1;
}

async function recordAdapterIssues(
  db: Queryable,
  c: CandidateRow,
  errors: readonly AdapterError[],
) {
  for (const e of errors) {
    await db.query(
      `insert into import_issue (batch_id, issue_key, code, severity, origin, message, candidate_id, detail)
       values ($1, $2, $3, 'ERROR', 'ADAPTER', $4, $5, $6)
       on conflict (batch_id, issue_key) do nothing`,
      [
        c.batch_id,
        stableKey('ADAPTER', c.id, e.code, e.field ?? null, e.message),
        e.code,
        e.message,
        c.id,
        JSON.stringify({ field: e.field ?? null, ...(e.detail ?? {}) }),
      ],
    );
  }
}

// ---------------------------------------------------------------- context

type Row = Record<string, unknown>;
const q = async (db: Queryable, sql: string, params: unknown[] = []) =>
  (await db.query(sql, params)).rows as Row[];

export async function buildAdapterContext(
  db: Queryable,
  c: Pick<CandidateRow, 'id' | 'batch_id' | 'source_file' | 'data_class' | 'blocking_reasons'>,
  mode: 'DRY_RUN' | 'PUBLISH',
): Promise<AdapterContext> {
  const sourceRecords: SourceRecordRef[] = (
    await q(
      db,
      `select r.id, r.record_key, r.record_type, r.legacy_id, cs.role,
              r.source_cells -> 0 ->> 'source_sheet' as sheet,
              r.source_cells -> 0 ->> 'source_cell' as first_cell,
              r.source_cells -> (jsonb_array_length(r.source_cells) - 1) ->> 'source_cell' as last_cell,
              r.source_cells -> 0 ->> 'workbook_sha256' as sha
         from import_candidate_source cs join import_record r on r.id = cs.record_id
        where cs.candidate_id = $1 order by cs.ordinal`,
      [c.id],
    )
  ).map((r) => ({
    recordId: r.id as string,
    recordKey: r.record_key as string,
    recordType: r.record_type as string,
    legacyId: (r.legacy_id as string | null) ?? null,
    role: r.role as string,
    sheet: r.sheet as string,
    firstCell: r.first_cell as string,
    lastCell: r.last_cell as string,
    workbookSha256: r.sha as string,
  }));

  const itemsByLegacy: Record<string, string[]> = {};
  for (const r of await q(
    db,
    `select source_locator, entity_id from source_reference
      where source_kind = 'LEGACY_ID' and entity_type = 'catalog_item' order by entity_id`,
  )) {
    (itemsByLegacy[r.source_locator as string] ??= []).push(r.entity_id as string);
  }
  const items: AdapterContext['items'] = Object.fromEntries(
    (await q(db, 'select id, kind, status, sale_unit, decoration_policy from catalog_item')).map(
      (r) => [
        r.id as string,
        {
          id: r.id as string,
          kind: r.kind as 'PRODUCT' | 'SERVICE',
          status: (r.status as never) ?? null,
          saleUnit: (r.sale_unit as never) ?? null,
          decorationPolicy: r.decoration_policy as never,
        },
      ],
    ),
  );

  const fixedAttributeOptionsByItemLegacy: Record<string, string[]> = {};
  for (const r of await q(
    db,
    `select proposal from import_candidate where batch_id = $1 and kind = 'CATALOG_ITEM'`,
    [c.batch_id],
  )) {
    const p = r.proposal as {
      legacyId: string;
      fixedAttributes: { optionLegacyId: string | null }[];
    };
    fixedAttributeOptionsByItemLegacy[p.legacyId] = p.fixedAttributes.flatMap((a) =>
      a.optionLegacyId ? [a.optionLegacyId] : [],
    );
  }

  const historicalByItemLegacy: Record<string, HistoricalEvidenceRef[]> = {};
  for (const r of await q(
    db,
    `select id, record_key, evidence from import_record
      where batch_id = $1 and evidence_class = 'HISTORICAL_PRICE' order by record_key`,
    [c.batch_id],
  )) {
    const e = r.evidence as {
      item_legacy: unknown;
      price_legacy: unknown;
      money: { amount: string | null; currency: string | null };
      conditions: Record<string, unknown>[];
    };
    (historicalByItemLegacy[String(e.item_legacy)] ??= []).push({
      recordId: r.id as string,
      recordKey: r.record_key as string,
      priceLegacyId: String(e.price_legacy),
      amount: e.money.amount,
      currency: e.money.currency,
      conditions: e.conditions,
    });
  }

  const existingSourceLocators: Record<string, string[]> = {};
  for (const r of await q(db, 'select entity_id, source_locator from source_reference')) {
    (existingSourceLocators[r.entity_id as string] ??= []).push(r.source_locator as string);
  }

  const optionDefinitions: AdapterContext['optionDefinitions'] = Object.fromEntries(
    (await q(db, 'select id, key, value_kind, unit from option_definition')).map((r) => [
      r.key as string,
      {
        id: r.id as string,
        key: r.key as string,
        valueKind: r.value_kind as OptionValueKind,
        unit: (r.unit as string | null) ?? null,
      },
    ]),
  );
  const optionValues: Record<string, Record<string, string>> = {};
  for (const r of await q(
    db,
    'select d.key, v.code, v.id from option_value v join option_definition d on d.id = v.option_definition_id',
  )) {
    (optionValues[r.key as string] ??= {})[r.code as string] = r.id as string;
  }
  const itemOptions: Record<
    string,
    {
      isRequired: boolean;
      selectionMode: 'SINGLE' | 'MULTI';
      isDistributable: boolean;
      valueIds: string[];
    }
  > = {};
  for (const r of await q(
    db,
    `select io.item_id, io.option_definition_id, io.is_required, io.selection_mode, io.is_distributable,
            coalesce(array_agg(iov.option_value_id) filter (where iov.option_value_id is not null), '{}') as value_ids
       from item_option io
       left join item_option_value iov on iov.item_id = io.item_id and iov.option_definition_id = io.option_definition_id
      group by 1, 2, 3, 4, 5`,
  )) {
    itemOptions[`${r.item_id}:${r.option_definition_id}`] = {
      isRequired: r.is_required as boolean,
      selectionMode: r.selection_mode as 'SINGLE' | 'MULTI',
      isDistributable: r.is_distributable as boolean,
      valueIds: r.value_ids as string[],
    };
  }
  const decorationMethods = Object.fromEntries(
    (await q(db, 'select key, id from decoration_method')).map((r) => [
      r.key as string,
      r.id as string,
    ]),
  );
  const capabilities = (await q(db, 'select item_id, method_id from decoration_capability')).map(
    (r) => `${r.item_id}:${r.method_id}`,
  );

  const optionLinks: Record<string, OptionLinkRef> = {};
  const published = await q(
    db,
    `select distinct on (c.lineage_key) c.id, c.proposal
       from import_candidate c
      where c.kind = 'OPTION' and c.review_status = 'PUBLISHED'
      order by c.lineage_key, c.published_at desc`,
  );
  for (const p of published) {
    const proposal = OptionProposalSchema.parse(p.proposal);
    const links = await q(
      db,
      'select role, entity_id, detail from import_candidate_link where candidate_id = $1',
      [p.id],
    );
    const def = links.find((l) => l.role === 'item_option');
    if (!def) continue;
    const valueIdByRecordKey: Record<string, string> = {};
    for (const l of links.filter((x) => x.role === 'option_value')) {
      valueIdByRecordKey[(l.detail as { recordKey: string }).recordKey] = l.entity_id as string;
    }
    optionLinks[proposal.optionLegacyId] = {
      itemId: (def.detail as { itemId: string }).itemId,
      definitionId: def.entity_id as string,
      valueIdByRecordKey,
      labelByRecordKey: Object.fromEntries(
        proposal.values
          .filter((v) => valueIdByRecordKey[v.recordKey])
          .map((v) => [v.recordKey, v.label]),
      ),
    };
  }

  const compositionLines: CompositionLine[] = (
    await q(
      db,
      'select id, parent_item_id, child_item_id, quantity, role, sort, note from composition_line',
    )
  ).map((r) => ({
    id: r.id as string,
    parentItemId: r.parent_item_id as string,
    childItemId: r.child_item_id as string,
    quantity: Number(r.quantity),
    role: r.role as 'INCLUDED' | 'OPTIONAL',
    sort: Number(r.sort),
    note: (r.note as string | null) ?? null,
  }));

  const priceBooks = Object.fromEntries(
    (
      await q(
        db,
        'select m.code, pb.id, pb.currency from price_book pb join market m on m.id = pb.market_id',
      )
    ).map((r) => [r.code as string, { id: r.id as string, currency: r.currency as CurrencyCode }]),
  ) as AdapterContext['priceBooks'];

  const priceDefinitionsByItem: Record<string, ExistingPriceDefinition[]> = {};
  for (const r of await q(
    db,
    `select d.id, d.item_id, d.price_book_id, d.component, d.model, d.status, d.amount, d.max_quantity,
            coalesce((select jsonb_agg(jsonb_build_object('quantity', b.quantity, 'amount', b.amount::text,
                        'amountBasis', b.amount_basis) order by b.quantity)
                        from price_break b where b.price_definition_id = d.id), '[]') as breaks,
            coalesce((select array_agg(pc.option_definition_id || '=' || pc.option_value_id order by 1)
                        from price_condition pc where pc.price_definition_id = d.id and pc.kind = 'OPTION_VALUE'), '{}') as signature
       from price_definition d`,
  )) {
    (priceDefinitionsByItem[r.item_id as string] ??= []).push({
      id: r.id as string,
      itemId: r.item_id as string,
      priceBookId: r.price_book_id as string,
      component: r.component as 'ITEM' | 'DECORATION',
      model: r.model as string,
      status: r.status as string,
      amount: (r.amount as string | null) ?? null,
      maxQuantity: r.max_quantity === null ? null : Number(r.max_quantity),
      breaks: (
        r.breaks as { quantity: number; amount: string; amountBasis: 'TOTAL' | 'UNIT' }[]
      ).map((x) => ({
        ...x,
        amount: Number(x.amount).toFixed(2),
      })),
      conditionSignature: [...(r.signature as string[])].sort(),
    });
  }

  const presentationsByItem: Record<
    string,
    { id: string; locale: string; displayName: string; isDefault: boolean }[]
  > = {};
  for (const r of await q(
    db,
    'select id, item_id, locale, display_name, is_default from presentation',
  )) {
    (presentationsByItem[r.item_id as string] ??= []).push({
      id: r.id as string,
      locale: r.locale as string,
      displayName: r.display_name as string,
      isDefault: r.is_default as boolean,
    });
  }

  const categories = Object.fromEntries(
    (await q(db, 'select id, key, is_active from category')).map((r) => [
      r.key as string,
      { id: r.id as string, isActive: r.is_active as boolean },
    ]),
  );
  const primaryCategoryByItem = Object.fromEntries(
    (await q(db, 'select item_id, category_id from catalog_item_category where is_primary')).map(
      (r) => [r.item_id as string, r.category_id as string],
    ),
  );

  return {
    mode,
    dataClass: c.data_class,
    publicationEnabledFor: PUBLICATION_ENABLED_FOR,
    batchId: c.batch_id,
    candidateId: c.id,
    sourceFile: c.source_file,
    blockingReasons: c.blocking_reasons,
    sourceRecords,
    itemsByLegacy,
    items,
    fixedAttributeOptionsByItemLegacy,
    historicalByItemLegacy,
    existingSourceLocators,
    optionDefinitions,
    optionValues,
    itemOptions,
    decorationMethods,
    capabilities,
    optionLinks,
    compositionLines,
    priceBooks,
    priceDefinitionsByItem,
    presentationsByItem,
    categories,
    primaryCategoryByItem,
  };
}

// ---------------------------------------------------------------- executor

async function execute(db: Queryable, candidateId: string, ops: readonly DomainOp[]) {
  const refs = new Map<string, string>();
  const id = (e: EntityRef): string => {
    if ('id' in e) return e.id;
    const v = refs.get(e.ref);
    if (!v) throw new Error(`unresolved reference ${e.ref}`);
    return v;
  };
  const one = async (sql: string, params: unknown[]) =>
    (await db.query(sql, params)).rows[0] as Row;
  const links: PublishLink[] = [];
  let publicCode: string | null = null;

  for (const op of ops) {
    switch (op.op) {
      case 'CREATE_CATALOG_ITEM': {
        const v = op.values;
        const r = await one(
          `insert into catalog_item (kind, canonical_name, status, sale_unit, decoration_policy, customer_supplied_item)
           values ($1, $2, $3, $4, $5, $6) returning id, public_code`,
          [
            v.kind,
            v.canonicalName,
            v.status,
            v.saleUnit,
            v.decorationPolicy,
            v.customerSuppliedItem,
          ],
        );
        refs.set(op.ref, r.id as string);
        publicCode = r.public_code as string;
        break;
      }
      case 'CREATE_OPTION_DEFINITION': {
        const v = op.values;
        const r = await one(
          'insert into option_definition (key, label, value_kind, unit, scope) values ($1, $2, $3, $4, $5) returning id',
          [v.key, v.label, v.valueKind, v.unit, v.scope],
        );
        refs.set(op.ref, r.id as string);
        break;
      }
      case 'CREATE_OPTION_VALUE': {
        const v = op.values;
        const r = await one(
          'insert into option_value (option_definition_id, code, label, spec, sort) values ($1, $2, $3, $4, $5) returning id',
          [
            id(op.definition),
            v.code,
            v.label,
            v.spec === null ? null : JSON.stringify(v.spec),
            v.sort,
          ],
        );
        refs.set(op.ref, r.id as string);
        break;
      }
      case 'CREATE_ITEM_OPTION':
        await db.query(
          `insert into item_option (item_id, option_definition_id, is_required, selection_mode, is_distributable, sort)
           values ($1, $2, $3, $4, $5, $6)`,
          [
            op.itemId,
            id(op.definition),
            op.values.isRequired,
            op.values.selectionMode,
            op.values.isDistributable,
            op.values.sort,
          ],
        );
        break;
      case 'CREATE_ITEM_OPTION_VALUE':
        await db.query(
          'insert into item_option_value (item_id, option_definition_id, option_value_id, sort) values ($1, $2, $3, $4)',
          [op.itemId, id(op.definition), id(op.value), op.sort],
        );
        break;
      case 'ASSIGN_CATEGORY':
        await db.query(
          'insert into catalog_item_category (item_id, category_id, is_primary) values ($1, $2, true)',
          [id(op.item), op.categoryId],
        );
        break;
      case 'CREATE_DECORATION_CAPABILITY':
        await db.query('insert into decoration_capability (item_id, method_id) values ($1, $2)', [
          op.itemId,
          op.methodId,
        ]);
        break;
      case 'SET_DECORATION_POLICY': {
        const res = await db.query(
          'update catalog_item set decoration_policy = $3 where id = $1 and decoration_policy = $2',
          [op.itemId, op.from, op.to],
        );
        if (res.rowCount !== 1)
          throw new Error(`decoration policy of ${op.itemId} changed concurrently`);
        break;
      }
      case 'CREATE_COMPOSITION_LINE': {
        const v = op.values;
        const r = await one(
          'insert into composition_line (parent_item_id, child_item_id, quantity, role) values ($1, $2, $3, $4) returning id',
          [v.parentItemId, v.childItemId, v.quantity, v.role],
        );
        refs.set(op.ref, r.id as string);
        break;
      }
      case 'CREATE_PRICE_DEFINITION': {
        const v = op.values;
        const r = await one(
          `insert into price_definition (item_id, price_book_id, component, model, amount, max_quantity, status, valid_from)
           values ($1, $2, $3, $4, $5, $6, 'DRAFT', $7) returning id`,
          [
            v.itemId,
            v.priceBookId,
            v.component,
            v.model,
            v.amount ? formatAmount(v.amount) : null,
            v.maxQuantity,
            v.validFrom,
          ],
        );
        const defId = r.id as string;
        refs.set(op.ref, defId);
        for (const br of op.breaks) {
          await db.query(
            'insert into price_break (price_definition_id, quantity, amount, amount_basis) values ($1, $2, $3, $4)',
            [defId, br.quantity, formatAmount(br.amount), br.amountBasis],
          );
        }
        for (const c of op.conditions) {
          await db.query(
            `insert into price_condition (price_definition_id, kind, option_definition_id, option_value_id)
             values ($1, 'OPTION_VALUE', $2, $3)`,
            [defId, c.optionDefinitionId, c.optionValueId],
          );
        }
        break;
      }
      case 'CREATE_PRESENTATION': {
        const v = op.values;
        const r = await one(
          `insert into presentation (item_id, locale, occasion, display_name, is_default, status)
           values ($1, $2, $3, $4, $5, 'DRAFT') returning id`,
          [v.itemId, v.locale, v.occasion, v.displayName, v.isDefault],
        );
        refs.set(op.ref, r.id as string);
        break;
      }
      case 'ADD_SOURCE_REFERENCE':
        await db.query(
          `insert into source_reference (entity_type, entity_id, source_kind, source_locator, payload)
           values ($1, $2, $3, $4, $5)`,
          [
            op.entityType,
            id(op.entity),
            op.sourceKind,
            op.locator,
            op.payload === null ? null : JSON.stringify(op.payload),
          ],
        );
        break;
      case 'LINK': {
        const entityId = id(op.entity);
        await db.query(
          `insert into import_candidate_link (candidate_id, role, entity_type, entity_id, link_kind, detail)
           values ($1, $2, $3, $4, $5, $6)`,
          [
            candidateId,
            op.role,
            op.entityType,
            entityId,
            op.linkKind,
            op.detail === null ? null : JSON.stringify(op.detail),
          ],
        );
        links.push({ role: op.role, entityType: op.entityType, entityId, linkKind: op.linkKind });
        break;
      }
    }
  }
  return { links, publicCode };
}
