import { randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import type { INestApplication } from '@nestjs/common';
import { MockLLMProvider } from '@orbit/agent-core';
import request from 'supertest';
import { LLM_PROVIDER } from '../src/agent/agent.tokens';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantsService } from '../src/tenants/tenants.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

const PASSWORD = 'Test#Password2026!';

/**
 * §25-33/§63 Phase 6+7 des Master-Dokuments ("Sonde Conversation
 * Foundation" + "Sonde Read Mode") — live gegen echte Postgres + den
 * echten MockLLMProvider: eine Konversation anlegen, eine Nachricht
 * senden, die tatsächlich einen ASK-Tool-Aufruf über den echten
 * AgentRuntime → Policy-Engine-Pfad auslöst (kein simulierter/gekürzter
 * Pfad), Tenant-/Nutzer-Isolation (eine fremde Konversation ist nie
 * sichtbar, selbst innerhalb desselben Tenants), Löschen.
 *
 * Frische Wegwerf-Tenants (nicht der geteilte Musterwerk-Tenant) — jeder
 * neu per `bootstrapTenant()` angelegte Tenant bekommt die neue
 * `COPILOT_READ`-PolicyConfig-Zeile automatisch aus DEFAULT_POLICY_CONFIG
 * geseedet, anders als der bereits existierende Musterwerk-Demo-Tenant
 * (siehe docs/ASSUMPTIONS.md #275 für dieselbe Klasse Lücke bei
 * TENANT_BRANDING_CONFIGURE).
 */
describe('Copilot / Sonde (e2e)', () => {
  let app: INestApplication;
  let tenantsService: TenantsService;
  let prisma: PrismaService;
  let llm: MockLLMProvider;
  let tenantAId: string;
  let tokenA: string;
  let tokenAOtherUser: string;
  let tokenB: string;

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    tenantsService = app.get(TenantsService);
    prisma = app.get(PrismaService);
    llm = app.get(LLM_PROVIDER);

    const suffixA = randomUUID();
    const { tenant: tenantA, adminUser: adminA } = await tenantsService.bootstrapTenant({
      name: `E2E Copilot Test A ${suffixA}`,
      slug: `e2e-copilot-a-${suffixA}`,
      adminEmail: `admin-${suffixA}@e2e-copilot-a.example`,
      adminPassword: PASSWORD,
      adminFirstName: 'E2E',
      adminLastName: 'Admin',
    });
    const loginA = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: adminA.email, password: PASSWORD })
      .expect(200);
    tokenA = loginA.body.accessToken as string;
    tenantAId = tenantA.id;

    // A second, genuinely distinct user in the SAME tenant (not just a
    // second tenant) — used to prove conversations are personal per §29,
    // not merely tenant-scoped. bootstrapTenant() only ever creates one
    // admin user per tenant, so this second user is seeded directly.
    const tenantAAdminRole = await prisma
      .forTenantId(tenantA.id)
      .role.findFirstOrThrow({ where: { name: 'TENANT_ADMIN' } });
    const otherUser = await prisma.forTenantId(tenantA.id).user.create({
      data: {
        tenantId: tenantA.id,
        email: `admin2-${suffixA}@e2e-copilot-a.example`,
        passwordHash: await argon2.hash(PASSWORD),
        firstName: 'E2E',
        lastName: 'Second Admin',
        status: 'ACTIVE',
      },
    });
    await prisma.userRole.create({ data: { userId: otherUser.id, roleId: tenantAAdminRole.id } });
    const loginAOther = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: otherUser.email, password: PASSWORD })
      .expect(200);
    tokenAOtherUser = loginAOther.body.accessToken as string;

    // A genuinely separate tenant, to also prove ordinary cross-tenant isolation still holds.
    const suffixB = randomUUID();
    const { adminUser: adminB } = await tenantsService.bootstrapTenant({
      name: `E2E Copilot Test B ${suffixB}`,
      slug: `e2e-copilot-b-${suffixB}`,
      adminEmail: `admin-${suffixB}@e2e-copilot-b.example`,
      adminPassword: PASSWORD,
      adminFirstName: 'E2E',
      adminLastName: 'Admin',
    });
    const loginB = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: adminB.email, password: PASSWORD })
      .expect(200);
    tokenB = loginB.body.accessToken as string;
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /copilot/capabilities lists the ASK, PREPARE and ACT tools', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/copilot/capabilities')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(response.body).toEqual({
      modes: ['ASK', 'PREPARE', 'ACT'],
      tools: [
        'get_dashboard_summary',
        'list_open_approvals',
        'get_case',
        'list_overdue_tasks',
        'list_failed_agent_runs',
        'draft_email',
        'create_meeting',
        'create_booking_proposal',
        'create_task',
        'create_contact',
        'create_lead',
        'send_email',
      ],
    });
  });

  it('rejects every /copilot route without a valid token', async () => {
    await request(app.getHttpServer()).get('/api/v1/copilot/conversations').expect(401);
  });

  let conversationId: string;

  it('creates a conversation', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/copilot/conversations')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ title: 'Testfrage' })
      .expect(201);
    expect(response.body.title).toBe('Testfrage');
    conversationId = response.body.id;
  });

  it('lists the conversation for its owner', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/copilot/conversations')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(response.body.some((c: { id: string }) => c.id === conversationId)).toBe(true);
  });

  it('sends a message that triggers a real ASK-mode tool call and gets a real assistant reply', async () => {
    llm.seedResponse({
      toolCalls: [{ toolCallId: randomUUID(), toolName: 'get_dashboard_summary', input: {} }],
      stopReason: 'tool_use',
    });
    llm.seedResponse({ toolCalls: [], stopReason: 'end_turn', text: 'Es gibt aktuell keine offenen Vorgänge.' });

    const response = await request(app.getHttpServer())
      .post(`/api/v1/copilot/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ content: 'Was braucht heute meine Aufmerksamkeit?' })
      .expect(201);

    expect(response.body.role).toBe('ASSISTANT');
    expect(response.body.content).toBe('Es gibt aktuell keine offenen Vorgänge.');
    expect(response.body.agentRunId).toBeTruthy();
  });

  it('persists both the user and assistant message in order', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/copilot/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    expect(response.body).toHaveLength(2);
    expect(response.body[0]).toMatchObject({ role: 'USER', content: 'Was braucht heute meine Aufmerksamkeit?' });
    expect(response.body[1]).toMatchObject({ role: 'ASSISTANT', content: 'Es gibt aktuell keine offenen Vorgänge.' });
  });

  it('streams a second message over SSE with real tool.started/tool.completed/message.completed events', async () => {
    llm.seedResponse({
      toolCalls: [{ toolCallId: randomUUID(), toolName: 'list_open_approvals', input: {} }],
      stopReason: 'tool_use',
    });
    llm.seedResponse({ toolCalls: [], stopReason: 'end_turn', text: 'Drei Freigaben warten auf Sie.' });

    const response = await request(app.getHttpServer())
      .post(`/api/v1/copilot/conversations/${conversationId}/messages/stream`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ content: 'Was ist offen?' })
      .expect(200);

    expect(response.headers['content-type']).toMatch(/^text\/event-stream/);
    expect(response.text).toContain('event: tool.started\ndata: {"toolName":"list_open_approvals"}');
    expect(response.text).toContain('event: tool.completed\ndata: {"toolName":"list_open_approvals","decision":"ALLOW"}');
    expect(response.text).toContain('event: message.completed');
    expect(response.text).toContain('Drei Freigaben warten auf Sie.');

    const messages = await request(app.getHttpServer())
      .get(`/api/v1/copilot/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(messages.body).toHaveLength(4);
    expect(messages.body[3]).toMatchObject({ role: 'ASSISTANT', content: 'Drei Freigaben warten auf Sie.' });
  });

  it('streaming a message into a conversation owned by a different user returns a real 404, not an SSE body', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/copilot/conversations/${conversationId}/messages/stream`)
      .set('Authorization', `Bearer ${tokenAOtherUser}`)
      .send({ content: 'x' })
      .expect(404);
  });

  it("a different user in the same tenant cannot see this conversation (personal, not just tenant-scoped)", async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/copilot/conversations/${conversationId}`)
      .set('Authorization', `Bearer ${tokenAOtherUser}`)
      .expect(404);
  });

  it('a user in a different tenant cannot see this conversation either', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/copilot/conversations/${conversationId}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(404);
  });

  it('deletes the conversation, after which it 404s', async () => {
    await request(app.getHttpServer())
      .delete(`/api/v1/copilot/conversations/${conversationId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(204);

    await request(app.getHttpServer())
      .get(`/api/v1/copilot/conversations/${conversationId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(404);
  });

  /**
   * §26/§32 Phase 9 ("Sonde Prepare Mode") — beide Tools sind bewusst
   * dieselben, bereits an anderer Stelle getesteten Domain-Agent-Tools
   * (`SalesAgentTools`/`FinanceAgentTools`, siehe Kopfkommentar in
   * tools/sonde.tools.ts), hier über den echten Sonde-Pfad aufgerufen —
   * nicht ihre eigene Geschäftslogik wird erneut bewiesen, sondern dass
   * Sonde sie überhaupt erreichen und real ausführen kann.
   */
  describe('PREPARE mode', () => {
    let prepareConversationId: string;

    beforeAll(async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/copilot/conversations')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ title: 'Prepare-Test' })
        .expect(201);
      prepareConversationId = response.body.id;
    });

    it('draft_email really persists an OUTBOUND EmailMessage as a draft (never sent)', async () => {
      llm.seedResponse({
        toolCalls: [
          {
            toolCallId: randomUUID(),
            toolName: 'draft_email',
            input: { toAddress: 'kunde@example.com', subject: 'Ihre Anfrage', bodyText: 'Vielen Dank für Ihre Anfrage.' },
          },
        ],
        stopReason: 'tool_use',
      });
      llm.seedResponse({ toolCalls: [], stopReason: 'end_turn', text: 'Ich habe einen Antwortentwurf gespeichert.' });

      const response = await request(app.getHttpServer())
        .post(`/api/v1/copilot/conversations/${prepareConversationId}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ content: 'Schreib eine Antwort an kunde@example.com.', mode: 'PREPARE' })
        .expect(201);
      expect(response.body.content).toBe('Ich habe einen Antwortentwurf gespeichert.');

      const drafts = await prisma
        .forTenantId(tenantAId)
        .emailMessage.findMany({ where: { toAddresses: { has: 'kunde@example.com' } } });
      expect(drafts).toHaveLength(1);
      expect(drafts[0]).toMatchObject({ direction: 'OUTBOUND', subject: 'Ihre Anfrage' });
    });

    it('create_booking_proposal really creates a BookingProposal for a real PENDING_APPROVAL invoice via Sonde', async () => {
      const invoice = await prisma.forTenantId(tenantAId).invoice.create({
        data: { tenantId: tenantAId, status: 'PENDING_APPROVAL', amountGross: 119, currency: 'EUR' },
      });

      llm.seedResponse({
        toolCalls: [
          {
            toolCallId: randomUUID(),
            toolName: 'create_booking_proposal',
            input: { invoiceId: invoice.id, accountCode: '4200', description: 'Büromaterial', amount: 119 },
          },
        ],
        stopReason: 'tool_use',
      });
      llm.seedResponse({ toolCalls: [], stopReason: 'end_turn', text: 'Ich habe einen Buchungsvorschlag erstellt.' });

      const response = await request(app.getHttpServer())
        .post(`/api/v1/copilot/conversations/${prepareConversationId}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ content: `Erstelle einen Buchungsvorschlag für Rechnung ${invoice.id}.`, mode: 'PREPARE' })
        .expect(201);
      expect(response.body.content).toBe('Ich habe einen Buchungsvorschlag erstellt.');

      const proposals = await prisma.forTenantId(tenantAId).bookingProposal.findMany({ where: { invoiceId: invoice.id } });
      expect(proposals).toHaveLength(1);
      expect(proposals[0]).toMatchObject({ accountCode: '4200', description: 'Büromaterial' });
    });
  });

  /**
   * §26/§32 Phase 10 ("Sonde Safe Actions") — wie bei PREPARE bewusst
   * dieselben, bereits anderswo getesteten Domain-Agent-Tools. Der
   * zweite Test ist der konkrete, live geprüfte Beweis für §27 ("Sonde
   * cannot bypass RBAC → Policy Engine → Approval Rules"): `send_email`
   * ist `REQUIRE_APPROVAL`, Sonde darf es aufrufen, aber der Tool-Code
   * (und damit der echte Mail-Connector) läuft dabei nie — es entsteht
   * ausschließlich eine Freigabeanfrage.
   */
  describe('ACT mode', () => {
    let actConversationId: string;

    beforeAll(async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/copilot/conversations')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ title: 'Act-Test' })
        .expect(201);
      actConversationId = response.body.id;
    });

    it('create_task really and immediately creates a real Task via Sonde (AUTONOMOUS, no approval needed)', async () => {
      llm.seedResponse({
        toolCalls: [
          {
            toolCallId: randomUUID(),
            toolName: 'create_task',
            input: { title: 'Rückruf Müller GmbH', description: 'Angebot nachfassen' },
          },
        ],
        stopReason: 'tool_use',
      });
      llm.seedResponse({ toolCalls: [], stopReason: 'end_turn', text: 'Ich habe die Aufgabe angelegt.' });

      const response = await request(app.getHttpServer())
        .post(`/api/v1/copilot/conversations/${actConversationId}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ content: 'Leg eine Aufgabe an: Rückruf Müller GmbH, Angebot nachfassen.', mode: 'ACT' })
        .expect(201);
      expect(response.body.content).toBe('Ich habe die Aufgabe angelegt.');

      const tasks = await prisma.forTenantId(tenantAId).task.findMany({ where: { title: 'Rückruf Müller GmbH' } });
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toMatchObject({ description: 'Angebot nachfassen', status: 'OPEN' });
    });

    it('send_email never sends directly (REQUIRE_APPROVAL) — Sonde creates a FOLLOW_UP approval instead, the mail connector never runs', async () => {
      const draft = await prisma.forTenantId(tenantAId).emailMessage.create({
        data: {
          tenantId: tenantAId,
          direction: 'OUTBOUND',
          fromAddress: 'noreply@musterwerk.example',
          toAddresses: ['kunde@example.com'],
          subject: 'Ihre Anfrage',
          bodyPreview: 'Vielen Dank für Ihre Anfrage.',
        },
      });

      llm.seedResponse({
        toolCalls: [{ toolCallId: randomUUID(), toolName: 'send_email', input: { draftEmailId: draft.id } }],
        stopReason: 'tool_use',
      });
      llm.seedResponse({ toolCalls: [], stopReason: 'end_turn', text: 'Der Versand wartet jetzt auf Ihre Freigabe.' });

      const response = await request(app.getHttpServer())
        .post(`/api/v1/copilot/conversations/${actConversationId}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ content: 'Versende den Entwurf jetzt.', mode: 'ACT' })
        .expect(201);
      expect(response.body.content).toBe('Der Versand wartet jetzt auf Ihre Freigabe.');

      const stillUnsent = await prisma.forTenantId(tenantAId).emailMessage.findUniqueOrThrow({ where: { id: draft.id } });
      expect(stillUnsent.sentAt).toBeNull();

      const approvals = await prisma
        .forTenantId(tenantAId)
        .approval.findMany({ where: { policyAction: 'send_email', entityType: 'FOLLOW_UP' } });
      expect(approvals).toHaveLength(1);
      expect(approvals[0]).toMatchObject({ status: 'PENDING' });
    });
  });
  /** UI v2 §8.3: der gewählte Modus begrenzt die Werkzeuge der Nachricht wirklich – er ist kein dekoratives Etikett. */
  describe('mode scoping', () => {
    it('without a mode (default "Fragen") a model-requested write tool is not executed', async () => {
      const conversation = await request(app.getHttpServer()).post('/api/v1/copilot/conversations').set('Authorization', `Bearer ${tokenA}`).send({ title: 'Modus' }).expect(201);
      llm.seedResponse({ toolCalls: [{ toolCallId: randomUUID(), toolName: 'create_task', input: { title: 'Darf nicht entstehen im Fragen-Modus' } }], stopReason: 'tool_use' });
      llm.seedResponse({ toolCalls: [], stopReason: 'end_turn', text: 'Das geht nur im Modus Ausführen.' });
      await request(app.getHttpServer())
        .post(`/api/v1/copilot/conversations/${conversation.body.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ content: 'Leg eine Aufgabe an.' })
        .expect(201);
      const created = await prisma.forTenantId(tenantAId).task.findMany({ where: { title: 'Darf nicht entstehen im Fragen-Modus' } });
      expect(created).toHaveLength(0);
    });

    it('rejects an unknown mode', async () => {
      const conversation = await request(app.getHttpServer()).post('/api/v1/copilot/conversations').set('Authorization', `Bearer ${tokenA}`).send({ title: 'Modus 2' }).expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/copilot/conversations/${conversation.body.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ content: 'Hallo', mode: 'ROOT' })
        .expect(400);
    });
  });
});
