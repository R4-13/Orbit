import { expect, test } from '@playwright/test';
import { DEMO_USERS, loginViaUi } from './utils/login';

/** A 1x1 transparent PNG — the smallest valid PNG byte sequence. */
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

test.describe('Branding — logo upload', () => {
  test('uploads a real PNG via the hidden file input, the public URL lands in the Logo field, and survives a reload', async ({
    page,
  }) => {
    await loginViaUi(page, DEMO_USERS.admin);
    await page.goto('/admin/branding');

    const logoInput = page.locator('#branding-logo');
    const fileInput = logoInput.locator('xpath=../input[@type="file"]');
    // Ein früherer Lauf kann bereits ein Logo gespeichert haben – gewartet wird auf den NEUEN Wert, nicht auf irgendeinen passenden.
    await expect(logoInput).toBeVisible();
    await page.waitForTimeout(500);
    const previousUrl = await logoInput.inputValue();
    await fileInput.setInputFiles({ name: 'playwright-logo.png', mimeType: 'image/png', buffer: ONE_PIXEL_PNG });

    // The upload is async (request-upload-url -> PUT to object storage); wait for the field to actually change.
    await expect(logoInput).not.toHaveValue(previousUrl, { timeout: 10_000 });
    await expect(logoInput).toHaveValue(/\/public\/tenants\/.+playwright-logo\.png$/, { timeout: 10_000 });
    const uploadedUrl = await logoInput.inputValue();

    // The uploaded object is really there and really publicly readable — not just a URL string in the form.
    const response = await page.request.get(uploadedUrl);
    expect(response.status()).toBe(200);
    expect(await response.body()).toEqual(ONE_PIXEL_PNG);

    await page.getByRole('button', { name: 'Speichern' }).click();
    // Erst neu laden, wenn der Server das Speichern bestätigt hat (die Seite zeigt dann „Gespeichert“).
    await expect(page.getByText('Gespeichert', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.locator('#branding-logo')).toHaveValue(uploadedUrl);
  });

  test('rejects an oversized file client-side before ever requesting an upload URL', async ({ page }) => {
    await loginViaUi(page, DEMO_USERS.admin);
    await page.goto('/admin/branding');

    const logoInput = page.locator('#branding-logo');
    const fileInput = logoInput.locator('xpath=../input[@type="file"]');
    const oversized = Buffer.alloc(3 * 1024 * 1024, 1); // 3 MB > the 2 MB client-side limit

    let uploadUrlRequested = false;
    await page.route('**/tenant/branding/logo-upload-url', (route) => {
      uploadUrlRequested = true;
      return route.continue();
    });

    await fileInput.setInputFiles({ name: 'too-big.png', mimeType: 'image/png', buffer: oversized });
    // Matches the dynamic validation error specifically, not the always-visible
    // "PNG, JPEG oder WebP, maximal 2 MB." helper text under the same field.
    await expect(page.getByText(/Datei zu groß/i)).toBeVisible();
    expect(uploadUrlRequested).toBe(false);
  });
});
