import { Injectable } from '@nestjs/common';
import { NotFoundError, PolicyViolationError, policyModeRank } from '@orbit/shared';
import { DEFAULT_POLICY_CONFIG, type PolicyActionKey, type PolicyMode } from '@orbit/shared';
import type { PolicyConfig } from '@orbit/domain';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * §17/§39 admin surface for the Policy Engine (`/admin/policies`).
 * Deliberately separate from PolicyEnforcementService — that one answers
 * "what may an agent do right now" on the hot path of every tool call;
 * this one is the slow, human-facing "configure what an agent may do"
 * path. Mixing the two would put admin-CRUD concerns on a service every
 * tool invocation depends on.
 */
@Injectable()
export class PolicyConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  findAll(tenantId: string): Promise<PolicyConfig[]> {
    return this.prisma.forTenantId(tenantId).policyConfig.findMany({ orderBy: { action: 'asc' } });
  }

  /**
   * A `locked` row (see DEFAULT_POLICY_CONFIG) has a fixed autonomy
   * *ceiling* — its own default mode's rank — that no tenant can ever
   * exceed, regardless of what's currently stored. PAYMENT_EXECUTE
   * (locked at DISABLED) can therefore never be changed to anything but
   * DISABLED; SUPPLIER_CREATE (locked at REQUIRE_APPROVAL) can be
   * tightened further (DISABLED/SUGGEST_ONLY) but never relaxed past
   * REQUIRE_APPROVAL.
   */
  async updateMode(
    tenantId: string,
    actorUserId: string,
    action: PolicyActionKey,
    mode: PolicyMode,
  ): Promise<PolicyConfig> {
    const existing = await this.prisma
      .forTenantId(tenantId)
      .policyConfig.findUnique({ where: { tenantId_action: { tenantId, action } } });
    if (!existing) {
      throw new NotFoundError('Policy action not configured for this tenant.', { action });
    }

    if (existing.locked) {
      const ceiling = DEFAULT_POLICY_CONFIG[action].mode;
      if (policyModeRank(mode) > policyModeRank(ceiling)) {
        throw new PolicyViolationError('This policy action is locked and cannot be relaxed beyond its default.', {
          action,
          requestedMode: mode,
          maxAllowedMode: ceiling,
        });
      }
    }

    const updated = await this.prisma.forTenantId(tenantId).policyConfig.update({
      where: { tenantId_action: { tenantId, action } },
      data: { mode, updatedByUserId: actorUserId },
    });

    await this.audit.record({
      tenantId,
      eventType: 'POLICY_CONFIG_UPDATED',
      actorType: 'USER',
      actorUserId,
      entityType: 'PolicyConfig',
      entityId: updated.id,
      payload: { action, previousMode: existing.mode, newMode: mode },
    });

    return updated;
  }
}
