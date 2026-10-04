import { Injectable } from '@nestjs/common';
import type { IntegrationConnectorType } from '@orbit/domain';
import {
  CONNECTOR_OPERATIONAL_STATUS_LEVELS,
  type ConnectorOperationalStatus,
  type ConnectorOperationalStatusLevel,
  type ConnectorOperationalStatusResult,
} from '@orbit/shared';
import { PrismaService } from '../prisma/prisma.service';

const UNREACHED: ConnectorOperationalStatusLevel = { reached: false, at: null };

/**
 * docs/CHANNEL_EVENT_RUNTIME_PLAN.md §8 / Increment H — computes the five
 * operational-status levels from real evidence (Integration/ConnectorSync/
 * IntakeEvent/WorkflowRun rows), never from configuration intent. Lives in
 * `IntegrationsModule` (not `ChannelSyncModule`, which already depends on
 * `IntegrationsModule` for `GmailConnectorService` — importing it back
 * here would be circular) since this only ever needs `PrismaService`.
 */
@Injectable()
export class ConnectorStatusService {
  constructor(private readonly prisma: PrismaService) {}

  async getStatus(tenantId: string, connectorType: IntegrationConnectorType): Promise<ConnectorOperationalStatusResult> {
    const scoped = this.prisma.forTenantId(tenantId);
    const integration = await scoped.integration.findUnique({ where: { tenantId_connectorType: { tenantId, connectorType } } });

    const levels: Record<ConnectorOperationalStatus, ConnectorOperationalStatusLevel> = {
      AUTHENTICATION_CONNECTED: UNREACHED,
      INPUT_TRIGGER_ACTIVE: UNREACHED,
      INTAKE_PIPELINE_ACTIVE: UNREACHED,
      DOMAIN_WORKFLOW_ACTIVE: UNREACHED,
      LIVE_END_TO_END_TESTED: UNREACHED,
    };

    if (!integration) {
      return { connectorType, highestLevelReached: null, currentlyConnected: false, levels };
    }

    // Level 1 — prefer `lastSuccessAt` (only ever set after a real completed
    // OAuth token exchange or a real successful testConnection() call, see
    // GmailConnectorService) as the more precise timestamp; fall back to a
    // current `CONNECTED` status (set by the generic credentials-upsert
    // path for non-OAuth connectors, which have no separate "test" step)
    // so a manually-configured API-key connector isn't permanently stuck
    // at "never authenticated".
    if (integration.lastSuccessAt) {
      levels.AUTHENTICATION_CONNECTED = { reached: true, at: integration.lastSuccessAt.toISOString() };
    } else if (integration.status === 'CONNECTED') {
      levels.AUTHENTICATION_CONNECTED = { reached: true, at: integration.updatedAt.toISOString() };
    }

    const connectorSync = await scoped.connectorSync.findUnique({ where: { connectionId: integration.id } });
    if (connectorSync?.lastSuccessAt) {
      levels.INPUT_TRIGGER_ACTIVE = { reached: true, at: connectorSync.lastSuccessAt.toISOString() };
    }

    const firstRealIntakeEvent = await scoped.intakeEvent.findFirst({
      where: { connectionId: integration.id },
      orderBy: { occurredAt: 'asc' },
    });
    if (firstRealIntakeEvent) {
      levels.INTAKE_PIPELINE_ACTIVE = { reached: true, at: firstRealIntakeEvent.occurredAt.toISOString() };
    }

    const firstWorkflowTriggeringEvent = await scoped.intakeEvent.findFirst({
      where: { connectionId: integration.id, workflowRunId: { not: null } },
      orderBy: { occurredAt: 'asc' },
    });
    if (firstWorkflowTriggeringEvent) {
      levels.DOMAIN_WORKFLOW_ACTIVE = { reached: true, at: firstWorkflowTriggeringEvent.occurredAt.toISOString() };
    }

    const firstFullyCompletedEvent = await scoped.intakeEvent.findFirst({
      where: { connectionId: integration.id, status: 'COMPLETED', workflowRun: { status: 'COMPLETED' } },
      orderBy: { occurredAt: 'asc' },
    });
    if (firstFullyCompletedEvent) {
      levels.LIVE_END_TO_END_TESTED = { reached: true, at: firstFullyCompletedEvent.occurredAt.toISOString() };
    }

    // The longest reached *prefix* — a gap (e.g. real intake events present
    // without the scheduler ever having recorded a successful poll) must
    // never be presented as a more advanced status than it honestly is.
    let highestLevelReached: ConnectorOperationalStatus | null = null;
    for (const level of CONNECTOR_OPERATIONAL_STATUS_LEVELS) {
      if (!levels[level].reached) break;
      highestLevelReached = level;
    }

    return { connectorType, highestLevelReached, currentlyConnected: integration.status === 'CONNECTED', levels };
  }
}
