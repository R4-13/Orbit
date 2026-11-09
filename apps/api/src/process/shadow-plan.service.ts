import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@orbit/domain';
import { FEATURE_FLAGS, SHADOW_PLAN_LIMIT_PER_TENANT, rateShadowPlan } from '@orbit/shared';
import { PlatformControlService } from '../platform-control/platform-control.service';
import { PrismaService } from '../prisma/prisma.service';
import { CapabilityRegistryService } from './capability-registry.service';
import { CASE_EVENT_TYPES, CaseEventsService } from './case-events.service';
import { PlannerService } from './planner.service';
import { ShadowQuotaService, type QuotaUnit } from './shadow-quota.service';

export type ShadowOutcome = 'RECORDED' | 'DISABLED' | 'UNAVAILABLE' | 'LIMIT_REACHED' | 'ALREADY_DONE' | 'NO_PREVIOUS_PLAN';

interface Reserved {
  eventId: string;
  unit: QuotaUnit | null;
}

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
    private readonly quota: ShadowQuotaService,
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

  /**
   * Atomar: vorhandene Planung → `ALREADY_DONE`; Grundgrenze erreicht → die Einheit kommt aus dem aktiven Zusatzkontingent (Hauptbuch), sonst Ablehnung ohne Verbrauch; sonst Reservierung samt Audit-Eintrag.
   * Eine ausdrückliche Wiederholung (`repeat`) braucht immer ein aktives Kontingent und berührt die Grundzählung nie.
   */
  private async reserve(tenantId: string, caseId: string, repeatKey: string | null): Promise<'ALREADY_DONE' | 'LIMIT_REACHED' | 'NO_PREVIOUS_PLAN' | Reserved> {
    return this.prisma.inTenantTransaction(tenantId, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`shadow:${tenantId}`}))`;
      const repeat = repeatKey !== null;
      const first = await tx.caseEvent.findFirst({ where: { caseId, dedupeKey: `shadow:${caseId}` }, select: { id: true } });
      if (repeat) {
        if (!first) return 'NO_PREVIOUS_PLAN' as const;
        // Dieselbe Wiederholungsanfrage (doppelt zugestellt): bereits gezählt, nicht noch einmal.
        if (await tx.shadowQuotaLedger.findFirst({ where: { tenantId, caseId, requestKey: repeatKey }, select: { id: true } })) return 'ALREADY_DONE' as const;
      } else if (first) return 'ALREADY_DONE' as const;

      const used = await this.quota.baseUsedInTx(tx, tenantId);
      let unit: QuotaUnit | null = null;
      let refusal: string | null = null;
      if (repeat || used >= SHADOW_PLAN_LIMIT_PER_TENANT) {
        const taken = await this.quota.takeInTx(tx, tenantId, caseId, repeat ? 'REPEAT' : 'FIRST', repeatKey);
        if (taken.unit) unit = taken.unit;
        else refusal = taken.reason === 'EXHAUSTED' ? 'Das Zusatzkontingent ist aufgebraucht.' : 'Es ist kein Zusatzkontingent aktiv.';
      }
      if (!unit && (repeat || used >= SHADOW_PLAN_LIMIT_PER_TENANT)) {
        await this.events.appendInTx(tx, tenantId, caseId, {
          type: CASE_EVENT_TYPES.SHADOW_PLAN_REFUSED,
          payload: { stage: 'DONE', available: false, reason: `Die Obergrenze von ${SHADOW_PLAN_LIMIT_PER_TENANT} Schattenplanungen je Mandant ist erreicht. ${refusal ?? ''}`.trim(), limit: SHADOW_PLAN_LIMIT_PER_TENANT, used },
          dedupeKey: `shadow-refused:${caseId}${repeat ? `:repeat:${repeatKey}` : ''}`,
        });
        return 'LIMIT_REACHED' as const;
      }
      const dedupeKey = unit?.requestKey ? `shadow:${caseId}:r:${unit.requestKey}` : `shadow:${caseId}`;
      const reserved = await this.events.appendInTx(tx, tenantId, caseId, { type: CASE_EVENT_TYPES.SHADOW_PLAN_PROPOSED, payload: { stage: 'RESERVED', available: null, ...(unit ? { quota: { grantId: unit.grantId, kind: unit.kind, attempt: unit.attempt } } : {}) }, dedupeKey });
      if (unit) await this.quota.attachInTx(tx, unit.ledgerId, reserved.event.id);
      else await tx.auditLog.create({ data: { tenantId, eventType: 'SHADOW_PLAN_CONSUMED', actorType: 'SYSTEM', entityType: 'case', entityId: caseId, payload: { caseEventId: reserved.event.id } } });
      return { eventId: reserved.event.id, unit };
    });
  }

  async record(tenantId: string, caseId: string, intentSummary?: string): Promise<ShadowOutcome> {
    return this.plan(tenantId, caseId, intentSummary, null);
  }

  /**
   * Ausdrückliche Wiederholung der Planung für einen Vorgang (nur aus einem aktiven Zusatzkontingent, einzeln gezählt). `requestKey` kennzeichnet die Wiederholungsanfrage: dieselbe Anfrage (doppelt zugestellt,
   * erneut ausgeführt) zählt und plant nur einmal (`ALREADY_DONE`); eine neue Anfrage ist ein neuer, kostenpflichtiger Versuch und steht als eigene Einheit im Hauptbuch.
   */
  async recordRepeat(tenantId: string, caseId: string, requestKey: string, intentSummary?: string): Promise<ShadowOutcome> {
    if (requestKey.trim().length === 0) throw new Error('Eine Wiederholung braucht einen Anfrageschlüssel.');
    return this.plan(tenantId, caseId, intentSummary, requestKey.trim());
  }

  private async plan(tenantId: string, caseId: string, intentSummary: string | undefined, repeatKey: string | null): Promise<ShadowOutcome> {
    if (!(await this.platformControl.flagEnabled(FEATURE_FLAGS.PLANNER_SHADOW, tenantId))) return 'DISABLED';

    // 1. Zählen und Reservieren in EINEM Schritt unter einer Sperre je Mandant: wer an der Grenze scheitert, verbraucht nichts (früher schrieb auch der abgelehnte Versuch einen Verbrauchs-Eintrag – der
    //    Zähler stand dann bei 61 von 60, obwohl genau 60 Planungen liefen), und zwei gleichzeitige Aufrufe können die Grenze nicht gemeinsam überschreiten.
    //    Die Zählung ist **dauerhaft**: jede verbrauchte Planung hinterlässt zusätzlich einen Audit-Eintrag, der das Löschen des Vorgangs überlebt – wer Testvorgänge löscht, setzt den Zähler nicht zurück.
    //    Maßgeblich ist der größere der beiden Werte. Ein zweiter Aufruf für denselben Vorgang findet das Ereignis (dedupeKey) und plant nicht noch einmal.
    const reservation = await this.reserve(tenantId, caseId, repeatKey);
    if (reservation === 'ALREADY_DONE' || reservation === 'LIMIT_REACHED' || reservation === 'NO_PREVIOUS_PLAN') return reservation;
    const { eventId, unit } = reservation;
    const quotaInfo = unit ? { quota: { grantId: unit.grantId, kind: unit.kind, attempt: unit.attempt } } : {};
    const finish = (payload: Record<string, unknown>) =>
      this.prisma.forTenantId(tenantId).caseEvent.update({ where: { id: eventId }, data: { payload: payload as Prisma.InputJsonValue } });

    const proposed = await this.planner.shadowPropose(tenantId, caseId, intentSummary);
    if (proposed.status === 'UNAVAILABLE') {
      await finish({ stage: 'DONE', available: false, reason: proposed.reason, ...quotaInfo });
      if (unit) await this.quota.finish(tenantId, unit.ledgerId, 'UNAVAILABLE');
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
      ...quotaInfo,
    });
    if (unit) await this.quota.finish(tenantId, unit.ledgerId, 'DONE');
    return 'RECORDED';
  }
}
