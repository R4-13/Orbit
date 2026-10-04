import { Injectable } from '@nestjs/common';
import type { Case, Prisma } from '@orbit/domain';
import { NotFoundError, caseStatusFor, type CaseOrchestrationStatusValue } from '@orbit/shared';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CASE_EVENT_TYPES, CaseEventsService } from './case-events.service';

export interface CaseTransition {
  to: CaseOrchestrationStatusValue;
  /** Why the case needs attention right now (shown on the orchestration view); replaces the previous list. */
  attentionReasons?: string[];
  /** Set only for a verified completion (Amendment 02 §20.6) or a deliberate manual close. */
  outcome?: { code: string; evidenceRefs: string[] };
}

/**
 * The single place that changes a case's process state. It keeps the
 * fine-grained `orchestrationStatus` and the pre-existing simple `status`
 * consistent through the ONE mapping table in @orbit/shared (`caseStatusFor`),
 * bumps `revision`, and writes the matching case event in the SAME transaction
 * (Amendment 02 §12.3: state change and outbox event are atomic) — so no
 * caller can set one without the other, and the frontend never needs its own
 * status machine (§12.1).
 */
@Injectable()
export class CaseLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: CaseEventsService,
  ) {}

  async transition(tenantId: string, caseId: string, transition: CaseTransition, actor: { userId?: string; type: 'USER' | 'AGENT' | 'SYSTEM' } = { type: 'SYSTEM' }): Promise<Case> {
    const completing = transition.to === 'COMPLETED';
    const { updated, previous } = await this.prisma.inTenantTransaction(tenantId, async (tx) => {
      const existing = await tx.case.findFirst({ where: { id: caseId, tenantId } });
      if (!existing) throw new NotFoundError('Case not found.', { caseId });
      const changed = await tx.case.update({
        where: { id: caseId },
        data: {
          orchestrationStatus: transition.to,
          status: caseStatusFor(transition.to),
          revision: { increment: 1 },
          attentionReasons: transition.attentionReasons ?? [],
          ...(completing ? { completedAt: new Date(), outcome: transition.outcome as unknown as Prisma.InputJsonValue } : {}),
        },
      });
      await this.events.appendInTx(tx, tenantId, caseId, {
        type: completing ? CASE_EVENT_TYPES.COMPLETED : CASE_EVENT_TYPES.STATUS_CHANGED,
        payload: { from: existing.orchestrationStatus, to: transition.to, attentionReasons: transition.attentionReasons ?? [], revision: changed.revision },
      });
      return { updated: changed, previous: existing.orchestrationStatus };
    });

    if (previous !== transition.to) {
      await this.audit.record({
        tenantId,
        eventType: 'CASE_STATUS_CHANGED',
        actorType: actor.type,
        actorUserId: actor.userId,
        entityType: 'Case',
        entityId: caseId,
        payload: { from: previous, to: transition.to, attentionReasons: transition.attentionReasons ?? [], outcomeCode: transition.outcome?.code },
      });
    }
    return updated;
  }

  /** Applies a fact-/goal-level update without changing the process state. */
  async setGoals(tenantId: string, caseId: string, input: { businessGoals: string[]; currentIntent?: string; blueprint?: { key: string; version: string } }): Promise<void> {
    await this.prisma.forTenantId(tenantId).case.update({
      where: { id: caseId },
      data: {
        businessGoals: input.businessGoals,
        currentIntent: input.currentIntent,
        ...(input.blueprint ? { blueprintKey: input.blueprint.key, blueprintVersion: input.blueprint.version } : {}),
        revision: { increment: 1 },
      },
    });
  }
}
