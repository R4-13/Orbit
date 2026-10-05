/**
 * Gibt die axe-Verstöße je Route mit Elementzielen aus – ein Hilfsmittel zum Finden und Beheben, kein Abnahmetest (der steht in
 * e2e/ux-v2-a11y.spec.ts). Aufruf: node apps/web/scripts/axe-report.mjs /admin/users /admin/settings
 */
import AxeBuilder from '@axe-core/playwright';
import { chromium } from '@playwright/test';

const routes = process.argv.slice(2);
const login = await fetch('http://localhost:3001/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@musterwerk.example', password: process.env.UX_PASSWORD ?? 'Musterwerk#2026!' }) });
const session = await login.json();
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
await page.addInitScript((v) => window.localStorage.setItem('orbit.auth', v), JSON.stringify({ accessToken: session.accessToken, refreshToken: session.refreshToken, user: session.user }));
for (const route of routes) {
  await page.goto(`http://localhost:3000/${route.replace(/^\/+/, '')}`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  console.log(`\n${route}: ${result.violations.length} Verstöße`);
  for (const violation of result.violations) {
    console.log(`  [${violation.impact}] ${violation.id}: ${violation.help}`);
    for (const node of violation.nodes.slice(0, 4)) console.log(`     ${node.target.join(' ')}\n       ${node.html.slice(0, 160)}`);
  }
}
await browser.close();
