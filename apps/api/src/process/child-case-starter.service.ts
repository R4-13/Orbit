import { Injectable, Logger } from '@nestjs/common';
import type { Case } from '@orbit/domain';
import { TriageResultSchema, UNKNOWN_CATEGORY, caseStatusFor, type TriageResult } from '@orbit/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AdHocIntakeService } from './ad-hoc-intake.service';
import { BlueprintFitService } from './blueprint-fit.service';
import { BlueprintRegistryService } from './blueprint-registry.service';
import { CASE_EVENT_TYPES, CaseEventsService } from './case-events.service';
import { messageCaseIds } from './case-scope';
import { CaseLifecycleService } from './case-lifecycle.service';
import { OrchestratorService } from './orchestrator.service';

export type ChildStartOutcome = 'RUNNING' | 'AWAITING_PLAN_APPROVAL' | 'MANUAL_REVIEW' | 'RETRY_SCHEDULED';

/**
 * Startet die Bearbeitung eines Teilvorgangs einer aufgeteilten Nachricht (FX-02): Blueprint, Standardverfahren oder freie Planung – wie bei jedem Eingang. Hier, im Prozessmodul, weil auch der
 * Hauptvorgang (Roll-up) noch nicht begonnene Teilvorgänge starten muss, sobald Platz ist.
 */
@Injectable()
export class ChildCaseStarterService {
  private readonly logger = new Logger(ChildCaseStarterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: CaseLifecycleService,
    private readonly blueprints: BlueprintRegistryService,
    private readonly orchestrator: OrchestratorService,
    private readonly adHoc: AdHocIntakeService,
    private readonly fit: BlueprintFitService,
    private readonly events: CaseEventsService,
  ) {}

  async start(tenantId: string, userId: string | undefined, childCase: Case, triage: TriageResult, subject: string): Promise<ChildStartOutcome> {
    try {
      let blueprint = triage.category === UNKNOWN_CATEGORY ? undefined : await this.blueprints.findActiveForIntent(tenantId, triage.category);
      if (blueprint) {
        // FX-18: ein Leitfaden gilt nur, wenn er den konkreten Fall fachlich trägt.
        const message = await this.prisma.forTenantId(tenantId).emailMessage.findFirst({ where: { caseId: { in: await messageCaseIds(this.prisma, tenantId, childCase.id) }, direction: 'INBOUND' }, orderBy: { createdAt: 'asc' } });
        const assessment = await this.fit.assess(tenantId, blueprint, { category: triage.category, subject: subject, text: message?.bodyText ?? childCase.description ?? '' });
        await this.events.append(tenantId, childCase.id, { type: CASE_EVENT_TYPES.BLUEPRINT_FIT_ASSESSED, payload: { blueprintKey: blueprint.row.key, ...assessment } });
        if (!assessment.fits) blueprint = null;
      }
      if (blueprint) {
        const started = await this.orchestrator.startCase(tenantId, childCase.id, { userId, blueprintKey: blueprint.row.key, intentSummary: subject });
        if (started.outcome === 'RUNNING' || started.outcome === 'AWAITING_PLAN_APPROVAL') await this.orchestrator.advance(tenantId, childCase.id);
        return started.outcome;
      }
      const started = await this.adHoc.start(tenantId, userId, childCase, triage, subject);
      if (started && started.result.outcome !== 'MANUAL_REVIEW') return started.result.outcome;
      const why = started?.result.reasons.filter(Boolean).slice(0, 3) ?? [];
      await this.lifecycle.transition(tenantId, childCase.id, { to: 'MANUAL_REVIEW', attentionReasons: [...why, triage.conciseReason] }, { type: 'AGENT' });
      return 'MANUAL_REVIEW';
    } catch (error) {
      this.logger.warn(`child ${childCase.id} could not be started: ${error instanceof Error ? error.message : String(error)}`);
      await this.lifecycle.transition(tenantId, childCase.id, { to: 'MANUAL_REVIEW', attentionReasons: ['Das Anliegen konnte nicht automatisch gestartet werden; bitte prüfen.'] }, { type: 'AGENT' }).catch(() => undefined);
      return 'MANUAL_REVIEW';
    }
  }

  /**
   * Startet bis zu `count` noch nicht begonnene Teilvorgänge des Hauptvorgangs in der Reihenfolge der Nachricht. Der Start wird atomar beansprucht (Status „Eingegangen“ → „In Bearbeitung“),
   * damit er nie doppelt erfolgt. Die Einstufung des Anliegens liegt im Ereignis `case.split_from`.
   */
  async startPending(tenantId: string, parentCaseId: string, count: number, userId?: string): Promise<number> {
    if (count <= 0) return 0;
    const scoped = this.prisma.forTenantId(tenantId);
    const pending = await scoped.case.findMany({ where: { parentCaseId, orchestrationStatus: 'RECEIVED' }, orderBy: { createdAt: 'asc' }, take: count });
    let started = 0;
    for (const child of pending) {
      const claimed = await scoped.case.updateMany({ where: { id: child.id, orchestrationStatus: 'RECEIVED' }, data: { orchestrationStatus: 'IN_PROGRESS', status: caseStatusFor('IN_PROGRESS'), attentionReasons: [] } });
      if (claimed.count !== 1) continue;
      const event = await scoped.caseEvent.findFirst({ where: { caseId: child.id, type: CASE_EVENT_TYPES.CASE_SPLIT_FROM }, orderBy: { sequence: 'asc' } });
      const payload = (event?.payload ?? {}) as { triage?: unknown; subject?: string };
      const parsed = TriageResultSchema.safeParse(payload.triage);
      if (!parsed.success) {
        await this.lifecycle.transition(tenantId, child.id, { to: 'MANUAL_REVIEW', attentionReasons: ['Die Einstufung dieses Anliegens liegt nicht mehr vor; bitte prüfen und bearbeiten.'] }, { type: 'AGENT' }).catch(() => undefined);
        continue;
      }
      await this.start(tenantId, userId, (await scoped.case.findUniqueOrThrow({ where: { id: child.id } })), parsed.data, payload.subject ?? child.title);
      started += 1;
    }
    return started;
  }
}
