import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { API_BASE_URL, DEMO_USERS, loginViaApi, loginViaStorage } from './utils/login';

/**
 * Automatisierte Zugänglichkeitsprüfung (UI v2 §25, AC-19): axe-core gegen WCAG 2.0/2.1 A und AA (Kontrast, Beschriftungen, Landmarken,
 * Rollen, Tastaturerreichbarkeit). Das ersetzt keine manuelle Screenreader-Prüfung, fängt aber die häufigsten strukturellen Fehler ab.
 */

const ROUTES = ['/dashboard', '/dashboard/attention', '/inbox', '/finance/invoices', '/sales/leads', '/approvals', '/tasks', '/cases', '/activity', '/integrations', '/admin', '/admin/branding', '/admin/users', '/admin/policies', '/admin/ai-providers', '/admin/settings', '/admin/retention', '/admin/processes', '/admin/agents', '/admin/workflows', '/sales/contacts', '/sales/opportunities', '/finance/suppliers'];

async function violations(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  return result.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.slice(0, 3).map((node) => `${node.target.join(' ')} :: ${(node.failureSummary ?? '').split('\n').slice(0, 2).join(' | ')}`),
  }));
}

test.describe('axe: keine A/AA-Verstöße in den Standardansichten', () => {
  for (const route of ROUTES) {
    test(`${route} bei 1440×900`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await loginViaStorage(page, DEMO_USERS.admin);
      await page.goto(route);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await page.waitForLoadState('networkidle');
      expect(await violations(page)).toEqual([]);
    });
  }

  test('Detailseiten: Eingang, Freigabe, Vorgang (Tabs) und Rechnung', async ({ page }) => {
    const token = await loginViaApi(DEMO_USERS.admin);
    const list = async <T>(path: string): Promise<T> => (await (await fetch(`${API_BASE_URL}/api/v1${path}`, { headers: { Authorization: `Bearer ${token}` } })).json()) as T;
    const inbox = await list<{ items: Array<{ id: string }> }>('/inbox/items');
    const queue = await list<Array<{ id: string }>>('/approvals/queue');
    const cases = await list<{ items: Array<{ id: string }> }>('/cases/overview?filter=ALL');
    const invoices = await list<Array<{ id: string }>>('/invoices');

    await page.setViewportSize({ width: 1440, height: 900 });
    await loginViaStorage(page, DEMO_USERS.admin);
    const targets = [
      inbox.items[0] ? `/inbox/${inbox.items[0].id}` : null,
      queue[0] ? `/approvals/${queue[0].id}` : null,
      cases.items[0] ? `/cases/${cases.items[0].id}` : null,
      cases.items[0] ? `/cases/${cases.items[0].id}?tab=orchestration` : null,
      invoices[0] ? `/finance/invoices/${invoices[0].id}` : null,
    ].filter((value): value is string => Boolean(value));
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      await page.goto(target);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await page.waitForLoadState('networkidle');
      expect(await violations(page), target).toEqual([]);
    }
  });

  test('Sonde als Overlay und Dialog „Ansicht anpassen“ sind zugänglich', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await loginViaStorage(page, DEMO_USERS.admin);
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Benötigt Ihre Aufmerksamkeit' })).toBeVisible();
    await page.getByRole('button', { name: 'Sonde', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Sonde' })).toBeVisible();
    expect(await violations(page)).toEqual([]);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Ansicht anpassen' }).click();
    await expect(page.getByRole('dialog', { name: 'Ansicht anpassen' })).toBeVisible();
    expect(await violations(page)).toEqual([]);
  });

  test('Mobil 390×844: Home und geöffnete Navigationsschublade', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginViaStorage(page, DEMO_USERS.admin);
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Benötigt Ihre Aufmerksamkeit' })).toBeVisible();
    expect(await violations(page)).toEqual([]);
    await page.getByRole('button', { name: 'Navigation öffnen' }).click();
    await expect(page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Posteingang' })).toBeVisible();
    expect(await violations(page)).toEqual([]);
  });
});
