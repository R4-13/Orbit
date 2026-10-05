/**
 * Erzeugt die Screenshot-Matrix der UI/UX-v2-Abnahme (§29.1) gegen einen laufenden Stack.
 *
 *   node apps/web/scripts/capture-ui-matrix.mjs <ausgabeordner> [--pages=dashboard,inbox] [--sizes=1440x900,1280x720]
 *
 * Meldet je Aufnahme die gemessenen Werte (Dokument-/Hauptbereich-Scroll, horizontaler Überlauf), damit „Vorher“ und „Nachher“
 * belegbar sind. Login mit dem Demo-Nutzer aus docs/DEMO_DATA.md (nur gegen die lokale Entwicklungsumgebung).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const outDir = process.argv[2];
if (!outDir) {
  console.error('Usage: capture-ui-matrix.mjs <outDir> [--pages=..] [--sizes=..]');
  process.exit(1);
}
const arg = (name, fallback) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const EMAIL = process.env.UX_EMAIL ?? 'admin@musterwerk.example';
const PASSWORD = process.env.UX_PASSWORD ?? 'Musterwerk#2026!';

const PAGES = arg('pages', 'dashboard,inbox,finance/invoices,sales/leads,approvals,tasks,cases,activity,integrations,admin').split(',');
const SIZES = arg('sizes', '1920x1080,1600x900,1440x900,1366x768,1280x720,1024x768,768x1024,390x844,320x740').split(',');

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const report = [];

for (const size of SIZES) {
  const [width, height] = size.split('x').map(Number);
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.getByLabel('E-Mail-Adresse').fill(EMAIL);
  await page.getByLabel('Passwort').fill(PASSWORD);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await page.waitForURL('**/dashboard');

  for (const route of PAGES) {
    await page.goto(`${BASE}/${route}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    const metrics = await page.evaluate(() => {
      const main = document.querySelector('[data-shell-main]') ?? document.querySelector('main');
      const home = document.querySelector('[data-home-layout]');
      return {
        docScroll: document.documentElement.scrollHeight - document.documentElement.clientHeight,
        bodyScroll: document.body.scrollHeight - window.innerHeight,
        pageHScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        mainWidth: main ? Math.round(main.getBoundingClientRect().width) : null,
        mainVScroll: main ? main.scrollHeight - main.clientHeight : null,
        homeVScroll: home ? home.scrollHeight - home.clientHeight : null,
        homeHScroll: home ? home.scrollWidth - home.clientWidth : null,
      };
    });
    const name = `${route.replace(/\//g, '-')}__${size}.png`;
    await page.screenshot({ path: join(outDir, name) });
    report.push({ route, size, ...metrics });
  }
  await context.close();
}
await browser.close();
writeFileSync(join(outDir, 'metrics.json'), JSON.stringify(report, null, 2));
console.log(`${report.length} Aufnahmen in ${outDir}`);
