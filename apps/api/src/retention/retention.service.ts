import { Injectable } from '@nestjs/common';
import { NotFoundError, TERMINAL_CASE_STATUSES } from '@orbit/shared';
import { AgentRunStatus, RetentionCategory, type RetentionPolicy } from '@orbit/domain';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

/** AgentRun rows still in flight are never eligible for deletion, however old — an
 * agent stuck in RUNNING/WAITING_FOR_APPROVAL past the retention window is an
 * operational anomaly to investigate, not stale history to discard. */
const AGENT_RUN_TERMINAL_STATUSES: AgentRunStatus[] = [
  AgentRunStatus.COMPLETED,
  AgentRunStatus.FAILED,
  AgentRunStatus.REJECTED,
];

/** Abgeschlossene Vorgänge – nur deren Texte und überholte Fakten dürfen der Aufbewahrungsfrist zum Opfer fallen. */
const TERMINAL_CASE_STATUS_LIST = [...TERMINAL_CASE_STATUSES];

export interface RetentionPreviewResult {
  category: RetentionCategory;
  retentionDays: number;
  cutoffAt: Date;
  matchingCount: number;
  oldestMatchingAt: Date | null;
  newestMatchingAt: Date | null;
}

export interface RetentionApplyResult {
  category: RetentionCategory;
  retentionDays: number;
  cutoffAt: Date;
  deletedCount: number;
}

/**
 * §Retention-Grundlage (Unified Evolution Concept): lets a tenant configure
 * how long AgentRun / ToolInvocation history is kept, preview what a policy
 * would delete, and manually trigger the deletion. Deliberately no
 * automatic scheduler in this phase (see docs/ASSUMPTIONS.md) — apply() is
 * only ever invoked by an explicit, audited admin action, never a cron.
 * A tenant with no RetentionPolicy row for a category has unlimited
 * retention for it by default; nothing is ever deleted without an admin
 * having explicitly configured a window first.
 */
@Injectable()
export class RetentionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  findAll(tenantId: string): Promise<RetentionPolicy[]> {
    return this.prisma.forTenantId(tenantId).retentionPolicy.findMany({ orderBy: { category: 'asc' } });
  }

  async upsertPolicy(
    tenantId: string,
    actorUserId: string,
    category: RetentionCategory,
    retentionDays: number,
  ): Promise<RetentionPolicy> {
    const existing = await this.prisma
      .forTenantId(tenantId)
      .retentionPolicy.findUnique({ where: { tenantId_category: { tenantId, category } } });

    const updated = await this.prisma.forTenantId(tenantId).retentionPolicy.upsert({
      where: { tenantId_category: { tenantId, category } },
      create: { tenantId, category, retentionDays, updatedByUserId: actorUserId },
      update: { retentionDays, updatedByUserId: actorUserId },
    });

    await this.audit.record({
      tenantId,
      eventType: 'RETENTION_POLICY_UPDATED',
      actorType: 'USER',
      actorUserId,
      entityType: 'RetentionPolicy',
      entityId: updated.id,
      payload: { category, previousRetentionDays: existing?.retentionDays ?? null, newRetentionDays: retentionDays },
    });

    return updated;
  }

  async preview(tenantId: string, category: RetentionCategory): Promise<RetentionPreviewResult> {
    const policy = await this.getPolicyOrThrow(tenantId, category);
    const cutoffAt = this.cutoffDate(policy.retentionDays);
    const { matchingCount, oldestMatchingAt, newestMatchingAt } = await this.matchingRange(tenantId, category, cutoffAt);

    return { category, retentionDays: policy.retentionDays, cutoffAt, matchingCount, oldestMatchingAt, newestMatchingAt };
  }

  async apply(tenantId: string, actorUserId: string, category: RetentionCategory): Promise<RetentionApplyResult> {
    const policy = await this.getPolicyOrThrow(tenantId, category);
    const cutoffAt = this.cutoffDate(policy.retentionDays);
    const deletedCount = await this.deleteMatching(tenantId, category, cutoffAt);

    await this.audit.record({
      tenantId,
      eventType: 'RETENTION_APPLIED',
      actorType: 'USER',
      actorUserId,
      entityType: 'RetentionPolicy',
      entityId: policy.id,
      payload: { category, retentionDays: policy.retentionDays, cutoffAt: cutoffAt.toISOString(), deletedCount },
    });

    return { category, retentionDays: policy.retentionDays, cutoffAt, deletedCount };
  }

  private async getPolicyOrThrow(tenantId: string, category: RetentionCategory): Promise<RetentionPolicy> {
    const policy = await this.prisma
      .forTenantId(tenantId)
      .retentionPolicy.findUnique({ where: { tenantId_category: { tenantId, category } } });
    if (!policy) {
      throw new NotFoundError('No retention policy configured for this category yet.', { category });
    }
    return policy;
  }

  private cutoffDate(retentionDays: number): Date {
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - retentionDays);
    return cutoff;
  }

  private async matchingRange(
    tenantId: string,
    category: RetentionCategory,
    cutoffAt: Date,
  ): Promise<{ matchingCount: number; oldestMatchingAt: Date | null; newestMatchingAt: Date | null }> {
    if (category === RetentionCategory.EMAIL_BODIES) {
      const where = this.emailBodiesWhere(cutoffAt);
      const scoped = this.prisma.forTenantId(tenantId);
      const [matchingCount, oldest, newest] = await Promise.all([
        scoped.emailMessage.count({ where }),
        scoped.emailMessage.findFirst({ where, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
        scoped.emailMessage.findFirst({ where, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
      ]);
      return { matchingCount, oldestMatchingAt: oldest?.createdAt ?? null, newestMatchingAt: newest?.createdAt ?? null };
    }
    if (category === RetentionCategory.SUPERSEDED_FACTS) {
      const where = this.supersededFactsWhere(cutoffAt);
      const scoped = this.prisma.forTenantId(tenantId);
      const [matchingCount, oldest, newest] = await Promise.all([
        scoped.caseFact.count({ where }),
        scoped.caseFact.findFirst({ where, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
        scoped.caseFact.findFirst({ where, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
      ]);
      return { matchingCount, oldestMatchingAt: oldest?.createdAt ?? null, newestMatchingAt: newest?.createdAt ?? null };
    }
    if (category === RetentionCategory.AGENT_RUNS) {
      const where = { startedAt: { lt: cutoffAt }, status: { in: AGENT_RUN_TERMINAL_STATUSES } };
      const [matchingCount, oldest, newest] = await Promise.all([
        this.prisma.forTenantId(tenantId).agentRun.count({ where }),
        this.prisma.forTenantId(tenantId).agentRun.findFirst({ where, orderBy: { startedAt: 'asc' }, select: { startedAt: true } }),
        this.prisma.forTenantId(tenantId).agentRun.findFirst({ where, orderBy: { startedAt: 'desc' }, select: { startedAt: true } }),
      ]);
      return { matchingCount, oldestMatchingAt: oldest?.startedAt ?? null, newestMatchingAt: newest?.startedAt ?? null };
    }

    const where = { createdAt: { lt: cutoffAt } };
    const [matchingCount, oldest, newest] = await Promise.all([
      this.prisma.forTenantId(tenantId).toolInvocation.count({ where }),
      this.prisma.forTenantId(tenantId).toolInvocation.findFirst({ where, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
      this.prisma.forTenantId(tenantId).toolInvocation.findFirst({ where, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    ]);
    return { matchingCount, oldestMatchingAt: oldest?.createdAt ?? null, newestMatchingAt: newest?.createdAt ?? null };
  }

  /** Nachrichten mit noch vorhandenem Text, älter als die Frist, die zu keinem oder einem abgeschlossenen Vorgang gehören. */
  private emailBodiesWhere(cutoffAt: Date) {
    return {
      createdAt: { lt: cutoffAt },
      AND: [{ OR: [{ bodyText: { not: null } }, { bodyPreview: { not: null } }] }, { OR: [{ caseId: null }, { case: { orchestrationStatus: { in: TERMINAL_CASE_STATUS_LIST } } }] }],
    };
  }

  private supersededFactsWhere(cutoffAt: Date) {
    return { isCurrent: false, createdAt: { lt: cutoffAt }, case: { orchestrationStatus: { in: TERMINAL_CASE_STATUS_LIST } } };
  }

  private async deleteMatching(tenantId: string, category: RetentionCategory, cutoffAt: Date): Promise<number> {
    if (category === RetentionCategory.EMAIL_BODIES) {
      // Der Text wird entfernt, nicht die Zeile: Absender, Zeitpunkt, Betreff und Zuordnung bleiben als Nachweis.
      const result = await this.prisma.forTenantId(tenantId).emailMessage.updateMany({ where: this.emailBodiesWhere(cutoffAt), data: { bodyText: null, bodyPreview: null } });
      return result.count;
    }
    if (category === RetentionCategory.SUPERSEDED_FACTS) {
      const result = await this.prisma.forTenantId(tenantId).caseFact.deleteMany({ where: this.supersededFactsWhere(cutoffAt) });
      return result.count;
    }
    if (category === RetentionCategory.AGENT_RUNS) {
      const result = await this.prisma.forTenantId(tenantId).agentRun.deleteMany({
        where: { startedAt: { lt: cutoffAt }, status: { in: AGENT_RUN_TERMINAL_STATUSES } },
      });
      return result.count;
    }

    const result = await this.prisma.forTenantId(tenantId).toolInvocation.deleteMany({
      where: { createdAt: { lt: cutoffAt } },
    });
    return result.count;
  }
}
