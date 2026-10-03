import { expect, test, type Page } from '@playwright/test';
import { itemId } from '../../data/dev-slice';

/**
 * STEP 09 critical migration flows (prompt §41), against the real staging after the owner decisions
 * OD-01..OD-09 were applied by `scripts/step09-migrate.ts decisions` and BEFORE any REAL write.
 * This file runs first (00-) and performs the explicit dry run, permit approval and scoped publication through
 * the Admin as the controlled development migration owner (`e2e-owner`, DTG_MIGRATION_OWNERS in playwright.config).
 * It WRITES to the local database: rebuild and restage before re-running.
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

test.describe.serial('Commercial Print migration', () => {
  test('1 · gate view: 21 scoped, item by item, nothing published yet', async ({
    page,
    baseURL,
  }) => {
    await actAs(page, 'e2e-dev', baseURL);
    await page.goto('/admin/migration');
    await expect(page.locator('h1')).toContainText('Migración');
    expect(await metric(page, 'scoped')).toBe(21);
    expect(await metric(page, 'publishable')).toBe(5);
    expect(await metric(page, 'blocked')).toBe(16);
    expect(await metric(page, 'published')).toBe(0);
    await expect(page.locator('[data-testid=migration-table] tbody tr')).toHaveCount(21);
    await expect(page.getByTestId('permit-panel')).toContainText('Sin permiso activo');
    await expect(page.getByTestId('published-table')).toHaveCount(0);
  });

  test('2 · a blocked item shows its exact reasons; an eligible item passes', async ({
    page,
    baseURL,
  }) => {
    await actAs(page, 'e2e-dev', baseURL);
    await page.goto('/admin/migration');
    const blocked = row(page, 'MIG2-O-037'); // Tabloides: status/sale unit never confirmed
    await expect(blocked).toHaveAttribute('data-verdict', 'BLOCKED');
    await expect(blocked).toContainText('D-001');
    await expect(blocked).toContainText('Sin categoría');
    const ok = row(page, 'MIG1-O-008');
    await expect(ok).toHaveAttribute('data-verdict', 'PUBLISHABLE');
    await expect(ok).toContainText('pasa su compuerta');
    await expect(ok).toContainText('eximida: D-022'); // Mexico decision waived for the USA permit
    // Postales is eligible with no automatic price: ACTIVE + QUOTE_ONLY is valid
    await expect(row(page, 'MIG2-O-040')).toHaveAttribute('data-verdict', 'PUBLISHABLE');
    await expect(row(page, 'MIG2-O-040')).toContainText('QUOTE_ONLY');
  });

  test('3 · without the owner role nobody can approve or publish REAL data', async ({
    page,
    baseURL,
  }) => {
    await actAs(page, 'e2e-dev', baseURL);
    await page.goto('/admin/migration');
    await expect(page.getByTestId('migration-blocked')).toBeVisible();
    await expect(page.getByTestId('migration-publish')).toHaveCount(0);
    await expect(page.getByTestId('migration-approve')).toHaveCount(0);
    // the price authorizer is not the migration owner either
    await actAs(page, 'e2e-authorizer', baseURL);
    await page.goto('/admin/migration');
    await expect(page.getByTestId('migration-publish')).toHaveCount(0);
  });

  test('4 · dry run writes nothing; publish needs an approved permit', async ({
    page,
    baseURL,
  }) => {
    await actAs(page, 'e2e-owner', baseURL);
    await page.goto('/admin/migration');
    await expect(page.getByTestId('migration-publish')).toBeDisabled(); // no permit yet
    await page.getByTestId('migration-simulate').click();
    await expect(page.getByTestId('migration-msg')).toContainText('nada se escribió');
    await expect(page.getByTestId('migration-msg')).toContainText('5 de 5');
    await expect(page.getByTestId('migration-lines')).toContainText('MIG1-O-009: OK DTG-00002');
    await page.reload();
    expect(await metric(page, 'published')).toBe(0);
    await expect(page.getByTestId('permit-panel')).toContainText('Sin permiso activo');
    await page.goto('/admin/catalog?q=Postales');
    await expect(page.getByTestId('catalog-table')).not.toContainText('Postales');
  });

  test('5 · explicit permit approval, then explicit scoped publication', async ({
    page,
    baseURL,
  }) => {
    await actAs(page, 'e2e-owner', baseURL);
    await page.goto('/admin/migration');
    await expect(page.getByTestId('migration-approve')).toBeDisabled(); // a reason is required
    await page
      .getByLabel('Motivo de la aprobación')
      .fill('E2E: el dueño autoriza la primera publicación REAL (OD-07).');
    await page.getByTestId('migration-approve').click();
    await expect(page.getByTestId('migration-msg')).toContainText('Permiso aprobado');
    await expect(page.getByTestId('permit-panel')).toContainText('ACTIVO');
    await expect(page.getByTestId('permit-panel')).toContainText('e2e-owner');
    expect(await metric(page, 'published')).toBe(0); // approving a permit publishes nothing
    await page.getByTestId('migration-publish').click();
    await expect(page.getByTestId('migration-msg')).toContainText('Publicación ejecutada: 5 items');
    await page.reload();
    expect(await metric(page, 'published')).toBe(5);
    const table = page.getByTestId('published-table');
    for (const code of ['DTG-00001', 'DTG-00002', 'DTG-00003', 'DTG-00004'])
      await expect(table.locator(`tr[data-public-code="${code}"]`)).toHaveCount(1);
    await expect(table).toContainText('e2e-owner');
    // the 16 unresolved items stay blocked, with their reasons
    expect(await metric(page, 'blocked')).toBe(16);
    await expect(row(page, 'MIG2-O-037')).toHaveAttribute('data-verdict', 'BLOCKED');
    await expect(row(page, 'MIG1-O-008')).toHaveAttribute('data-verdict', 'PUBLISHED');
  });

  test('6 · publishing again is idempotent', async ({ page, baseURL }) => {
    await actAs(page, 'e2e-owner', baseURL);
    await page.goto('/admin/migration');
    await page.getByTestId('migration-publish').click();
    await expect(page.getByTestId('migration-msg')).toContainText('Publicación ejecutada: 5 items');
    await page.reload();
    await expect(page.getByTestId('published-table').locator('tbody tr')).toHaveCount(5);
  });

  test('7 · Apparel and every other category stay unpublished', async ({ page, baseURL }) => {
    await actAs(page, 'e2e-dev', baseURL);
    await page.goto('/admin/review?kind=CATALOG_ITEM&status=PUBLISHED');
    const table = page.locator('[data-testid=review-table] tbody tr');
    await expect(table).toHaveCount(5);
    await expect(page.locator('[data-testid=review-table]')).not.toContainText(
      /camiseta|playera|polo|gorra|t-shirt/i,
    );
  });

  test('8 · catalog search finds the migrated item; provenance leads back to the workbook cell', async ({
    page,
    baseURL,
  }) => {
    await actAs(page, 'e2e-dev', baseURL);
    await page.goto('/admin/catalog?q=Postales');
    await page
      .getByTestId('catalog-table')
      .getByRole('link', { name: /Postales/ })
      .click();
    await expect(page.locator('h1')).toContainText('Postales');
    await expect(page.locator('main')).toContainText(/DTG-\d{5}/);
    await expect(page.locator('main')).toContainText('LEGACY_ID');
    await expect(page.locator('main')).toContainText('MIG2-O-040');
    // import trace → candidate → source record → workbook / sheet / cell
    await page
      .getByRole('link', { name: /CATALOG_ITEM/ })
      .first()
      .click();
    await expect(page.locator('[data-section=source]')).toContainText('.xlsx');
  });

  test('9 · price simulator uses the real engine: authorized prices resolve, everything else is QUOTE_ONLY', async ({
    page,
    baseURL,
  }) => {
    await actAs(page, 'e2e-dev', baseURL);
    const simulate = async (id: string, qty: string, opts: Record<string, string> = {}) => {
      await page.goto(`/admin/pricing/${id}`);
      await page.getByTestId('sim-qty').fill(qty);
      for (const [k, v] of Object.entries(opts))
        await page.getByTestId(`sim-opt-${k}`).selectOption(v);
      await page.getByTestId('sim-run').click();
    };
    // Premium Business Card · 2 sides × 500 = 120.00 USD; 750 is never interpolated
    await simulate(itemId('tarjeta_premium'), '500', { caras: '2' });
    await expect(page.getByTestId('sim-total')).toHaveText('120.00');
    await simulate(itemId('tarjeta_premium'), '750', { caras: '2' });
    await expect(page.getByTestId('sim-status')).toHaveText('QUOTE_ONLY');
    // Premium Flyer · half letter · 2 sides × 1000 = 400.00 USD
    await simulate(itemId('flyers'), '1000', {
      caras: '2',
      papel: 'Premium',
      tamano_papel: 'Media carta',
    });
    await expect(page.getByTestId('sim-total')).toHaveText('400.00');
    // magnets: 1 pair = 65.00; 2 pairs are NOT 130.00
    await simulate(itemId('imanes_par'), '1');
    await expect(page.getByTestId('sim-total')).toHaveText('65.00');
    await simulate(itemId('imanes_par'), '2');
    await expect(page.getByTestId('sim-status')).toHaveText('QUOTE_ONLY');
    // Postales has no authorized price: QUOTE_ONLY with a reason, not a made-up number
    await page.goto('/admin/catalog?q=Postales');
    await page
      .getByTestId('catalog-table')
      .getByRole('link', { name: /Postales/ })
      .click();
    await page.waitForURL(/\/admin\/catalog\/[0-9a-f-]{36}$/);
    const postales = page.url().split('/').pop()!;
    await simulate(postales, '100');
    await expect(page.getByTestId('sim-status')).toHaveText('QUOTE_ONLY');
    await expect(page.getByTestId('sim-total')).toHaveCount(0);
  });
});
