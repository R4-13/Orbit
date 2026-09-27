import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { MockLLMProvider } from '@orbit/agent-core';
import request from 'supertest';
import { LLM_PROVIDER } from '../src/agent/agent.tokens';
import { TenantsService } from '../src/tenants/tenants.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

const PASSWORD = 'Test#Password2026!';

/**
 * §17 des Unified-Evolution-Konzepts ("Agent Evaluation Framework") — live
 * proof against real Postgres + the app's real MockLLMProvider singleton:
 * a critical evaluation case that fails blocks DRAFT→ACTIVE outright (the
 * update never persists), and the same definition can activate once the
 * case passes.
 *
 * Fresh throwaway tenant (not the shared Musterwerk tenant) — same
 * rationale as every other live-LLM E2E file in this suite (see
 * workflow-orchestration.e2e-spec.ts).
 */
describe('Agent evaluation framework (e2e)', () => {
  let app: INestApplication;
  let tenantsService: TenantsService;
  let llm: MockLLMProvider;
  let adminToken: string;
  const agentKey = 'e2e-eval-sales-agent';

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    tenantsService = app.get(TenantsService);
    llm = app.get(LLM_PROVIDER);

    const suffix = randomUUID();
    const { adminUser } = await tenantsService.bootstrapTenant({
      name: `E2E Agent Evaluation Test ${suffix}`,
      slug: `e2e-agent-evaluation-${suffix}`,
      adminEmail: `admin-${suffix}@e2e-agent-evaluation.example`,
      adminPassword: PASSWORD,
      adminFirstName: 'E2E',
      adminLastName: 'Admin',
    });

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: adminUser.email, password: PASSWORD })
      .expect(200);
    adminToken = login.body.accessToken as string;

    await request(app.getHttpServer())
      .post('/api/v1/agent-definitions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        key: agentKey,
        name: 'E2E Evaluation Test Agent',
        baseType: 'SALES',
        systemPrompt: 'Du legst bei jeder Nachricht ein neues Unternehmen an.',
        allowedTools: ['create_company'],
      })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates an evaluation case', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/agent-definitions/${agentKey}/evaluation-cases`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Legt ein Unternehmen an', userMessage: 'Neue Firma: Beispiel GmbH', expectedTools: ['create_company'], critical: true })
      .expect(201);

    expect(response.body.critical).toBe(true);
    expect(response.body.expectedTools).toEqual(['create_company']);
  });

  it('POST .../evaluate reports a failing result when the LLM calls no tool', async () => {
    // Empty MockLLMProvider queue -> runtime returns no tool calls -> the case's expectedTools check fails.
    const response = await request(app.getHttpServer())
      .post(`/api/v1/agent-definitions/${agentKey}/evaluate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);

    expect(response.body).toHaveLength(1);
    expect(response.body[0].passed).toBe(false);
    expect(response.body[0].failures[0]).toContain('create_company');
  });

  it('PATCH status=ACTIVE is blocked while the critical case fails, and nothing is persisted', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/agent-definitions/${agentKey}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'ACTIVE' })
      .expect(400)
      .expect((res) => {
        expect(res.body.code).toBe('VALIDATION_FAILED');
      });

    const stillDraft = await request(app.getHttpServer())
      .get(`/api/v1/agent-definitions/${agentKey}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(stillDraft.body.status).toBe('DRAFT');
    expect(stillDraft.body.version).toBe(1);
  });

  it('PATCH status=ACTIVE succeeds once the critical case passes', async () => {
    llm.seedResponse({
      toolCalls: [{ toolCallId: randomUUID(), toolName: 'create_company', input: { name: 'Beispiel GmbH' } }],
      stopReason: 'tool_use',
    });

    const response = await request(app.getHttpServer())
      .patch(`/api/v1/agent-definitions/${agentKey}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'ACTIVE' })
      .expect(200);

    expect(response.body.status).toBe('ACTIVE');
    // The gate itself consumed one AgentRun via runSuite/assertCriticalCasesPass — version still only bumps once for this PATCH.
    expect(response.body.version).toBe(2);
  });

  it('lists the evaluation case and deletes it', async () => {
    const list = await request(app.getHttpServer())
      .get(`/api/v1/agent-definitions/${agentKey}/evaluation-cases`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(list.body).toHaveLength(1);

    await request(app.getHttpServer())
      .delete(`/api/v1/agent-definitions/${agentKey}/evaluation-cases/${list.body[0].id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const afterDelete = await request(app.getHttpServer())
      .get(`/api/v1/agent-definitions/${agentKey}/evaluation-cases`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(afterDelete.body).toEqual([]);
  });
});
