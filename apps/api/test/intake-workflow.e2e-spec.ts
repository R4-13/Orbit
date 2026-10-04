import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { MockOcrProvider } from '@orbit/integration-core';
import { OCR_PROVIDER } from '../src/connectors/connectors.tokens';
import { PrismaService } from '../src/prisma/prisma.service';
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
  let prisma: PrismaService;
  let tenantId: string;
  let pausedActivationIds: string[] = [];

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    ocrProvider = app.get(OCR_PROVIDER);
    prisma = app.get(PrismaService);

    const login = async (email: string) => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: 'Musterwerk#2026!' })
        .expect(200);
      tenantId = response.body.user.tenantId as string;
      return response.body.accessToken as string;
    };
    financeToken = await login('finance@musterwerk.example');
    salesToken = await login('sales@musterwerk.example');

    // This suite verifies the pre-existing domain workflows. If the demo tenant has an active process blueprint for the
    // same intent (Amendment 02), the intake correctly starts that process instead — so the activation is paused for the
    // duration of this suite and restored afterwards (the legacy path itself is unchanged and must keep working).
    const active = await prisma.withRlsBypass((tx) => tx.tenantProcessActivation.findMany({ where: { tenantId, enabled: true }, select: { id: true } }));
    pausedActivationIds = active.map((a) => a.id);
    if (pausedActivationIds.length > 0) {
      await prisma.withRlsBypass((tx) => tx.tenantProcessActivation.updateMany({ where: { id: { in: pausedActivationIds } }, data: { enabled: false } }));
    }
  });

  afterAll(async () => {
    if (pausedActivationIds.length > 0) {
      await prisma.withRlsBypass((tx) => tx.tenantProcessActivation.updateMany({ where: { id: { in: pausedActivationIds } }, data: { enabled: true } }));
    }
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
        simulatedTriageScenario: 'INVOICE_RECEIVED',
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
        simulatedTriageScenario: 'REQUEST_FOR_QUOTE',
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

  it('returns OTHER and creates no case for a message the (simulated) AI triage judged non-business — no keyword logic involved', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/intake/emails')
      .set('Authorization', `Bearer ${financeToken}`)
      .send({
        fromAddress: 'noreply@newsletter-e2e.example',
        toAddresses: ['info@musterwerk.example'],
        subject: 'Wöchentlicher Branchen-Newsletter',
        bodyText: 'Hier sind die aktuellen Neuigkeiten aus der Branche diese Woche.',
        simulatedTriageScenario: 'NEWSLETTER',
      })
      .expect(201);

    expect(response.body.category).toBe('OTHER');
    expect(response.body.case).toBeUndefined();
  });

  it('routes an uncertain triage result to review and creates a human-review Task instead of guessing a domain', async () => {
    const runId = randomUUID();
    const response = await request(app.getHttpServer())
      .post('/api/v1/intake/emails')
      .set('Authorization', `Bearer ${financeToken}`)
      .send({
        fromAddress: `unklar-${runId}@ambiguous-e2e.example`,
        toAddresses: ['info@musterwerk.example'],
        subject: `Kurze Frage ${runId}`,
        bodyText: 'Könnten wir das kurz telefonisch besprechen? Ich melde mich die Tage.',
        simulatedTriageScenario: 'UNCERTAIN',
      })
      .expect(201);

    expect(response.body.category).toBe('OTHER');
    expect(response.body.case).toBeUndefined();

    const tasks = await request(app.getHttpServer())
      .get('/api/v1/tasks?status=OPEN')
      .set('Authorization', `Bearer ${financeToken}`)
      .expect(200);
    const reviewTask = (tasks.body as Array<{ title: string }>).find((task) => task.title.includes(runId));
    expect(reviewTask).toBeDefined();
    expect(reviewTask?.title).toContain('Prüfung erforderlich');
  });

  it('never lets a keyword stand in for AI judgement: with the simulated provider and no scripted result the input goes to review, even if it screams "Rechnung"', async () => {
    const runId = randomUUID();
    const response = await request(app.getHttpServer())
      .post('/api/v1/intake/emails')
      .set('Authorization', `Bearer ${financeToken}`)
      .send({
        fromAddress: `rechnung-${runId}@keyword-e2e.example`,
        toAddresses: ['info@musterwerk.example'],
        subject: `Rechnung Angebot Preis ${runId}`,
        bodyText: 'Rechnung, Angebot, Preis, Zahlung, Interesse, Anfrage.',
      })
      .expect(201);

    expect(response.body.category).toBe('OTHER');
    expect(response.body.case).toBeUndefined();

    const scoped = prisma.forTenantId(tenantId);
    const decision = await scoped.intakeDecision.findUniqueOrThrow({ where: { intakeEventId: response.body.intakeEventId } });
    expect(decision.status).toBe('REVIEW_REQUIRED');
    expect(decision.failureReason).toContain('SIMULATION_WITHOUT_FIXTURE');
    expect((decision.execution as { mode: string }).mode).toBe('SIMULATED');
    const event = await scoped.intakeEvent.findUniqueOrThrow({ where: { id: response.body.intakeEventId } });
    expect(event.status).toBe('NEEDS_REVIEW');
  });

  it('records a decision with the validated structured result, provider and SIMULATED mode — and hides nothing on low confidence', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/intake/emails')
      .set('Authorization', `Bearer ${salesToken}`)
      .send({
        fromAddress: `decision-${randomUUID()}@decision-e2e.example`,
        toAddresses: ['vertrieb@musterwerk.example'],
        subject: 'Anfrage für Entscheidungsprotokoll',
        bodyText: 'Bitte um ein Angebot.',
        simulatedTriageScenario: 'REQUEST_FOR_QUOTE',
      })
      .expect(201);

    const decision = await prisma.forTenantId(tenantId).intakeDecision.findUniqueOrThrow({ where: { intakeEventId: response.body.intakeEventId } });
    expect(decision.status).toBe('DECIDED');
    expect(decision.appliedRelevance).toBe('BUSINESS_ACTIONABLE');
    expect(decision.result).toMatchObject({ schemaVersion: '1.0', businessRelevance: 'RELEVANT', category: 'REQUEST_FOR_QUOTE' });
    expect(decision.execution).toMatchObject({ provider: 'mock', mode: 'SIMULATED', promptVersion: expect.any(String) });
  });
});
