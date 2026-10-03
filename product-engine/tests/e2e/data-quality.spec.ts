import { expect, test, type Page } from '@playwright/test';

/**
 * STEP 08 acceptance scenarios A–G on the real staging (data quality, controlled bulk remediation,
 * owner-decision answer recording, Commercial Print gate). It WRITES to the local database
 * (a recorded answer, an applied bulk change): rebuild and restage afterwards.
 */

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([
    { name: 'dtg_admin_actor', value: 'e2e-authorizer', url: `${baseURL}/admin` },
  ]);
});

const metric = async (page: Page, key: string) =>
  Number(await page.locator(`[data-metric="${key}"] .v`).first().textContent());

test('A · dashboard shows real, clickable numbers', async ({ page }) => {
  await page.goto('/admin/data-quality');
  await expect(page.locator('h1')).toHaveText('Calidad de datos');
  expect(await metric(page, 'candidates')).toBeGreaterThan(0);
  const blockers = await metric(page, 'blockers');
  const warnings = await metric(page, 'warnings');
  const info = await metric(page, 'info');
  expect(await metric(page, 'findings')).toBe(blockers + warnings + info);
  // No 0-100 score anywhere: separate dimensions only.
  await expect(page.getByTestId('readiness-summary')).toContainText('Revisión');
  await expect(page.getByTestId('readiness-summary')).toContainText('Publicación');
  await expect(page.getByTestId('quality-by-area')).toContainText('Opciones');
});

test('B · blocker metric opens the filtered list', async ({ page }) => {
  await page.goto('/admin/data-quality');
  const blockers = await metric(page, 'blockers');
  await page.locator('[data-metric="blockers"]').click();
  await expect(page).toHaveURL(/severity=BLOCKER/);
  await expect(page.getByTestId('issues-count')).toContainText(`${blockers} de`);
  const sev = page.locator('[data-testid=issues-table] tbody tr td:nth-child(2)');
  await expect(sev.first()).toHaveText('BLOCKER');
  for (const t of await sev.allTextContents()) expect(t).toBe('BLOCKER');
});

test('C · a finding leads to its candidate and its source provenance', async ({ page }) => {
  await page.goto('/admin/data-quality/issues?severity=BLOCKER&kind=CATALOG_ITEM');
  await page.getByTestId('finding-candidate').first().click();
  await expect(page.locator('[data-testid=resolution-panel]')).toBeVisible();
  await expect(page.locator('[data-section=source]')).toContainText('.xlsx');
});

test('D · bulk remediation preview writes nothing', async ({ page }) => {
  await page.goto('/admin/data-quality/issues?rule=DQ-CATALOG-004');
  const panel = page.getByTestId('remediation-panel');
  await expect(panel).toBeVisible();
  const before = await page.getByTestId('issues-count').textContent();
  await panel.locator('select[name=remediation-value]').selectOption({ index: 1 });
  await panel.getByTestId('remediation-preview').click();
  await expect(page.getByTestId('remediation-summary')).toContainText('cambiarían');
  await page.reload();
  await expect(page.getByTestId('issues-count')).toHaveText(before!);
});

test('E · explicit answer → preview → apply improves readiness without hiding other blockers', async ({
  page,
}) => {
  await page.goto('/admin/data-quality');
  const blockersBefore = await metric(page, 'blockers');
  const waitingBefore = await metric(page, 'owner-decisions');

  await page.goto('/admin/decisions/D-001');
  const panel = page.getByTestId('answer-panel');
  await panel
    .getByLabel('Respuesta')
    .fill('E2E: respuesta de prueba del dueño (datos de desarrollo)');
  await panel.locator('select[name=answer-value]').selectOption('ACTIVE');
  await panel.getByRole('button', { name: 'Agregar' }).click();
  await panel.getByTestId('record-answer').click();
  await expect(panel.getByTestId('answer-done')).toContainText('registrada');
  await expect(page.getByTestId('decision-state')).toHaveText('RESPONDIDA');
  await expect(panel.getByTestId('current-answer')).toContainText('e2e-authorizer');

  await panel.getByTestId('assignment-preview').first().click();
  await expect(panel.getByTestId('assignment-summary')).toContainText('Cambiarían');
  const overwrite = panel.getByTestId('assignment-summary').getByRole('checkbox');
  if (await overwrite.isVisible()) await overwrite.check();
  await panel.getByTestId('assignment-apply').click();
  await expect(panel.getByTestId('answer-done')).toContainText('DECISION_GROUP D-001');

  await page.goto('/admin/data-quality');
  expect(await metric(page, 'owner-decisions')).toBeLessThan(waitingBefore);
  // other blockers (sale unit, options, pricing…) are still there: nothing was hidden
  const blockersAfter = await metric(page, 'blockers');
  expect(blockersAfter).toBeLessThanOrEqual(blockersBefore);
  expect(blockersAfter).toBeGreaterThan(0);

  await page.goto('/admin/decisions');
  await expect(page.locator('[data-decision="D-001"] [data-testid=decision-status]')).toHaveText(
    'RESPONDIDA',
  );
  await expect(page.locator('[data-decision="D-003"] [data-testid=decision-status]')).toHaveText(
    'ABIERTA',
  );
});

test('F · category mapping needs an explicit choice and a preview', async ({ page }) => {
  await page.goto('/admin/data-quality/categories');
  const row = page.locator('[data-testid=categories-table] tbody tr').first();
  await expect(row.getByTestId('mapping-preview')).toBeDisabled(); // nothing is mapped by name
  await row.locator('select').selectOption({ index: 1 });
  await row.getByTestId('mapping-preview').click();
  await expect(row.getByTestId('mapping-summary')).toContainText('Cambiarían');
});

test('G · Commercial Print gate lists the 21 items and migrates nothing', async ({ page }) => {
  await page.goto('/admin/data-quality/commercial-print');
  await expect(page.locator('[data-metric="total"] .v')).toHaveText('21');
  await expect(page.locator('[data-testid=gate-table] tbody tr')).toHaveCount(21);
  const can = await metric(page, 'can-migrate');
  const staged = await metric(page, 'staged');
  expect(can).toBeLessThanOrEqual(staged);
  await expect(page.locator('main button')).toHaveCount(0); // read-only: no publish, no migrate
  // machine-readable export carries the findings
  const res = await page.request.get('/admin/data-quality/export');
  const json = await res.json();
  expect(json.findings.length).toBeGreaterThan(0);
  expect(json.meta.publicationEnabledFor).toEqual(['FIXTURE']);
});
