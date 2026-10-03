import { expect, test, type Page } from '@playwright/test';

/**
 * STEP 06 acceptance scenarios A–F (prompt §41) on the real v1.2 staging.
 * Each run uses unique values, so the suite can be re-run on the same database.
 */

// Unique per run (minute precision, like the datetime input), so re-runs never hit "same value".
const RUN = new Date(Date.UTC(2027, 0, 1) + Math.floor(Math.random() * 500_000) * 60_000)
  .toISOString()
  .slice(0, 16);

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([
    { name: 'dtg_admin_actor', value: 'e2e-martin', url: `${baseURL}/admin` },
  ]);
});

async function openFirst(page: Page, url: string) {
  await page.goto(url);
  const link = page.locator('[data-testid=review-table] tbody tr td:nth-child(2) a').first();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page.locator('[data-testid=resolution-panel]')).toBeVisible();
}

const field = (page: Page, name: string) => page.locator(`[data-field="${name}"]`);

async function save(page: Page) {
  await page.getByTestId('save-draft').click();
  await expect(page.locator('main [role=status]').filter({ hasText: 'Guardado' })).toBeVisible();
}

test('A · unresolved CatalogItem: resolve, preview, approve — never publish REAL', async ({
  page,
}) => {
  await openFirst(
    page,
    '/admin/review?kind=CATALOG_ITEM&catalogStatus=unresolved&decorationPolicy=unresolved&status=WARNING&itemType=resolved&dataClass=REAL',
  );
  await expect(field(page, 'status').locator('.badge', { hasText: 'sin resolver' })).toBeVisible();
  await expect(
    field(page, 'decorationPolicy').locator('.badge', { hasText: 'sin resolver' }),
  ).toBeVisible();
  // Nothing is preselected: the "Sin resolver" choice is the checked one.
  await expect(field(page, 'status').locator('input[value="__unset__"]')).toBeChecked();
  await expect(page.getByTestId('approve')).toBeDisabled();

  await field(page, 'status').getByLabel('ACTIVE').check();
  await field(page, 'decorationPolicy').getByLabel('NONE').check();
  await save(page);

  // If the LEGACY_ID already exists in the domain the real adapter asks for an explicit target.
  const errors = page.getByTestId('preview-errors');
  if ((await errors.isVisible()) && (await errors.textContent())?.includes('LINEAGE_EXISTS')) {
    await field(page, 'target').getByLabel('Vincular a existente').check();
    await save(page);
  }
  await expect(page.getByTestId('preview-ops')).toBeVisible();
  await expect(page.locator('[data-section=preview]')).toContainText(
    /CatalogItem nuevo|Enlace catalog_item/,
  );

  await page.getByTestId('approve').click();
  await expect(page.locator('main [role=status]').filter({ hasText: 'Aprobado' })).toBeVisible();
  await page.reload();
  await expect(page.locator('h1')).toContainText('APPROVED');
  await expect(page.getByTestId('publish-real-disabled')).toBeDisabled();
  await expect(page.getByText("PUBLICATION_ENABLED_FOR = ['FIXTURE']")).toBeVisible();
});

test('B · Option with required = null stays unresolved until true/false is chosen', async ({
  page,
}) => {
  await openFirst(page, '/admin/review?kind=OPTION&status=WARNING&openField=isRequired');
  const req = field(page, 'isRequired');
  await expect(req.locator('.badge', { hasText: 'sin resolver' })).toBeVisible();
  await expect(req.locator('input[value="true"]')).not.toBeChecked();
  await expect(req.locator('input[value="false"]')).not.toBeChecked();
  await req.getByLabel('Opcional (false)').check();
  await save(page);
  await page.reload();
  await expect(req.locator('.badge', { hasText: 'decidido' })).toBeVisible();
  await expect(req.locator('input[value="false"]')).toBeChecked();
  await expect(page.getByTestId('audit-trail')).toContainText('isRequired');
});

test('C · provenance: candidate → source record → workbook / sheet / row / cell', async ({
  page,
}) => {
  await openFirst(page, '/admin/review?kind=CATALOG_ITEM&sheet=OFERTAS');
  const source = page.locator('[data-section=source]');
  await expect(source).toContainText('Design_To_Go_Catalog_v1.2_RC_MANGO_TANGO.xlsx');
  const cells = page.getByTestId('source-cells').first();
  await expect(cells).toContainText('OFERTAS');
  await expect(cells.locator('tbody tr').first().locator('td').nth(3)).toHaveText(/^[A-Z]+\d+$/);
});

test('D · bulk resolution: select, preview counts, confirm, audit', async ({ page }) => {
  // STEP 09 resolved every real PRICE candidate of the migrated items, so the bulk flow now runs on options
  // of items that are still in review (a draft change, never approval or publication).
  await page.goto('/admin/review?kind=OPTION&status=WARNING&dataClass=REAL');
  const boxes = page.locator('[data-testid=review-table] tbody input[type=checkbox]');
  await expect(boxes.first()).toBeVisible();
  for (let i = 0; i < 3; i++) await boxes.nth(i).check();
  const bar = page.getByTestId('bulk-bar');
  await bar.locator('select[name=bulk-field]').selectOption('selectionMode');
  await bar.locator('select[name=bulk-value]').selectOption('MULTI');
  await bar.getByRole('button', { name: 'Vista previa' }).click();
  const preview = page.getByTestId('bulk-preview');
  await expect(preview).toContainText('3 seleccionados');
  const overwrite = preview.getByRole('checkbox');
  if (await overwrite.isVisible()) await overwrite.check(); // re-runs: earlier values differ
  await preview.getByRole('button', { name: /Aplicar a 3/ }).click();
  await expect(page.locator('main [role=status]').filter({ hasText: 'Aplicado' })).toBeVisible();
  await page.goto('/admin/review/audit');
  await expect(page.locator('table').first()).toContainText('selectionMode');
  await expect(page.locator('table').first()).toContainText('e2e-martin');
});

test('E · historical evidence is separate and offers no publication', async ({ page }) => {
  await page.goto('/admin/pricing/historical');
  await expect(page.locator('h1')).toHaveText('Historical evidence · Not used for current pricing');
  await expect(page.getByTestId('historical-table').locator('tbody tr')).not.toHaveCount(0);
  await expect(page.locator('main button')).toHaveCount(0);
  await openFirst(page, '/admin/review?kind=CATALOG_ITEM&hasHistorical=yes');
  await expect(page.locator('[data-section=historical]')).toContainText(
    'Not used for current pricing',
  );
  await expect(page.locator('[data-section=historical] button')).toHaveCount(0);
});

test('F · catalog: create a minimal item, find it, open it, edit, see history', async ({
  page,
}) => {
  const name = `Taza E2E ${RUN}`;
  await page.goto('/admin/catalog/new');
  const form = page.getByTestId('create-item-form');
  await form.locator('input[name=name]').fill(name);
  await form.getByLabel('PRODUCT').check();
  await page.getByTestId('create-item').click();
  await expect(page.locator('main [role=alert]')).toContainText('status'); // status and policy are not assumed
  await form.getByLabel('CANDIDATE').check();
  await form.getByLabel('OPTIONAL').check();
  await page.getByTestId('create-item').click();
  await expect(page.locator('main [role=status]')).toContainText(/DTG-\d{5}/);

  await page.goto(`/admin/catalog?q=${encodeURIComponent(name)}`);
  await page.getByTestId('catalog-table').getByRole('link', { name }).click();
  await expect(page.locator('h1')).toContainText(name);
  const edit = page.getByTestId('edit-item-form');
  await edit.locator('textarea').fill('creado en la prueba E2E');
  await page.getByTestId('save-item').click();
  await expect(page.locator('main [role=status]')).toContainText('descriptionInternal');
  await page.reload();
  const history = page.locator('[data-section=history]');
  await expect(history).toContainText('admin:catalog.update');
  await expect(history).toContainText('e2e-martin');
  await expect(history).toContainText('admin:catalog.create');
});
