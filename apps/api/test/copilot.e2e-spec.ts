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

  it('GET /copilot/capabilities lists the ASK-mode read tools', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/copilot/capabilities')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(response.body).toEqual({ mode: 'ASK', tools: ['get_dashboard_summary', 'list_open_approvals', 'get_case'] });
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
});
