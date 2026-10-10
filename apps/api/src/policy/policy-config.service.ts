import { Injectable } from '@nestjs/common';
import { NotFoundError, PolicyViolationError, policyModeRank } from '@orbit/shared';
import { AUTOMATION_PRESETS, AUTOMATION_PRESET_KEYS, DEFAULT_POLICY_CONFIG, POLICY_ACTIONS, detectAutomationLevel, presetModeFor, type AutomationLevel, type AutomationPresetKey, type PolicyActionKey, type PolicyMode } from '@orbit/shared';
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

  /** Der aktuelle Automatisierungsgrad und was jede Stufe gegenüber den heutigen Regeln ändern würde. */
  async automation(tenantId: string): Promise<{
    current: AutomationLevel;
    presets: Array<{ key: AutomationPresetKey; label: string; description: string; changes: Array<{ action: string; from: PolicyMode; to: PolicyMode }> }>;
  }> {
    const rows = await this.findAll(tenantId);
    const modes = Object.fromEntries(rows.map((row) => [row.action, row.mode as PolicyMode]));
    return {
      current: detectAutomationLevel(modes),
      presets: AUTOMATION_PRESET_KEYS.map((key) => ({
        key,
        label: AUTOMATION_PRESETS[key].label,
        description: AUTOMATION_PRESETS[key].description,
        changes: rows
          .filter((row) => (Object.values(POLICY_ACTIONS) as string[]).includes(row.action))
          .map((row) => ({ action: row.action, from: row.mode as PolicyMode, to: presetModeFor(key, row.action as PolicyActionKey) }))
          .filter((change) => change.from !== change.to),
      })),
    };
  }

  /** Setzt alle Regeln auf eine Stufe. Gesperrte Aktionen bleiben unverändert (feste Obergrenze); jede Änderung wird einzeln protokolliert. */
  async applyAutomation(tenantId: string, actorUserId: string, preset: AutomationPresetKey): Promise<{ current: AutomationLevel; changed: number }> {
    const rows = await this.findAll(tenantId);
    let changed = 0;
    for (const row of rows) {
      if (!(Object.values(POLICY_ACTIONS) as string[]).includes(row.action)) continue;
      const target = presetModeFor(preset, row.action as PolicyActionKey);
      if (row.mode === target) continue;
      await this.updateMode(tenantId, actorUserId, row.action as PolicyActionKey, target);
      changed += 1;
    }
    // Die Stufe ist bewusst gewählt (auch wenn sie sich nicht geändert hat): die Einrichtungs-Checkliste hakt den Schritt ab.
    await this.prisma.forTenantId(tenantId).tenantProfile.upsert({
      where: { tenantId },
      create: { tenantId, automationConfirmedAt: new Date(), updatedByUserId: actorUserId },
      update: { automationConfirmedAt: new Date() },
    });
    const after = await this.automation(tenantId);
    return { current: after.current, changed };
  }

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
