import { expect, test, type Page } from '@playwright/test';

/**
 * STEP 09 completion · Owner Decisions v1.0 (flows against the real staging AFTER `step09-migrate.ts completion`
 * and the second, superseding permit were applied by the owner through the audited scripts).
 * Runs only in the completion stage of tools/step09-rebuild.sh (it needs that state): read-only except for
 * the idempotent re-publication in the last test.
 */

async function actAs(page: Page, name: string, baseURL: string | undefined) {
  await page.context().clearCookies();
  await page
    .context()
    .addCookies([{ name: 'dtg_admin_actor', value: name, url: `${baseURL}/admin` }]);
}
const metric = async (page: Page, key: string) =>
  Number(await page.locator(`[data-metric="${key}"] .v`).first().textContent());
const row = (page: Page, legacy: string) =>
  page.locator(`[data-testid=migration-table] tr[data-item="${legacy}"]`);

test.describe.serial('Commercial Print migration · owner decisions completion', () => {
  test('1 · the 21 source rows are fully resolved: 13 products, 8 non-products, 0 blocked', async ({
    page,
    baseURL,
  }) => {
    await actAs(page, 'e2e-dev', baseURL);
    await page.goto('/admin/migration');
    expect(await metric(page, 'scoped')).toBe(21);
    expect(await metric(page, 'publishable')).toBe(13);
    expect(await metric(page, 'resolved')).toBe(8);
    expect(await metric(page, 'blocked')).toBe(0);
    expect(await metric(page, 'published')).toBe(13);
    await expect(page.locator('[data-testid=migration-table] tbody tr')).toHaveCount(21);
    await expect(page.getByTestId('published-table').locator('tbody tr')).toHaveCount(13);
  });

  test('2 · aliases, configurations, styles and invalid legacy rows are RESOLVED with their canonical target, not products', async ({
    page,
    baseURL,
  }) => {
    await actAs(page, 'e2e-dev', baseURL);
    await page.goto('/admin/migration');
    await expect(row(page, 'MIGF-O-010')).toContainText('ALIAS → MIGF-O-008, MIGF-O-009');
    await expect(row(page, 'MIGF-O-011')).toContainText('CONFIGURATION');
    await expect(row(page, 'MIGF-O-012')).toContainText('CONFIGURATION → MIGF-O-009');
    await expect(row(page, 'MIGF-O-013')).toContainText('CONFIGURATION → MIGF-O-009');
    await expect(row(page, 'OWN-O-007')).toContainText('STYLE');
    await expect(row(page, 'OWN-O-008')).toContainText('STYLE');
    await expect(row(page, 'MIGF-O-014')).toContainText('LEGACY_INVALID');
    await expect(row(page, 'MIG2-O-046')).toContainText('LEGACY_INVALID');
    for (const l of [
      'MIGF-O-010',
      'MIGF-O-011',
      'MIGF-O-012',
      'MIGF-O-013',
      'MIGF-O-014',
      'OWN-O-007',
      'OWN-O-008',
      'MIG2-O-046',
    ])
      await expect(row(page, l)).toHaveAttribute('data-verdict', 'RESOLVED');
  });

  test('3 · invitations: only Sencilla and Premium are ACTIVE products; the alias is not one', async ({
    page,
    baseURL,
  }) => {
    await actAs(page, 'e2e-dev', baseURL);
    await page.goto('/admin/catalog?q=Invitaci');
    const t = page.getByTestId('catalog-table');
    await expect(t).toContainText('Invitación sencilla');
    await expect(t).toContainText('Invitación premium');
    await expect(t.locator('tbody tr', { hasText: 'ACTIVE' })).toHaveCount(2);
    for (const gone of ['con sello', 'con acrílico', 'con sobre', 'especial', 'formal', 'casual'])
      await expect(t).not.toContainText(gone);
    // DTG-00016 "Invitación para evento" is the pre-existing dev-slice item of the alias row (MIGF-O-010):
    // no status, so it is in no publication profile. This pass does not create or activate it.
    const alias = t.locator('tbody tr', { hasText: 'DTG-00016' });
    await expect(alias).toHaveCount(1);
    await expect(alias).not.toContainText('ACTIVE');
    await expect(alias).not.toContainText('CANDIDATE');
    await page.goto('/admin/catalog?q=complementarias');
    await expect(page.getByTestId('catalog-table')).not.toContainText('Tarjetas complementarias');
  });

  test('4 · Poster / Tabloide 11×17 and Poster Gran Formato are two distinct products', async ({
    page,
    baseURL,
  }) => {
    await actAs(page, 'e2e-dev', baseURL);
    await page.goto('/admin/catalog?q=Poster');
    const t = page.getByTestId('catalog-table');
    await expect(t).toContainText('Poster / Tabloide 11×17');
    await expect(t).toContainText('Poster Gran Formato');
    await expect(t.locator('tbody tr')).toHaveCount(2);
    await expect(t).not.toContainText(/banner/i);
  });

  test('5 · CANDIDATE items exist internally but are marked CANDIDATE (never ACTIVE, never public)', async ({
    page,
    baseURL,
  }) => {
    await actAs(page, 'e2e-dev', baseURL);
    for (const q of ['Seating', 'Thank-you']) {
      await page.goto(`/admin/catalog?q=${q}`);
      const t = page.getByTestId('catalog-table');
      await expect(t.locator('tbody tr')).toHaveCount(1);
      await expect(t).toContainText('CANDIDATE');
      await expect(t).not.toContainText('ACTIVE');
    }
  });

  test('6 · price simulator: new items quote (no invented price); regressions still hold', async ({
    page,
    baseURL,
  }) => {
    await actAs(page, 'e2e-dev', baseURL);
    const idOf = async (q: string, name: RegExp) => {
      await page.goto(`/admin/catalog?q=${encodeURIComponent(q)}`);
      await page.getByTestId('catalog-table').getByRole('link', { name }).first().click();
      await page.waitForURL(/\/admin\/catalog\/[0-9a-f-]{36}$/);
      return page.url().split('/').pop()!;
    };
    const quote = async (id: string, qty: string) => {
      await page.goto(`/admin/pricing/${id}`);
      await page.getByTestId('sim-qty').fill(qty);
      await page.getByTestId('sim-run').click();
      await expect(page.getByTestId('sim-status')).toHaveText('QUOTE_ONLY');
      await expect(page.getByTestId('sim-total')).toHaveCount(0);
    };
    const menu = await idOf('Menú', /Menús/);
    await quote(menu, '1'); // one piece is allowed (prototype) but has no authorized price
    await quote(menu, '6');
    const inv = await idOf('Invitación sencilla', /Invitación sencilla/);
    await quote(inv, '24');
    await quote(await idOf('Poster Gran', /Poster Gran Formato/), '1');
    await quote(await idOf('Periódico', /Periódico/), '1');
    // existing regressions: Premium card 2 sides × 500 = 120.00
    await page.goto(`/admin/pricing/${await idOf('Premium', /Premium \/ Gloss/)}`);
    await page.getByTestId('sim-qty').fill('500');
    await page.getByTestId('sim-opt-caras').selectOption('2');
    await page.getByTestId('sim-run').click();
    await expect(page.getByTestId('sim-total')).toHaveText('120.00');
  });

  test('7 · publishing again is idempotent and creates nothing', async ({ page, baseURL }) => {
    await actAs(page, 'e2e-owner', baseURL);
    await page.goto('/admin/migration');
    await page.getByTestId('migration-publish').click();
    await expect(page.getByTestId('migration-msg')).toContainText(
      'Publicación ejecutada: 13 items',
    );
    await page.reload();
    await expect(page.getByTestId('published-table').locator('tbody tr')).toHaveCount(13);
    expect(await metric(page, 'blocked')).toBe(0);
  });

  test('8 · Apparel and other categories stay unpublished', async ({ page, baseURL }) => {
    await actAs(page, 'e2e-dev', baseURL);
    await page.goto('/admin/review?kind=CATALOG_ITEM&status=PUBLISHED');
    await expect(page.locator('[data-testid=review-table] tbody tr')).toHaveCount(13);
    await expect(page.locator('[data-testid=review-table]')).not.toContainText(
      /camiseta|playera|polo|gorra|t-shirt|banner|lona|vinil/i,
    );
  });
});
