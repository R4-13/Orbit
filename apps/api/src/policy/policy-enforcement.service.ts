import { Injectable } from '@nestjs/common';
import { decidePolicyAction, type PolicyDecision } from '@orbit/agent-core';
import { EXTERNAL_SEND_POLICY_ACTIONS, KILL_SWITCHES, READ_ONLY_POLICY_ACTIONS, type PolicyActionKey, type PolicyMode } from '@orbit/shared';
import { PlatformControlService } from '../platform-control/platform-control.service';
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly platformControl: PlatformControlService,
  ) {}

  async resolveMode(tenantId: string, action: PolicyActionKey): Promise<PolicyMode> {
    const config = await this.prisma.forTenantId(tenantId).policyConfig.findUnique({
      where: { tenantId_action: { tenantId, action } },
    });
    // No row is only possible if a tenant was bootstrapped before this
    // action existed — fail safe (require a human) rather than silently
    // allowing an action nobody explicitly configured.
    return this.applyPlatformCeiling(tenantId, action, config?.mode ?? 'REQUIRE_APPROVAL');
  }

  /**
   * Konfigurationspräzedenz (Amendment 03 §7): Plattformgrenzen stehen über der Mandantenpolicy und machen sie nur strenger, nie lockerer.
   * Kill Switch „autonomer externer Versand“ und Mandantensperren (AUTOMATION, BILLING, SECURITY_QUARANTINE, nicht aktiver Lebenszyklus) nehmen
   * AUTONOMOUS auf REQUIRE_APPROVAL zurück – nichts wird dadurch gelöscht oder fälschlich abgeschlossen; Vorgänge warten auf eine Freigabe.
   */
  private async applyPlatformCeiling(tenantId: string, action: PolicyActionKey, mode: PolicyMode): Promise<PolicyMode> {
    if (mode !== 'AUTONOMOUS') return mode;
    if (EXTERNAL_SEND_POLICY_ACTIONS.includes(action) && (await this.platformControl.killSwitchEngaged(KILL_SWITCHES.AUTONOMOUS_EXTERNAL_SEND))) return 'REQUIRE_APPROVAL';
    if (!READ_ONLY_POLICY_ACTIONS.includes(action) && !(await this.platformControl.tenantGate(tenantId)).automationAllowed) return 'REQUIRE_APPROVAL';
    return mode;
  }

  async decide(tenantId: string, action: PolicyActionKey): Promise<PolicyDecision> {
    const mode = await this.resolveMode(tenantId, action);
    return decidePolicyAction(mode);
  }
}
