import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { test } from '@playwright/test';

/**
 * Tests, die Lieferanten, Vorgänge oder Aufgaben anlegen, laufen in einem eigenen, frischen Betrieb (Skript `apps/api/scripts/e2e-tenant.ts`, am Ende gelöscht) und nicht im
 * Demo-Betrieb „Musterwerk“: dort blieben sonst Testeinträge liegen, die echte offene Freigaben überdecken (ASSUMPTIONS.md #618). Braucht die Umgebung (`DATABASE_URL`),
 * sonst werden diese Tests übersprungen (`set -a && source .env && set +a`).
 */
const REPO_ROOT = join(__dirname, '../../../..');

export interface FreshTenant {
  tenantId: string;
  password: string;
  /** E-Mail-Adresse je Rolle (`admin` immer, dazu die angeforderten). */
  users: Record<string, string>;
}

function runTenantScript(args: string[]): string {
  const output = execFileSync('pnpm', ['--filter', '@orbit/api', 'exec', 'ts-node', 'scripts/e2e-tenant.ts', ...args], { cwd: REPO_ROOT, encoding: 'utf8', shell: process.platform === 'win32', timeout: 120_000 });
  return output.trim().split('\n').at(-1) ?? '';
}

/** Legt vor den Tests des umgebenden `describe` einen frischen Betrieb an und löscht ihn danach; liefert eine Funktion, die ihn zurückgibt. */
export function useFreshTenant(roles: string[]): () => FreshTenant {
  let tenant: FreshTenant | undefined;
  test.skip(!process.env.DATABASE_URL, 'DATABASE_URL nicht gesetzt (Umgebung aus .env laden): der frische Betrieb kann nicht angelegt werden');
  test.beforeAll(() => {
    tenant = JSON.parse(runTenantScript(['create', ...(roles.length > 0 ? ['--roles', roles.join(',')] : [])])) as FreshTenant;
  });
  test.afterAll(() => {
    if (tenant) runTenantScript(['delete', tenant.tenantId]);
  });
  return () => tenant as FreshTenant;
}
