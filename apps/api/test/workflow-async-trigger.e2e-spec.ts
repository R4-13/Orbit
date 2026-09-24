import { randomUUID } from 'node:crypto';
import type { INestApplication, INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { MockLLMProvider } from '@orbit/agent-core';
import { LLM_PROVIDER } from '../src/agent/agent.tokens';
import { WorkerModule } from '../worker/worker.module';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

async function waitFor(check: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`waitFor() timed out after ${timeoutMs}ms`);
}

/**
 * End-to-end test of docs/SCALABILITY_CONCEPT.md's first implementation
 * slice: POST .../trigger-async enqueues a real BullMQ job (real Redis,
 * `REDIS_URL`) that a genuinely separate `WorkerModule` application
 * context — bootstrapped here exactly the way `apps/api/worker/main.ts`
 * does in production — picks up and executes, entirely outside the
 * request/response cycle that created it. This is the automated,
 * permanent-regression counterpart to the manual `curl`-based live
 * verification done while building this feature (202 in ~100ms, worker
 * completes the run moments later).
 *
 * `app` and `workerApp` are two independent NestJS DI containers (same
 * as two OS processes in production) — each gets its **own**
 * `MockLLMProvider` singleton instance (`LLM_PROVIDER` is provided by a
 * per-container factory in AgentModule). Seeding `app`'s instance (as
 * `workflow-orchestration.e2e-spec.ts` does for the synchronous path)
 * would have no effect on what `workerApp`'s processor sees — this
 * suite seeds `workerApp`'s instance instead, since that's the one that
 * actually calls `AgentRuntime.runTurn()` for a queued run.
 */
describe('Workflow async trigger (e2e)', () => {
  let app: INestApplication;
  let workerApp: INestApplicationContext;
  let workerLlm: MockLLMProvider;
  let adminToken: string;
  const workflowKey = `e2e-async-trigger-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    workerApp = await NestFactory.createApplicationContext(WorkerModule, { logger: false });
    workerLlm = workerApp.get(LLM_PROVIDER);

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'admin@musterwerk.example', password: 'Musterwerk#2026!' })
      .expect(200);
    adminToken = login.body.accessToken as string;

    await request(app.getHttpServer())
      .post('/api/v1/workflow-definitions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        key: workflowKey,
        name: 'E2E Async Trigger Test',
        triggerType: 'MANUAL',
        steps: [{ order: 1, agentDefinitionKey: 'communication-intake' }],
      })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
    await workerApp.close();
  });

  it('returns 202 with a workflowRunId immediately, before the worker has run anything', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/workflow-definitions/${workflowKey}/trigger-async`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ input: { subject: 'schneller Response-Test' } })
      .expect(202);

    expect(response.body.workflowRunId).toEqual(expect.any(String));
  });

  it('a separate worker process context picks up the queued job and completes it in Postgres', async () => {
    workerLlm.seedResponse({
      toolCalls: [
        { toolCallId: randomUUID(), toolName: 'classify_message', input: { subject: 'Angebot', bodyText: 'Interesse', hasAttachment: false } },
      ],
      stopReason: 'tool_use',
    });
    workerLlm.seedResponse({ toolCalls: [], stopReason: 'end_turn' });

    const trigger = await request(app.getHttpServer())
      .post(`/api/v1/workflow-definitions/${workflowKey}/trigger-async`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ input: { subject: 'Angebot' } })
      .expect(202);
    const { workflowRunId } = trigger.body as { workflowRunId: string };

    let finalStatus: string | undefined;
    await waitFor(async () => {
      const runs = await request(app.getHttpServer())
        .get(`/api/v1/workflow-definitions/${workflowKey}/runs`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const run = (runs.body as Array<{ id: string; status: string }>).find((r) => r.id === workflowRunId);
      finalStatus = run?.status;
      return finalStatus === 'COMPLETED' || finalStatus === 'FAILED';
    }, 10000);

    expect(finalStatus).toBe('COMPLETED');
  });

  it('rejects trigger-async for an unknown workflow key with 404, without enqueuing anything', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/workflow-definitions/does-not-exist/trigger-async')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ input: {} })
      .expect(404);
  });
});
