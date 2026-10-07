import { Injectable } from '@nestjs/common';
import type { IntegrationConnectorType } from '@orbit/domain';
import {
  CONNECTOR_OPERATIONAL_STATUS_LEVELS,
  DEFAULT_CAPABILITIES,
  describeExecutionModes,
  type ConnectorCurrentHealth,
  type ConnectorOperationalStatus,
  type ConnectorOperationalStatusLevel,
  type ConnectorOperationalStatusResult,
  type ConnectorVerifiedRun,
  type ExecutionEvidenceSnapshot,
} from '@orbit/shared';
import { PrismaService } from '../prisma/prisma.service';

const UNREACHED: ConnectorOperationalStatusLevel = { reached: false, at: null };

/** How many of the newest candidate runs are inspected when looking for a verifying run. */
const VERIFICATION_CANDIDATE_LIMIT = 25;

function readExecution(metadata: unknown): ExecutionEvidenceSnapshot | null {
  if (typeof metadata !== 'object' || metadata === null) return null;
  const execution = (metadata as { execution?: unknown }).execution;
  return typeof execution === 'object' && execution !== null ? (execution as ExecutionEvidenceSnapshot) : null;
}

/**
 * docs/CHANNEL_EVENT_RUNTIME_PLAN.md §8 and Amendment 02 §19.4 — computes the
 * operational-status levels from real evidence (Integration / ConnectorSync /
 * IntakeEvent / WorkflowRun / StepRun / AgentRun / ToolInvocation rows), never
 * from configuration intent and never from `IntakeEvent.status = COMPLETED`
 * alone.
 *
 * `LIVE_END_TO_END_TESTED` needs one concrete run where *everything* holds:
 * intake COMPLETED, WorkflowRun COMPLETED, every step SUCCEEDED/SKIPPED, every
 * step's AgentRun COMPLETED and no failed/uncertain tool invocation. A run that
 * was wrongly marked COMPLETED while a tool failed therefore never counts —
 * and a later success does not retroactively heal it (it simply is not a
 * verifying run). Current health is reported separately from that proof.
 *
 * Lives in `IntegrationsModule` (not `ChannelSyncModule`, which already
 * depends on `IntegrationsModule` for `GmailConnectorService`) since this
 * only ever needs `PrismaService`.
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
      return { connectorType, highestLevelReached: null, currentlyConnected: false, levels, verifiedRun: null, health: null };
    }

    // Level 1 — prefer `lastSuccessAt` (only ever set after a real completed OAuth token exchange or a real
    // successful testConnection() call, see GmailConnectorService); fall back to a current `CONNECTED` status
    // (set by the generic credentials-upsert path for non-OAuth connectors, which have no separate "test" step).
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

    const verifiedRun = await this.newestVerifiedRun(tenantId, integration.id);
    if (verifiedRun) {
      levels.LIVE_END_TO_END_TESTED = { reached: true, at: verifiedRun.completedAt };
    }

    // The longest reached *prefix* — a gap (e.g. real intake events without the scheduler ever having recorded a
    // successful poll) must never be presented as a more advanced status than it honestly is.
    let highestLevelReached: ConnectorOperationalStatus | null = null;
    for (const level of CONNECTOR_OPERATIONAL_STATUS_LEVELS) {
      if (!levels[level].reached) break;
      highestLevelReached = level;
    }

    const latestRun = await scoped.intakeEvent.findFirst({
      where: { connectionId: integration.id, workflowRunId: { not: null } },
      orderBy: { occurredAt: 'desc' },
    });
    const health: ConnectorCurrentHealth = {
      connectionStatus: integration.status,
      lastErrorAt: integration.lastErrorAt?.toISOString() ?? null,
      lastErrorCode: integration.lastErrorCode ?? null,
      syncStatus: connectorSync?.status ?? null,
      syncLastErrorCode: connectorSync?.lastErrorCode ?? null,
      latestRunFailed: latestRun?.status === 'FAILED' || latestRun?.status === 'NEEDS_REVIEW',
    };

    return {
      connectorType,
      highestLevelReached,
      currentlyConnected: integration.status === 'CONNECTED',
      levels,
      verifiedRun,
      health,
    };
  }

  /** The newest verified run of either kind: a durable workflow run or a completed business process (Amendment 02). */
  private async newestVerifiedRun(tenantId: string, connectionId: string): Promise<ConnectorVerifiedRun | null> {
    const [workflow, process] = await Promise.all([this.findVerifiedRun(tenantId, connectionId), this.findVerifiedProcessRun(tenantId, connectionId)]);
    if (workflow && process) return new Date(process.completedAt).getTime() > new Date(workflow.completedAt).getTime() ? process : workflow;
    return workflow ?? process;
  }

  /**
   * A business process counts as verified only when its case is COMPLETED on verified criteria, every node of the active plan
   * ended SUCCEEDED/SKIPPED, and every action intent has a confirmed receipt — a returned tool error or an unknown outcome
   * anywhere keeps it out (BP-23/BP-27). The receipts' execution modes are part of the statement.
   */
  private async findVerifiedProcessRun(tenantId: string, connectionId: string): Promise<ConnectorVerifiedRun | null> {
    const candidates = await this.prisma.forTenantId(tenantId).intakeEvent.findMany({
      where: { connectionId, status: 'COMPLETED', case: { orchestrationStatus: 'COMPLETED', blueprintKey: { not: null } } },
      orderBy: { occurredAt: 'desc' },
      take: VERIFICATION_CANDIDATE_LIMIT,
      include: { case: true },
    });
    for (const candidate of candidates) {
      const c = candidate.case;
      if (!c || !c.completedAt) continue;
      const plan = await this.prisma.forTenantId(tenantId).processPlan.findFirst({ where: { caseId: c.id, status: 'ACTIVE' }, include: { nodes: true } });
      if (!plan || plan.nodes.length === 0) continue;
      if (!plan.nodes.every((n) => n.state === 'SUCCEEDED' || n.state === 'SKIPPED')) continue;
      const intents = await this.prisma.forTenantId(tenantId).actionIntent.findMany({ where: { caseId: c.id, planId: plan.id } });
      // A cancelled intent (approval voided by an edit or a replan) is history; it only counts if its step never got a confirmed effect.
      const confirmedNodes = new Set(intents.filter((i) => i.status === 'CONFIRMED').map((i) => i.nodeKey));
      if (!intents.every((i) => i.status === 'CONFIRMED' || (i.status === 'CANCELLED' && confirmedNodes.has(i.nodeKey)))) continue;
      // „Versand“ betrifft nur Aktionen, die nach außen wirken. Interne Schritte (Entwurf, Angebot anlegen/rendern) sind immer „live“ und dürfen die Aussage
      // nicht verfälschen; Fähigkeiten außerhalb des Katalogs gelten vorsichtshalber als nach außen wirkend. Sortiert, damit die Aussage stabil ist.
      const external = new Set(intents.filter((i) => (DEFAULT_CAPABILITIES.find((cap) => cap.key === i.capabilityKey)?.sideEffect ?? 'EXTERNAL_WRITE') === 'EXTERNAL_WRITE').map((i) => i.id));
      const receipts = await this.prisma.forTenantId(tenantId).actionReceipt.findMany({ where: { intentId: { in: [...external] }, status: 'CONFIRMED' } });
      const modes = [...new Set(receipts.map((r) => r.executionMode))].sort((a, b) => (a === b ? 0 : a === 'SIMULATED' ? -1 : 1));
      const execution = readExecution(candidate.metadata);
      const base = execution ? describeExecutionModes(execution) : 'Ausführungsmodus nicht erfasst';
      return {
        intakeEventId: candidate.id,
        workflowRunId: c.id,
        workflowKey: `Prozess ${c.blueprintKey} ${c.blueprintVersion ?? ''}`.trim(),
        completedAt: c.completedAt.toISOString(),
        execution,
        executionSummary: modes.length > 0 ? `${base} · Versand: ${modes.map((m) => (m === 'LIVE' ? 'live' : 'simuliert')).join(', ')}` : base,
      };
    }
    return null;
  }

  /** Newest real run of this connection that passes every verification criterion — or null. */
  private async findVerifiedRun(tenantId: string, connectionId: string): Promise<ConnectorVerifiedRun | null> {
    const candidates = await this.prisma.forTenantId(tenantId).intakeEvent.findMany({
      where: { connectionId, status: 'COMPLETED', workflowRun: { status: 'COMPLETED' } },
      orderBy: { occurredAt: 'desc' },
      take: VERIFICATION_CANDIDATE_LIMIT,
      include: {
        workflowRun: {
          include: {
            workflowDefinition: true,
            stepRuns: { include: { agentRun: { include: { toolInvocations: true } } } },
          },
        },
      },
    });

    for (const candidate of candidates) {
      const run = candidate.workflowRun;
      if (!run || run.stepRuns.length === 0) continue;

      const everyStepVerified = run.stepRuns.every((step) => {
        if (step.status === 'SKIPPED') return true;
        if (step.status !== 'SUCCEEDED') return false;
        if (!step.agentRun || step.agentRun.status !== 'COMPLETED') return false;
        return step.agentRun.toolInvocations.every((tool) => tool.status === 'SUCCESS');
      });
      if (!everyStepVerified) continue;

      const execution = readExecution(candidate.metadata);
      return {
        intakeEventId: candidate.id,
        workflowRunId: run.id,
        workflowKey: run.workflowDefinition?.key ?? null,
        completedAt: (run.completedAt ?? candidate.updatedAt).toISOString(),
        execution,
        executionSummary: execution ? describeExecutionModes(execution) : 'Ausführungsmodus nicht erfasst',
      };
    }
    return null;
  }
}
