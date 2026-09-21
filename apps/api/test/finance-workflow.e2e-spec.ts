import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { MockOcrProvider } from '@orbit/integration-core';
import { OCR_PROVIDER } from '../src/connectors/connectors.tokens';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

/**
 * End-to-end Finance workflow against the live Postgres + MinIO stack (no
 * mocked Prisma/Storage — only the OCR_PROVIDER/FINANCE_CONNECTOR are mock
 * *implementations*, selected the same way production would select a real
 * one, per docs/INTEGRATIONS.md). Closes the gap flagged in
 * docs/IMPLEMENTATION_STATUS.md ("Document-Upload gegen echtes MinIO noch
 * nicht live getestet") by performing a real presigned-URL PUT.
 *
 * Uses the seeded "Musterwerk GmbH" demo users (Phase 13) for auth, but
 * creates its own fresh suppliers/documents/invoices per run (unique
 * names/invoice numbers via randomUUID) rather than mutating the seeded
 * fixtures the frontend demo/manual QA relies on — see docs/DEMO_DATA.md.
 */
describe('Finance workflow (e2e)', () => {
  let app: INestApplication;
  let ocrProvider: MockOcrProvider;

  let adminToken: string;
  let financeToken: string;
  let approverToken: string;

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    ocrProvider = app.get(OCR_PROVIDER);

    const login = async (email: string) => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: 'Musterwerk#2026!' })
        .expect(200);
      return response.body.accessToken as string;
    };
    adminToken = await login('admin@musterwerk.example');
    financeToken = await login('finance@musterwerk.example');
    approverToken = await login('approval@musterwerk.example');
  });

  afterAll(async () => {
    await app.close();
  });

  /** Uploads a document via the real presigned-URL flow (Nest -> MinIO). */
  async function uploadDocument(): Promise<string> {
    const fileName = `e2e-invoice-${randomUUID()}.pdf`;
    const bytes = Buffer.from(`%PDF-1.4 e2e fixture ${randomUUID()}`, 'utf-8');

    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/documents/upload-url')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ fileName, mimeType: 'application/pdf', sizeBytes: bytes.byteLength })
      .expect(201);

    const { document, uploadUrl } = createResponse.body as { document: { id: string }; uploadUrl: string };

    const putResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/pdf' },
      body: bytes,
    });
    expect(putResponse.ok).toBe(true);

    return document.id;
  }

  it('creates a supplier as PENDING_APPROVAL under the default policy, then an approver activates it', async () => {
    const supplierName = `E2E Lieferant ${randomUUID()}`;

    const created = await request(app.getHttpServer())
      .post('/api/v1/suppliers')
      .set('Authorization', `Bearer ${approverToken}`)
      .send({ name: supplierName, taxId: `DE-${randomUUID()}` })
      .expect(201);
    expect(created.body.status).toBe('PENDING_APPROVAL');
    expect(created.body.externalFinanceId).toBeNull();

    const approved = await request(app.getHttpServer())
      .patch(`/api/v1/suppliers/${created.body.id}/approve`)
      .set('Authorization', `Bearer ${approverToken}`)
      .expect(200);
    expect(approved.body.status).toBe('ACTIVE');
    expect(approved.body.externalFinanceId).toEqual(expect.any(String));
  });

  it('processes an invoice end-to-end: upload -> OCR -> supplier match -> booking -> approval -> FiBu transfer', async () => {
    const supplierName = `E2E Nord Werkzeuge ${randomUUID()}`;
    const supplierCreate = await request(app.getHttpServer())
      .post('/api/v1/suppliers')
      .set('Authorization', `Bearer ${approverToken}`)
      .send({ name: supplierName })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/api/v1/suppliers/${supplierCreate.body.id}/approve`)
      .set('Authorization', `Bearer ${approverToken}`)
      .expect(200);

    const documentId = await uploadDocument();
    ocrProvider.seedResult({
      supplierName,
      invoiceNumber: `E2E-${randomUUID()}`,
      amountNet: 100,
      amountGross: 119,
      vatAmount: 19,
      vatRate: 19,
      confidenceScore: 0.95,
    });

    const invoiceCreate = await request(app.getHttpServer())
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ documentId })
      .expect(201);
    expect(invoiceCreate.body.status).toBe('PENDING_APPROVAL');
    expect(invoiceCreate.body.supplierId).toBe(supplierCreate.body.id);
    const invoiceId = invoiceCreate.body.id as string;

    await request(app.getHttpServer())
      .post(`/api/v1/invoices/${invoiceId}/booking-proposal`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ accountCode: '4400', amount: 119 })
      .expect(201);

    const approved = await request(app.getHttpServer())
      .patch(`/api/v1/invoices/${invoiceId}/approve`)
      .set('Authorization', `Bearer ${approverToken}`)
      .expect(200);
    expect(approved.body.status).toBe('APPROVED');

    const transferred = await request(app.getHttpServer())
      .post(`/api/v1/invoices/${invoiceId}/transfer`)
      .set('Authorization', `Bearer ${approverToken}`)
      .expect(201);
    expect(transferred.body.status).toBe('TRANSFERRED');
  });

  it('flags a second invoice with the same invoice number + amount as DUPLICATE_SUSPECTED', async () => {
    const sharedInvoiceNumber = `E2E-DUP-${randomUUID()}`;

    const firstDocumentId = await uploadDocument();
    ocrProvider.seedResult({ invoiceNumber: sharedInvoiceNumber, amountGross: 250, confidenceScore: 0.9 });
    const first = await request(app.getHttpServer())
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ documentId: firstDocumentId })
      .expect(201);
    expect(first.body.status).toBe('PENDING_APPROVAL');

    const secondDocumentId = await uploadDocument();
    ocrProvider.seedResult({ invoiceNumber: sharedInvoiceNumber, amountGross: 250, confidenceScore: 0.9 });
    const second = await request(app.getHttpServer())
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ documentId: secondDocumentId })
      .expect(201);
    expect(second.body.status).toBe('DUPLICATE_SUSPECTED');
    expect(second.body.duplicateOfInvoiceId).toBe(first.body.id);
  });

  it('rejects transfer with the documented 403 when no supplier was matched', async () => {
    const documentId = await uploadDocument();
    ocrProvider.seedResult({
      invoiceNumber: `E2E-NOSUP-${randomUUID()}`,
      amountGross: 42,
      confidenceScore: 0.4,
    });

    const invoiceCreate = await request(app.getHttpServer())
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ documentId })
      .expect(201);
    expect(invoiceCreate.body.supplierId).toBeNull();
    const invoiceId = invoiceCreate.body.id as string;

    await request(app.getHttpServer())
      .post(`/api/v1/invoices/${invoiceId}/booking-proposal`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ accountCode: '4400', amount: 42 })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/api/v1/invoices/${invoiceId}/approve`)
      .set('Authorization', `Bearer ${approverToken}`)
      .expect(200);

    const transferAttempt = await request(app.getHttpServer())
      .post(`/api/v1/invoices/${invoiceId}/transfer`)
      .set('Authorization', `Bearer ${approverToken}`)
      .expect(403);
    expect(transferAttempt.body.message).toBe('Invoice has no matched supplier to transfer to.');
  });
});
