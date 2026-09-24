import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { MockLLMProvider } from '@orbit/agent-core';
import { POLICY_ACTIONS } from '@orbit/shared';
import { LLM_PROVIDER } from '../src/agent/agent.tokens';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

/**
 * docs/ORBIT_UNIFIED_IMPLEMENTATION_PLAN.md, Phase 1 ("Durable Workflow
 * + Approval Resume") — the single biggest confirmed gap this session
 * found: approving a blocked `FOLLOW_UP` entry previously had no effect
 * at all (docs/MASTER_SPEC_GAP_ANALYSIS.md §37). This is the live,
 * real-Postgres proof that it now does: a two-step WorkflowRun whose
 * first step's tool call is forced into REQUIRE_APPROVAL pauses
 * (`WAITING_FOR_APPROVAL`, step 2 never runs), and approving the
 * resulting FOLLOW_UP approval via `PATCH /follow-ups/:id/approve`
 * actually executes the tool and resumes step 2 to completion — proven
 * against the real HTTP layer, real Postgres, real Policy Engine
 * (temporarily forcing `task.create` to REQUIRE_APPROVAL for this test's
 * duration, restored in `afterEach`), not just the mocked unit tests in
 * `apps/api/src/follow-ups/follow-up-resume.service.spec.ts` and
 * `apps/api/src/workflows/workflow-runner.service.spec.ts`.
 */
describe('Workflow approval resume (e2e)', () => {
  let app: INestApplication;
  let llm: MockLLMProvider;
  let adminToken: string;
  const blockedAgentKey = `e2e-resume-blocked-${randomUUID().slice(0, 8)}`;
  const followUpAgentKey = `e2e-resume-followup-${randomUUID().slice(0, 8)}`;
  const workflowKey = `e2e-resume-workflow-${randomUUID().slice(0, 8)}`;
  const rejectWorkflowKey = `e2e-resume-reject-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    llm = app.get(LLM_PROVIDER);

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'admin@musterwerk.example', password: 'Musterwerk#2026!' })
      .expect(200);
    adminToken = login.body.accessToken as string;

    // `task.create` has no autonomy ceiling (unlike payment.execute/
    // supplier.*), so it's safe to force into REQUIRE_APPROVAL for this
    // suite's duration.
    await request(app.getHttpServer())
      .patch(`/api/v1/policies/${POLICY_ACTIONS.TASK_CREATE}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ mode: 'REQUIRE_APPROVAL' })
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/v1/agent-definitions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ key: blockedAgentKey, name: 'E2E Blocked Agent', baseType: 'SALES', systemPrompt: 'Lege eine Aufgabe an.', allowedTools: ['create_task'] })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/api/v1/agent-definitions/${blockedAgentKey}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'ACTIVE' })
      .expect(200);

    // A second step whose tool (classify_message, email.classify) stays
    // AUTONOMOUS — proves step 2 genuinely never ran before resume, and
    // genuinely does run after it.
    await request(app.getHttpServer())
      .post('/api/v1/agent-definitions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ key: followUpAgentKey, name: 'E2E Follow-up Agent', baseType: 'COMMUNICATION', systemPrompt: 'Klassifiziere.', allowedTools: ['classify_message'] })
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
        name: 'E2E Approval Resume Test',
        triggerType: 'MANUAL',
        steps: [
          { order: 1, agentDefinitionKey: blockedAgentKey },
          { order: 2, agentDefinitionKey: followUpAgentKey },
        ],
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/v1/workflow-definitions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ key: rejectWorkflowKey, name: 'E2E Approval Reject Test', triggerType: 'MANUAL', steps: [{ order: 1, agentDefinitionKey: blockedAgentKey }] })
      .expect(201);
  });

  afterAll(async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/policies/${POLICY_ACTIONS.TASK_CREATE}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ mode: 'AUTONOMOUS' })
      .expect(200);
    await app.close();
  });

  it('pauses the run at step 1, then approving the FOLLOW_UP resumes and completes step 2', async () => {
    llm.seedResponse({ toolCalls: [{ toolCallId: randomUUID(), toolName: 'create_task', input: { title: 'E2E Resume Task' } }], stopReason: 'tool_use' });
    llm.seedResponse({ toolCalls: [], stopReason: 'end_turn' }); // closes step 1's turn

    const trigger = await request(app.getHttpServer())
      .post(`/api/v1/workflow-definitions/${workflowKey}/trigger`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ input: {} })
      .expect(201);

    expect(trigger.body.status).toBe('WAITING_FOR_APPROVAL');
    expect(trigger.body.steps).toEqual([{ order: 1, agentDefinitionKey: blockedAgentKey, skipped: false, agentRunId: expect.any(String) }]);

    const runsAfterPause = await request(app.getHttpServer())
      .get(`/api/v1/workflow-definitions/${workflowKey}/runs`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(runsAfterPause.body[0].status).toBe('WAITING_FOR_APPROVAL');
    expect(runsAfterPause.body[0].stepRuns).toHaveLength(1);

    const pending = await request(app.getHttpServer())
      .get('/api/v1/approvals')
      .query({ status: 'PENDING', entityType: 'FOLLOW_UP' })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const approval = pending.body.find((a: { policyAction: string }) => a.policyAction === 'create_task');
    expect(approval).toBeDefined();

    // step 2 only calls the LLM once resumed — seeded now, not before, to
    // prove the pause genuinely blocked step 2 from running earlier.
    llm.seedResponse({
      toolCalls: [{ toolCallId: randomUUID(), toolName: 'classify_message', input: { subject: 'x', bodyText: 'y', hasAttachment: false } }],
      stopReason: 'tool_use',
    });
    llm.seedResponse({ toolCalls: [], stopReason: 'end_turn' }); // closes step 2's turn

    const decided = await request(app.getHttpServer())
      .patch(`/api/v1/follow-ups/${approval.id}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(decided.body.status).toBe('APPROVED');

    const runsAfterResume = await request(app.getHttpServer())
      .get(`/api/v1/workflow-definitions/${workflowKey}/runs`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(runsAfterResume.body[0].status).toBe('COMPLETED');
    expect(runsAfterResume.body[0].stepRuns).toHaveLength(2);
  });

  it('rejecting the FOLLOW_UP marks the WorkflowRun REJECTED and never resumes it', async () => {
    llm.seedResponse({ toolCalls: [{ toolCallId: randomUUID(), toolName: 'create_task', input: { title: 'E2E Reject Task' } }], stopReason: 'tool_use' });
    llm.seedResponse({ toolCalls: [], stopReason: 'end_turn' });

    const trigger = await request(app.getHttpServer())
      .post(`/api/v1/workflow-definitions/${rejectWorkflowKey}/trigger`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ input: {} })
      .expect(201);
    expect(trigger.body.status).toBe('WAITING_FOR_APPROVAL');

    const pending = await request(app.getHttpServer())
      .get('/api/v1/approvals')
      .query({ status: 'PENDING', entityType: 'FOLLOW_UP' })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const approval = pending.body.find((a: { policyAction: string; requestedAt: string }) => a.policyAction === 'create_task');
    expect(approval).toBeDefined();

    const decided = await request(app.getHttpServer())
      .patch(`/api/v1/follow-ups/${approval.id}/reject`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(decided.body.status).toBe('REJECTED');

    const runs = await request(app.getHttpServer())
      .get(`/api/v1/workflow-definitions/${rejectWorkflowKey}/runs`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(runs.body[0].status).toBe('REJECTED');
  });

  it('rejects approving an already-decided FOLLOW_UP a second time', async () => {
    llm.seedResponse({ toolCalls: [{ toolCallId: randomUUID(), toolName: 'create_task', input: { title: 'E2E Double-Decide Task' } }], stopReason: 'tool_use' });
    llm.seedResponse({ toolCalls: [], stopReason: 'end_turn' });

    await request(app.getHttpServer())
      .post(`/api/v1/workflow-definitions/${rejectWorkflowKey}/trigger`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ input: {} })
      .expect(201);

    const pending = await request(app.getHttpServer())
      .get('/api/v1/approvals')
      .query({ status: 'PENDING', entityType: 'FOLLOW_UP' })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const approval = pending.body.find((a: { policyAction: string }) => a.policyAction === 'create_task');

    await request(app.getHttpServer())
      .patch(`/api/v1/follow-ups/${approval.id}/reject`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/api/v1/follow-ups/${approval.id}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(403);
  });
});
