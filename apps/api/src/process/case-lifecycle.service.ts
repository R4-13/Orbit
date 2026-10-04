import { Injectable } from '@nestjs/common';
import type { Case } from '@orbit/domain';
import { NotFoundError, caseStatusFor, type CaseOrchestrationStatusValue } from '@orbit/shared';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

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
 * bumps `revision`, and audits the change — so no caller can set one without
 * the other, and the frontend never needs its own status machine (§12.1).
 */
@Injectable()
export class CaseLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async transition(tenantId: string, caseId: string, transition: CaseTransition, actor: { userId?: string; type: 'USER' | 'AGENT' | 'SYSTEM' } = { type: 'SYSTEM' }): Promise<Case> {
    const scoped = this.prisma.forTenantId(tenantId);
    const existing = await scoped.case.findUnique({ where: { id: caseId } });
    if (!existing) throw new NotFoundError('Case not found.', { caseId });

    const completing = transition.to === 'COMPLETED';
    const updated = await scoped.case.update({
      where: { id: caseId },
      data: {
        orchestrationStatus: transition.to,
        status: caseStatusFor(transition.to),
        revision: { increment: 1 },
        attentionReasons: transition.attentionReasons ?? [],
        ...(completing ? { completedAt: new Date(), outcome: transition.outcome } : {}),
      },
    });

    if (existing.orchestrationStatus !== transition.to) {
      await this.audit.record({
        tenantId,
        eventType: 'CASE_STATUS_CHANGED',
        actorType: actor.type,
        actorUserId: actor.userId,
        entityType: 'Case',
        entityId: caseId,
        payload: {
          from: existing.orchestrationStatus,
          to: transition.to,
          attentionReasons: transition.attentionReasons ?? [],
          outcomeCode: transition.outcome?.code,
        },
      });
    }
    return updated;
  }

  /** Applies a fact-/goal-level update without changing the process state. */
  async setGoals(tenantId: string, caseId: string, input: { businessGoals: string[]; currentIntent?: string }): Promise<void> {
    await this.prisma
      .forTenantId(tenantId)
      .case.update({ where: { id: caseId }, data: { businessGoals: input.businessGoals, currentIntent: input.currentIntent, revision: { increment: 1 } } });
  }
}
