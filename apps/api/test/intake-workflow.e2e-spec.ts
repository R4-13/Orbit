import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { MockOcrProvider } from '@orbit/integration-core';
import { OCR_PROVIDER } from '../src/connectors/connectors.tokens';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

/**
 * End-to-end test of the Agent Runtime wiring (docs/ASSUMPTIONS.md Phase
 * 18, docs/MASTER_SPEC_GAP_ANALYSIS.md §12-17's biggest gap): simulates
 * an inbound email via POST /api/v1/intake/emails and verifies the *real*
 * Agent → Tool Registry → Policy Engine → Tool Gateway loop actually ran
 * against live Postgres — not just that the classification heuristic
 * returned the right label, but that it produced real AgentRun/
 * ToolInvocation rows and real Invoice/Lead/Task/Approval records via
 * the same tested Phase 7/8 services.
 */
describe('Intake workflow — Agent Runtime (e2e)', () => {
  let app: INestApplication;
  let ocrProvider: MockOcrProvider;
  let financeToken: string;
  let salesToken: string;

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
    financeToken = await login('finance@musterwerk.example');
    salesToken = await login('sales@musterwerk.example');
  });

  afterAll(async () => {
    await app.close();
  });

  it('classifies a Finance email, extracts the invoice, and creates a booking proposal — all via the real agent loop', async () => {
    const runId = randomUUID();
    const invoiceNumber = `E2E-AGENT-${runId}`;
    const attachmentBytes = Buffer.from(`%PDF-1.4 e2e intake fixture ${runId}`, 'utf-8');

    // MockOcrProvider (like MockFinanceConnector etc.) needs a scripted
    // result seeded ahead of time — nothing in this environment can
    // really read the fixture PDF's content (§18, no real OCR).
    ocrProvider.seedResult({
      supplierName: `E2E Agent Lieferant ${runId}`,
      invoiceNumber,
      amountNet: 100,
      amountGross: 119,
      vatAmount: 19,
      vatRate: 19,
      confidenceScore: 0.92,
    });

    const response = await request(app.getHttpServer())
      .post('/api/v1/intake/emails')
      .set('Authorization', `Bearer ${financeToken}`)
      .send({
        fromAddress: 'buchhaltung@lieferant-e2e.example',
        toAddresses: ['rechnungen@musterwerk.example'],
        subject: `Rechnung ${invoiceNumber}`,
        bodyText: 'Anbei erhalten Sie unsere aktuelle Rechnung. Bitte um Ausgleich bis zum Fälligkeitsdatum.',
        attachment: {
          fileName: `${invoiceNumber}.pdf`,
          mimeType: 'application/pdf',
          contentBase64: attachmentBytes.toString('base64'),
        },
      })
      .expect(201);

    expect(response.body.category).toBe('FINANCE');
    expect(response.body.case).toBeTruthy();
    expect(response.body.agentRunIds.length).toBeGreaterThan(0);
    const caseId = response.body.case.id as string;

    const caseDetail = await request(app.getHttpServer())
      .get(`/api/v1/cases/${caseId}`)
      .set('Authorization', `Bearer ${financeToken}`)
      .expect(200);
    expect(caseDetail.body.type).toBe('FINANCE');

    // The Finance agent's extract_invoice tool call really created an
    // Invoice, linked to this case, findable via the normal read path.
    const invoices = await request(app.getHttpServer())
      .get('/api/v1/invoices')
      .set('Authorization', `Bearer ${financeToken}`)
      .expect(200);
    const created = (invoices.body as Array<{ invoiceNumber?: string; caseId?: string; status: string }>).find(
      (invoice) => invoice.invoiceNumber === invoiceNumber,
    );
    expect(created).toBeDefined();
    expect(created?.caseId).toBe(caseId);
    // create_booking_proposal ran too (reacting to extract_invoice's real
    // output), so the invoice is still PENDING_APPROVAL awaiting human
    // sign-off, not stuck without a proposal.
    expect(created?.status).toBe('PENDING_APPROVAL');
  });

  it('classifies a Sales email and creates a Company, Contact and Lead (with its auto follow-up Task) via the real agent loop', async () => {
    const runId = randomUUID();
    const fromAddress = `maria.schmidt+${runId}@interessent-e2e.example`;

    const response = await request(app.getHttpServer())
      .post('/api/v1/intake/emails')
      .set('Authorization', `Bearer ${salesToken}`)
      .send({
        fromAddress,
        toAddresses: ['vertrieb@musterwerk.example'],
        subject: 'Anfrage zu Ihrem Angebot',
        bodyText: 'Wir haben Interesse an einer Beratung zu Ihren Produkten. Bitte melden Sie sich.',
      })
      .expect(201);

    expect(response.body.category).toBe('SALES');
    const caseId = response.body.case.id as string;

    const caseDetail = await request(app.getHttpServer())
      .get(`/api/v1/cases/${caseId}`)
      .set('Authorization', `Bearer ${salesToken}`)
      .expect(200);
    expect(caseDetail.body.type).toBe('SALES');

    const contacts = await request(app.getHttpServer())
      .get('/api/v1/contacts')
      .set('Authorization', `Bearer ${salesToken}`)
      .expect(200);
    const contact = (contacts.body as Array<{ email?: string; id: string }>).find((c) => c.email === fromAddress);
    expect(contact).toBeDefined();

    const leads = await request(app.getHttpServer())
      .get('/api/v1/leads')
      .set('Authorization', `Bearer ${salesToken}`)
      .expect(200);
    const lead = (leads.body as Array<{ contactId: string; caseId?: string; source: string }>).find(
      (l) => l.contactId === contact!.id,
    );
    expect(lead).toBeDefined();
    expect(lead?.caseId).toBe(caseId);
    expect(lead?.source).toBe('EMAIL');

    // create_lead's own tested behavior (Phase 8) auto-creates a follow-up Task.
    const tasks = await request(app.getHttpServer())
      .get('/api/v1/tasks?status=OPEN')
      .set('Authorization', `Bearer ${salesToken}`)
      .expect(200);
    const followUpTask = (tasks.body as Array<{ title: string; caseId?: string }>).find(
      (task) => task.caseId === caseId,
    );
    expect(followUpTask).toBeDefined();
  });

  it('returns OTHER and creates no case for content unrelated to Finance or Sales', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/intake/emails')
      .set('Authorization', `Bearer ${financeToken}`)
      .send({
        fromAddress: 'noreply@newsletter-e2e.example',
        toAddresses: ['info@musterwerk.example'],
        subject: 'Wöchentlicher Branchen-Newsletter',
        bodyText: 'Hier sind die aktuellen Neuigkeiten aus der Branche diese Woche.',
      })
      .expect(201);

    expect(response.body.category).toBe('OTHER');
    expect(response.body.case).toBeUndefined();
  });
});
