import { Inject, Injectable } from '@nestjs/common';
import type { AgentTurnResult, ToolCallOutcome, ToolRegistry } from '@orbit/agent-core';
import type { AgentRun, AgentRunTriggerType, AgentType, Prisma, ToolInvocation } from '@orbit/domain';
import { NotFoundError } from '@orbit/shared';
import { AuditService } from '../audit/audit.service';
import { MetricsService } from '../metrics/metrics.service';
import { PrismaService } from '../prisma/prisma.service';
import { TOOL_REGISTRY } from './agent.tokens';

export interface QueryAgentRunsInput {
  agentType?: AgentType;
  caseId?: string;
}

export interface StartAgentRunInput {
  tenantId: string;
  agentType: AgentType;
  triggerType: AgentRunTriggerType;
  caseId?: string;
  input?: Record<string, unknown>;
}

/**
 * Persists AgentRun/ToolInvocation (§10 — previously-modeled, never-
 * written tables, see MASTER_SPEC_GAP_ANALYSIS.md §10) around an
 * AgentRuntime.runTurn() call, and records the matching audit trail
 * entries (AGENT_RUN_STARTED/COMPLETED/FAILED, TOOL_INVOKED,
 * POLICY_DECISION_MADE — all already in AUDIT_EVENT_TYPES, just never
 * emitted before Phase 18).
 */
@Injectable()
export class AgentRunRecorderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly metrics: MetricsService,
    @Inject(TOOL_REGISTRY) private readonly tools: ToolRegistry,
  ) {}

  async start(input: StartAgentRunInput): Promise<AgentRun> {
    const run = await this.prisma.forTenantId(input.tenantId).agentRun.create({
      data: {
        tenantId: input.tenantId,
        caseId: input.caseId,
        agentType: input.agentType,
        triggerType: input.triggerType,
        status: 'RUNNING',
        input: input.input as Prisma.InputJsonValue | undefined,
      },
    });

    await this.audit.record({
      tenantId: input.tenantId,
      eventType: 'AGENT_RUN_STARTED',
      actorType: 'AGENT',
      entityType: 'AgentRun',
      entityId: run.id,
      payload: { agentType: input.agentType, triggerType: input.triggerType },
    });

    return run;
  }

  /** Persists every tool call outcome from a completed AgentRuntime turn as a ToolInvocation row. */
  async recordToolCalls(tenantId: string, agentRunId: string, outcomes: ToolCallOutcome[]): Promise<void> {
    for (const outcome of outcomes) {
      const status =
        outcome.decision === 'DENY'
          ? 'DENIED'
          : outcome.decision !== 'ALLOW'
            ? 'BLOCKED_AWAITING_APPROVAL'
            : outcome.error
              ? 'FAILED'
              : 'SUCCESS';

      await this.prisma.forTenantId(tenantId).toolInvocation.create({
        data: {
          tenantId,
          agentRunId,
          toolCallId: outcome.toolCallId,
          toolName: outcome.toolName,
          policyAction: this.tools.get(outcome.toolName)?.policyAction,
          input: outcome.input as Prisma.InputJsonValue | undefined,
          // Previously always SUCCESS/FAILED regardless of `decision` —
          // BLOCKED_AWAITING_APPROVAL/DENIED existed in the enum since
          // Phase 1 but were never written. Now correctly reflects
          // whether the tool actually ran; FollowUpsModule relies on
          // finding BLOCKED_AWAITING_APPROVAL rows to resume, see
          // docs/ORBIT_UNIFIED_IMPLEMENTATION_PLAN.md.
          status,
          output: { decision: outcome.decision, output: outcome.output, error: outcome.error } as Prisma.InputJsonValue,
        },
      });

      // Only ALLOW decisions ever reach ToolRegistry.execute() — durationMs
      // is undefined for blocked/denied calls (see ToolCallOutcome's own
      // doc comment, packages/agent-core).
      if (outcome.durationMs !== undefined) {
        this.metrics.toolInvocationDuration.observe({ tool_name: outcome.toolName, status }, outcome.durationMs / 1000);
      }

      await this.audit.record({
        tenantId,
        eventType: 'TOOL_INVOKED',
        actorType: 'AGENT',
        entityType: 'ToolInvocation',
        entityId: outcome.toolCallId,
        payload: { toolName: outcome.toolName, decision: outcome.decision },
      });

      if (outcome.decision !== 'ALLOW') {
        await this.audit.record({
          tenantId,
          eventType: 'POLICY_DECISION_MADE',
          actorType: 'AGENT',
          entityType: 'ToolInvocation',
          entityId: outcome.toolCallId,
          payload: { toolName: outcome.toolName, decision: outcome.decision },
        });
      }
    }
  }

  async complete(tenantId: string, agentRunId: string, result: AgentTurnResult): Promise<void> {
    const hasError = result.toolCallOutcomes.some((outcome) => outcome.error);

    const updated = await this.prisma.forTenantId(tenantId).agentRun.update({
      where: { id: agentRunId },
      data: {
        status: hasError ? 'FAILED' : 'COMPLETED',
        output: {
          finalText: result.finalText,
          iterations: result.iterations,
          toolCallOutcomes: result.toolCallOutcomes,
        } as unknown as Prisma.InputJsonValue,
        completedAt: new Date(),
      },
    });
    this.recordAgentRunMetrics(updated);

    await this.audit.record({
      tenantId,
      eventType: hasError ? 'AGENT_RUN_FAILED' : 'AGENT_RUN_COMPLETED',
      actorType: 'AGENT',
      entityType: 'AgentRun',
      entityId: agentRunId,
      payload: { iterations: result.iterations },
    });
  }

  /** Read side for the §38 Activity feed — newest runs first, across all agent types unless filtered. */
  findAll(
    tenantId: string,
    query: QueryAgentRunsInput,
  ): Promise<Array<AgentRun & { toolInvocations: ToolInvocation[] }>> {
    return this.prisma.forTenantId(tenantId).agentRun.findMany({
      where: { agentType: query.agentType, caseId: query.caseId },
      include: { toolInvocations: { orderBy: { createdAt: 'asc' } } },
      orderBy: { startedAt: 'desc' },
      take: 100,
    });
  }

  async findOne(tenantId: string, id: string): Promise<AgentRun & { toolInvocations: ToolInvocation[] }> {
    const found = await this.prisma.forTenantId(tenantId).agentRun.findUnique({
      where: { id },
      include: { toolInvocations: { orderBy: { createdAt: 'asc' } } },
    });
    if (!found) {
      throw new NotFoundError('AgentRun not found.', { id });
    }
    return found;
  }

  async fail(tenantId: string, agentRunId: string, errorMessage: string): Promise<void> {
    const updated = await this.prisma.forTenantId(tenantId).agentRun.update({
      where: { id: agentRunId },
      data: { status: 'FAILED', errorMessage, completedAt: new Date() },
    });
    this.recordAgentRunMetrics(updated);

    await this.audit.record({
      tenantId,
      eventType: 'AGENT_RUN_FAILED',
      actorType: 'AGENT',
      entityType: 'AgentRun',
      entityId: agentRunId,
      payload: { error: errorMessage },
    });
  }

  private recordAgentRunMetrics(run: AgentRun): void {
    const durationSeconds = (Date.now() - run.startedAt.getTime()) / 1000;
    this.metrics.agentRunDuration.observe({ agent_type: run.agentType, status: run.status }, durationSeconds);
    if (run.status === 'FAILED') this.metrics.agentRunFailures.inc({ agent_type: run.agentType });
  }
}
