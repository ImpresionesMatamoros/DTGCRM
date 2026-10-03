import { defineConfig, devices } from '@playwright/test';

/**
 * Critical admin flows end to end (STEP 06 §35/§41). Needs a local database
 * with the real v1.2 staging loaded (see tests/e2e/README.md) and a production
 * build (`pnpm test:e2e` builds first). It WRITES to the local database
 * (drafts, approvals, a created item): rebuild it afterwards if needed.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `pnpm start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/v1/health`,
    // STEP 07: a controlled development price authorizer for the e2e actor (D-016 remains open).
    env: {
      ...(process.env as Record<string, string>),
      DTG_PRICE_AUTHORIZERS: 'e2e-authorizer',
      // STEP 08: the e2e actor may record an owner answer (controlled development role; nobody has it by default).
      DTG_DECISION_RECORDERS: 'e2e-authorizer',
      // STEP 09: the controlled development migration owner (OD-07). Nobody else may approve or run the REAL migration.
      DTG_MIGRATION_OWNERS: 'e2e-owner',
    },
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
