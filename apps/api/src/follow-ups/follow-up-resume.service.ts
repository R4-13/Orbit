import { Inject, Injectable } from '@nestjs/common';
import type { ToolCallOutcome, ToolRegistry } from '@orbit/agent-core';
import type { Approval, Prisma } from '@orbit/domain';
import { AuthenticationExpiredError, ExternalSystemError, IntegrationUnavailableError, NotFoundError, PolicyViolationError } from '@orbit/shared';
import { AgentRunRecorderService } from '../agent/agent-run-recorder.service';
import { TOOL_REGISTRY } from '../agent/agent.tokens';
import { ApprovalsService } from '../approvals/approvals.service';
import { PrismaService } from '../prisma/prisma.service';
import type { WorkflowPathContext } from '../workflows/workflow-path';
import { WorkflowRunnerService } from '../workflows/workflow-runner.service';

/**
 * docs/ORBIT_UNIFIED_EVOLUTION_CONCEPT.md §6 ("Approval Resume") —
 * previously the single biggest confirmed gap in this codebase
 * (docs/ORBIT_UNIFIED_IMPLEMENTATION_PLAN.md, "kritischer Befund"):
 * approving a blocked `FOLLOW_UP` entry had no effect at all. This
 * service is the "owning entity" for `entityType: 'FOLLOW_UP'`
 * approvals, following the same pattern `SuppliersService.approve()`/
 * `InvoicesService.approve()` already use for their own entity types
 * (see `ApprovalsService`'s own doc comment: deciding an approval
 * updates both the entity and the matching `Approval` row in one place,
 * not through a generic dispatch table).
 *
 * Resolves the blocked call's tool name + original input arguments from
 * `ToolInvocation` (joined via `toolCallId === approval.entityId`,
 * Phase 1 of docs/ORBIT_UNIFIED_IMPLEMENTATION_PLAN.md) — no LLM is
 * re-invoked, no tool is re-selected; the human is approving the exact
 * call the agent already proposed. Executes it directly against the
 * shared, unrestricted `TOOL_REGISTRY` (the specific tool + its Zod
 * schema is already fixed at this point; the "which tools may this
 * agent choose from" concern that the restricted per-`AgentDefinition`
 * registry exists for does not apply to re-running an already-selected,
 * already-approved call).
 *
 * If the blocked call happened inside a `WorkflowRun` step (detected via
 * `WorkflowStepRun.agentRunId`), resumes the remaining steps through
 * `WorkflowRunnerService.resumeFromStep()`. If it was a direct
 * `IntakeService` call (no `WorkflowStepRun`), executing the tool is the
 * entire resume — `IntakeService`'s own orchestration already finished
 * synchronously within the original HTTP request, nothing else to
 * continue.
 */
@Injectable()
export class FollowUpResumeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly approvals: ApprovalsService,
    private readonly agentRuns: AgentRunRecorderService,
    private readonly workflowRunner: WorkflowRunnerService,
    @Inject(TOOL_REGISTRY) private readonly tools: ToolRegistry,
  ) {}

  async approve(tenantId: string, actorUserId: string, approvalId: string): Promise<Approval> {
    const approval = await this.requirePendingFollowUp(tenantId, approvalId);

    const toolInvocation = await this.prisma.forTenantId(tenantId).toolInvocation.findFirst({
      where: { toolCallId: approval.entityId, status: 'BLOCKED_AWAITING_APPROVAL' },
      orderBy: { createdAt: 'desc' },
    });
    if (!toolInvocation) {
      throw new NotFoundError('No blocked tool invocation found for this approval — it may predate Phase 1 of docs/ORBIT_UNIFIED_IMPLEMENTATION_PLAN.md.', {
        approvalId,
      });
    }

    const tool = this.tools.get(toolInvocation.toolName);
    if (!tool) {
      throw new NotFoundError(`Unknown tool "${toolInvocation.toolName}".`, { approvalId });
    }

    const input = (toolInvocation.input as Record<string, unknown>) ?? {};
    let outcome: ToolCallOutcome;
    try {
      const output = await this.tools.execute(tool.name, input, {
        tenantId,
        agentRunId: toolInvocation.agentRunId,
        actorUserId,
      });
      outcome = { toolCallId: approval.entityId, toolName: tool.name, decision: 'ALLOW', input, output };
    } catch (error) {
      // Die Aktion wurde nachweislich nicht ausgeführt, weil eine Verbindung fehlt oder unterbrochen ist: die Freigabe bleibt OFFEN. Weder wird sie als
      // „genehmigt/erledigt“ geführt noch der blockierte Aufruf verbraucht – nach dem Erneuern der Verbindung genügt eine erneute Freigabe. Die Person
      // erhält die Ursache in verständlicher Form statt eines stillen Erfolgs.
      if (error instanceof IntegrationUnavailableError || error instanceof AuthenticationExpiredError) {
        throw new IntegrationUnavailableError(`Die Freigabe wurde nicht ausgeführt: ${error.message} Die Freigabe bleibt offen und kann nach dem Beheben erneut erteilt werden.`);
      }
      outcome = {
        toolCallId: approval.entityId,
        toolName: tool.name,
        decision: 'ALLOW',
        input,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    await this.agentRuns.recordToolCalls(tenantId, toolInvocation.agentRunId, [outcome]);
    await this.approvals.markDecided(tenantId, 'FOLLOW_UP', approval.entityId, actorUserId, 'APPROVED');

    const stepRun = await this.prisma
      .forTenantId(tenantId)
      .workflowStepRun.findFirst({ where: { agentRunId: toolInvocation.agentRunId } });

    if (stepRun) {
      if (outcome.error) {
        await this.prisma.forTenantId(tenantId).workflowRun.update({
          where: { id: stepRun.workflowRunId },
          data: {
            status: 'FAILED',
            errorMessage: `Schritt ${stepRun.stepOrder} (${tool.name}) nach Freigabe fehlgeschlagen: ${outcome.error}`,
            completedAt: new Date(),
          },
        });
      } else {
        const stillPending = await this.hasOtherPendingApprovals(tenantId, stepRun.workflowRunId, approval.entityId);
        if (stillPending) {
          await this.mergeIntoContextSnapshot(tenantId, stepRun.workflowRunId, stepRun.stepOrder, tool.name, outcome.output);
        } else {
          const context = await this.loadContextSnapshot(tenantId, stepRun.workflowRunId);
          context.steps[stepRun.stepOrder] = {
            output: { ...(context.steps[stepRun.stepOrder]?.output ?? {}), [tool.name]: outcome.output },
          };
          await this.workflowRunner.resumeFromStep(tenantId, actorUserId, stepRun.workflowRunId, stepRun.stepOrder + 1, context);
        }
      }
    }

    // Die Entscheidung der Person ist festgehalten, die Ausführung aber gescheitert (oder bei einem Versand ungewiss): das wird nie still als Erfolg geführt.
    if (outcome.error) {
      throw new ExternalSystemError(`Die Freigabe wurde erfasst, die Ausführung von „${tool.name}“ ist jedoch fehlgeschlagen: ${outcome.error}`, { approvalId, toolName: tool.name });
    }

    return this.approvals.findOne(tenantId, approvalId);
  }

  async reject(tenantId: string, actorUserId: string, approvalId: string): Promise<Approval> {
    const approval = await this.requirePendingFollowUp(tenantId, approvalId);
    await this.approvals.markDecided(tenantId, 'FOLLOW_UP', approval.entityId, actorUserId, 'REJECTED');

    const toolInvocation = await this.prisma.forTenantId(tenantId).toolInvocation.findFirst({
      where: { toolCallId: approval.entityId },
      orderBy: { createdAt: 'desc' },
    });
    if (toolInvocation) {
      const stepRun = await this.prisma
        .forTenantId(tenantId)
        .workflowStepRun.findFirst({ where: { agentRunId: toolInvocation.agentRunId } });
      if (stepRun) {
        await this.workflowRunner.markRejected(tenantId, stepRun.workflowRunId);
      }
    }

    return this.approvals.findOne(tenantId, approvalId);
  }

  private async requirePendingFollowUp(tenantId: string, approvalId: string): Promise<Approval> {
    const approval = await this.approvals.findOne(tenantId, approvalId);
    if (approval.entityType !== 'FOLLOW_UP') {
      throw new PolicyViolationError('This approval is not a FOLLOW_UP entry.', { approvalId, entityType: approval.entityType });
    }
    if (approval.status !== 'PENDING') {
      throw new PolicyViolationError('Approval is not pending.', { approvalId, status: approval.status });
    }
    return approval;
  }

  /** Whether any *other* blocked tool call from the same WorkflowRun is still waiting on a decision — if so, the run must stay WAITING_FOR_APPROVAL rather than advancing to the next step. */
  private async hasOtherPendingApprovals(tenantId: string, workflowRunId: string, excludeEntityId: string): Promise<boolean> {
    const stepRuns = await this.prisma.forTenantId(tenantId).workflowStepRun.findMany({
      where: { workflowRunId },
      select: { agentRunId: true },
    });
    const agentRunIds = stepRuns.map((s) => s.agentRunId).filter((id): id is string => Boolean(id));
    if (agentRunIds.length === 0) return false;

    const blocked = await this.prisma.forTenantId(tenantId).toolInvocation.findMany({
      where: { agentRunId: { in: agentRunIds }, status: 'BLOCKED_AWAITING_APPROVAL' },
      select: { toolCallId: true },
    });
    const toolCallIds = blocked.map((t) => t.toolCallId).filter((id): id is string => Boolean(id) && id !== excludeEntityId);
    if (toolCallIds.length === 0) return false;

    const pendingCount = await this.prisma.forTenantId(tenantId).approval.count({
      where: { entityType: 'FOLLOW_UP', entityId: { in: toolCallIds }, status: 'PENDING' },
    });
    return pendingCount > 0;
  }

  private async loadContextSnapshot(tenantId: string, workflowRunId: string): Promise<WorkflowPathContext> {
    const run = await this.prisma.forTenantId(tenantId).workflowRun.findUnique({ where: { id: workflowRunId } });
    if (!run) {
      throw new NotFoundError('Workflow run not found.', { workflowRunId });
    }
    return (run.contextSnapshot as unknown as WorkflowPathContext) ?? { trigger: { input: (run.input as Record<string, unknown>) ?? {} }, steps: {} };
  }

  private async mergeIntoContextSnapshot(
    tenantId: string,
    workflowRunId: string,
    stepOrder: number,
    toolName: string,
    output: unknown,
  ): Promise<void> {
    const context = await this.loadContextSnapshot(tenantId, workflowRunId);
    context.steps[stepOrder] = { output: { ...(context.steps[stepOrder]?.output ?? {}), [toolName]: output } };
    await this.prisma.forTenantId(tenantId).workflowRun.update({
      where: { id: workflowRunId },
      data: { contextSnapshot: context as unknown as Prisma.InputJsonValue },
    });
  }
}
