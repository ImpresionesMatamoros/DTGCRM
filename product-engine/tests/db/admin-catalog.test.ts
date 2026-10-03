import { afterAll, describe, expect, it } from 'vitest';
import { itemId } from '../../data/dev-slice';
import { createItemHandler, updateItemHandler } from '@/admin/handlers';
import { catalogItemDetail, searchCatalog } from '@/db/admin/catalog';
import { ACTOR, must, rollbackRunner } from './admin-helpers';
import { expectDbError, pool, withRollback } from './helpers';

afterAll(() => pool.end());

describe('catalog browser', () => {
  it('searches by name, public code and LEGACY_ID, and filters unset status', async () => {
    await withRollback(async (c) => {
      const byName = await searchCatalog(c, { q: 'premium' });
      expect(byName.rows.map((r) => r.publicCode)).toEqual(['DTG-00002']);
      expect((await searchCatalog(c, { q: 'DTG-00008' })).rows[0]!.name).toBe('X-Banner completo');
      expect((await searchCatalog(c, { q: 'MIG1-O-009' })).rows.map((r) => r.publicCode)).toEqual([
        'DTG-00002',
      ]);
      const unset = await searchCatalog(c, { status: 'UNSET' });
      expect(unset.rows.map((r) => r.publicCode)).toEqual(['DTG-00016']);
      expect((await searchCatalog(c, { kind: 'SERVICE' })).total).toBe(1);
      expect((await searchCatalog(c, {}, 1, 5)).rows).toHaveLength(5);
    });
  });

  it('shows options, decoration, composition, presentations, pricing summary and provenance', async () => {
    await withRollback(async (c) => {
      const tee = (await catalogItemDetail(c, itemId('camiseta_algodon')))!;
      expect(tee.options.map((o) => o.key).sort()).toEqual(['color', 'talla']);
      expect(tee.capabilities.map((m) => m.methodKey).sort()).toEqual([
        'DTF',
        'EMBROIDERY',
        'HTV',
        'SCREEN_PRINTING',
      ]);
      expect(tee.provenance.some((p) => p.sourceKind === 'LEGACY_ID')).toBe(true);
      const xb = (await catalogItemDetail(c, itemId('xbanner_completo')))!;
      expect(xb.composition.asParent.map((l) => l.childCode).sort()).toEqual([
        'DTG-00009',
        'DTG-00010',
      ]);
      const premium = (await catalogItemDetail(c, itemId('tarjeta_premium')))!;
      expect(premium.pricing).toEqual([
        { book: 'USA_MASTER', model: 'EXACT_QUANTITY_MATRIX', status: 'AUTHORIZED', n: 2 },
      ]);
      expect(await catalogItemDetail(c, 'not-a-uuid')).toBeNull();
    });
  });
});

describe('catalog editor', () => {
  it('creates a minimal item only with explicit status and decoration policy', async () => {
    await withRollback(async (c) => {
      const tx = rollbackRunner(c);
      const missing = await createItemHandler(tx, ACTOR, { name: 'Taza', kind: 'PRODUCT' });
      expect(missing.ok).toBe(false);
      if (!missing.ok)
        expect(missing.errors.map((e) => e.field).sort()).toEqual(['decorationPolicy', 'status']);
      const service = await createItemHandler(tx, ACTOR, {
        name: 'Planchado',
        kind: 'SERVICE',
        status: 'CANDIDATE',
        decorationPolicy: 'NONE',
      });
      expect(service.ok).toBe(false);
      const created = must(
        await createItemHandler(tx, ACTOR, {
          name: 'Taza de cerámica 11 oz',
          kind: 'PRODUCT',
          status: 'CANDIDATE',
          decorationPolicy: 'OPTIONAL',
          categoryKey: 'gorras_accesorios',
        }),
      );
      expect(created.publicCode).toMatch(/^DTG-\d{5}$/);
      const found = await searchCatalog(c, { q: 'taza de cerámica' });
      expect(found.rows.map((r) => r.id)).toEqual([created.id]);
      const d = (await catalogItemDetail(c, created.id))!;
      expect(d.item).toMatchObject({
        status: 'CANDIDATE',
        decorationPolicy: 'OPTIONAL',
        saleUnit: null, // optional and left unknown, not defaulted
        customerSuppliedItem: 'NOT_APPLICABLE',
      });
      expect(d.categories).toEqual([
        { key: 'gorras_accesorios', name: 'Gorras y Accesorios', isPrimary: true },
      ]);
      expect(d.history[d.history.length - 1]).toMatchObject({
        table: 'catalog_item',
        action: 'INSERT',
        changedBy: 'martin@test',
        context: 'admin:catalog.create',
      });
    });
  });

  it('edits safe fields with audit; identity, kind and unset status are protected', async () => {
    await withRollback(async (c) => {
      const tx = rollbackRunner(c);
      const id = itemId('invitacion_evento');
      const before = (await catalogItemDetail(c, id))!;
      expect(before.item.status).toBeNull();
      must(
        await updateItemHandler(tx, ACTOR, {
          id,
          patch: {
            status: 'PLANNED',
            descriptionInternal: 'pendiente de catálogo',
            categoryKey: 'impresos_papel',
          },
        }),
      );
      const after = (await catalogItemDetail(c, id))!;
      expect(after.item).toMatchObject({
        status: 'PLANNED',
        descriptionInternal: 'pendiente de catálogo',
      });
      expect(after.item.publicCode).toBe(before.item.publicCode);
      expect(after.categories[0]).toMatchObject({ key: 'impresos_papel', isPrimary: true });
      const last = after.history.find((h) => h.table === 'catalog_item')!;
      expect(last).toMatchObject({
        action: 'UPDATE',
        changedBy: 'martin@test',
        context: 'admin:catalog.update',
      });
      expect(last.changes.map((ch) => ch.field).sort()).toEqual(['description_internal', 'status']);

      for (const patch of [
        { publicCode: 'DTG-99999' },
        { id: '00000000-0000-0000-0000-000000000000' },
        { kind: 'SERVICE' },
        { status: null }, // never back to unset
        { customerSuppliedItem: 'ALLOWED' }, // PRODUCT
      ]) {
        const r = await updateItemHandler(tx, ACTOR, { id, patch });
        expect(r.ok, JSON.stringify(patch)).toBe(false);
      }
      const tee = itemId('camiseta_algodon');
      const none = await updateItemHandler(tx, ACTOR, {
        id: tee,
        patch: { decorationPolicy: 'NONE' },
      });
      expect(none.ok).toBe(false);
      if (!none.ok) expect(none.errors[0]!.code).toBe('DECORATION_CAPABILITIES_EXIST');
      expect((await catalogItemDetail(c, id))!.item.publicCode).toBe(before.item.publicCode);
      await expectDbError(
        c,
        "update catalog_item set public_code = 'DTG-99999' where id = $1",
        [id],
        /immutable/,
      );
    });
  });
});
