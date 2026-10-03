import { expect, test, type Page } from '@playwright/test';
import { itemId } from '../../data/dev-slice';

/**
 * STEP 07 critical pricing flows (prompt §32 "UI acceptance"). They never leave an authorized row behind:
 * drafts they create are deleted at the end, so the suite can be re-run on the same database.
 * `e2e-authorizer` is the controlled development price authorizer (DTG_PRICE_AUTHORIZERS in playwright.config).
 */
const CARD = itemId('tarjeta_premium');
const MAGNET = itemId('imanes_par');

async function actAs(page: Page, name: string, baseURL: string | undefined) {
  await page.context().clearCookies();
  await page
    .context()
    .addCookies([{ name: 'dtg_admin_actor', value: name, url: `${baseURL}/admin` }]);
}

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([
    { name: 'dtg_admin_actor', value: 'e2e-authorizer', url: `${baseURL}/admin` },
  ]);
});

async function openAuthorizedCard2(page: Page) {
  await page.goto(`/admin/pricing?itemId=${CARD}&status=AUTHORIZED&validity=current`);
  const row = page
    .locator('[data-testid=pricing-definitions] tbody tr')
    .filter({ hasText: 'caras=2' })
    .first();
  await expect(row).toBeVisible();
  await row.getByRole('link').first().click();
  await expect(page.getByTestId('def-status')).toHaveText('AUTHORIZED');
}

test('1 · authorized price → clone draft → edit matrix → simulate → compare', async ({ page }) => {
  await openAuthorizedCard2(page);
  await page.getByTestId('clone-draft').click();
  await expect(page.getByTestId('def-status')).toHaveText('DRAFT');
  await expect(page.getByTestId('def-revision')).toContainText('revisión 2');

  // matrix editor: exact rows, change 500 → 130.00, no interpolation
  const row500 = page.getByTestId('matrix-row').filter({ has: page.locator('input[value="500"]') });
  await row500.locator('input[data-testid^=matrix-amount]').fill('130.00');
  await page.getByTestId('save-draft-price').click();
  await expect(page.locator('[data-testid=draft-editor] [role=status]')).toContainText(
    'Borrador guardado',
  );

  // impact preview + comparison against revision 1
  await page.reload();
  const impact = page.getByTestId('impact-row').filter({ hasText: '500' }).first();
  await expect(impact).toContainText('120.00');
  await expect(impact).toContainText('130.00');
  await expect(impact).toContainText('+10.00');
  await expect(page.getByTestId('compare-breaks')).toContainText('+10.00');

  // draft simulation is explicit and isolated: shows the draft AND the live answer
  await page.getByTestId('sim-qty').fill('500');
  await page.getByTestId('sim-opt-caras').selectOption('2');
  await page.getByTestId('sim-run').click();
  await expect(page.getByTestId('sim-draft').filter({ hasText: 'Con el borrador' })).toContainText(
    '130.00',
  );
  await expect(page.getByTestId('sim-draft').filter({ hasText: 'Vigente hoy' })).toContainText(
    '120.00',
  );

  // the authorized revision is untouched and normal quoting still answers 120.00
  await page.goto(`/admin/pricing/${CARD}`);
  await page.getByTestId('sim-qty').fill('500');
  await page.getByTestId('sim-opt-caras').selectOption('2');
  await page.getByTestId('sim-run').click();
  await expect(page.getByTestId('sim-total')).toHaveText('120.00');

  // cleanup: delete the draft
  await openAuthorizedCard2(page);
  await page.getByText('Ver la revisión siguiente').click();
  await expect(page.getByTestId('def-status')).toHaveText('DRAFT');
  await page.getByTestId('delete-draft').click();
  await expect(page).toHaveURL(/\/admin\/pricing$/);
});

test('2 · conflict preview blocks authorization (and without the capability the button is off too)', async ({
  page,
  baseURL,
}) => {
  await page.goto(`/admin/pricing/definitions/new?itemId=${CARD}&market=USA`);
  await page.getByLabel('nueva condición').selectOption('OPTION_VALUE|caras|2');
  await page.getByRole('button', { name: 'Añadir', exact: true }).click();
  await page.getByTestId('add-break').click();
  await page.getByTestId('matrix-qty-0').fill('100');
  await page.getByTestId('matrix-amount-0').fill('49.00');
  // duplicate quantity is blocked in the editor itself
  await page.getByTestId('add-break').click();
  await page.getByTestId('matrix-qty-1').fill('100');
  await page.getByTestId('matrix-amount-1').fill('50.00');
  await expect(page.getByTestId('save-draft-price')).toBeDisabled();
  await page.getByTestId('remove-break-1').click();
  await page.getByTestId('save-draft-price').click();
  await expect(page.getByTestId('def-status')).toHaveText('DRAFT');

  await expect(page.getByTestId('conflicts-blocking')).toContainText('Mismo alcance');
  await expect(page.getByTestId('authorize-price')).toBeDisabled();

  // a normal dev actor additionally lacks price.authorize (D-016 still open)
  await actAs(page, 'e2e-martin', baseURL);
  await page.reload();
  await expect(page.getByTestId('authorize-capability-note')).toContainText('D-016');
  await expect(page.getByTestId('authorize-price')).toBeDisabled();

  await actAs(page, 'e2e-authorizer', baseURL);
  await page.reload();
  await page.getByTestId('delete-draft').click();
  await expect(page).toHaveURL(/\/admin\/pricing$/);
});

test('3 · D-010 (answered by OD-08: one pair) opens the magnet context and the Review Inbox; multiples stay QUOTE_ONLY', async ({
  page,
}) => {
  await page.goto('/admin/decisions');
  await expect(page.getByTestId('decisions-table').locator('tbody tr')).toHaveCount(22);
  await page.getByRole('link', { name: 'D-010' }).first().click();
  // STEP 09: the owner answered D-010 (OD-08): 65 USD = 1 pair, no linear multiples
  await expect(page.getByTestId('decision-answer')).toContainText('1 PAR');
  await expect(page.getByTestId('pricing-relevance')).toContainText('QUOTE_ONLY');
  await page.getByTestId('decision-item-link').click();
  await expect(page.locator('h1')).toContainText('Imanes');
  await expect(page.locator('main')).toContainText('65.00');
  await page.goto('/admin/decisions/D-010');
  await page.getByTestId('open-in-review').click();
  await expect(page).toHaveURL(/\/admin\/review\?ids=/);
  await expect(page.locator('[data-testid=review-table] tbody tr')).toHaveCount(1);
  await expect(page.locator('[data-testid=review-table]')).toContainText('Imanes');
  // magnets: several pairs stay QUOTE_ONLY (D-010), one pair = 65.00
  await page.goto(`/admin/pricing/${MAGNET}`);
  await page.getByTestId('sim-qty').fill('2');
  await page.getByTestId('sim-run').click();
  await expect(page.getByTestId('sim-status')).toHaveText('QUOTE_ONLY');
});

test('4 · Mexico: policy and simulation label the rounding as provisional and D-022 as unresolved', async ({
  page,
}) => {
  await page.goto('/admin/pricing/policies');
  await expect(page.locator('main')).toContainText('PROVISIONAL TECHNICAL BEHAVIOR');
  await expect(page.getByRole('link', { name: 'D-022' }).first()).toBeVisible();
  await page.goto(`/admin/pricing/${CARD}`);
  await page.getByTestId('sim-market').selectOption('MX');
  await page.getByTestId('sim-qty').fill('500');
  await page.getByTestId('sim-opt-caras').selectOption('2');
  await page.getByTestId('sim-run').click();
  await expect(page.getByTestId('sim-total')).toHaveText('1386.00');
  await expect(page.getByTestId('sim-derivation')).toContainText('PROVISIONAL TECHNICAL BEHAVIOR');
  await expect(page.getByTestId('sim-derivation')).toContainText('IVA sin resolver');
});

test('5 · historical evidence has no authorization action and never appears as a price definition', async ({
  page,
}) => {
  await page.goto('/admin/pricing/historical');
  await expect(page.locator('main button')).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText('Autorizar');
  await page.goto(`/admin/pricing/${itemId('xbanner_completo')}`);
  await expect(page.locator('[data-section=historical] button')).toHaveCount(0);
  await expect(page.locator('[data-section=historical]')).toContainText(
    'Not used for current pricing',
  );
  // the same item has no price definition to authorize
  await page.goto(`/admin/pricing?itemId=${itemId('xbanner_completo')}`);
  await expect(page.getByText('Sin definiciones con esos filtros')).toBeVisible();
});

test('6 · Commercial Print readiness is a report, not a migration', async ({ page }) => {
  await page.goto('/admin/pricing/readiness');
  const totals = page.getByTestId('readiness-totals');
  await expect(totals).toContainText('21');
  await expect(totals).toContainText('131');
  await expect(page.getByTestId('readiness-table').locator('tbody tr')).toHaveCount(21);
  await expect(page.locator('main')).toContainText('no migra, no publica');
});
