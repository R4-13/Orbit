import { Inject, Injectable } from '@nestjs/common';
import type { ToolDefinition, ToolRegistry } from '@orbit/agent-core';
import {
  CapabilityDefinitionSchema,
  DEFAULT_CAPABILITIES,
  POLICY_ACTIONS,
  type CapabilityDefinition,
  type CapabilityExecutability,
  type PolicyMode,
} from '@orbit/shared';
import { TOOL_REGISTRY } from '../agent/agent.tokens';
import { PolicyEnforcementService } from '../policy/policy-enforcement.service';
import { PrismaService } from '../prisma/prisma.service';

const KNOWN_POLICY_ACTIONS: ReadonlySet<string> = new Set(Object.values(POLICY_ACTIONS));

/**
 * Amendment 02 §9 — the capability catalogue as a *business view over the
 * existing ToolRegistry*. It adds no second tool platform: every capability
 * names registered tools (`toolBindings`), a policy action and the connector
 * permission it needs, and whether it can run for a given tenant is computed
 * from facts (tool registered ∩ connection & granted scope ∩ policy not
 * disabled), never assumed. Additional definitions (another domain's
 * capabilities) are added with `register()` — no engine change.
 */
@Injectable()
export class CapabilityRegistryService {
  private readonly extra = new Map<string, CapabilityDefinition>();

  constructor(
    @Inject(TOOL_REGISTRY) private readonly tools: ToolRegistry,
    private readonly policy: PolicyEnforcementService,
    private readonly prisma: PrismaService,
  ) {}

  /** Registers an additional capability. Fails fast on a bad shape, a duplicate key or an unknown policy action. */
  register(definition: CapabilityDefinition): void {
    const parsed = CapabilityDefinitionSchema.parse(definition);
    if (this.catalogue().has(parsed.key)) throw new Error(`Capability "${parsed.key}" is already registered.`);
    for (const action of [parsed.policyAction, ...Object.values(parsed.policyActionByPurpose ?? {})]) {
      if (!KNOWN_POLICY_ACTIONS.has(action)) throw new Error(`Capability "${parsed.key}" references unknown policy action "${action}".`);
    }
    this.extra.set(parsed.key, parsed);
  }

  /** Test/fixture seam only: removes an additionally registered capability. */
  unregister(key: string): void {
    this.extra.delete(key);
  }

  catalogue(): ReadonlyMap<string, CapabilityDefinition> {
    const map = new Map<string, CapabilityDefinition>(DEFAULT_CAPABILITIES.map((c) => [c.key, c]));
    for (const [key, def] of this.extra) map.set(key, def);
    return map;
  }

  get(key: string): CapabilityDefinition | undefined {
    return this.catalogue().get(key);
  }

  /** The policy action that governs a use of the capability for a purpose (clarification vs. quote delivery, ...). */
  policyActionFor(capability: CapabilityDefinition, purpose?: string): string {
    return (purpose && capability.policyActionByPurpose?.[purpose]) || capability.policyAction;
  }

  /** The tool that implements the capability, or undefined when none of its bindings is registered. */
  toolFor(capability: CapabilityDefinition): ToolDefinition | undefined {
    for (const name of capability.toolBindings) {
      const tool = this.tools.get(name);
      if (tool) return tool;
    }
    return undefined;
  }

  /** Tool names a capability needs that are not registered (empty = implementation present). */
  missingTools(capability: CapabilityDefinition): string[] {
    return capability.toolBindings.filter((name) => !this.tools.get(name));
  }

  /** Effective policy mode of every policy action the catalogue refers to, for one tenant. */
  async policyModesFor(tenantId: string): Promise<Map<string, PolicyMode>> {
    const actions = new Set<string>();
    for (const cap of this.catalogue().values()) {
      actions.add(cap.policyAction);
      for (const action of Object.values(cap.policyActionByPurpose ?? {})) actions.add(action);
    }
    const modes = new Map<string, PolicyMode>();
    for (const action of actions) modes.set(action, await this.policy.resolveMode(tenantId, action as never));
    return modes;
  }

  /**
   * Per-tenant executability (§9.2): the answer to "can ORBIT really do this for this tenant right now". Each failed
   * condition adds a business-readable reason so the planner, the UI and the user see *why* something is unavailable.
   */
  async executabilityFor(tenantId: string): Promise<Map<string, CapabilityExecutability>> {
    const policyModes = await this.policyModesFor(tenantId);
    const integrations = await this.prisma.forTenantId(tenantId).integration.findMany({ select: { connectorType: true, status: true, grantedCapabilities: true } });
    const result = new Map<string, CapabilityExecutability>();

    for (const cap of this.catalogue().values()) {
      const reasons: string[] = [];
      const missing = this.missingTools(cap);
      if (missing.length === cap.toolBindings.length) reasons.push(`Die Umsetzung (${missing.join(', ')}) ist nicht installiert.`);

      for (const requirement of cap.connectorRequirements ?? []) {
        const integration = integrations.find((i) => i.connectorType === requirement.connectorType);
        const granted = Array.isArray(integration?.grantedCapabilities) ? (integration?.grantedCapabilities as unknown[]) : [];
        if (!integration || integration.status !== 'CONNECTED') reasons.push(`Keine aktive ${requirement.connectorType}-Verbindung.`);
        else if (!granted.includes(requirement.capability)) reasons.push(`Die ${requirement.connectorType}-Verbindung hat die Berechtigung "${requirement.capability}" nicht erteilt.`);
      }

      const actions = [cap.policyAction, ...Object.values(cap.policyActionByPurpose ?? {})];
      if (actions.every((a) => policyModes.get(a) === 'DISABLED')) reasons.push('Die Policy für diese Aktion ist deaktiviert.');

      result.set(cap.key, { executable: reasons.length === 0, reasons });
    }
    return result;
  }
}
