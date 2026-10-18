import { Injectable } from '@nestjs/common';
import { buildSetupAssessment, type PolicyMode, type SetupAssessment } from '@orbit/shared';
import { TenantProfileService } from '../organization/tenant-profile.service';
import { CapabilityRegistryService } from '../process/capability-registry.service';
import { PrismaService } from '../prisma/prisma.service';

/** Fähigkeiten, deren Verfügbarkeit der Assistent für den Betrieb zeigt. */
const CAPABILITIES = ['email.send', 'calendar.book', 'crm.lead.create', 'staff.notify'] as const;
/** Regeln, deren Modus der Assistent zeigt. */
const POLICY_ACTIONS = ['email.send.clarification', 'email.send.information', 'meeting.create', 'lead.create', 'staff.notify'] as const;

/**
 * Einrichtungsassistent: liest den tatsächlichen Stand des Betriebs (Profil, Mitarbeitende, Verbindungen, Regeln) und sagt, was noch fehlt und was ORBIT damit übernimmt.
 * Liest nur – geändert wird auf den Seiten, zu denen der Assistent führt.
 */
@Injectable()
export class SetupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly profile: TenantProfileService,
    private readonly capabilities: CapabilityRegistryService,
  ) {}

  async get(tenantId: string): Promise<SetupAssessment> {
    const state = await this.profile.get(tenantId);
    const scoped = this.prisma.forTenantId(tenantId);
    const [integrations, staffCount, executability, modes] = await Promise.all([
      scoped.integration.findMany({ select: { connectorType: true, status: true, grantedCapabilities: true } }),
      scoped.staffMember.count({ where: { active: true } }),
      this.capabilities.executabilityFor(tenantId),
      this.capabilities.policyModesFor(tenantId),
    ]);
    const gmail = integrations.find((i) => i.connectorType === 'GMAIL');
    const hubspot = integrations.find((i) => i.connectorType === 'HUBSPOT');
    const grantedOf = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);
    return buildSetupAssessment({
      onboarding: state.onboarding,
      integrations: {
        ...(gmail ? { gmail: { connected: gmail.status === 'CONNECTED', granted: grantedOf(gmail.grantedCapabilities) } } : {}),
        ...(hubspot ? { hubspot: { connected: hubspot.status === 'CONNECTED' } } : {}),
      },
      capabilities: Object.fromEntries(CAPABILITIES.map((key) => [key, executability.get(key)?.executable === true])),
      modes: Object.fromEntries(POLICY_ACTIONS.map((action) => [action, modes.get(action) as PolicyMode | undefined])),
      staffCount,
    });
  }
}
