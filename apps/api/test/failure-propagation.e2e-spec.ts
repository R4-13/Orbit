import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { MockLLMProvider, ToolOutcomeUnknownError, type ToolRegistry } from '@orbit/agent-core';
import { triageFixtureForScenario } from '@orbit/shared';
import { LLM_PROVIDER, TOOL_REGISTRY } from '../src/agent/agent.tokens';
import type { NormalizedIntakeEvent } from '../src/intake/channel-event.types';
import { IntakeService } from '../src/intake/intake.service';
import { ConnectorStatusService } from '../src/integrations/connector-status.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantsService } from '../src/tenants/tenants.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

/**
 * Amendment 02 §12.5 / §25.2 — MANDATORY GATE. A required tool that fails
 * must never end up as "success" anywhere along
 *   Tool → ToolInvocation → StepRun → WorkflowRun → IntakeEvent → integration badge
 * whether it returns a failure (no exception), throws, or leaves the external
 * effect uncertain. A real (non-simulated) channel event is driven through the
 * full intake pipeline in a throwaway tenant with a GMAIL connection.
 */
describe('Failure propagation Tool → StepRun → WorkflowRun → IntakeEvent → badge (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let intake: IntakeService;
  let status: ConnectorStatusService;
  let tools: ToolRegistry;
  let llm: MockLLMProvider;
  let tenantsService: TenantsService;
  const tenants: string[] = [];

  async function setupTenantWithGmail() {
    const suffix = randomUUID();
    const { tenant } = await tenantsService.bootstrapTenant({
      name: `E2E Propagation ${suffix}`,
      slug: `e2e-propagation-${suffix}`,
      adminEmail: `admin-${suffix}@e2e-propagation.example`,
      adminPassword: 'Musterwerk#2026!',
      adminFirstName: 'E2E',
      adminLastName: 'Admin',
    });
    tenants.push(tenant.id);
    const scoped = prisma.forTenantId(tenant.id);
    const integration = await scoped.integration.create({
      data: { tenantId: tenant.id, connectorType: 'GMAIL', status: 'CONNECTED', lastSuccessAt: new Date() },
    });
    await scoped.connectorSync.create({
      data: {
        tenantId: tenant.id,
        connectionId: integration.id,
        connectorType: 'GMAIL',
        syncMode: 'POLLING',
        status: 'SUCCEEDED',
        lastSuccessAt: new Date(),
      },
    });
    return { tenantId: tenant.id, connectionId: integration.id };
  }

  /** Scripts the simulated AI's structured triage answer for the NEXT intake event (a scenario fixture, not keyword logic). */
  function seedSalesTriage(): void {
    llm.seedResponse({
      toolCalls: [{ toolCallId: randomUUID(), toolName: 'submit_triage_result', input: triageFixtureForScenario('REQUEST_FOR_QUOTE') as unknown as Record<string, unknown> }],
      stopReason: 'tool_use',
    });
  }

  async function driveSalesEvent(tenantId: string, connectionId: string) {
    seedSalesTriage();
    return intake.handleIntakeEvent(tenantId, undefined, salesEvent(tenantId, connectionId));
  }

  function salesEvent(tenantId: string, connectionId: string): NormalizedIntakeEvent {
    return {
      tenantId,
      connectionId,
      channel: 'EMAIL',
      provider: 'gmail',
      externalEventId: `gmail-${randomUUID()}`,
      occurredAt: new Date(),
      sender: { address: `interessent-${randomUUID()}@kunde.example`, displayName: 'Interessent' },
      recipients: [{ address: 'info@firma.example' }],
      subject: 'Anfrage zu Ihrem Angebot',
      content: 'Wir haben Interesse an einer Beratung zu Ihren Produkten. Bitte melden Sie sich.',
    };
  }

  /** Makes `create_lead` fail the way a real adapter could, restoring the real tool afterwards. */
  function forceToolOutcome(behaviour: 'returned-failure' | 'throws' | 'unknown') {
    const tool = tools.get('create_lead');
    if (!tool) throw new Error('create_lead not registered');
    const original = tool.execute;
    tool.execute = async () => {
      if (behaviour === 'returned-failure') return { success: false, message: 'CRM lehnt die Anlage ab.' };
      if (behaviour === 'throws') throw new Error('boom');
      throw new ToolOutcomeUnknownError('Timeout nach dem Absenden');
    };
    return () => {
      tool.execute = original;
    };
  }

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    prisma = app.get(PrismaService);
    intake = app.get(IntakeService);
    status = app.get(ConnectorStatusService);
    tools = app.get(TOOL_REGISTRY);
    llm = app.get(LLM_PROVIDER);
    tenantsService = app.get(TenantsService);
  });

  afterAll(async () => {
    for (const tenantId of tenants) {
      await prisma.withRlsBypass((tx) => tx.tenant.delete({ where: { id: tenantId } }));
    }
    await app.close();
  });

  async function assertChain(tenantId: string, intakeEventId: string, expected: { intake: string; step: string; tool: string }) {
    const scoped = prisma.forTenantId(tenantId);
    const event = await scoped.intakeEvent.findUniqueOrThrow({ where: { id: intakeEventId } });
    const run = await scoped.workflowRun.findUniqueOrThrow({ where: { id: event.workflowRunId! }, include: { stepRuns: true } });
    const invocations = await scoped.toolInvocation.findMany({ where: { agentRunId: run.stepRuns[0]!.agentRunId! } });

    expect(invocations.find((i) => i.toolName === 'create_lead')?.status).toBe(expected.tool);
    expect(run.stepRuns[0]?.status).toBe(expected.step);
    expect(run.stepRuns[0]?.failedToolName).toBe('create_lead');
    expect(run.status).toBe('FAILED');
    expect(run.errorMessage).toBeTruthy();
    expect(event.status).toBe(expected.intake);
    expect(event.errorMessage).toBeTruthy();
    expect(await scoped.lead.count()).toBe(0);
  }

  async function assertBadgeNotLive(tenantId: string) {
    const result = await status.getStatus(tenantId, 'GMAIL');
    expect(result.levels.DOMAIN_WORKFLOW_ACTIVE.reached).toBe(true);
    expect(result.levels.LIVE_END_TO_END_TESTED.reached).toBe(false);
    expect(result.highestLevelReached).toBe('DOMAIN_WORKFLOW_ACTIVE');
    expect(result.verifiedRun).toBeNull();
    expect(result.health?.latestRunFailed).toBe(true);
  }

  it('a RETURNED tool failure (no exception) ends FAILED everywhere and never reaches the live badge', async () => {
    const { tenantId, connectionId } = await setupTenantWithGmail();
    const restore = forceToolOutcome('returned-failure');
    try {
      const result = await driveSalesEvent(tenantId, connectionId);
      await assertChain(tenantId, result.intakeEventId, { intake: 'FAILED', step: 'FAILED', tool: 'FAILED' });
    } finally {
      restore();
    }
    await assertBadgeNotLive(tenantId);
  });

  it('a THROWN tool exception ends FAILED everywhere and never reaches the live badge', async () => {
    const { tenantId, connectionId } = await setupTenantWithGmail();
    const restore = forceToolOutcome('throws');
    try {
      const result = await driveSalesEvent(tenantId, connectionId);
      await assertChain(tenantId, result.intakeEventId, { intake: 'FAILED', step: 'FAILED', tool: 'FAILED' });
    } finally {
      restore();
    }
    await assertBadgeNotLive(tenantId);
  });

  it('an UNCERTAIN external outcome is OUTCOME_UNKNOWN, needs review, and is never retried or shown as success', async () => {
    const { tenantId, connectionId } = await setupTenantWithGmail();
    const restore = forceToolOutcome('unknown');
    try {
      const result = await driveSalesEvent(tenantId, connectionId);
      await assertChain(tenantId, result.intakeEventId, { intake: 'NEEDS_REVIEW', step: 'OUTCOME_UNKNOWN', tool: 'OUTCOME_UNKNOWN' });
    } finally {
      restore();
    }
    await assertBadgeNotLive(tenantId);
  });

  it('a genuinely successful run verifies the badge with an honest live/simulated breakdown — and does not heal an earlier failed or wrongly-completed run', async () => {
    const { tenantId, connectionId } = await setupTenantWithGmail();
    const scoped = prisma.forTenantId(tenantId);

    // 1. an earlier failed run
    const restore = forceToolOutcome('returned-failure');
    try {
      await driveSalesEvent(tenantId, connectionId);
    } finally {
      restore();
    }
    // 2. a historic, wrongly COMPLETED run (the reported incident's shape) that must never count as proof
    const definition = await scoped.workflowDefinition.findFirstOrThrow({ where: { key: 'sales-lead-intake' } });
    const badRun = await scoped.workflowRun.create({ data: { tenantId, workflowDefinitionId: definition.id, status: 'COMPLETED', completedAt: new Date() } });
    const badAgentRun = await scoped.agentRun.create({ data: { tenantId, agentType: 'SALES', triggerType: 'EMAIL', status: 'FAILED' } });
    await scoped.workflowStepRun.create({ data: { tenantId, workflowRunId: badRun.id, stepOrder: 1, agentRunId: badAgentRun.id, status: 'SUCCEEDED' } });
    await scoped.toolInvocation.create({ data: { tenantId, agentRunId: badAgentRun.id, toolName: 'create_lead', status: 'FAILED' } });
    await scoped.intakeEvent.create({
      data: {
        tenantId,
        connectionId,
        channel: 'EMAIL',
        provider: 'gmail',
        externalEventId: `gmail-${randomUUID()}`,
        occurredAt: new Date(),
        status: 'COMPLETED',
        workflowRunId: badRun.id,
      },
    });

    let result = await status.getStatus(tenantId, 'GMAIL');
    expect(result.levels.LIVE_END_TO_END_TESTED.reached).toBe(false); // the wrongly-COMPLETED row is not a verifying run

    // 3. now a real success
    const success = await driveSalesEvent(tenantId, connectionId);
    const event = await scoped.intakeEvent.findUniqueOrThrow({ where: { id: success.intakeEventId } });
    expect(event.status).toBe('COMPLETED');

    result = await status.getStatus(tenantId, 'GMAIL');
    expect(result.highestLevelReached).toBe('LIVE_END_TO_END_TESTED');
    expect(result.verifiedRun?.intakeEventId).toBe(success.intakeEventId); // exactly this run, not the bad one
    expect(result.verifiedRun?.executionSummary).toContain('Eingang live');
    expect(result.verifiedRun?.executionSummary).toContain('KI simuliert'); // LLM_PROVIDER=mock in this environment
    expect(result.verifiedRun?.executionSummary).toContain('CRM simuliert'); // test SoR, never claimed as a real CRM
    expect(await scoped.lead.count()).toBe(1);
  });
});
