import { Injectable } from '@nestjs/common';
import type { CaseEvent, Prisma } from '@orbit/domain';
import { PrismaService } from '../prisma/prisma.service';

export interface AppendEventInput {
  type: string;
  payload: Record<string, unknown>;
  /** Inbound events enter the case's inbox and are consumed exactly once by the orchestrator. */
  inbound?: boolean;
  /** Stable event id; a repeated delivery with the same key is recorded once (Amendment 02 §12.3). */
  dedupeKey?: string;
}

export interface AppendedEvent {
  event: CaseEvent;
  duplicate: boolean;
}

/** Event types written by the framework itself. The UI maps them to wording; unknown types are shown generically. */
export const CASE_EVENT_TYPES = {
  CASE_CREATED: 'case.created',
  STATUS_CHANGED: 'case.status_changed',
  PLAN_CREATED: 'plan.created',
  PLAN_ACTIVATED: 'plan.activated',
  PLAN_SUPERSEDED: 'plan.superseded',
  NODE_STATE_CHANGED: 'node.state_changed',
  FACT_RECORDED: 'fact.recorded',
  CONTEXT_RESOLUTION_ATTEMPTED: 'context.resolution_attempted',
  /** Die KI hat die Anfrage analysiert (Art, vorhandene/fehlende Angaben, Terminbedarf, nächster Schritt). */
  REQUIREMENTS_ANALYZED: 'requirements.analyzed',
  /** Ein Schritt wurde wieder aufgenommen bzw. live wiederholt, weil der echte Weg (Verbindung, KI-Dienst, Versand) verfügbar wurde. */
  LIVE_UPGRADE: 'live.upgrade',
  /** Der Kundschaft wurde ein Vor-Ort- oder Telefontermin vorgeschlagen (mit den Zeiten bzw. dem Grund, warum keine genannt wurden). */
  APPOINTMENT_PROPOSED: 'appointment.proposed',
  COMPLETION_EVALUATED: 'completion.evaluated',
  ACTION_PREPARED: 'action.prepared',
  ACTION_CONFIRMED: 'action.confirmed',
  ACTION_UNKNOWN: 'action.outcome_unknown',
  WAIT_STARTED: 'wait.started',
  WAIT_SATISFIED: 'wait.satisfied',
  WAIT_TIMED_OUT: 'wait.timed_out',
  COMMUNICATION_RECEIVED: 'communication.received',
  COMMAND_ACCEPTED: 'command.accepted',
  COMPLETED: 'case.completed',
} as const;

/**
 * The per-case event log (Amendment 02 §12.3 / §18): inbox for incoming events
 * (deduplicated by a stable key) and outbox/journal for state changes. The
 * `sequence` is allocated from the case row inside the same transaction as the
 * event, so it is strictly increasing per case and is the cursor SSE clients
 * resume from. Everything is persisted — a restart loses nothing.
 */
@Injectable()
export class CaseEventsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Appends within an existing tenant transaction (atomic with the caller's state change). */
  async appendInTx(tx: Prisma.TransactionClient, tenantId: string, caseId: string, input: AppendEventInput): Promise<AppendedEvent> {
    if (input.dedupeKey) {
      const existing = await tx.caseEvent.findFirst({ where: { tenantId, dedupeKey: input.dedupeKey } });
      if (existing) return { event: existing, duplicate: true };
    }
    const updated = await tx.case.update({ where: { id: caseId }, data: { eventSequence: { increment: 1 } }, select: { eventSequence: true, tenantId: true } });
    if (updated.tenantId !== tenantId) throw new Error('Case does not belong to the tenant.');
    const event = await tx.caseEvent.create({
      data: {
        tenantId,
        caseId,
        sequence: updated.eventSequence,
        type: input.type,
        payload: input.payload as Prisma.InputJsonValue,
        dedupeKey: input.dedupeKey,
        inbound: input.inbound ?? false,
      },
    });
    return { event, duplicate: false };
  }

  append(tenantId: string, caseId: string, input: AppendEventInput): Promise<AppendedEvent> {
    return this.prisma.inTenantTransaction(tenantId, (tx) => this.appendInTx(tx, tenantId, caseId, input));
  }

  /** Events after a cursor, oldest first — the replay source for SSE and the history list. */
  list(tenantId: string, caseId: string, afterSequence = 0, limit = 200): Promise<CaseEvent[]> {
    return this.prisma.forTenantId(tenantId).caseEvent.findMany({
      where: { caseId, sequence: { gt: afterSequence } },
      orderBy: { sequence: 'asc' },
      take: Math.min(Math.max(limit, 1), 500),
    });
  }

  async lastSequence(tenantId: string, caseId: string): Promise<number> {
    const found = await this.prisma.forTenantId(tenantId).case.findUnique({ where: { id: caseId }, select: { eventSequence: true } });
    return found?.eventSequence ?? 0;
  }

  /** Oldest unprocessed inbound event of a case, if any. */
  nextInbound(tenantId: string, caseId: string): Promise<CaseEvent | null> {
    return this.prisma.forTenantId(tenantId).caseEvent.findFirst({ where: { caseId, inbound: true, processedAt: null }, orderBy: { sequence: 'asc' } });
  }

  /** Exactly-once consumption: only the caller that flips `processedAt` from null gets `true`. */
  async markProcessed(tenantId: string, eventId: string): Promise<boolean> {
    const result = await this.prisma.forTenantId(tenantId).caseEvent.updateMany({ where: { id: eventId, processedAt: null }, data: { processedAt: new Date() } });
    return result.count === 1;
  }

  /** Cases that have unprocessed inbound events (worker sweep after a restart). */
  async casesWithPendingInbound(limit = 50): Promise<Array<{ tenantId: string; caseId: string }>> {
    const rows = await this.prisma.withRlsBypass((tx) =>
      tx.caseEvent.findMany({ where: { inbound: true, processedAt: null }, distinct: ['tenantId', 'caseId'], select: { tenantId: true, caseId: true }, take: limit }),
    );
    return rows;
  }
}
