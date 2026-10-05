import { expect, test, type Page } from '@playwright/test';
import { DEMO_USERS, loginViaStorage } from './utils/login';

/**
 * Abnahme UI/UX v2 (docs/ORBIT_UI_UX_V2_ACCEPTANCE_REPORT.md): Shell, Home, Navigation, Sonde. Die Prüfungen messen die
 * tatsächlich gerenderte Geometrie (Scrollhöhen, Breiten, Bounding-Boxen) – ein grüner Test belegt kein Aussehen, aber er
 * fängt jede Rückkehr zu langem Scrollen, verstecktem Composer oder aufgeklapptem Navigationsbaum zuverlässig ab.
 */

async function openHome(page: Page): Promise<void> {
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Benötigt Ihre Aufmerksamkeit' })).toBeVisible();
  await expect(page.getByText(/Stand \d\d:\d\d/)).toBeVisible();
  // Skeletons (aria-hidden + animate-pulse) sind verschwunden: die Daten sind da.
  await page.waitForFunction(() => document.querySelectorAll('[aria-hidden="true"].animate-pulse').length === 0);
}

const DESKTOP_MATRIX: Array<[number, number]> = [
  [1920, 1080],
  [1600, 900],
  [1440, 900],
  [1366, 768],
  [1280, 720],
  [1280, 800],
];

test.describe('Home auf einer Bildschirmseite (AC-01, AC-02, AC-03, AC-06)', () => {
  for (const [width, height] of DESKTOP_MATRIX) {
    test(`${width}×${height}: kein Scrollen, kein horizontaler Überlauf, lesbare Schrift`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await loginViaStorage(page, DEMO_USERS.admin);
      await openHome(page);

      const m = await page.evaluate(() => {
        const main = document.querySelector('[data-shell-main]') as HTMLElement;
        const home = document.querySelector('[data-home-layout]') as HTMLElement;
        const listLink = home.querySelector('li a') as HTMLElement | null;
        return {
          layout: home.dataset.homeLayout,
          docV: document.documentElement.scrollHeight - document.documentElement.clientHeight,
          docH: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          mainV: main.scrollHeight - main.clientHeight,
          homeV: home.scrollHeight - home.clientHeight,
          homeH: home.scrollWidth - home.clientWidth,
          listFont: listLink ? parseFloat(getComputedStyle(listLink).fontSize) : 14,
          bodyFont: parseFloat(getComputedStyle(document.body).fontSize),
          transform: getComputedStyle(home).transform,
          zoom: (getComputedStyle(home) as CSSStyleDeclaration & { zoom?: string }).zoom ?? '1',
        };
      });
      expect(m.layout).toBe('one-screen');
      expect(m.docV).toBeLessThanOrEqual(1);
      expect(m.docH).toBeLessThanOrEqual(1);
      expect(m.mainV).toBeLessThanOrEqual(1);
      expect(m.homeV).toBeLessThanOrEqual(1);
      expect(m.homeH).toBeLessThanOrEqual(1);
      expect(m.listFont).toBeGreaterThanOrEqual(13);
      expect(m.bodyFont).toBeGreaterThanOrEqual(14);
      expect(m.transform).toBe('none'); // AC-06: kein Scale-/Zoom-Hack
      expect(m.zoom).toBe('1');

      // Jeder Pflichtbereich ist tatsächlich sichtbar (nichts abgeschnitten): unterste Karte liegt im Viewport.
      const lastCard = await page.getByRole('region', { name: /Ihre nächsten Aufgaben|Zuletzt erledigt/ }).first().boundingBox();
      expect(lastCard).not.toBeNull();
      expect(lastCard!.y + lastCard!.height).toBeLessThanOrEqual(height + 1);
    });
  }

  test('Home hat fünf KPI-Karten mit Zeitbezug und die vier Zonen in der vorgeschriebenen Reihenfolge', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginViaStorage(page, DEMO_USERS.admin);
    await openHome(page);
    for (const label of ['Verarbeitete Posten', 'Automatisiert', 'Freigaben offen', 'Fehler / ungeklärt', 'Geschätzte Zeitersparnis']) {
      await expect(page.getByRole('link', { name: new RegExp(`^${label}:`) })).toBeVisible();
    }
    const order = await page.evaluate(() => [...document.querySelectorAll('[data-home-layout] section[aria-labelledby]')].map((el) => el.querySelector('h2')?.textContent));
    expect(order).toEqual(['Benötigt Ihre Aufmerksamkeit', 'Neu im Posteingang', 'Finanzen', 'Vertrieb', 'Ihre nächsten Aufgaben', 'Zuletzt erledigt']);
  });
});

test.describe('Shell und Breitenrechnung (AC-03, AC-08)', () => {
  test('1440×900: Sonde ist angedockt (384 px) und der Hauptinhalt behält mindestens 800 px netto', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginViaStorage(page, DEMO_USERS.admin);
    await openHome(page);
    const sonde = page.locator('[data-sonde="docked"]');
    await expect(sonde).toBeVisible();
    const sondeWidth = (await sonde.boundingBox())!.width;
    expect(Math.round(sondeWidth)).toBe(384);
    const mainWidth = (await page.locator('[data-shell-main]').boundingBox())!.width;
    expect(mainWidth - 2 * 16).toBeGreaterThanOrEqual(800);
  });

  for (const width of [1280, 1366]) {
    test(`${width} px: Sonde wird nicht in die Arbeitsfläche gezwängt – sie öffnet als Overlay`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await loginViaStorage(page, DEMO_USERS.admin);
      await openHome(page);
      await expect(page.locator('[data-sonde="docked"]')).toHaveCount(0);
      const before = (await page.locator('[data-shell-main]').boundingBox())!.width;
      await page.getByRole('button', { name: 'Sonde', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Sonde' });
      await expect(dialog).toBeVisible();
      // Das Grundlayout bleibt unverändert; das Overlay überdeckt bewusst einen Teil.
      expect((await page.locator('[data-shell-main]').boundingBox())!.width).toBe(before);
      await expect(page.getByLabel('Nachricht an Sonde')).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
    });
  }

  test('Es gibt keinen globalen schmalen Container: die Hauptfläche belegt die zugewiesene Breite (GAP-01)', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await loginViaStorage(page, DEMO_USERS.admin);
    await openHome(page);
    const widths = await page.evaluate(() => {
      const main = document.querySelector('[data-shell-main]') as HTMLElement;
      const home = document.querySelector('[data-home-layout]') as HTMLElement;
      return { main: main.clientWidth, home: home.clientWidth };
    });
    expect(widths.home).toBeGreaterThanOrEqual(widths.main - 2 * 24 - 1);
  });
});

test.describe('Navigation (NAV-01 bis NAV-03, AC-04, AC-05)', () => {
  test('beim ersten Einstieg sind alle Untermenüs geschlossen, die Hauptlabels sichtbar', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginViaStorage(page, DEMO_USERS.admin);
    await openHome(page);
    const nav = page.getByRole('navigation', { name: 'Hauptnavigation' });
    for (const label of ['Home', 'Posteingang', 'Finanzen', 'Vertrieb', 'Aufgaben', 'Vorgänge', 'Aktivitäten', 'Systeme & Verbindungen', 'Administration']) {
      await expect(nav.getByRole('link', { name: label, exact: true })).toBeVisible();
    }
    // „Freigaben“ trägt den Zähler offener Freigaben im zugänglichen Namen („Freigaben 35 offen“).
    await expect(nav.getByRole('link', { name: /^Freigaben/ })).toBeVisible();
    await expect(nav.locator('[id^="nav-sub-"]')).toHaveCount(0);
    await expect(nav.locator('button[aria-expanded="true"]')).toHaveCount(0);
  });

  test('eine Unterroute öffnet nur ihre Gruppe; zurück auf Home schließt sie wieder', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginViaStorage(page, DEMO_USERS.admin);
    await page.goto('/finance/invoices');
    const nav = page.getByRole('navigation', { name: 'Hauptnavigation' });
    await expect(nav.locator('#nav-sub-finance')).toBeVisible();
    await expect(nav.locator('#nav-sub-sales')).toHaveCount(0);
    await expect(nav.locator('#nav-sub-administration')).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Rechnungen', exact: true })).toHaveAttribute('aria-current', 'page');

    await nav.getByRole('link', { name: 'Home', exact: true }).click();
    await page.waitForURL('**/dashboard');
    await expect(nav.locator('[id^="nav-sub-"]')).toHaveCount(0);

    // Browser-Zurück führt wieder auf die Unterseite und öffnet deren Gruppe.
    await page.goBack();
    await page.waitForURL('**/finance/invoices');
    await expect(nav.locator('#nav-sub-finance')).toBeVisible();
  });

  test('höchstens eine manuell geöffnete Gruppe; der Chevron hat ein eigenes Label', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginViaStorage(page, DEMO_USERS.admin);
    await openHome(page);
    const nav = page.getByRole('navigation', { name: 'Hauptnavigation' });
    await nav.getByRole('button', { name: 'Vertrieb: Unterseiten öffnen' }).click();
    await expect(nav.locator('#nav-sub-sales')).toBeVisible();
    await nav.getByRole('button', { name: 'Finanzen: Unterseiten öffnen' }).click();
    await expect(nav.locator('#nav-sub-finance')).toBeVisible();
    await expect(nav.locator('#nav-sub-sales')).toHaveCount(0);
  });

  test('der Navigationstext zeigt den Anzeigenamen aus dem Profil, nicht die E-Mail-Adresse', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginViaStorage(page, DEMO_USERS.admin);
    await openHome(page);
    await page.getByRole('button', { name: 'Profilmenü' }).click();
    const menu = page.getByRole('menu');
    await expect(menu).toContainText('@'); // die Adresse steht nur als Zweittext im Profilmenü
    await expect(page.getByRole('heading', { level: 1 })).not.toContainText('@');
  });
});

/** 120 synthetische Nachrichten: prüft nur die Geometrie, ohne ein Modell aufzurufen. */
async function mockLongThread(page: Page): Promise<void> {
  const messages = Array.from({ length: 120 }, (_, index) => ({
    id: `m-${index}`,
    tenantId: 't',
    conversationId: 'c-long',
    userId: index % 2 === 0 ? 'u' : null,
    role: index % 2 === 0 ? 'USER' : 'ASSISTANT',
    content: `Nachricht ${index + 1}: ${'Ein längerer Text, der umbrechen muss. '.repeat(index % 5 === 0 ? 6 : 1)}`,
    agentRunId: null,
    createdAt: new Date(Date.now() - (120 - index) * 60_000).toISOString(),
  }));
  await page.route('**/api/v1/copilot/conversations', (route) =>
    route.request().method() === 'GET' ? route.fulfill({ json: [{ id: 'c-long', tenantId: 't', userId: 'u', title: 'Lange Unterhaltung', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }] }) : route.continue(),
  );
  await page.route('**/api/v1/copilot/conversations/c-long/messages', (route) => (route.request().method() === 'GET' ? route.fulfill({ json: messages }) : route.continue()));
}

test.describe('Sonde (AC-07, AC-09, SONDE-01 bis SONDE-03)', () => {
  test('der Composer bleibt bei 120 Nachrichten im sichtbaren Panel – auch nach Resize und Routenwechsel', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockLongThread(page);
    await loginViaStorage(page, DEMO_USERS.admin);
    await openHome(page);

    const composer = page.getByLabel('Nachricht an Sonde');
    const inViewport = async () => {
      const box = (await composer.boundingBox())!;
      const vh = page.viewportSize()!.height;
      return box.y >= 0 && box.y + box.height <= vh + 1;
    };
    await expect(composer).toBeVisible();
    expect(await inViewport()).toBe(true);

    // Nur die Nachrichtenliste scrollt: Dokument und Panel nicht.
    const metrics = await page.evaluate(() => {
      const log = document.querySelector('[role="log"]') as HTMLElement;
      const panel = document.querySelector('[data-sonde="docked"]') as HTMLElement;
      return { logScrolls: log.scrollHeight > log.clientHeight + 50, panelV: panel.scrollHeight - panel.clientHeight, docV: document.documentElement.scrollHeight - document.documentElement.clientHeight };
    });
    expect(metrics.logScrolls).toBe(true);
    expect(metrics.panelV).toBeLessThanOrEqual(1);
    expect(metrics.docV).toBeLessThanOrEqual(1);

    await page.setViewportSize({ width: 1440, height: 640 });
    expect(await inViewport()).toBe(true);
    await page.setViewportSize({ width: 1600, height: 760 });
    expect(await inViewport()).toBe(true);

    await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Aufgaben', exact: true }).click();
    await page.waitForURL('**/tasks');
    expect(await inViewport()).toBe(true);
  });

  test('ungesendeter Text überlebt Seitenwechsel, Schließen/Öffnen und Neuladen (SONDE-03, AC-09)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginViaStorage(page, DEMO_USERS.admin);
    await openHome(page);
    const composer = page.getByLabel('Nachricht an Sonde');
    await composer.fill('Entwurf, der nicht verloren gehen darf');

    await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Aufgaben', exact: true }).click();
    await page.waitForURL('**/tasks');
    await expect(composer).toHaveValue('Entwurf, der nicht verloren gehen darf');

    await page.getByRole('button', { name: 'Sonde schließen' }).click();
    await expect(composer).toHaveCount(0);
    await page.getByRole('button', { name: 'Sonde', exact: true }).click();
    await expect(page.getByLabel('Nachricht an Sonde')).toHaveValue('Entwurf, der nicht verloren gehen darf');

    await page.reload();
    await expect(page.getByLabel('Nachricht an Sonde')).toHaveValue('Entwurf, der nicht verloren gehen darf');
  });

  test('Modi tragen verständliche deutsche Labels; nicht verfügbare sind sichtbar deaktiviert, Standard ist „Fragen“', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginViaStorage(page, DEMO_USERS.admin);
    await openHome(page);
    const select = page.getByLabel('Modus');
    await expect(select).toHaveValue('ASK');
    const options = await select.locator('option').evaluateAll((nodes) => nodes.map((n) => ({ text: (n as HTMLOptionElement).text.trim(), disabled: (n as HTMLOptionElement).disabled })));
    expect(options).toEqual([
      { text: 'Fragen', disabled: false },
      { text: 'Vorbereiten', disabled: false },
      { text: 'Ausführen', disabled: false },
      { text: 'Beauftragen (noch nicht verfügbar)', disabled: true },
      { text: 'Navigieren (noch nicht verfügbar)', disabled: true },
    ]);
    // Der Bereitschaftsstatus kommt aus der Laufzeit, nicht aus der Konfigurationsart.
    await expect(page.getByRole('status').filter({ hasText: /Bereit|Simulationsmodus|Modell gestört|Nicht erreichbar/ }).first()).toBeVisible();
  });

  test('der Eingang einer Nachricht fällt nie unter die Tastatur: auf Mobilgerät öffnet Sonde als Vollbild mit sichtbarem Composer', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginViaStorage(page, DEMO_USERS.admin);
    await page.goto('/dashboard');
    await page.getByRole('button', { name: 'Sonde', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Sonde' });
    await expect(dialog).toBeVisible();
    const box = (await page.getByLabel('Nachricht an Sonde').boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(844 + 1);
    await page.getByRole('button', { name: 'Sonde schließen' }).click();
    await expect(dialog).toHaveCount(0);
  });
});

test.describe('Anpassung und Reflow (AC-21, HOME-03, HOME-04)', () => {
  test('Ansicht anpassen: eine Zone ausblenden, nach Neuladen erhalten, mit „Standard wiederherstellen“ zurück', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginViaStorage(page, DEMO_USERS.admin);
    await openHome(page);

    await page.getByRole('button', { name: 'Ansicht anpassen' }).click();
    const dialog = page.getByRole('dialog', { name: 'Ansicht anpassen' });
    await expect(dialog).toBeVisible();
    // Die Aufmerksamkeit ist nicht abschaltbar.
    await expect(dialog.getByRole('checkbox', { name: /Benötigt Ihre Aufmerksamkeit/ })).toBeDisabled();
    await dialog.getByLabel('Neu im Posteingang').uncheck();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Neu im Posteingang' })).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Benötigt Ihre Aufmerksamkeit' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Neu im Posteingang' })).toHaveCount(0);
    // Auch mit ausgeblendeter Zone passt Home auf eine Seite.
    const homeV = await page.evaluate(() => {
      const home = document.querySelector('[data-home-layout]') as HTMLElement;
      return home.scrollHeight - home.clientHeight;
    });
    expect(homeV).toBeLessThanOrEqual(1);

    await page.getByRole('button', { name: 'Ansicht anpassen' }).click();
    await page.getByRole('button', { name: 'Standard wiederherstellen' }).click();
    await page.getByRole('button', { name: 'Fertig' }).click();
    await expect(page.getByRole('heading', { name: 'Neu im Posteingang' })).toBeVisible();
  });

  test('Mobil 390×844 und 320×740: vertikales Scrollen erlaubt, kein horizontaler Überlauf, Aktionen erreichbar', async ({ page }) => {
    for (const [width, height] of [
      [390, 844],
      [320, 740],
    ] as const) {
      await page.setViewportSize({ width, height });
      await loginViaStorage(page, DEMO_USERS.admin);
      await openHome(page);
      const m = await page.evaluate(() => {
        const home = document.querySelector('[data-home-layout]') as HTMLElement;
        return { layout: home.dataset.homeLayout, homeH: home.scrollWidth - home.clientWidth, docH: document.documentElement.scrollWidth - document.documentElement.clientWidth };
      });
      expect(m.layout).toBe('reflow');
      expect(m.homeH).toBeLessThanOrEqual(1);
      expect(m.docH).toBeLessThanOrEqual(1);
      await page.getByRole('button', { name: 'Navigation öffnen' }).click();
      await expect(page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Posteingang' })).toBeVisible();
      await page.keyboard.press('Escape');
    }
  });

  test('200 % Zoom bei 1280×720 (= 640×360 CSS-Pixel): Reflow statt Verkleinern, Sonde erreichbar', async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 360 });
    await loginViaStorage(page, DEMO_USERS.admin);
    await openHome(page);
    const m = await page.evaluate(() => {
      const home = document.querySelector('[data-home-layout]') as HTMLElement;
      return { layout: home.dataset.homeLayout, homeH: home.scrollWidth - home.clientWidth, canScroll: home.scrollHeight > home.clientHeight };
    });
    expect(m.layout).toBe('reflow');
    expect(m.homeH).toBeLessThanOrEqual(1);
    expect(m.canScroll).toBe(true);
    await page.getByRole('button', { name: 'Sonde', exact: true }).click();
    await expect(page.getByLabel('Nachricht an Sonde')).toBeVisible();
  });
});

test.describe('Tastatur und Zugänglichkeit (AC-19)', () => {
  test('der erste Tabstopp ist „Zum Inhalt springen“ und führt in den Arbeitsbereich', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginViaStorage(page, DEMO_USERS.admin);
    await openHome(page);
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Zum Inhalt springen' });
    await expect(skip).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main')).toBeFocused();
  });

  test('Landmarken: Navigation, Header, Hauptbereich und Sonde sind erreichbar benannt', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginViaStorage(page, DEMO_USERS.admin);
    await openHome(page);
    await expect(page.getByRole('navigation', { name: 'Hauptnavigation' })).toBeVisible();
    await expect(page.getByRole('banner')).toBeVisible();
    await expect(page.getByRole('main', { name: 'Arbeitsbereich' })).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Sonde' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  });

  test('globale Suche: findet berechtigte Objekte und ist per Tastatur bedienbar', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginViaStorage(page, DEMO_USERS.admin);
    await openHome(page);
    const search = page.getByRole('combobox', { name: 'In ORBIT suchen' });
    await search.fill('IT-Service');
    const invoice = page.getByRole('option').filter({ has: page.getByText('Rechnung', { exact: true }) }).first();
    await expect(invoice).toBeVisible();
    // Tastatur: Pfeil nach unten wählt das nächste Ergebnis, Enter öffnet es.
    await search.press('ArrowDown');
    await expect(page.getByRole('option').nth(1)).toHaveAttribute('aria-selected', 'true');
    await search.press('Escape');
    await expect(page.getByRole('listbox')).toHaveCount(0);
    await search.fill('IT-Service');
    await page.getByRole('option').filter({ has: page.getByText('Rechnung', { exact: true }) }).first().click();
    await page.waitForURL('**/finance/invoices/**');
  });
});
