import { describe, expect, it } from 'vitest';
import { authorize, can, normalizeActorName, type Actor } from '@/admin/permissions';
import type { Proposal } from '@/import/proposal';
import { parseDraftResolution, parseResolution } from '@/import/resolution';
import { planBulk, type BulkCandidate } from '@/review/bulk';
import { applyDraftPatch, FIELD_DEFS, fieldViews, openFields } from '@/review/fields';
import { explainIssue } from '@/review/labels';

const item = (over: Partial<Proposal & { kind: 'CATALOG_ITEM' }> = {}): Proposal => ({
  kind: 'CATALOG_ITEM',
  legacyId: 'MIG1-O-001',
  legacySku: null,
  name: 'Lona impresa',
  itemType: 'PRODUCT',
  itemTypeEvidence: 'PRODUCT',
  status: null,
  saleUnit: 'SQ_FT',
  customerSuppliedEvidence: null,
  categoryLegacy: 'Impresos en Papel',
  familyEvidence: null,
  notesEvidence: null,
  fixedAttributes: [],
  ...over,
});

const option: Proposal = {
  kind: 'OPTION',
  optionLegacyId: 'MIG1-OP-001',
  itemLegacyId: 'MIG1-O-008',
  name: 'caras',
  captureType: 'Lista',
  required: null,
  values: [],
};

describe('review fields', () => {
  it('never turns unknown into a value: unresolved fields stay unresolved', () => {
    const views = fieldViews(item(), null);
    const byField = Object.fromEntries(views.map((v) => [v.field, v]));
    expect(byField.status).toMatchObject({ state: 'UNRESOLVED', value: undefined });
    expect(byField.decorationPolicy).toMatchObject({ state: 'UNRESOLVED', value: undefined });
    expect(byField.itemType).toMatchObject({ state: 'SOURCE', value: 'PRODUCT' });
    expect(byField.categoryKey).toMatchObject({ state: 'NOT_SET' });
    expect(byField.categoryKey!.evidence).toContain('Impresos en Papel');
    expect(byField.customerSuppliedItem).toBeUndefined(); // PRODUCT: not applicable
    const req = fieldViews(option, null).find((v) => v.field === 'isRequired')!;
    expect(req).toMatchObject({ state: 'UNRESOLVED', value: undefined });
  });

  it('customer supplied appears only for SERVICE and uses the domain vocabulary', () => {
    const service = item({
      itemType: null,
      itemTypeEvidence: null,
      customerSuppliedEvidence: true,
    });
    expect(fieldViews(service, null).some((v) => v.field === 'customerSuppliedItem')).toBe(false);
    const decided = fieldViews(service, { itemType: 'SERVICE' });
    const cs = decided.find((v) => v.field === 'customerSuppliedItem')!;
    expect(cs.state).toBe('UNRESOLVED');
    expect(cs.control).toMatchObject({ type: 'enum' });
    if (cs.control.type === 'enum')
      expect(cs.control.options.map((o) => o.value)).toEqual([
        'NOT_APPLICABLE',
        'ALLOWED',
        'REQUIRED',
      ]);
    expect(cs.evidence).toContain('Sí');
    expect(openFields(service, { itemType: 'SERVICE' })).toContain('customerSuppliedItem');
  });

  it('draft patches report field-level changes and ignore no-ops', () => {
    const a = applyDraftPatch(null, { set: { status: 'ACTIVE' } });
    expect(a.changes).toEqual([
      { field: 'status', action: 'SET', oldValue: undefined, newValue: 'ACTIVE' },
    ]);
    const b = applyDraftPatch(a.draft, { set: { status: 'ACTIVE', saleUnit: null } });
    expect(b.changes).toEqual([
      { field: 'saleUnit', action: 'SET', oldValue: undefined, newValue: null },
    ]);
    const cl = applyDraftPatch(b.draft, { clear: ['status', 'decorationPolicy'] });
    expect(cl.changes).toEqual([
      { field: 'status', action: 'CLEAR', oldValue: 'ACTIVE', newValue: undefined },
    ]);
    expect(cl.draft).toEqual({ saleUnit: null });
  });

  it('draft resolutions are partial but every field keeps its real schema', () => {
    expect(parseDraftResolution('OPTION', { isRequired: false }).ok).toBe(true);
    expect(parseResolution('OPTION', { isRequired: false }).ok).toBe(false); // approval needs all
    expect(parseDraftResolution('CATALOG_ITEM', { status: 'LIVE' }).ok).toBe(false);
    expect(parseDraftResolution('CATALOG_ITEM', { categoryKey: 'playeras_textiles' }).ok).toBe(
      true,
    );
    expect(parseDraftResolution('CATALOG_ITEM', { unknown: 1 }).ok).toBe(false);
  });

  it('every bulk field is a real resolution field of its kind', () => {
    for (const [kind, defs] of Object.entries(FIELD_DEFS)) {
      for (const d of defs.filter((x) => x.bulk && x.control.type === 'enum')) {
        const value = d.control.type === 'enum' ? d.control.options[0]!.value : null;
        expect(
          parseDraftResolution(kind as never, { [d.field]: value }).ok,
          `${kind}.${d.field}`,
        ).toBe(true);
      }
    }
  });
});

describe('bulk planning', () => {
  const cand = (id: string, over: Partial<BulkCandidate> = {}): BulkCandidate => ({
    id,
    kind: 'CATALOG_ITEM',
    reviewStatus: 'WARNING',
    proposal: item(),
    draft: null,
    ...over,
  });

  it('classifies unresolved / same / different and never counts different as affected without overwrite', () => {
    const r = planBulk(
      [
        cand('a'),
        cand('b', { draft: { decorationPolicy: 'OPTIONAL' } }),
        cand('c', { draft: { decorationPolicy: 'NONE' } }),
      ],
      'CATALOG_ITEM',
      { decorationPolicy: 'NONE' },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.counts).toMatchObject({
      selected: 3,
      affected: 1,
      unresolved: 1,
      same: 1,
      different: 1,
    });
    expect(r.plan.counts.skipped).toEqual({ DIFFERENT_NOT_CONFIRMED: 1 });
    const confirmed = planBulk(
      [
        cand('a'),
        cand('b', { draft: { decorationPolicy: 'OPTIONAL' } }),
        cand('c', { draft: { decorationPolicy: 'NONE' } }),
      ],
      'CATALOG_ITEM',
      { decorationPolicy: 'NONE' },
      { overwrite: true },
    );
    expect(confirmed.ok && confirmed.plan.counts.affected).toBe(2);
    // Same hash with or without overwrite: it describes what the person saw.
    expect(confirmed.ok && confirmed.plan.planSha256).toBe(r.plan.planSha256);
  });

  it('a source value that differs counts as different (explicit source data is not silently overridden)', () => {
    const r = planBulk([cand('a', { proposal: item({ status: 'ACTIVE' }) })], 'CATALOG_ITEM', {
      status: 'CANDIDATE',
    });
    expect(r.ok && r.plan.entries[0]).toMatchObject({
      classification: 'DIFFERENT',
      currentOrigin: 'SOURCE',
      current: 'ACTIVE',
    });
  });

  it('skips blocked, approved, terminal, pending and other kinds; rejects non-bulk fields', () => {
    const r = planBulk(
      [
        cand('b', { reviewStatus: 'BLOCKED' }),
        cand('ap', { reviewStatus: 'APPROVED' }),
        cand('p', { reviewStatus: 'PUBLISHED' }),
        cand('pe', { reviewStatus: 'PENDING' }),
        cand('o', { kind: 'OPTION', proposal: option }),
        cand('ok'),
      ],
      'CATALOG_ITEM',
      { status: 'ACTIVE' },
    );
    expect(r.ok && r.plan.counts.skipped).toEqual({
      BLOCKED: 1,
      APPROVED_LOCKED: 1,
      TERMINAL: 1,
      NOT_VALIDATED: 1,
      OTHER_KIND: 1,
    });
    expect(planBulk([cand('a')], 'CATALOG_ITEM', { canonicalName: 'x' }).ok).toBe(false);
    expect(planBulk([cand('a')], 'CATALOG_ITEM', { target: { mode: 'CREATE' } }).ok).toBe(false);
    expect(planBulk([cand('a')], 'CATALOG_ITEM', {}).ok).toBe(false);
    const cs = planBulk([cand('a')], 'CATALOG_ITEM', { customerSuppliedItem: 'ALLOWED' });
    expect(cs.ok && cs.plan.counts.skipped).toEqual({ FIELD_NOT_APPLICABLE: 1 });
  });
});

describe('labels and permissions', () => {
  it('explains technical codes and points to the field they concern', () => {
    expect(explainIssue('IMPORT_UNKNOWN_STATUS', 'x', null).field).toBe('status');
    expect(
      explainIssue(
        'IMPORT_DOMAIN_MAPPING_QUESTION',
        'Business meaning requires a domain decision: Sale unit unknown/unmapped',
        null,
      ).field,
    ).toBe('saleUnit');
    expect(explainIssue('SOMETHING_NEW', 'raw message', null).explanation).toBe('raw message');
  });

  it('the local actor may review and edit, but nobody may authorize prices', () => {
    const actor: Actor = { name: 'martin', source: 'cookie', role: 'local_dev' };
    expect(can(actor, 'review.resolve')).toBe(true);
    expect(can(actor, 'review.bulk')).toBe(true);
    expect(authorize(actor, 'price.authorize')?.code).toBe('FORBIDDEN');
    expect(authorize(null, 'review.resolve')?.code).toBe('ACTOR_REQUIRED');
    expect(normalizeActorName('  Martín  ')).toBe('Martín');
    expect(normalizeActorName('')).toBeNull();
    expect(normalizeActorName('x'.repeat(61))).toBeNull();
  });
});
