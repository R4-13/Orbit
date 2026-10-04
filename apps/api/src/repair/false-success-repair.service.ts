import { Injectable } from '@nestjs/common';
import { Prisma } from '@orbit/domain';
import { NotFoundError, ValidationFailedError } from '@orbit/shared';
import { PrismaService } from '../prisma/prisma.service';

export interface FalseSuccessRepairTarget {
  tenantId: string;
  connectionId: string;
  /** The provider's own message id (`IntakeEvent.externalEventId`) — never the subject. */
  externalEventId: string;
  intakeEventId: string;
  workflowRunId: string;
  agentRunId: string;
  /** The tool whose recorded failure proves the run did not succeed. */
  failedToolName: string;
  reason: string;
  /** Free text identifying who/what executed the correction (audit evidence). */
  executedBy: string;
}

export interface FalseSuccessRepairResult {
  changed: boolean;
  previous: { intakeStatus: string; workflowRunStatus: string };
  current: { intakeStatus: string; workflowRunStatus: string };
}

/**
 * Amendment 02 §24.3 — corrects a *provably* wrong terminal success status
 * (IntakeEvent/WorkflowRun `COMPLETED` although a required tool failed).
 *
 * Contract:
 * - the target is identified by tenant + connection + source message id +
 *   run ids + failed tool — never by subject,
 * - every precondition is verified from persisted evidence first; if any
 *   does not hold, nothing changes,
 * - the original status/timestamps/error evidence stay available (copied
 *   into the audit payload and the event's metadata; `completedAt` and all
 *   timestamps are untouched),
 * - one audit event per corrected record records old/new state, reason,
 *   time and executor,
 * - nothing is deleted, the workflow is NOT restarted, no lead/mail is
 *   created — a deliberate retry is a separate, ledger-checked command.
 *
 * Idempotent: a second run on an already-corrected target is a no-op.
 * Uses the documented RLS bypass because it is a maintenance operation,
 * but every query still filters by the explicit tenant id.
 */
@Injectable()
export class FalseSuccessRepairService {
  constructor(private readonly prisma: PrismaService) {}

  async repair(target: FalseSuccessRepairTarget): Promise<FalseSuccessRepairResult> {
    return this.prisma.withRlsBypass(async (tx) => {
      const intake = await tx.intakeEvent.findFirst({
        where: {
          id: target.intakeEventId,
          tenantId: target.tenantId,
          connectionId: target.connectionId,
          externalEventId: target.externalEventId,
        },
      });
      if (!intake) throw new NotFoundError('IntakeEvent does not match tenant/connection/source message.', { intakeEventId: target.intakeEventId });
      if (intake.workflowRunId !== target.workflowRunId) {
        throw new ValidationFailedError('IntakeEvent is not linked to the given WorkflowRun.', { intakeEventId: intake.id });
      }

      const run = await tx.workflowRun.findFirst({ where: { id: target.workflowRunId, tenantId: target.tenantId } });
      if (!run) throw new NotFoundError('WorkflowRun not found for this tenant.', { workflowRunId: target.workflowRunId });

      const stepRun = await tx.workflowStepRun.findFirst({
        where: { workflowRunId: run.id, tenantId: target.tenantId, agentRunId: target.agentRunId },
      });
      const agentRun = await tx.agentRun.findFirst({ where: { id: target.agentRunId, tenantId: target.tenantId } });
      if (!stepRun || !agentRun) {
        throw new ValidationFailedError('AgentRun is not part of the given WorkflowRun.', { agentRunId: target.agentRunId });
      }
      const failedInvocation = await tx.toolInvocation.findFirst({
        where: { agentRunId: agentRun.id, tenantId: target.tenantId, toolName: target.failedToolName, status: 'FAILED' },
        orderBy: { createdAt: 'asc' },
      });

      const previous = { intakeStatus: intake.status, workflowRunStatus: run.status };

      // Already corrected (or never wrongly successful): nothing to do.
      if (intake.status !== 'COMPLETED' && run.status !== 'COMPLETED') {
        return { changed: false, previous, current: previous };
      }

      // Hard precondition: the proof of failure must exist in persisted evidence.
      if (agentRun.status !== 'FAILED' || !failedInvocation) {
        throw new ValidationFailedError(
          'No persisted failure evidence (AgentRun FAILED and a FAILED tool invocation) — refusing to change any status.',
          { agentRunId: agentRun.id, toolName: target.failedToolName },
        );
      }

      const errorMessage = `Korrigiert (Amendment 02 §24.3): Tool "${target.failedToolName}" ist fehlgeschlagen; der frühere Status COMPLETED war falsch.`;
      const correctedAt = new Date();
      const originalIntakeMetadata = (intake.metadata && typeof intake.metadata === 'object' && !Array.isArray(intake.metadata)
        ? intake.metadata
        : {}) as Record<string, unknown>;

      await tx.intakeEvent.update({
        where: { id: intake.id },
        data: {
          status: 'FAILED',
          errorMessage,
          metadata: {
            ...originalIntakeMetadata,
            statusCorrection: {
              previousStatus: intake.status,
              previousErrorMessage: intake.errorMessage,
              correctedAt: correctedAt.toISOString(),
              reason: target.reason,
              failedToolName: target.failedToolName,
              workflowRunId: run.id,
            },
          } as Prisma.InputJsonValue,
        },
      });
      await tx.workflowRun.update({
        where: { id: run.id },
        data: { status: 'FAILED', errorMessage },
      });
      if (stepRun.status !== 'FAILED') {
        await tx.workflowStepRun.update({
          where: { id: stepRun.id },
          data: {
            status: 'FAILED',
            errorCode: stepRun.errorCode ?? 'TOOL_RETURNED_ERROR',
            errorMessage,
            failedToolName: target.failedToolName,
          },
        });
      }

      const payloadBase = {
        reason: target.reason,
        executedBy: target.executedBy,
        correctedAt: correctedAt.toISOString(),
        sourceMessageId: target.externalEventId,
        connectionId: target.connectionId,
        failedToolName: target.failedToolName,
        failedToolInvocationId: failedInvocation.id,
        failedToolCallId: failedInvocation.toolCallId,
        agentRunId: agentRun.id,
        workflowRunId: run.id,
        preserved: 'completedAt, startedAt, tool evidence and external references are unchanged; nothing deleted; workflow not restarted',
      };
      await tx.auditLog.create({
        data: {
          tenantId: target.tenantId,
          eventType: 'STATUS_CORRECTED',
          actorType: 'SYSTEM',
          entityType: 'IntakeEvent',
          entityId: intake.id,
          payload: { ...payloadBase, from: { status: intake.status, errorMessage: intake.errorMessage }, to: { status: 'FAILED', errorMessage } } as Prisma.InputJsonValue,
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId: target.tenantId,
          eventType: 'STATUS_CORRECTED',
          actorType: 'SYSTEM',
          entityType: 'WorkflowRun',
          entityId: run.id,
          payload: {
            ...payloadBase,
            from: { status: run.status, errorMessage: run.errorMessage, completedAt: run.completedAt?.toISOString() ?? null },
            to: { status: 'FAILED', errorMessage },
          } as Prisma.InputJsonValue,
        },
      });

      return { changed: true, previous, current: { intakeStatus: 'FAILED', workflowRunStatus: 'FAILED' } };
    });
  }
}
