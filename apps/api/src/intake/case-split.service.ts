import { Injectable, Logger } from '@nestjs/common';
import type { Case } from '@orbit/domain';
import { DEFAULT_TRIAGE_CATEGORIES, FEATURE_FLAGS, MAX_ACTIVE_SPLIT_CHILDREN, UNKNOWN_CATEGORY, categoryLabel, decideSplit, type SplitDecision, type TriageResult } from '@orbit/shared';
import { CasesService } from '../cases/cases.service';
import { PlatformControlService } from '../platform-control/platform-control.service';
import { PrismaService } from '../prisma/prisma.service';
import { ChildCaseStarterService } from '../process/child-case-starter.service';
import { CASE_EVENT_TYPES, CaseEventsService } from '../process/case-events.service';
import { CaseFactsService, type FactInput } from '../process/case-facts.service';
import { CaseLifecycleService } from '../process/case-lifecycle.service';
import type { NormalizedIntakeEvent } from './channel-event.types';

const REGISTRY_CATEGORIES: ReadonlySet<string> = new Set(DEFAULT_TRIAGE_CATEGORIES.map((c) => c.key));

export interface SplitInput {
  tenantId: string;
  actorUserId: string | undefined;
  /** Der Hauptvorgang: trägt die Nachricht und führt nichts selbst aus. */
  parent: Case;
  triage: TriageResult;
  event: NormalizedIntakeEvent;
  inboundEmailId: string;
}

export interface SplitResult {
  children: Array<{ caseId: string; intentKey: string; goal: string; outcome: 'RUNNING' | 'AWAITING_PLAN_APPROVAL' | 'MANUAL_REVIEW' | 'PENDING' }>;
}

/**
 * Aufteilung einer Nachricht mit mehreren Anliegen (FX-02/FX-06, ADD-3.1): Jedes Anliegen wird ein eigener, mit dem Hauptvorgang verknüpfter Teilvorgang mit eigenem Ziel,
 * eigener Planung und eigenem Abschluss. Nichts geht verloren: Anliegen über der Obergrenze stehen am Hauptvorgang. Nur mit dem Betreiber-Flag `process.split`.
 * Wirken Teilvorgänge auf dasselbe Geschäftsobjekt (Termin, Interessent, Eingangsbestätigung), koordiniert der Wirkungsschlüssel (FX-07).
 */
@Injectable()
export class CaseSplitService {
  private readonly logger = new Logger(CaseSplitService.name);

  constructor(
    private readonly platformControl: PlatformControlService,
    private readonly prisma: PrismaService,
    private readonly cases: CasesService,
    private readonly lifecycle: CaseLifecycleService,
    private readonly facts: CaseFactsService,
    private readonly events: CaseEventsService,
    private readonly starter: ChildCaseStarterService,
  ) {}

  /** Teilen nur mit dem Flag und nur bei einer belastbaren Einstufung. Fail-closed: bei jedem Zweifel läuft es wie bisher. */
  async decide(tenantId: string, triage: TriageResult): Promise<SplitDecision> {
    const decision = decideSplit(triage);
    if (!decision.split) return decision;
    const enabled = await this.platformControl.flagEnabled(FEATURE_FLAGS.PROCESS_SPLIT, tenantId).catch(() => false);
    return enabled ? decision : { ...decision, split: false, reason: 'Die Aufteilung ist für diesen Mandanten nicht freigegeben.' };
  }

  async split(input: SplitInput, decision: SplitDecision): Promise<SplitResult> {
    const { tenantId, actorUserId, parent, triage, event, inboundEmailId } = input;
    const subject = event.subject ?? '(ohne Betreff)';
    const result: SplitResult = { children: [] };

    await this.lifecycle.setGoals(tenantId, parent.id, { businessGoals: decision.children.map((c) => c.goal), currentIntent: 'MULTIPLE_INTENTS' });
    await this.lifecycle.transition(tenantId, parent.id, { to: 'IN_PROGRESS', attentionReasons: [] }, { type: 'AGENT' });

    // Erst werden alle Teilvorgänge angelegt, dann die ersten gestartet: der Hauptvorgang darf nie mit einem Teil „fertig“ sein, solange ein weiterer noch nicht existiert. Mehr als
    // `MAX_ACTIVE_SPLIT_CHILDREN` bearbeitet ORBIT nicht gleichzeitig; die übrigen bleiben ausdrücklich offen (Status „Eingegangen“) und werden gestartet, sobald ein Platz frei ist.
    const created: Array<{ child: SplitDecision['children'][number]; childCase: Case; childTriage: TriageResult; immediate: boolean }> = [];
    for (const [index, child] of decision.children.entries()) {
      const category = REGISTRY_CATEGORIES.has(child.intentKey) ? child.intentKey : UNKNOWN_CATEGORY;
      const childCase = await this.cases.create(tenantId, actorUserId ?? '', {
        type: 'GENERAL',
        title: `${REGISTRY_CATEGORIES.has(child.intentKey) ? categoryLabel(child.intentKey) : child.goal}: ${subject}`,
        description: event.content?.slice(0, 1000),
      });
      await this.prisma.forTenantId(tenantId).case.update({ where: { id: childCase.id }, data: { parentCaseId: parent.id } });
      await this.lifecycle.setGoals(tenantId, childCase.id, { businessGoals: [child.goal], currentIntent: child.intentKey });
      await this.facts.propose(
        tenantId,
        childCase.id,
        triage.extractedFactCandidates.map(
          (candidate): FactInput => ({ key: candidate.key, value: candidate.value, valueSchemaRef: candidate.valueSchemaRef, unit: candidate.unit, currency: candidate.currency, confidence: candidate.confidence, evidenceRefs: candidate.evidenceRefs, sourceType: 'EMAIL', sourceRef: inboundEmailId }),
        ),
      );
      const childTriage: TriageResult = {
        ...triage,
        category,
        intents: triage.intents.filter((intent) => intent.key === child.intentKey),
        riskFlags: triage.riskFlags.filter((flag) => flag !== 'MULTIPLE_INTENTS'),
        proposedBusinessGoals: [child.goal],
      };
      await this.events.append(tenantId, childCase.id, {
        type: CASE_EVENT_TYPES.CASE_SPLIT_FROM,
        payload: { parentCaseId: parent.id, intentKey: child.intentKey, goal: child.goal, siblings: decision.children.filter((c) => c !== child).map((c) => c.goal), triage: childTriage, subject },
        dedupeKey: `case.split_from:${childCase.id}`,
      });
      const immediate = index < MAX_ACTIVE_SPLIT_CHILDREN;
      if (immediate) await this.lifecycle.transition(tenantId, childCase.id, { to: 'IN_PROGRESS' }, { type: 'AGENT' });
      created.push({ child, childCase, childTriage, immediate });
    }
    await this.events.append(tenantId, parent.id, {
      type: CASE_EVENT_TYPES.CASE_SPLIT,
      payload: { children: created.map(({ child, childCase }) => ({ caseId: childCase.id, intentKey: child.intentKey, goal: child.goal })), startedNow: created.filter((c) => c.immediate).length, reason: decision.reason },
      dedupeKey: `case.split:${parent.id}`,
    });
    const waiting = created.filter((c) => !c.immediate).length;
    if (waiting > 0) {
      await this.prisma.forTenantId(tenantId).case.update({ where: { id: parent.id }, data: { attentionReasons: [`${waiting} ${waiting === 1 ? 'Anliegen wartet' : 'Anliegen warten'} auf die Bearbeitung.`] } });
    }
    for (const { child, childCase, childTriage, immediate } of created) {
      if (!immediate) {
        result.children.push({ caseId: childCase.id, intentKey: child.intentKey, goal: child.goal, outcome: 'PENDING' });
        continue;
      }
      const outcome = await this.starter.start(tenantId, actorUserId, childCase, childTriage, subject);
      result.children.push({ caseId: childCase.id, intentKey: child.intentKey, goal: child.goal, outcome });
    }
    return result;
  }
}
