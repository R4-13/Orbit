import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ToolFailedError, type ToolDefinition, type ToolRegistry } from '@orbit/agent-core';
import { MAX_TIME_WAIT_DAYS, POLICY_ACTIONS, ValidationFailedError } from '@orbit/shared';
import { z } from 'zod';
import { TOOL_REGISTRY } from '../agent/agent.tokens';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CASE_EVENT_TYPES, CaseEventsService } from './case-events.service';
import { CaseLifecycleService } from './case-lifecycle.service';
import { OrchestratorService } from './orchestrator.service';
import { buildReminderProcedure } from './standard-procedures';

export interface InternalOrderInput {
  title: string;
  instruction: string;
  /** ISO 8601: zu diesem Zeitpunkt wird die zuständige Person informiert. Ohne Zeitpunkt plant ORBIT den Auftrag frei. */
  dueAt?: string;
}

export interface InternalOrderResult {
  caseId: string;
  mode: 'TIMED_REMINDER' | 'PLANNED';
  status: string;
}

/**
 * Allgemeines Geschäftsereignis ohne Nachricht (FX-03, D6): ein interner Auftrag, den eine Person erteilt (z. B. über Sonde) – „Erinnere uns am Freitag an die Wartung bei Meier“.
 * Er läuft über **dieselbe Orchestrierung** wie jeder Eingang: ein Vorgang, ein Plan, Wirkungsnachweis, Abschlusskriterien. Mit Zeitpunkt ist der Ablauf fest (warten bis zum
 * Zeitpunkt, dann die zuständige Person informieren); ohne Zeitpunkt plant ORBIT frei – dort gilt die Planfreigabe für Wirkungen nach außen wie bei jedem unbekannten Vorgang (D4).
 */
@Injectable()
export class InternalOrderService implements OnModuleInit {
  private readonly logger = new Logger(InternalOrderService.name);

  constructor(
    @Inject(TOOL_REGISTRY) private readonly registry: ToolRegistry,
    private readonly prisma: PrismaService,
    private readonly lifecycle: CaseLifecycleService,
    private readonly events: CaseEventsService,
    private readonly orchestrator: OrchestratorService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    const tool = this.orderTool();
    if (!this.registry.get(tool.name)) this.registry.register(tool);
  }

  async create(tenantId: string, userId: string | undefined, input: InternalOrderInput): Promise<InternalOrderResult> {
    const due = input.dueAt ? new Date(input.dueAt) : undefined;
    if (due) {
      if (Number.isNaN(due.getTime())) throw new ValidationFailedError('Der Zeitpunkt des Auftrags ist ungültig.');
      if (due.getTime() > Date.now() + MAX_TIME_WAIT_DAYS * 24 * 3600 * 1000) throw new ValidationFailedError(`Der Zeitpunkt liegt mehr als ${MAX_TIME_WAIT_DAYS} Tage in der Zukunft.`);
    }
    const created = await this.prisma.forTenantId(tenantId).case.create({ data: { tenantId, type: 'GENERAL', title: `Auftrag: ${input.title}`, description: input.instruction } });
    await this.audit.record({ tenantId, eventType: 'CASE_CREATED', actorType: userId ? 'USER' : 'AGENT', actorUserId: userId, entityType: 'Case', entityId: created.id, payload: { source: 'INTERNAL_ORDER' } });
    await this.events.append(tenantId, created.id, { type: CASE_EVENT_TYPES.ORDER_CREATED, payload: { instruction: input.instruction, dueAt: due?.toISOString() ?? null, createdByUserId: userId ?? null }, dedupeKey: `order.created:${created.id}` });
    await this.lifecycle.transition(tenantId, created.id, { to: 'IN_PROGRESS' }, { type: userId ? 'USER' : 'AGENT', userId });

    try {
      if (due) {
        // Zu einem Zeitpunkt in der Vergangenheit oder jetzt: sofort (die Frist ist schon erreicht).
        await this.lifecycle.setGoals(tenantId, created.id, { businessGoals: ['staff.informed'], currentIntent: 'INTERNAL_ORDER_REMINDER' });
        const started = await this.orchestrator.startProcedure(tenantId, created.id, buildReminderProcedure({ message: `Auftrag: ${input.title}. ${input.instruction}`.slice(0, 400), until: due.toISOString() }), { userId, intentSummary: input.title });
        if (started.outcome === 'RUNNING') await this.orchestrator.advance(tenantId, created.id);
        return { caseId: created.id, mode: 'TIMED_REMINDER', status: (await this.statusOf(tenantId, created.id)) };
      }
      const started = await this.orchestrator.startCase(tenantId, created.id, { userId, intentSummary: input.title });
      if (started.outcome === 'RUNNING' || started.outcome === 'AWAITING_PLAN_APPROVAL') await this.orchestrator.advance(tenantId, created.id);
      return { caseId: created.id, mode: 'PLANNED', status: await this.statusOf(tenantId, created.id) };
    } catch (error) {
      this.logger.warn(`internal order ${created.id} could not be started: ${error instanceof Error ? error.message : String(error)}`);
      await this.lifecycle.transition(tenantId, created.id, { to: 'MANUAL_REVIEW', attentionReasons: ['Der Auftrag konnte nicht automatisch gestartet werden; bitte prüfen.'] }, { type: 'SYSTEM' }).catch(() => undefined);
      return { caseId: created.id, mode: due ? 'TIMED_REMINDER' : 'PLANNED', status: 'MANUAL_REVIEW' };
    }
  }

  private async statusOf(tenantId: string, caseId: string): Promise<string> {
    return (await this.prisma.forTenantId(tenantId).case.findUniqueOrThrow({ where: { id: caseId }, select: { orchestrationStatus: true } })).orchestrationStatus;
  }

  private orderTool(): ToolDefinition {
    const schema = z.object({
      title: z.string().min(3).max(120),
      instruction: z.string().min(3).max(600),
      dueAt: z.string().datetime({ offset: true }).optional(),
    });
    return {
      name: 'create_internal_order',
      description:
        'Erteilt einen internen Auftrag, z. B. „Erinnere uns am Freitag um 8 Uhr an die Wartung bei Meier“. Mit dueAt (ISO 8601) informiert ORBIT die zuständige Person zu diesem Zeitpunkt; ohne dueAt plant ORBIT den Auftrag selbst. Schreibt nichts nach außen.',
      inputSchema: schema,
      policyAction: POLICY_ACTIONS.TASK_CREATE,
      execute: async (input: z.infer<typeof schema>, ctx) => {
        try {
          return { ...(await this.create(ctx.tenantId, ctx.actorUserId, input)), executionMode: 'LIVE' };
        } catch (error) {
          if (error instanceof ValidationFailedError) throw new ToolFailedError(error.message, { errorCode: 'ORDER_INVALID' });
          throw error;
        }
      },
    };
  }
}
