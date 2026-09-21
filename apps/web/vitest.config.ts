import { defineConfig } from 'vitest/config';

/**
 * Vitest's zero-config default include glob (`**\/*.{test,spec}.ts(x)`)
 * would otherwise also pick up `e2e/**\/*.spec.ts` (Playwright tests,
 * Phase 14) and fail with "did not expect test.describe() to be called
 * here" — Playwright's own test runner owns those files exclusively (run
 * via `pnpm test:e2e`, not `pnpm test`).
 */
export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**', 'e2e/**'],
  },
});
