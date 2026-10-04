import { ConflictException, ForbiddenException, Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
import type { Case, Prisma } from '@orbit/domain';
import {
  COMMAND_PAYLOAD_SCHEMAS,
  NotFoundError,
  PERMISSIONS,
  ValidationFailedError,
  parseCaseCommand,
  type CaseCommandType,
  type Permission,
} from '@orbit/shared';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CASE_EVENT_TYPES, CaseEventsService } from './case-events.service';
import { CaseFactsService } from './case-facts.service';
import { OrchestratorService } from './orchestrator.service';

export interface CommandActor {
  id: string;
  tenantId: string;
  permissions: readonly Permission[];
}

export interface CommandResult {
  commandId: string;
  status: 'ACCEPTED';
  caseRevision: number;
  /** True when the same command id was already executed; nothing was done a second time. */
  replayed: boolean;
}

/** Which permission each command needs. The server decides; a button in the UI is only a convenience. */
const REQUIRED_PERMISSION: Record<CaseCommandType, Permission> = {
  ADD_FACTS: PERMISSIONS.CASE_MANAGE,
  CORRECT_FACT: PERMISSIONS.CASE_MANAGE,
  RESOLVE_FACT_CONFLICT: PERMISSIONS.CASE_MANAGE,
  EDIT_DRAFT: PERMISSIONS.CASE_MANAGE,
  APPROVE_PLAN: PERMISSIONS.APPROVAL_DECIDE,
  REJECT_PLAN: PERMISSIONS.APPROVAL_DECIDE,
  APPROVE_ACTION: PERMISSIONS.APPROVAL_DECIDE,
  REJECT_ACTION: PERMISSIONS.APPROVAL_DECIDE,
  RECONCILE_ACTION: PERMISSIONS.APPROVAL_DECIDE,
  PAUSE: PERMISSIONS.CASE_MANAGE,
  RESUME: PERMISSIONS.CASE_MANAGE,
  REPLAN: PERMISSIONS.CASE_MANAGE,
  RETRY_STEP: PERMISSIONS.CASE_MANAGE,
  CANCEL: PERMISSIONS.CASE_MANAGE,
  COMPLETE_MANUAL_TASK: PERMISSIONS.CASE_MANAGE,
};

type Payload<T extends CaseCommandType> = z.infer<(typeof COMMAND_PAYLOAD_SCHEMAS)[T]>;

/** Extension point: other capabilities (e.g. draft editing) register their command handler without touching this class. */
export type ExtraCommandHandler = (ctx: { actor: CommandActor; caseRow: Case; payload: unknown }) => Promise<void>;

/**
 * Amendment 02 §14.5 / §17.2 / §21.2 — every human intervention is a validated,
 * idempotent command bound to the case revision the user saw:
 *
 *  1. schema-validate envelope and payload (no tenant/user in the payload),
 *  2. replay a repeated `commandId` without executing again,
 *  3. authorize on the server and confirm the case belongs to the tenant,
 *  4. reject with 409 when `expectedCaseRevision` is stale,
 *  5. execute through the same services the engine uses (never a direct DB edit),
 *  6. record the command, an event and an audit entry, then let the orchestrator continue.
 */
@Injectable()
export class CaseCommandsService {
  private readonly logger = new Logger(CaseCommandsService.name);
  private readonly extraHandlers = new Map<CaseCommandType, ExtraCommandHandler>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly facts: CaseFactsService,
    private readonly orchestrator: OrchestratorService,
    private readonly events: CaseEventsService,
    private readonly audit: AuditService,
  ) {}

  registerHandler(type: CaseCommandType, handler: ExtraCommandHandler): void {
    this.extraHandlers.set(type, handler);
  }

  async execute(actor: CommandActor, caseId: string, raw: unknown): Promise<CommandResult> {
    const parsed = parseCaseCommand(raw);
    if (!parsed.ok) throw new ValidationFailedError('Der Command ist ungültig.', { errors: parsed.errors });
    const { envelope, payload } = parsed;
    const scoped = this.prisma.forTenantId(actor.tenantId);

    const replay = await scoped.caseCommand.findFirst({ where: { commandId: envelope.commandId } });
    if (replay) {
      if (replay.caseId !== caseId) throw new ConflictException('Diese commandId wurde bereits für einen anderen Vorgang verwendet.');
      if (replay.status !== 'ACCEPTED') throw new ConflictException('Dieser Command wurde bereits abgewiesen; bitte mit neuer commandId erneut senden.');
      return { commandId: replay.commandId, status: 'ACCEPTED', caseRevision: replay.resultCaseRevision ?? 0, replayed: true };
    }

    const caseRow = await scoped.case.findUnique({ where: { id: caseId } });
    if (!caseRow) throw new NotFoundError('Case not found.', { caseId });

    const required = REQUIRED_PERMISSION[envelope.type];
    if (!actor.permissions.includes(required)) {
      await this.record(actor, caseRow, envelope, 'REJECTED', undefined, { reason: 'FORBIDDEN' });
      throw new ForbiddenException(`Für diese Aktion fehlt die Berechtigung ${required}.`);
    }
    if (envelope.expectedCaseRevision !== caseRow.revision) {
      await this.record(actor, caseRow, envelope, 'CONFLICT', caseRow.revision, { currentRevision: caseRow.revision });
      throw new ConflictException({ message: 'Der Vorgang wurde inzwischen geändert. Bitte die Ansicht aktualisieren.', currentRevision: caseRow.revision, expectedCaseRevision: envelope.expectedCaseRevision });
    }

    try {
      await this.dispatch(actor, caseRow, envelope.type, payload);
    } catch (error) {
      await this.record(actor, caseRow, envelope, 'REJECTED', undefined, { reason: error instanceof Error ? error.message.slice(0, 300) : 'ERROR' });
      throw error;
    }

    const after = await scoped.case.findUnique({ where: { id: caseId } });
    const revision = after?.revision ?? caseRow.revision;
    await this.record(actor, caseRow, envelope, 'ACCEPTED', revision);
    await this.events.append(actor.tenantId, caseId, { type: CASE_EVENT_TYPES.COMMAND_ACCEPTED, payload: { commandType: envelope.type, commandId: envelope.commandId, byUserId: actor.id } });
    // The command is accepted and durable; a failure while continuing is logged and visible on the case, not swallowed.
    await this.orchestrator.advance(actor.tenantId, caseId).catch((error: unknown) => this.logger.error(`advance after command ${envelope.type} failed for case ${caseId}: ${error instanceof Error ? error.message : String(error)}`));
    const final = await scoped.case.findUnique({ where: { id: caseId } });
    return { commandId: envelope.commandId, status: 'ACCEPTED', caseRevision: final?.revision ?? revision, replayed: false };
  }

  private async dispatch(actor: CommandActor, caseRow: Case, type: CaseCommandType, rawPayload: unknown): Promise<void> {
    const tenantId = actor.tenantId;
    const extra = this.extraHandlers.get(type);
    if (extra) return extra({ actor, caseRow, payload: rawPayload });

    switch (type) {
      case 'ADD_FACTS': {
        const payload = rawPayload as Payload<'ADD_FACTS'>;
        for (const fact of payload.facts) await this.facts.setByHuman(tenantId, caseRow.id, actor.id, { key: fact.key, value: fact.value, valueType: fact.valueType, unit: fact.unit, currency: fact.currency });
        return;
      }
      case 'CORRECT_FACT':
      case 'RESOLVE_FACT_CONFLICT': {
        const fact = rawPayload as Payload<'CORRECT_FACT'>;
        await this.facts.setByHuman(tenantId, caseRow.id, actor.id, { key: fact.key, value: fact.value, valueType: fact.valueType, unit: fact.unit, currency: fact.currency });
        return;
      }
      case 'APPROVE_PLAN':
        return this.orchestrator.approvePlan(tenantId, actor.id, (rawPayload as Payload<'APPROVE_PLAN'>).planId);
      case 'REJECT_PLAN': {
        const payload = rawPayload as Payload<'REJECT_PLAN'>;
        return this.orchestrator.rejectPlan(tenantId, actor.id, payload.planId, payload.reason);
      }
      case 'APPROVE_ACTION':
      case 'REJECT_ACTION': {
        const payload = rawPayload as Payload<'APPROVE_ACTION'>;
        const result = await this.orchestrator.decideAction(tenantId, actor.id, payload.intentId, type === 'APPROVE_ACTION' ? 'APPROVED' : 'REJECTED', (rawPayload as { reason?: string }).reason);
        if (!result.applied) throw new UnprocessableEntityException(result.reason ?? 'Die Entscheidung konnte nicht angewendet werden.');
        return;
      }
      case 'RECONCILE_ACTION': {
        const payload = rawPayload as Payload<'RECONCILE_ACTION'>;
        if (!(await this.orchestrator.reconcile(tenantId, actor.id, caseRow.id, payload.intentId, payload.happened, payload.note))) {
          throw new UnprocessableEntityException('Diese Aktion ist nicht ungewiss und kann nicht abgeglichen werden.');
        }
        return;
      }
      case 'PAUSE':
        return this.orchestrator.pause(tenantId, caseRow.id, actor.id);
      case 'RESUME':
        return this.orchestrator.resume(tenantId, caseRow.id, actor.id);
      case 'REPLAN': {
        const result = await this.orchestrator.replan(tenantId, caseRow.id, actor.id);
        if (result.outcome === 'MANUAL_REVIEW') throw new UnprocessableEntityException(result.reasons[0] ?? 'Die Neuplanung ist nicht möglich.');
        return;
      }
      case 'RETRY_STEP': {
        const payload = rawPayload as Payload<'RETRY_STEP'>;
        if (!(await this.orchestrator.retryNode(tenantId, caseRow.id, payload.stepRunId))) throw new UnprocessableEntityException('Dieser Schritt kann nicht wiederholt werden.');
        return;
      }
      case 'CANCEL':
        return this.orchestrator.cancel(tenantId, caseRow.id, actor.id);
      case 'COMPLETE_MANUAL_TASK': {
        const payload = rawPayload as Payload<'COMPLETE_MANUAL_TASK'>;
        // A node of type APPROVAL is a decision: it needs the approval permission, not only case management.
        const node = (await this.prisma.forTenantId(tenantId).processPlanNode.findFirst({ where: { nodeKey: payload.nodeId, plan: { caseId: caseRow.id, status: 'ACTIVE' } } })) ?? undefined;
        if (node?.type === 'APPROVAL' && !actor.permissions.includes(PERMISSIONS.APPROVAL_DECIDE)) throw new ForbiddenException('Für diese Entscheidung fehlt die Freigabe-Berechtigung.');
        if (!(await this.orchestrator.completeManual(tenantId, actor.id, caseRow.id, payload.nodeId, payload.result as Record<string, unknown>))) {
          throw new UnprocessableEntityException('Dieser Schritt wartet nicht auf eine manuelle Eingabe.');
        }
        return;
      }
      case 'EDIT_DRAFT':
        throw new UnprocessableEntityException('Für diesen Vorgang gibt es keinen bearbeitbaren Entwurf.');
    }
  }

  private async record(actor: CommandActor, caseRow: Case, envelope: { commandId: string; type: CaseCommandType; expectedCaseRevision: number; payload: Record<string, unknown> }, status: 'ACCEPTED' | 'REJECTED' | 'CONFLICT', resultRevision?: number, errors?: Record<string, unknown>): Promise<void> {
    await this.prisma.forTenantId(actor.tenantId).caseCommand.create({
      data: {
        tenantId: actor.tenantId,
        caseId: caseRow.id,
        commandId: envelope.commandId,
        type: envelope.type,
        payload: JSON.parse(JSON.stringify(envelope.payload)) as Prisma.InputJsonValue,
        expectedCaseRevision: envelope.expectedCaseRevision,
        status,
        resultCaseRevision: resultRevision,
        actorUserId: actor.id,
        errors: errors ? (errors as Prisma.InputJsonValue) : undefined,
      },
    });
    await this.audit.record({
      tenantId: actor.tenantId,
      eventType: 'CASE_COMMAND_EXECUTED',
      actorType: 'USER',
      actorUserId: actor.id,
      entityType: 'Case',
      entityId: caseRow.id,
      payload: { commandId: envelope.commandId, type: envelope.type, status, expectedCaseRevision: envelope.expectedCaseRevision, resultCaseRevision: resultRevision ?? null },
    });
  }
}
