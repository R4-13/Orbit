import { Injectable } from '@nestjs/common';
import type { ToolCallOutcome } from '@orbit/agent-core';
import type { Prisma } from '@orbit/domain';
import { NotFoundError, ValidationFailedError } from '@orbit/shared';
import { AgentRunRecorderService } from '../agent/agent-run-recorder.service';
import { AgentDefinitionResolverService } from '../agent-definitions/agent-definition-resolver.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { PrismaService } from '../prisma/prisma.service';
import { buildWorkflowStepMessage, evaluateWorkflowCondition, type WorkflowPathContext, type WorkflowStepConditionExpr } from './workflow-path';

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
 */
@Injectable()
export class WorkflowRunnerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: AgentDefinitionResolverService,
    private readonly runs: AgentRunRecorderService,
    private readonly approvals: ApprovalsService,
  ) {}

  async trigger(tenantId: string, actorUserId: string, key: string, triggerInput: Record<string, unknown>): Promise<WorkflowRunResult> {
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
