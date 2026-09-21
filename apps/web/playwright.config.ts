import { defineConfig, devices } from '@playwright/test';

/**
 * Frontend E2E suite (Phase 14). Requires the full stack already running
 * against a seeded DB: Postgres/Redis/MinIO (`docker compose up`), the API
 * (`pnpm --filter @orbit/api dev`, port 3001) and a seeded demo tenant
 * (`pnpm prisma:seed`) — see docs/DEMO_DATA.md. Assertions read the
 * seeded "Musterwerk GmbH" fixtures, so tests fail fast (not flaky) if the
 * DB wasn't seeded.
 *
 * `webServer` reuses an already-running `next dev`/`next start` on
 * localhost:3000 outside CI (matches the manual-QA workflow used
 * throughout this project); in CI it starts a fresh `next start` against
 * the build `pnpm build` already produced (turbo.json: `test:e2e`
 * `dependsOn: ["build"]`).
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm run start',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
