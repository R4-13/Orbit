import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { API_BASE_URL, DEMO_USERS, loginViaApi, loginViaUi } from './utils/login';

async function apiPost<T>(path: string, token: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_BASE_URL}/api/v1${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`POST ${path} failed: ${response.status} ${await response.text()}`);
  }
  return response.json() as Promise<T>;
}

async function apiPatch<T>(path: string, token: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API_BASE_URL}/api/v1${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    throw new Error(`PATCH ${path} failed: ${response.status} ${await response.text()}`);
  }
  return response.json() as Promise<T>;
}

test.describe('Finance', () => {
  test('invoice list shows the seeded Musterwerk fixtures with correct German status labels', async ({
    page,
  }) => {
    await loginViaUi(page, DEMO_USERS.finance);
    await page.goto('/finance/invoices');
    // UI v2 §12.1: Standard ist „Zu bearbeiten“; abgeschlossene Rechnungen stehen unter „Alle Rechnungen“.
    await page.getByRole('button', { name: /^Alle Rechnungen/ }).click();

    // Not an exact row count: other e2e/manual test runs against this same
    // dev DB create their own additional invoices (by design, so they never
    // mutate these seeded fixtures — see finance-workflow.e2e-spec.ts) and
    // accumulate across runs without a reseed in between.
    await expect(page.getByText('RE-2026-0312')).toBeVisible();
    const schmidtRow = page.locator('tbody tr', { hasText: 'SW-2026-014' });
    await expect(schmidtRow.getByText('Freigabe erforderlich')).toBeVisible();
    const itServiceRow = page.locator('tbody tr', { hasText: 'INV-8842' });
    await expect(itServiceRow.getByText('Freigegeben')).toBeVisible();

    // Two RE-2026-0455 rows: the original (Übertragen) + its detected
    // duplicate (Mögliche Dublette) — scoped by invoice number since other
    // e2e/manual runs against this same dev DB create their own additional
    // duplicate-suspected invoices (with different invoice numbers) over time.
    const duplicateNumberRows = page.locator('tbody tr', { hasText: 'RE-2026-0455' });
    await expect(duplicateNumberRows).toHaveCount(2);
    await expect(duplicateNumberRows.filter({ hasText: 'Übertragen' })).toHaveCount(1);
    await expect(duplicateNumberRows.filter({ hasText: 'Mögliche Dublette' })).toHaveCount(1);
  });

  test('approves a newly created pending supplier from the UI', async ({ page }) => {
    // Fresh fixture per run (via the real API), independent of seed/previous-run state.
    const adminToken = await loginViaApi(DEMO_USERS.admin);
    const supplierName = `E2E Playwright Lieferant ${randomUUID()}`;
    await apiPost('/suppliers', adminToken, { name: supplierName });

    await loginViaUi(page, DEMO_USERS.admin);
    await page.goto('/finance/suppliers');

    const row = page.locator('tr', { hasText: supplierName });
    await expect(row.getByText('Freigabe erforderlich')).toBeVisible();

    await row.getByRole('button', { name: 'Freigeben' }).click();
    await expect(row.getByText('Aktiv')).toBeVisible();
    await expect(row.getByRole('button', { name: 'Freigeben' })).not.toBeVisible();
  });

  test('shows the backend error message when transferring an invoice with no matched supplier', async ({
    page,
  }) => {
    // Build an APPROVED-but-supplierless invoice via the real API: the
    // running dev server's MockOcrProvider queue is empty by default, so an
    // upload with no seeded OCR result naturally extracts no supplierName.
    const adminToken = await loginViaApi(DEMO_USERS.admin);
    const financeToken = await loginViaApi(DEMO_USERS.finance);
    const approverToken = await loginViaApi(DEMO_USERS.approver);

    const fileName = `e2e-web-${randomUUID()}.pdf`;
    const bytes = Buffer.from(`%PDF-1.4 e2e web fixture ${randomUUID()}`, 'utf-8');
    const { document, uploadUrl } = await apiPost<{ document: { id: string }; uploadUrl: string }>(
      '/documents/upload-url',
      adminToken,
      { fileName, mimeType: 'application/pdf', sizeBytes: bytes.byteLength },
    );
    const putResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/pdf' },
      body: bytes,
    });
    expect(putResponse.ok).toBe(true);

    const invoice = await apiPost<{ id: string; supplierId: string | null }>('/invoices', financeToken, {
      documentId: document.id,
    });
    expect(invoice.supplierId).toBeNull();
    await apiPost(`/invoices/${invoice.id}/booking-proposal`, financeToken, {
      accountCode: '4400',
      amount: 10,
    });
    await apiPatch(`/invoices/${invoice.id}/approve`, approverToken);

    await loginViaUi(page, DEMO_USERS.approver);
    await page.goto(`/finance/invoices/${invoice.id}`);
    await page.getByRole('button', { name: 'Zur Buchhaltung übertragen' }).click();

    await expect(page.getByText('Invoice has no matched supplier to transfer to.')).toBeVisible();
  });
});
