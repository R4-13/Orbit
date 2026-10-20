import { Injectable, Logger } from '@nestjs/common';
import type { Case } from '@orbit/domain';
import type { PlanProposal, TriageResult } from '@orbit/shared';
import { PolicyEnforcementService } from '../policy/policy-enforcement.service';
import { PrismaService } from '../prisma/prisma.service';
import { BlueprintFitService, type GuideDescription } from './blueprint-fit.service';
import { CapabilityRegistryService } from './capability-registry.service';
import { CASE_EVENT_TYPES, CaseEventsService } from './case-events.service';
import { CaseFactsService } from './case-facts.service';
import { buildEmergencyProcedure } from './emergency-procedure';
import { buildInformationProcedure, buildStatusProcedure } from './standard-procedures';
import { OrchestratorService, type StartCaseResult } from './orchestrator.service';
import { messageCaseIds } from './case-scope';
import { ShadowPlanService } from './shadow-plan.service';

const REFERENCE_WINDOW_DAYS = 60;
/** Absender, die nie eine Antwort bekommen sollen (Lieferanten, Sonstige) – nur Kundschaft, Interessenten und Unbekannte. */
const ACKNOWLEDGED_SENDER_ROLES: ReadonlySet<string> = new Set(['CUSTOMER', 'PROSPECT', 'UNKNOWN']);

export interface AdHocStartResult {
  /** `MANUAL_REVIEW` heißt: nichts wurde geplant (z. B. KI nicht verfügbar) – der Vorgang liegt zur Prüfung bei einer Person. */
  result: StartCaseResult;
  mode: 'EMERGENCY_PROCEDURE' | 'STANDARD_PROCEDURE' | 'PLANNED';
}

/**
 * Die Brücke zwischen Eingang und Prozess-Engine für Nachrichten ohne hinterlegten Prozess (AUT-01): ORBIT plant selbst (oder wendet beim Notfall das feste
 * Verfahren an), statt jede solche Nachricht nur in die Prüfung zu legen. Jede Wirkung bleibt durch ihre eigene Regel geschützt.
 */
@Injectable()
export class AdHocIntakeService {
  private readonly logger = new Logger(AdHocIntakeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orchestrator: OrchestratorService,
    private readonly capabilities: CapabilityRegistryService,
    private readonly policy: PolicyEnforcementService,
    private readonly facts: CaseFactsService,
    private readonly events: CaseEventsService,
    private readonly shadow: ShadowPlanService,
    private readonly fit: BlueprintFitService,
  ) {}

  /** Startet die Bearbeitung und treibt sie voran. Wirft nie: bei jedem Fehler bleibt der Vorgang bei einer Person. */
  async start(tenantId: string, userId: string | undefined, caseRow: Case, triage: TriageResult, subject: string): Promise<AdHocStartResult | null> {
    try {
      let result: StartCaseResult;
      let mode: AdHocStartResult['mode'] = 'PLANNED';
      // Schattenbetrieb: wo der tatsächliche Weg ein festes Verfahren ist (Notfall, Auskunft, Status), plant der freie Planer zum Vergleich mit – ohne etwas auszuführen (nur mit Flag `planner.shadow`).
      // Wo der tatsächliche Weg ohnehin der freie Planer ist, gibt es nichts zu vergleichen.
      if (triage.urgency === 'CRITICAL') {
        mode = 'EMERGENCY_PROCEDURE';
        void this.shadow.recordSafely(tenantId, caseRow.id, subject);
        const acknowledgeSender = await this.canAcknowledge(tenantId, triage);
        const procedure = buildEmergencyProcedure({
          message: `Notfall: „${subject.slice(0, 120)}“ – bitte sofort prüfen und die Absenderin bzw. den Absender kontaktieren.`,
          acknowledgeSender,
        });
        result = await this.orchestrator.startProcedure(tenantId, caseRow.id, procedure, { userId, intentSummary: subject });
      } else {
        const standard = await this.standardProcedure(tenantId, caseRow.id, triage, subject);
        if (standard) {
          mode = 'STANDARD_PROCEDURE';
          void this.shadow.recordSafely(tenantId, caseRow.id, subject);
          result = await this.orchestrator.startProcedure(tenantId, caseRow.id, standard, { userId, intentSummary: subject });
        } else {
          result = await this.orchestrator.startCase(tenantId, caseRow.id, { userId, intentSummary: subject });
        }
      }
      // Auch ein Plan, der auf die Planfreigabe wartet, läuft los: seine verstehenden und vorbereitenden Schritte (Kontext, Angaben, Entwürfe) laufen vor der Freigabe (Entscheidung D4).
      if (result.outcome === 'RUNNING' || result.outcome === 'AWAITING_PLAN_APPROVAL') await this.orchestrator.advance(tenantId, caseRow.id);
      return { result, mode };
    } catch (error) {
      this.logger.warn(`Ad-hoc processing failed for case ${caseRow.id}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * Standardabläufe für die zwei häufigsten Fälle ohne hinterlegten Prozess: eine allgemeine Frage (aus dem Betriebswissen beantworten) und die Nachfrage zum Stand einer früheren
   * Anfrage. Sie gelten nur, wenn alles dafür bereit ist (Versand, Entwurf, Auskunft ausführbar, Regel nicht deaktiviert) und der Absender Kundschaft ist – sonst plant die KI.
   */
  private async standardProcedure(tenantId: string, caseId: string, triage: TriageResult, subject: string) {
    if (triage.category !== 'GENERAL_INQUIRY' || !ACKNOWLEDGED_SENDER_ROLES.has(triage.senderRoleHypothesis)) return undefined;
    const executability = await this.capabilities.executabilityFor(tenantId);
    const ready = (...keys: string[]) => keys.every((key) => executability.get(key)?.executable === true);
    const reference = await this.prisma.forTenantId(tenantId).caseFact.findFirst({ where: { caseId, key: 'case.reference', isCurrent: true, status: 'CONFIRMED' } });
    let candidate: { procedure: PlanProposal; guide: GuideDescription } | undefined;
    if (reference && ready('email.send', 'communication.draft') && (await this.policy.resolveMode(tenantId, 'email.send.acknowledgement')) !== 'DISABLED') {
      candidate = {
        procedure: buildStatusProcedure(),
        guide: { key: 'STANDARD_STATUS', title: 'Nachfrage zum Stand einer früheren Anfrage', goals: ['Anfrage beantwortet'], scope: 'Der Absender erhält den Stand seines früheren Vorgangs mitgeteilt', steps: ['Absender prüfen', 'Statusauskunft zum früheren Vorgang vorbereiten und senden'] },
      };
    } else if (ready('email.send', 'communication.draft', 'knowledge.answer') && (await this.policy.resolveMode(tenantId, 'email.send.information')) !== 'DISABLED' && (await this.policy.resolveMode(tenantId, 'knowledge.answer')) !== 'DISABLED') {
      candidate = {
        procedure: buildInformationProcedure({ message: `Allgemeine Frage „${subject.slice(0, 120)}“ – aus dem Betriebswissen nicht belegt beantwortbar, bitte persönlich antworten.` }),
        guide: { key: 'STANDARD_INFORMATION', title: 'Allgemeine Frage aus dem Betriebswissen beantworten', goals: ['Anfrage beantwortet'], scope: 'Eine Frage der Kundschaft wird aus dem freigegebenen Betriebswissen (Profil, häufige Fragen) beantwortet', steps: ['Absender prüfen', 'Antwort aus dem Betriebswissen ermitteln', 'Antwort senden – oder, wenn nicht belegt beantwortbar, zuständige Person informieren'] },
      };
    }
    if (!candidate) return undefined;
    // FX-18 (auch für feste Standardverfahren): Die Kategorie „Allgemeine Anfrage“ allein macht aus einer Mitteilung oder Bitte keine Frage, die aus dem Betriebswissen zu beantworten ist. Das Verfahren gilt nur,
    // wenn es den konkreten Fall trägt; sonst plant ORBIT frei (mit den Zielen, die die Nachricht wirklich verlangt – der Planvertrag bindet an die Ziele der ersten Planung, nicht an die des Verfahrens).
    const message = await this.prisma.forTenantId(tenantId).emailMessage.findFirst({ where: { caseId: { in: await messageCaseIds(this.prisma, tenantId, caseId) }, direction: 'INBOUND' }, orderBy: { createdAt: 'asc' }, select: { bodyText: true, bodyPreview: true } });
    const assessment = await this.fit.assessGuide(tenantId, candidate.guide, { category: triage.category, subject, text: message?.bodyText ?? message?.bodyPreview ?? '' });
    await this.events.append(tenantId, caseId, { type: CASE_EVENT_TYPES.BLUEPRINT_FIT_ASSESSED, payload: { blueprintKey: candidate.guide.key, procedure: true, ...assessment }, dedupeKey: `blueprint.fit:${caseId}:${candidate.guide.key}` });
    return assessment.fits ? candidate.procedure : undefined;
  }

  private async canAcknowledge(tenantId: string, triage: TriageResult): Promise<boolean> {
    if (!ACKNOWLEDGED_SENDER_ROLES.has(triage.senderRoleHypothesis)) return false;
    const executability = await this.capabilities.executabilityFor(tenantId);
    if (!executability.get('email.send')?.executable || !executability.get('communication.draft')?.executable) return false;
    return (await this.policy.resolveMode(tenantId, 'email.send.acknowledgement')) !== 'DISABLED';
  }

  /**
   * AUT-03: Bezieht sich eine Nachricht erkennbar auf einen früheren Vorgang (KI-Einstufung „Fortsetzung“), wird der Bezug vermerkt – nie verschmolzen. Genau ein
   * infrage kommender Vorgang derselben Absenderadresse der letzten Wochen wird als Fakt `case.reference` bestätigt (Quelle: ORBIT selbst); mehrere werden nur im
   * Verlauf genannt, damit eine Person entscheidet. Ohne Bezug geschieht nichts.
   */
  async linkReference(tenantId: string, caseId: string, senderAddress: string | undefined, triage: TriageResult): Promise<{ referenceCaseId?: string; candidates: number }> {
    if (triage.conversationRelation !== 'CONTINUATION' || !senderAddress) return { candidates: 0 };
    const since = new Date(Date.now() - REFERENCE_WINDOW_DAYS * 24 * 3600 * 1000);
    const rows = await this.prisma.forTenantId(tenantId).case.findMany({
      where: {
        id: { not: caseId },
        createdAt: { gte: since },
        orchestrationStatus: { notIn: ['REJECTED', 'CANCELLED'] },
        emailMessages: { some: { fromAddress: { equals: senderAddress, mode: 'insensitive' } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, title: true },
    });
    if (rows.length === 0) return { candidates: 0 };
    const single = rows.length === 1 ? rows[0] : undefined;
    if (single) {
      const [fact] = await this.facts.propose(tenantId, caseId, [{ key: 'case.reference', value: single.id, sourceType: 'SYSTEM_OF_RECORD', sourceRef: `case:${single.id}`, confidence: 1 }]);
      if (fact) await this.facts.confirmFromTrustedSource(tenantId, fact.id);
    }
    await this.events.append(tenantId, caseId, {
      type: CASE_EVENT_TYPES.CASE_REFERENCED,
      payload: { referenceCaseId: single?.id ?? null, ambiguous: !single, candidates: rows.map((r) => ({ caseId: r.id, title: r.title })) },
      dedupeKey: `case.referenced:${caseId}`,
    });
    return { referenceCaseId: single?.id, candidates: rows.length };
  }
}
