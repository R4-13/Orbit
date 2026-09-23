import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { MockLLMProvider } from '@orbit/agent-core';
import { LLM_PROVIDER } from '../src/agent/agent.tokens';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

/**
 * End-to-end test of the Orchestrierung capability
 * (docs/AGENT_STUDIO_CONCEPT.md Abschnitt 3, Phase 21): creates a real
 * two-step WorkflowDefinition (communication-intake -> conditionally a
 * SALES-only follow-up agent), triggers it via
 * POST /workflow-definitions/:key/trigger against real Postgres, and
 * verifies both branches of the conditional step (runs vs. skipped)
 * produce the expected real AgentRun/WorkflowStepRun records.
 *
 * Unlike IntakeService, WorkflowRunnerService has no built-in
 * MockLLMProvider scripting of its own (it's generic — it doesn't know in
 * advance which tools a configurable step's agent will call), so this
 * suite seeds MockLLMProvider directly via the app's DI container, the
 * same singleton IntakeService's own calls share (see
 * docs/ASSUMPTIONS.md Phase 21 for why the queue must be seeded with an
 * explicit trailing end_turn per step here, unlike IntakeService's
 * single-call sites).
 */
describe('Workflow orchestration (e2e)', () => {
  let app: INestApplication;
  let llm: MockLLMProvider;
  let adminToken: string;
  const workflowKey = `e2e-orchestration-${randomUUID().slice(0, 8)}`;
  const followUpAgentKey = `e2e-followup-agent-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    llm = app.get(LLM_PROVIDER);

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'admin@musterwerk.example', password: 'Musterwerk#2026!' })
      .expect(200);
    adminToken = login.body.accessToken as string;

    // A minimal, single-tool AgentDefinition for step 2 — avoids the
    // built-in sales-intake agent's 3-tool-call chain, which would need a
    // longer, more fragile Mock script than this suite's point (proving
    // conditional branching) needs.
    await request(app.getHttpServer())
      .post('/api/v1/agent-definitions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        key: followUpAgentKey,
        name: 'E2E Follow-up Agent',
        baseType: 'SALES',
        systemPrompt: 'Lege eine Aufgabe für diesen Sales-Lead an.',
        allowedTools: ['create_task'],
      })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/api/v1/agent-definitions/${followUpAgentKey}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'ACTIVE' })
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/v1/workflow-definitions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        key: workflowKey,
        name: 'E2E Orchestration Test',
        triggerType: 'MANUAL',
        steps: [
          { order: 1, agentDefinitionKey: 'communication-intake' },
          {
            order: 2,
            agentDefinitionKey: followUpAgentKey,
            inputMapping: { subject: '$.trigger.input.subject' },
            condition: { field: '$.steps[1].output.classify_message.category', equals: 'SALES' },
          },
        ],
      })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  it('runs step 2 when the classification condition matches (SALES)', async () => {
    llm.seedResponse({
      toolCalls: [
        { toolCallId: randomUUID(), toolName: 'classify_message', input: { subject: 'Angebot', bodyText: 'Interesse an Beratung', hasAttachment: false } },
      ],
      stopReason: 'tool_use',
    });
    llm.seedResponse({ toolCalls: [], stopReason: 'end_turn' }); // closes step 1's turn
    llm.seedResponse({
      toolCalls: [{ toolCallId: randomUUID(), toolName: 'create_task', input: { title: 'E2E-Orchestrierungstest Follow-up' } }],
      stopReason: 'tool_use',
    });
    llm.seedResponse({ toolCalls: [], stopReason: 'end_turn' }); // closes step 2's turn

    const response = await request(app.getHttpServer())
      .post(`/api/v1/workflow-definitions/${workflowKey}/trigger`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ input: { subject: 'Angebot' } })
      .expect(201);

    expect(response.body.status).toBe('COMPLETED');
    expect(response.body.steps).toEqual([
      { order: 1, agentDefinitionKey: 'communication-intake', skipped: false, agentRunId: expect.any(String) },
      { order: 2, agentDefinitionKey: followUpAgentKey, skipped: false, agentRunId: expect.any(String) },
    ]);

    const runsResponse = await request(app.getHttpServer())
      .get(`/api/v1/workflow-definitions/${workflowKey}/runs`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(runsResponse.body[0].status).toBe('COMPLETED');
    expect(runsResponse.body[0].stepRuns).toHaveLength(2);
  });

  it('skips step 2 when the classification condition does not match (FINANCE)', async () => {
    llm.seedResponse({
      toolCalls: [
        { toolCallId: randomUUID(), toolName: 'classify_message', input: { subject: 'Rechnung', bodyText: 'Anbei die Rechnung', hasAttachment: true } },
      ],
      stopReason: 'tool_use',
    });
    llm.seedResponse({ toolCalls: [], stopReason: 'end_turn' }); // closes step 1's turn — step 2 never calls the LLM at all

    const response = await request(app.getHttpServer())
      .post(`/api/v1/workflow-definitions/${workflowKey}/trigger`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ input: { subject: 'Rechnung' } })
      .expect(201);

    expect(response.body.status).toBe('COMPLETED');
    expect(response.body.steps).toEqual([
      { order: 1, agentDefinitionKey: 'communication-intake', skipped: false, agentRunId: expect.any(String) },
      { order: 2, agentDefinitionKey: followUpAgentKey, skipped: true },
    ]);
  });

  it('rejects a trigger for an unknown workflow key with 404', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/workflow-definitions/does-not-exist/trigger')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ input: {} })
      .expect(404);
  });

  it('rejects a role without AGENT_MANAGE with 403', async () => {
    const salesLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'sales@musterwerk.example', password: 'Musterwerk#2026!' })
      .expect(200);

    await request(app.getHttpServer())
      .get('/api/v1/workflow-definitions')
      .set('Authorization', `Bearer ${salesLogin.body.accessToken}`)
      .expect(403);
  });
});
