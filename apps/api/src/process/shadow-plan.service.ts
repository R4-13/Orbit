import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@orbit/domain';
import { FEATURE_FLAGS, SHADOW_PLAN_LIMIT_PER_TENANT, rateShadowPlan } from '@orbit/shared';
import { PlatformControlService } from '../platform-control/platform-control.service';
import { PrismaService } from '../prisma/prisma.service';
import { CapabilityRegistryService } from './capability-registry.service';
import { CASE_EVENT_TYPES, CaseEventsService } from './case-events.service';
import { PlannerService } from './planner.service';

export type ShadowOutcome = 'RECORDED' | 'DISABLED' | 'UNAVAILABLE' | 'LIMIT_REACHED' | 'ALREADY_DONE';

/**
 * Schattenbetrieb des Vorgangs-Agenten (Konzept Flexible Autonomie §9 Schritt 1, Addendum ADD-5.1): zu einem Vorgang, den der bisherige Weg bearbeitet, plant der freie Planer **mit** – ohne
 * Hinterlegung des Prozesses, aus den tatsächlich verfügbaren Fähigkeiten –, **führt aber nichts aus und speichert keinen Plan**. Das Ergebnis ist ein einziges Ereignis `shadow.plan_proposed`
 * im Verlauf des Vorgangs (keine neue Tabelle, Governance §5.3) mit der deterministischen Bewertung der Planung (`rateShadowPlan`: Regeln, Aktionsklassen, Dienst am Geschäftsziel).
 * Bewertet wird die **Planung**; ob die Ausführung gleichwertig wäre, zeigen erst die aktiven kontrollierten Tests.
 *
 * Grenzen: Plattform-Flag `planner.shadow` (je Mandant, Standard AUS, fail-closed), Kill-Switch `planner.adaptive`, die vorhandenen KI-Kosten- und Aufrufgrenzen (der Planer löst das Modell über den
 * üblichen Weg auf) und eine **feste Obergrenze von `SHADOW_PLAN_LIMIT_PER_TENANT` Schattenplanungen je Mandant** (ein begrenzter Messlauf, keine Dauereinrichtung). Die Grenze wird sicher gehalten:
 * erst wird die Planung als Ereignis reserviert, dann gezählt; wer über der Grenze liegt, plant nicht. Ein Fehler hier beeinträchtigt den Vorgang nie.
 */
@Injectable()
export class ShadowPlanService {
  private readonly logger = new Logger(ShadowPlanService.name);

  constructor(
    private readonly platformControl: PlatformControlService,
    private readonly planner: PlannerService,
    private readonly capabilities: CapabilityRegistryService,
    private readonly events: CaseEventsService,
    private readonly prisma: PrismaService,
  ) {}

  /** Ohne Rückgabewert und ohne Ausnahme – für den Aufruf aus dem Eingang ohne Warten (`void`). */
  async recordSafely(tenantId: string, caseId: string, intentSummary?: string): Promise<void> {
    try {
      await this.record(tenantId, caseId, intentSummary);
    } catch (error) {
      this.logger.warn(`Schattenplan für Vorgang ${caseId} nicht erstellt: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Art des Anliegens laut Einstufung des Eingangs (für die Zielbewertung); ohne Angabe urteilt ein Mensch. */
  private async categoryOf(tenantId: string, caseId: string): Promise<string | undefined> {
    const event = await this.prisma.forTenantId(tenantId).intakeEvent.findFirst({ where: { caseId }, orderBy: { createdAt: 'asc' }, select: { decision: { select: { result: true } } } });
    const category = (event?.decision?.result as { category?: unknown } | null | undefined)?.category;
    return typeof category === 'string' ? category : undefined;
  }

  async record(tenantId: string, caseId: string, intentSummary?: string): Promise<ShadowOutcome> {
    if (!(await this.platformControl.flagEnabled(FEATURE_FLAGS.PLANNER_SHADOW, tenantId))) return 'DISABLED';

    // 1. Reservieren: das Ereignis ist zugleich die Zählung. Ein zweiter Aufruf für denselben Vorgang findet es (dedupeKey) und plant nicht noch einmal.
    const reserved = await this.events.append(tenantId, caseId, { type: CASE_EVENT_TYPES.SHADOW_PLAN_PROPOSED, payload: { stage: 'RESERVED', available: null }, dedupeKey: `shadow:${caseId}` });
    if (reserved.duplicate) return 'ALREADY_DONE';
    const eventId = reserved.event.id;
    const finish = (payload: Record<string, unknown>) =>
      this.prisma.forTenantId(tenantId).caseEvent.update({ where: { id: eventId }, data: { payload: payload as Prisma.InputJsonValue } });

    // 2. Zählen (inklusive des eigenen Ereignisses): über der Grenze wird nicht geplant.
    const used = await this.prisma.forTenantId(tenantId).caseEvent.count({ where: { tenantId, type: CASE_EVENT_TYPES.SHADOW_PLAN_PROPOSED } });
    if (used > SHADOW_PLAN_LIMIT_PER_TENANT) {
      await finish({ stage: 'DONE', available: false, reason: `Die Obergrenze von ${SHADOW_PLAN_LIMIT_PER_TENANT} Schattenplanungen je Mandant ist erreicht.`, limit: SHADOW_PLAN_LIMIT_PER_TENANT });
      return 'LIMIT_REACHED';
    }

    const proposed = await this.planner.shadowPropose(tenantId, caseId, intentSummary);
    if (proposed.status === 'UNAVAILABLE') {
      await finish({ stage: 'DONE', available: false, reason: proposed.reason });
      return 'UNAVAILABLE';
    }
    const category = await this.categoryOf(tenantId, caseId);
    const rating = rateShadowPlan(proposed.proposal, {
      category,
      capabilities: this.capabilities.catalogue(),
      policyModes: Object.fromEntries(await this.capabilities.policyModesFor(tenantId)),
      planValid: proposed.validation.valid,
    });
    await finish({
      stage: 'DONE',
      available: true,
      category: category ?? null,
      goalKeys: proposed.proposal.goalKeys,
      explanation: proposed.proposal.conciseExplanation,
      nodes: proposed.proposal.nodes.map((n) => ({ id: n.id, type: n.type, capability: n.capability?.key ?? null, purpose: typeof n.config.purpose === 'string' ? n.config.purpose : null })),
      edgeCount: proposed.proposal.edges.length,
      valid: proposed.validation.valid,
      issueCodes: proposed.validation.issues.map((i) => i.code),
      rating,
    });
    return 'RECORDED';
  }
}
