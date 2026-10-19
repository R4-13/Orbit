import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ToolFailedError, type ToolDefinition, type ToolRegistry } from '@orbit/agent-core';
import { MAX_TIME_WAIT_DAYS, POLICY_ACTIONS, ValidationFailedError } from '@orbit/shared';
import { z } from 'zod';
import { TOOL_REGISTRY } from '../agent/agent.tokens';
import { AuditService } from '../audit/audit.service';
import { AttentionService } from '../organization/attention.service';
import { PrismaService } from '../prisma/prisma.service';
import { CASE_EVENT_TYPES, CaseEventsService } from './case-events.service';
import { CaseLifecycleService } from './case-lifecycle.service';
import { formatOrderTime, parseOrderTime } from './order-time';
import { OrchestratorService } from './orchestrator.service';
import { buildReminderProcedure } from './standard-procedures';

/**
 * Art des Auftrags: **Zeitpunkt, Fälligkeit und fachliches Ziel sind getrennt.**
 * - `REMINDER`: „Erinnere mich morgen um 8 an X“ – das Ziel *ist* die Erinnerung; sie endet mit der bestätigten Meldung an die zuständige Person zum Zeitpunkt (`remindAt`).
 * - `TASK`: „Prüfe bis morgen X“ – das fachliche Ziel (die Prüfung) bleibt das Ziel; ORBIT plant frei, wie es erreicht wird. Die Fälligkeit (`dueAt`) ist eine Frist, kein Ziel: sie steht am Vorgang
 *   und an den Aufgaben des Vorgangs, und ein überfälliger, noch offener Auftrag wird der zuständigen Person gemeldet – der Vorgang schließt dadurch nicht.
 */
export type OrderKind = 'REMINDER' | 'TASK';

export interface InternalOrderInput {
  title: string;
  instruction: string;
  kind?: OrderKind;
  /** Nur für `REMINDER`: Ortszeit des Betriebs (`2026-10-20T08:00`) oder ISO 8601 mit Zeitzonenversatz. */
  remindAt?: string;
  /** Nur für `TASK`: Fälligkeit des fachlichen Ziels, gleiches Format. */
  dueAt?: string;
}

export interface InternalOrderResult {
  caseId: string;
  mode: 'TIMED_REMINDER' | 'PLANNED';
  status: string;
  /** Der verstandene Zeitpunkt in Ortszeit des Betriebs und als UTC – damit er nachprüfbar ist. */
  understoodTime?: { local: string; utc: string; timeZone: string; role: 'REMINDER' | 'DUE' };
}

const TERMINAL = ['COMPLETED', 'REJECTED', 'CANCELLED', 'FAILED'];

/**
 * Allgemeines Geschäftsereignis ohne Nachricht (FX-03, D6): ein interner Auftrag, den eine Person erteilt (z. B. über Sonde). Er läuft über **dieselbe Orchestrierung** wie jeder Eingang:
 * ein Vorgang, ein Plan, Wirkungsnachweis, Abschlusskriterien. Siehe `OrderKind` für die Trennung von Erinnerung, Frist und Ziel. Für Wirkungen nach außen gilt die Planfreigabe wie bei jedem
 * unbekannten Vorgang (D4).
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
    private readonly attention: AttentionService,
  ) {}

  onModuleInit(): void {
    const tool = this.orderTool();
    if (!this.registry.get(tool.name)) this.registry.register(tool);
  }

  async create(tenantId: string, userId: string | undefined, input: InternalOrderInput): Promise<InternalOrderResult> {
    const kind: OrderKind = input.kind ?? 'TASK';
    const timeZone = (await this.prisma.withRlsBypass((tx) => tx.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } })))?.timezone || 'Europe/Berlin';
    const now = Date.now();
    let remindAt: Date | undefined;
    let dueAt: Date | undefined;
    if (kind === 'REMINDER') {
      if (!input.remindAt) throw new ValidationFailedError('Für eine Erinnerung fehlt der Zeitpunkt (remindAt).');
      if (input.dueAt) throw new ValidationFailedError('Eine Erinnerung hat keine Fälligkeit; die Erinnerung zum Zeitpunkt ist das Ziel. Soll zusätzlich etwas geprüft oder erledigt werden, erteile einen eigenen Auftrag (kind TASK).');
      remindAt = parseOrderTime(input.remindAt, timeZone, 'Der Zeitpunkt der Erinnerung');
      if (remindAt.getTime() < now - 60_000) throw new ValidationFailedError('Der Zeitpunkt der Erinnerung liegt in der Vergangenheit.');
      if (remindAt.getTime() > now + MAX_TIME_WAIT_DAYS * 24 * 3600 * 1000) throw new ValidationFailedError(`Der Zeitpunkt liegt mehr als ${MAX_TIME_WAIT_DAYS} Tage in der Zukunft.`);
    } else {
      if (input.remindAt) throw new ValidationFailedError('Zu einer Aufgabe wird (noch) keine zusätzliche Erinnerung geplant. Erteile die Erinnerung als eigenen Auftrag (kind REMINDER).');
      if (input.dueAt) {
        dueAt = parseOrderTime(input.dueAt, timeZone, 'Die Fälligkeit');
        if (dueAt.getTime() < now - 60_000) throw new ValidationFailedError('Die Fälligkeit liegt in der Vergangenheit.');
      }
    }

    const description = dueAt ? `${input.instruction}\n\nFällig bis: ${formatOrderTime(dueAt, timeZone)}.` : input.instruction;
    const created = await this.prisma.forTenantId(tenantId).case.create({ data: { tenantId, type: 'GENERAL', title: `Auftrag: ${input.title}`, description } });
    await this.audit.record({ tenantId, eventType: 'CASE_CREATED', actorType: userId ? 'USER' : 'AGENT', actorUserId: userId, entityType: 'Case', entityId: created.id, payload: { source: 'INTERNAL_ORDER', kind } });
    await this.events.append(tenantId, created.id, {
      type: CASE_EVENT_TYPES.ORDER_CREATED,
      payload: { kind, instruction: input.instruction, remindAt: remindAt?.toISOString() ?? null, dueAt: dueAt?.toISOString() ?? null, timeZone, createdByUserId: userId ?? null },
      dedupeKey: `order.created:${created.id}`,
    });
    await this.lifecycle.transition(tenantId, created.id, { to: 'IN_PROGRESS' }, { type: userId ? 'USER' : 'AGENT', userId });

    const time = remindAt ?? dueAt;
    const understoodTime = time ? { local: formatOrderTime(time, timeZone), utc: time.toISOString(), timeZone, role: remindAt ? ('REMINDER' as const) : ('DUE' as const) } : undefined;
    try {
      if (remindAt) {
        await this.lifecycle.setGoals(tenantId, created.id, { businessGoals: ['staff.informed'], currentIntent: 'INTERNAL_ORDER_REMINDER' });
        const started = await this.orchestrator.startProcedure(tenantId, created.id, buildReminderProcedure({ message: `Erinnerung: ${input.title}. ${input.instruction}`.slice(0, 400), until: remindAt.toISOString() }), { userId, intentSummary: input.title });
        if (started.outcome === 'RUNNING') await this.orchestrator.advance(tenantId, created.id);
        return { caseId: created.id, mode: 'TIMED_REMINDER', status: await this.statusOf(tenantId, created.id), understoodTime };
      }
      const started = await this.orchestrator.startCase(tenantId, created.id, { userId, intentSummary: input.title });
      if (started.outcome === 'RUNNING' || started.outcome === 'AWAITING_PLAN_APPROVAL') await this.orchestrator.advance(tenantId, created.id);
      return { caseId: created.id, mode: 'PLANNED', status: await this.statusOf(tenantId, created.id), understoodTime };
    } catch (error) {
      this.logger.warn(`internal order ${created.id} could not be started: ${error instanceof Error ? error.message : String(error)}`);
      await this.lifecycle.transition(tenantId, created.id, { to: 'MANUAL_REVIEW', attentionReasons: ['Der Auftrag konnte nicht automatisch gestartet werden; bitte prüfen.'] }, { type: 'SYSTEM' }).catch(() => undefined);
      return { caseId: created.id, mode: remindAt ? 'TIMED_REMINDER' : 'PLANNED', status: 'MANUAL_REVIEW', understoodTime };
    }
  }

  /**
   * Fälligkeit (Auftrag `TASK` mit `dueAt`): ist sie überschritten und der Auftrag noch offen, wird die zuständige Person genau einmal gemeldet. Der Vorgang schließt dadurch nicht; das fachliche
   * Ziel bleibt das Ziel. Vom Sweep des Workers aufgerufen. Wirft nie.
   */
  async raiseOverdue(now = new Date()): Promise<number> {
    let raised = 0;
    try {
      const rows = await this.prisma.withRlsBypass((tx) =>
        tx.$queryRaw<Array<{ tenant_id: string; case_id: string; title: string }>>`
          SELECT e.tenant_id, e.case_id, c.title
          FROM case_events e JOIN cases c ON c.id = e.case_id
          WHERE e.type = 'order.created'
            AND e.payload->>'dueAt' IS NOT NULL
            AND (e.payload->>'dueAt')::timestamptz < ${now}
            AND c.orchestration_status::text <> ALL(${TERMINAL})
            AND NOT EXISTS (SELECT 1 FROM case_events o WHERE o.case_id = e.case_id AND o.type = 'order.overdue')
          LIMIT 50`,
      );
      for (const row of rows) {
        const { duplicate } = await this.events.append(row.tenant_id, row.case_id, { type: CASE_EVENT_TYPES.ORDER_OVERDUE, payload: { raisedAt: now.toISOString() }, dedupeKey: `order.overdue:${row.case_id}` });
        if (duplicate) continue;
        await this.attention.raise(row.tenant_id, row.case_id, { message: `Überfällig: „${row.title}“ ist fällig gewesen und noch nicht erledigt.`, urgent: false });
        raised += 1;
      }
    } catch (error) {
      this.logger.warn(`overdue check failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    return raised;
  }

  private async statusOf(tenantId: string, caseId: string): Promise<string> {
    return (await this.prisma.forTenantId(tenantId).case.findUniqueOrThrow({ where: { id: caseId }, select: { orchestrationStatus: true } })).orchestrationStatus;
  }

  private orderTool(): ToolDefinition {
    const schema = z.object({
      title: z.string().min(3).max(120),
      instruction: z.string().min(3).max(600),
      kind: z.enum(['REMINDER', 'TASK']).optional(),
      remindAt: z.string().min(10).max(40).optional(),
      dueAt: z.string().min(10).max(40).optional(),
    });
    return {
      name: 'create_internal_order',
      description:
        'Erteilt einen internen Auftrag. kind=REMINDER: „Erinnere uns am Freitag um 8 Uhr an …“ – zum Zeitpunkt remindAt wird die zuständige Person informiert, das ist das Ziel. kind=TASK (Standard): „Prüfe bis morgen …“ – die Sache selbst bleibt das Ziel, ORBIT plant selbst, dueAt ist nur die Frist; ein überfälliger offener Auftrag wird gemeldet. Zeiten als Ortszeit des Betriebs im Format JJJJ-MM-TTTHH:MM (z. B. 2026-10-20T08:00) oder ISO 8601 mit Versatz; rechne relative Angaben („morgen“, „in 10 Minuten“) anhand der aktuellen Zeit aus der Anweisung. Schreibt nichts nach außen.',
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
