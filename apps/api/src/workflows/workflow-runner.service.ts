import { Injectable } from '@nestjs/common';
import type { ToolCallOutcome } from '@orbit/agent-core';
import type { Prisma, WorkflowRun } from '@orbit/domain';
import { NotFoundError, ValidationFailedError } from '@orbit/shared';
import { AgentRunRecorderService } from '../agent/agent-run-recorder.service';
import { AgentDefinitionResolverService } from '../agent-definitions/agent-definition-resolver.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { PrismaService } from '../prisma/prisma.service';
import { buildWorkflowStepMessage, evaluateWorkflowCondition, type WorkflowPathContext, type WorkflowStepConditionExpr } from './workflow-path';
import type { WorkflowDefinitionWithSteps } from './workflow-definitions.service';

export interface WorkflowRunResult {
  workflowRunId: string;
  status: 'COMPLETED' | 'FAILED';
  steps: Array<{ order: number; agentDefinitionKey: string; skipped: boolean; agentRunId?: string }>;
}

export type WorkflowRunWithStepRuns = Prisma.WorkflowRunGetPayload<{ include: { stepRuns: true } }>;

/**
 * docs/AGENT_STUDIO_CONCEPT.md Abschnitt 3 — the generalization of what
 * IntakeService today does by hand (classify -> branch -> run a Finance or
 * Sales agent turn, manually threading a tool's real output into the next
 * call). This is a *parallel*, additive capability: it does not replace
 * IntakeService or touch `POST /intake/emails`. The concept doc's own
 * migration section explicitly recommends proving parity before ever
 * switching the one live production entry point over — that switch is not
 * part of this phase.
 *
 * Deliberately not wired to any real trigger (no cron, no webhook) — every
 * WorkflowRun in this phase starts from an explicit `POST
 * /workflow-definitions/:key/trigger` call (a human or a test), matching
 * `WorkflowDefinition.triggerType: MANUAL`'s literal meaning. `EMAIL`/
 * `WEBHOOK`/`SCHEDULE` are accepted as a definition's declared intent
 * (informational, e.g. for a future automatic dispatcher) but nothing in
 * this codebase reads that field to decide when to call `trigger()`.
 *
 * Since docs/SCALABILITY_CONCEPT.md: `trigger()` (synchronous, blocks the
 * HTTP request for the whole run) sits alongside `createQueuedRun()` +
 * `executeQueuedRun()` (asynchronous — a `WorkflowRunQueueService`
 * enqueues a BullMQ job, `apps/api/worker`'s processor calls
 * `executeQueuedRun()` outside the request/response cycle). Both paths
 * share the same private `createRun()`/`executeRun()` — there is exactly
 * one place that decides how a workflow actually runs.
 */
@Injectable()
export class WorkflowRunnerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: AgentDefinitionResolverService,
    private readonly runs: AgentRunRecorderService,
    private readonly approvals: ApprovalsService,
  ) {}

  /** Synchronous execution (existing behavior, unchanged) — validates, creates the run, and walks it to completion before returning. */
  async trigger(tenantId: string, actorUserId: string, key: string, triggerInput: Record<string, unknown>): Promise<WorkflowRunResult> {
    const { definition, workflowRun } = await this.createRun(tenantId, key, triggerInput);
    return this.executeRun(tenantId, actorUserId, definition, workflowRun, triggerInput);
  }

  /**
   * docs/SCALABILITY_CONCEPT.md — the queue-backed counterpart to
   * `trigger()`. Creates the `WorkflowRun` row synchronously (so the
   * caller gets an id to poll `GET .../runs` with immediately) but does
   * **not** execute it — `WorkflowRunQueueService` enqueues a job that a
   * worker later picks up via `executeQueuedRun()`. Splitting create/
   * execute this way (rather than teaching `trigger()` to skip
   * execution) keeps `trigger()` itself completely unchanged — the
   * synchronous path is still exactly `createRun()` + `executeRun()`
   * back to back, so its existing behavior/tests are unaffected.
   */
  async createQueuedRun(tenantId: string, key: string, triggerInput: Record<string, unknown>): Promise<{ workflowRunId: string }> {
    const { workflowRun } = await this.createRun(tenantId, key, triggerInput);
    return { workflowRunId: workflowRun.id };
  }

  /** Worker-side counterpart to `createQueuedRun()` — loads the already-created run + its definition and walks it to completion, same as `executeRun()` inside `trigger()`. */
  async executeQueuedRun(tenantId: string, actorUserId: string, workflowRunId: string): Promise<WorkflowRunResult> {
    const workflowRun = await this.prisma.forTenantId(tenantId).workflowRun.findUnique({ where: { id: workflowRunId } });
    if (!workflowRun) {
      throw new NotFoundError('Workflow run not found.', { workflowRunId });
    }
    const definition = await this.prisma.forTenantId(tenantId).workflowDefinition.findUnique({
      where: { id: workflowRun.workflowDefinitionId },
      include: { steps: { orderBy: { order: 'asc' } } },
    });
    if (!definition) {
      throw new NotFoundError('Workflow definition not found for this run.', { workflowRunId });
    }
    return this.executeRun(tenantId, actorUserId, definition, workflowRun, (workflowRun.input as Record<string, unknown>) ?? {});
  }

  private async createRun(
    tenantId: string,
    key: string,
    triggerInput: Record<string, unknown>,
  ): Promise<{ definition: WorkflowDefinitionWithSteps; workflowRun: WorkflowRun }> {
    const definition = await this.prisma.forTenantId(tenantId).workflowDefinition.findUnique({
      where: { tenantId_key: { tenantId, key } },
      include: { steps: { orderBy: { order: 'asc' } } },
    });
    if (!definition || definition.status === 'DISABLED') {
      throw new NotFoundError('No runnable workflow definition found for this key.', { key });
    }
    if (definition.steps.length === 0) {
      throw new ValidationFailedError('This workflow definition has no steps.', { key });
    }

    const workflowRun = await this.prisma.forTenantId(tenantId).workflowRun.create({
      data: { tenantId, workflowDefinitionId: definition.id, status: 'RUNNING', input: triggerInput as Prisma.InputJsonValue },
    });

    return { definition, workflowRun };
  }

  private async executeRun(
    tenantId: string,
    actorUserId: string,
    definition: WorkflowDefinitionWithSteps,
    workflowRun: WorkflowRun,
    triggerInput: Record<string, unknown>,
  ): Promise<WorkflowRunResult> {
    const context: WorkflowPathContext = { trigger: { input: triggerInput }, steps: {} };
    const stepResults: WorkflowRunResult['steps'] = [];
    let failureMessage: string | undefined;

    for (const step of definition.steps) {
      if (step.condition && !evaluateWorkflowCondition(context, step.condition as unknown as WorkflowStepConditionExpr)) {
        await this.prisma.forTenantId(tenantId).workflowStepRun.create({
          data: { tenantId, workflowRunId: workflowRun.id, stepOrder: step.order, skipped: true },
        });
        stepResults.push({ order: step.order, agentDefinitionKey: step.agentDefinitionKey, skipped: true });
        continue;
      }

      let resolved: Awaited<ReturnType<AgentDefinitionResolverService['resolve']>>;
      try {
        resolved = await this.resolver.resolve(tenantId, step.agentDefinitionKey);
      } catch (error) {
        failureMessage = `Step ${step.order} (${step.agentDefinitionKey}): ${error instanceof Error ? error.message : String(error)}`;
        break;
      }

      const userMessage = buildWorkflowStepMessage(context, step.inputMapping as Record<string, string> | null);
      const agentRun = await this.runs.start({ tenantId, agentType: resolved.baseType, triggerType: 'MANUAL' });

      let outcomes: ToolCallOutcome[] = [];
      try {
        const result = await resolved.runtime.runTurn(
          { tenantId, agentRunId: agentRun.id, actorUserId },
          { systemPrompt: resolved.systemPrompt, messages: [{ role: 'user', content: userMessage }] },
        );
        outcomes = result.toolCallOutcomes;
        await this.runs.recordToolCalls(tenantId, agentRun.id, outcomes);
        await this.runs.complete(tenantId, agentRun.id, result);
      } catch (error) {
        await this.runs.fail(tenantId, agentRun.id, error instanceof Error ? error.message : String(error));
        failureMessage = `Step ${step.order} (${step.agentDefinitionKey}) failed: ${error instanceof Error ? error.message : String(error)}`;
      }

      await this.prisma.forTenantId(tenantId).workflowStepRun.create({
        data: { tenantId, workflowRunId: workflowRun.id, stepOrder: step.order, agentRunId: agentRun.id },
      });
      stepResults.push({ order: step.order, agentDefinitionKey: step.agentDefinitionKey, skipped: false, agentRunId: agentRun.id });

      const stepOutput: Record<string, unknown> = {};
      for (const outcome of outcomes) {
        if (outcome.output !== undefined) stepOutput[outcome.toolName] = outcome.output;
      }
      context.steps[step.order] = { output: stepOutput };

      for (const outcome of outcomes) {
        if (outcome.decision === 'ALLOW' || outcome.decision === 'DENY') continue;
        await this.approvals.create(tenantId, {
          entityType: 'FOLLOW_UP',
          entityId: outcome.toolCallId,
          policyAction: outcome.toolName,
          requestedByUserId: actorUserId,
          reason: `Workflow-Vorschlag „${outcome.toolName}" (Schritt ${step.order}) wartet auf Freigabe.`,
        });
      }

      if (failureMessage) break;
    }

    const finalStatus = failureMessage ? 'FAILED' : 'COMPLETED';
    await this.prisma.forTenantId(tenantId).workflowRun.update({
      where: { id: workflowRun.id },
      data: { status: finalStatus, errorMessage: failureMessage, completedAt: new Date() },
    });

    return { workflowRunId: workflowRun.id, status: finalStatus, steps: stepResults };
  }

  async listRuns(tenantId: string, workflowDefinitionKey: string): Promise<WorkflowRunWithStepRuns[]> {
    const definition = await this.prisma
      .forTenantId(tenantId)
      .workflowDefinition.findUnique({ where: { tenantId_key: { tenantId, key: workflowDefinitionKey } } });
    if (!definition) {
      throw new NotFoundError('Workflow definition not found.', { key: workflowDefinitionKey });
    }
    return this.prisma.forTenantId(tenantId).workflowRun.findMany({
      where: { workflowDefinitionId: definition.id },
      orderBy: { startedAt: 'desc' },
      take: 50,
      include: { stepRuns: { orderBy: { stepOrder: 'asc' } } },
    });
  }
}
