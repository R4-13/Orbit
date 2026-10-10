import { Injectable } from '@nestjs/common';
import type { Prisma, TenantProfile } from '@orbit/domain';
import {
  DEFAULT_ESCALATION_POLICY,
  EscalationPolicySchema,
  ValidationFailedError,
  detectAutomationLevel,
  onboardingChecklist,
  resolveEscalationPolicy,
  type AutomationLevel,
  type EscalationPolicy,
  type PolicyMode,
  type RoutableStaff,
  type UpdateTenantProfileRequest,
} from '@orbit/shared';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

export type TenantProfileView = Omit<TenantProfile, 'tenantId' | 'openingHours' | 'faqs' | 'escalationPolicy'> & { openingHours: unknown; faqs: unknown; escalationPolicy: unknown };

export interface TenantProfileState {
  profile: TenantProfileView | null;
  escalationPolicy: EscalationPolicy;
  escalationDefaults: EscalationPolicy;
  automation: AutomationLevel;
  onboarding: ReturnType<typeof onboardingChecklist>;
}

/**
 * Betriebsprofil: das Wissen, mit dem ORBIT im Sinne des Unternehmens entscheidet (Branche, Leistungen, Zeiten, Notdienst, Tonalität, häufige Fragen)
 * und die Zeiten für Erinnerung und Eskalation. Ohne Eintrag gilt „leer“ – ORBIT arbeitet dann mit den Standardwerten und weist in der Einrichtungs-Checkliste darauf hin.
 */
@Injectable()
export class TenantProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(tenantId: string): Promise<TenantProfileState> {
    const [row, staff, policies] = await Promise.all([
      this.prisma.forTenantId(tenantId).tenantProfile.findUnique({ where: { tenantId } }),
      this.prisma.forTenantId(tenantId).staffMember.findMany({ where: { tenantId } }),
      this.prisma.forTenantId(tenantId).policyConfig.findMany({ where: { tenantId } }),
    ]);
    const automation: AutomationLevel = detectAutomationLevel(Object.fromEntries(policies.map((p) => [p.action, p.mode as PolicyMode])));
    const checklist = onboardingChecklist({
      profile: row,
      staff: staff as RoutableStaff[],
      automationConfirmed: Boolean(row?.automationConfirmedAt),
    });
    return {
      profile: row ? this.view(row) : null,
      escalationPolicy: resolveEscalationPolicy(row?.escalationPolicy),
      escalationDefaults: DEFAULT_ESCALATION_POLICY,
      automation,
      onboarding: checklist,
    };
  }

  async update(tenantId: string, actorUserId: string, input: UpdateTenantProfileRequest): Promise<TenantProfileState> {
    const { escalationPolicy: escalationInput, ...fields } = input;
    const existing = await this.prisma.forTenantId(tenantId).tenantProfile.findUnique({ where: { tenantId } });

    let escalationPolicy: Prisma.InputJsonValue | undefined;
    if (escalationInput) {
      const merged = EscalationPolicySchema.safeParse({ ...resolveEscalationPolicy(existing?.escalationPolicy), ...escalationInput });
      if (!merged.success) throw new ValidationFailedError(merged.error.issues.map((i) => i.message).join(' '));
      escalationPolicy = merged.data;
    }

    const data = {
      ...fields,
      openingHours: fields.openingHours as Prisma.InputJsonValue | undefined,
      faqs: fields.faqs as Prisma.InputJsonValue | undefined,
      escalationPolicy,
      updatedByUserId: actorUserId,
    };
    const saved = await this.prisma.forTenantId(tenantId).tenantProfile.upsert({ where: { tenantId }, create: { tenantId, ...data }, update: data });

    await this.audit.record({
      tenantId,
      eventType: 'TENANT_PROFILE_UPDATED',
      actorType: 'USER',
      actorUserId,
      entityType: 'TenantProfile',
      entityId: saved.id,
      // Nur die Namen der geänderten Felder, nicht deren Inhalt (Texte können Kundendaten berühren).
      payload: { fields: Object.keys(input) },
    });

    const state = await this.get(tenantId);
    if (state.onboarding.complete && !saved.onboardingCompletedAt) {
      await this.prisma.forTenantId(tenantId).tenantProfile.update({ where: { tenantId }, data: { onboardingCompletedAt: new Date() } });
    }
    return state;
  }

  private view(row: TenantProfile): TenantProfileView {
    const { tenantId: _tenantId, ...rest } = row;
    return rest;
  }
}
