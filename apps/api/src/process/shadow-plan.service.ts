import { Injectable, Logger } from '@nestjs/common';
import { FEATURE_FLAGS, rateShadowPlan } from '@orbit/shared';
import { PlatformControlService } from '../platform-control/platform-control.service';
import { CapabilityRegistryService } from './capability-registry.service';
import { CASE_EVENT_TYPES, CaseEventsService } from './case-events.service';
import { PlannerService } from './planner.service';

export type ShadowOutcome = 'RECORDED' | 'DISABLED' | 'UNAVAILABLE';

/**
 * Schattenbetrieb des Vorgangs-Agenten (Konzept Flexible Autonomie §9 Schritt 1, Addendum ADD-5.1): zu einem Vorgang, den der bisherige Weg bearbeitet, plant der
 * freie Planer **mit** – ohne Hinterlegung des Prozesses, aus den tatsächlich verfügbaren Fähigkeiten –, **führt aber nichts aus und speichert keinen Plan**. Das Ergebnis
 * ist ein einziges Ereignis `shadow.plan_proposed` im Verlauf des Vorgangs (keine neue Tabelle, Governance §5.3) mit der deterministischen Bewertung der Planung
 * (`rateShadowPlan`). Bewertet wird die **Planung**; ob die Ausführung gleichwertig wäre, zeigen erst die aktiven kontrollierten Tests.
 *
 * Schalter `planner.shadow` (Plattform-Flag, je Mandant; Standard AUS, fail-closed) und der Kill-Switch `planner.adaptive` gelten. Kosten: ein Planeraufruf je Vorgang
 * (Profil COMPLEX_REASONING, am Vorgang gemessen). Ein Fehler hier darf den Vorgang nie beeinträchtigen.
 */
@Injectable()
export class ShadowPlanService {
  private readonly logger = new Logger(ShadowPlanService.name);

  constructor(
    private readonly platformControl: PlatformControlService,
    private readonly planner: PlannerService,
    private readonly capabilities: CapabilityRegistryService,
    private readonly events: CaseEventsService,
  ) {}

  /** Ohne Rückgabewert und ohne Ausnahme – für den Aufruf aus dem Eingang ohne Warten (`void`). */
  async recordSafely(tenantId: string, caseId: string, intentSummary?: string): Promise<void> {
    try {
      await this.record(tenantId, caseId, intentSummary);
    } catch (error) {
      this.logger.warn(`Schattenplan für Vorgang ${caseId} nicht erstellt: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async record(tenantId: string, caseId: string, intentSummary?: string): Promise<ShadowOutcome> {
    if (!(await this.platformControl.flagEnabled(FEATURE_FLAGS.PLANNER_SHADOW, tenantId))) return 'DISABLED';
    const proposed = await this.planner.shadowPropose(tenantId, caseId, intentSummary);
    if (proposed.status === 'UNAVAILABLE') {
      await this.events.append(tenantId, caseId, { type: CASE_EVENT_TYPES.SHADOW_PLAN_PROPOSED, payload: { available: false, reason: proposed.reason }, dedupeKey: `shadow:${caseId}` });
      return 'UNAVAILABLE';
    }
    const rating = rateShadowPlan(proposed.proposal, {
      capabilities: this.capabilities.catalogue(),
      policyModes: Object.fromEntries(await this.capabilities.policyModesFor(tenantId)),
      planValid: proposed.validation.valid,
    });
    await this.events.append(tenantId, caseId, {
      type: CASE_EVENT_TYPES.SHADOW_PLAN_PROPOSED,
      payload: {
        available: true,
        goalKeys: proposed.proposal.goalKeys,
        explanation: proposed.proposal.conciseExplanation,
        nodes: proposed.proposal.nodes.map((n) => ({ id: n.id, type: n.type, capability: n.capability?.key ?? null, purpose: typeof n.config.purpose === 'string' ? n.config.purpose : null })),
        edgeCount: proposed.proposal.edges.length,
        valid: proposed.validation.valid,
        issueCodes: proposed.validation.issues.map((i) => i.code),
        rating,
      },
      dedupeKey: `shadow:${caseId}`,
    });
    return 'RECORDED';
  }
}
