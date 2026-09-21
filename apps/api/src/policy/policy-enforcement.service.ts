import { Injectable } from '@nestjs/common';
import { decidePolicyAction, type PolicyDecision } from '@orbit/agent-core';
import type { PolicyActionKey, PolicyMode } from '@orbit/shared';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Bridges the DB-stored tenant policy configuration (PolicyConfig,
 * seeded per tenant from DEFAULT_POLICY_CONFIG — see
 * TenantsService.bootstrapTenant) to the pure decision function in
 * @orbit/agent-core. This is the "Authorization Check" step of the
 * architecture principle (PRODUCT_CONTEXT.md) for workflow code that acts
 * deterministically rather than through a full LLM tool-call loop (see
 * docs/ASSUMPTIONS.md on the Finance-workflow scope decision).
 */
@Injectable()
export class PolicyEnforcementService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveMode(tenantId: string, action: PolicyActionKey): Promise<PolicyMode> {
    const config = await this.prisma.forTenantId(tenantId).policyConfig.findUnique({
      where: { tenantId_action: { tenantId, action } },
    });
    // No row is only possible if a tenant was bootstrapped before this
    // action existed — fail safe (require a human) rather than silently
    // allowing an action nobody explicitly configured.
    return config?.mode ?? 'REQUIRE_APPROVAL';
  }

  async decide(tenantId: string, action: PolicyActionKey): Promise<PolicyDecision> {
    const mode = await this.resolveMode(tenantId, action);
    return decidePolicyAction(mode);
  }
}
