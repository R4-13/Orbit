import { Injectable, Logger } from '@nestjs/common';
import type { Case } from '@orbit/domain';
import type { TriageResult } from '@orbit/shared';
import { PolicyEnforcementService } from '../policy/policy-enforcement.service';
import { PrismaService } from '../prisma/prisma.service';
import { CapabilityRegistryService } from './capability-registry.service';
import { CASE_EVENT_TYPES, CaseEventsService } from './case-events.service';
import { CaseFactsService } from './case-facts.service';
import { buildEmergencyProcedure } from './emergency-procedure';
import { OrchestratorService, type StartCaseResult } from './orchestrator.service';

const REFERENCE_WINDOW_DAYS = 60;
/** Absender, die nie eine Antwort bekommen sollen (Lieferanten, Sonstige) – nur Kundschaft, Interessenten und Unbekannte. */
const ACKNOWLEDGED_SENDER_ROLES: ReadonlySet<string> = new Set(['CUSTOMER', 'PROSPECT', 'UNKNOWN']);

export interface AdHocStartResult {
  /** `MANUAL_REVIEW` heißt: nichts wurde geplant (z. B. KI nicht verfügbar) – der Vorgang liegt zur Prüfung bei einer Person. */
  result: StartCaseResult;
  mode: 'EMERGENCY_PROCEDURE' | 'PLANNED';
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
  ) {}

  /** Startet die Bearbeitung und treibt sie voran. Wirft nie: bei jedem Fehler bleibt der Vorgang bei einer Person. */
  async start(tenantId: string, userId: string | undefined, caseRow: Case, triage: TriageResult, subject: string): Promise<AdHocStartResult | null> {
    try {
      let result: StartCaseResult;
      let mode: AdHocStartResult['mode'] = 'PLANNED';
      if (triage.urgency === 'CRITICAL') {
        mode = 'EMERGENCY_PROCEDURE';
        const acknowledgeSender = await this.canAcknowledge(tenantId, triage);
        const procedure = buildEmergencyProcedure({
          message: `Notfall: „${subject.slice(0, 120)}“ – bitte sofort prüfen und die Absenderin bzw. den Absender kontaktieren.`,
          acknowledgeSender,
        });
        result = await this.orchestrator.startProcedure(tenantId, caseRow.id, procedure, { userId, intentSummary: subject });
      } else {
        result = await this.orchestrator.startCase(tenantId, caseRow.id, { userId, intentSummary: subject });
      }
      if (result.outcome === 'RUNNING') await this.orchestrator.advance(tenantId, caseRow.id);
      return { result, mode };
    } catch (error) {
      this.logger.warn(`Ad-hoc processing failed for case ${caseRow.id}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
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
