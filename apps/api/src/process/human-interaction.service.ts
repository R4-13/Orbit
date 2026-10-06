import { Injectable } from '@nestjs/common';
import {
  COMMAND_EFFECTS,
  HUMAN_INTERACTION_REASONS,
  PERMISSIONS,
  type ActionDescriptor,
  type CaseGraphNode,
  type HumanInteractionReason,
  type HumanInteractionRequest,
  type HumanInteractionResponse,
  type HumanInteractionType,
  type Permission,
} from '@orbit/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CaseFactsService } from './case-facts.service';
import { CaseOrchestrationService, type Viewer } from './case-orchestration.service';

const TERMINAL = new Set(['COMPLETED', 'REJECTED', 'CANCELLED', 'FAILED']);

function toResponse(action: ActionDescriptor): HumanInteractionResponse {
  return {
    key: action.commandKey,
    label: action.title,
    effectDescription: COMMAND_EFFECTS[action.commandKey] ?? action.title,
    destructive: action.destructive,
    requiresPreview: action.requiresPreview,
    targetRef: action.targetRef,
    payload: action.payload,
    fields: action.fields.map((f) => ({ name: f.name, label: f.label, type: f.type, required: f.required })),
  };
}

/**
 * HumanInteractionRequest (Amendment 02 v1.2 §31, BP-35): eine Projektion – keine zweite Tabelle – darüber, **wozu ORBIT gerade einen Menschen braucht**
 * und aus welchem zulässigen Grund. Quellen sind ausschließlich bestehende Objekte (gebundene Freigabe, Plan-Bestätigung, Faktenkonflikt, ungewisse Wirkung,
 * manueller Schritt, Prüfung bei erreichtem Limit). Fehlende Angaben allein erzeugen **keine** Anfrage: dafür gilt zuerst die Auflösungsleiter, danach die
 * externe Sachrückfrage; ein Mensch kommt erst bei einem der definierten Gründe ins Spiel. Die zulässigen Antworten sind die für den Betrachter
 * erlaubten Befehle – eine Anfrage ohne zulässige Antwort ist rein informativ.
 */
@Injectable()
export class HumanInteractionService {
  constructor(
    private readonly orchestration: CaseOrchestrationService,
    private readonly facts: CaseFactsService,
    private readonly prisma: PrismaService,
  ) {}

  async forCase(viewer: Viewer, caseId: string): Promise<HumanInteractionRequest[]> {
    const graph = await this.orchestration.projection(viewer, caseId);
    if (TERMINAL.has(graph.overallStatus)) return [];
    const goals = (await this.prisma.forTenantId(viewer.tenantId).case.findUnique({ where: { id: caseId }, select: { businessGoals: true } }))?.businessGoals ?? [];
    const requests: HumanInteractionRequest[] = [];
    const add = (type: HumanInteractionType, reason: HumanInteractionReason, question: string, extra: { id: string; nodeId?: string; responses: HumanInteractionResponse[]; freeText?: boolean; evidence?: string[] }) =>
      requests.push({
        id: `${caseId}:${extra.id}`,
        caseId,
        goalKeys: goals,
        type,
        businessQuestion: question,
        reasonCode: reason,
        reasonText: HUMAN_INTERACTION_REASONS[reason],
        nodeId: extra.nodeId,
        evidenceRefs: extra.evidence ?? [],
        allowedResponses: extra.responses,
        freeTextAllowed: extra.freeText ?? false,
      });

    // 1. Plan-Bestätigung (Ad-hoc-Plan)
    const planActions = graph.availableActions.filter((a) => a.commandKey === 'APPROVE_PLAN' || a.commandKey === 'REJECT_PLAN');
    if (graph.overallStatus === 'WAITING_FOR_APPROVAL' && planActions.length > 0) {
      add('PLAN_REVIEW', 'PLAN_REQUIRES_REVIEW', 'Soll der vorgeschlagene Plan für diesen Vorgang bestätigt werden?', { id: 'plan', responses: planActions.map(toResponse), freeText: true });
    }

    // 2. Knotenbezogene Gründe
    for (const node of graph.nodes) {
      if (node.state === 'AWAITING_APPROVAL') {
        add('APPROVAL', 'POLICY_REQUIRES_APPROVAL', `${node.title}: Soll diese Aktion jetzt ausgeführt werden?`, { id: `approval:${node.id}`, nodeId: node.id, responses: this.responsesOf(node, ['APPROVE_ACTION', 'REJECT_ACTION']), evidence: node.conciseReason ? [node.conciseReason] : [] });
      } else if (node.state === 'OUTCOME_UNKNOWN') {
        add('EXCEPTION_DECISION', 'OUTCOME_UNKNOWN', `${node.title}: Ist die Aktion tatsächlich erfolgt? Bitte mit Nachweis klären – sie wird nicht erneut versucht.`, { id: `unknown:${node.id}`, nodeId: node.id, responses: this.responsesOf(node, ['RECONCILE_ACTION']), freeText: true });
      } else if (node.state === 'WAITING' && node.type === 'MANUAL_TASK') {
        add('EXCEPTION_DECISION', 'MANUAL_STEP_OPEN', `${node.title}: Dieser manuelle Schritt wartet auf Ihr Ergebnis.`, { id: `manual:${node.id}`, nodeId: node.id, responses: this.responsesOf(node, ['COMPLETE_MANUAL_TASK']), freeText: true });
      }
    }

    // 3. Faktenkonflikt
    const conflicted = (await this.facts.getCurrent(viewer.tenantId, caseId)).filter((f) => f.status === 'CONFLICTED');
    if (conflicted.length > 0) {
      const keys = [...new Set(conflicted.map((f) => f.key))];
      const canManage = viewer.permissions.includes(PERMISSIONS.CASE_MANAGE as Permission);
      for (const key of keys) {
        const values = conflicted.filter((f) => f.key === key).map((f) => JSON.stringify(f.value));
        add('CONFLICT_RESOLUTION', 'FACT_CONFLICT', `„${key}“ ist widersprüchlich (${values.join(' / ')}). Welcher Wert gilt?`, {
          id: `conflict:${key}`,
          evidence: values,
          responses: canManage
            ? [{ key: 'RESOLVE_FACT_CONFLICT', label: 'Wert festlegen', effectDescription: COMMAND_EFFECTS.RESOLVE_FACT_CONFLICT as string, requiresPreview: false, payload: { key }, fields: [{ name: 'value', label: 'Gültiger Wert', type: 'text', required: true }] }]
            : [],
          freeText: true,
        });
      }
    }

    // 4. Prüfung ohne konkreteren Anlass (Limit erreicht / Schritt blockiert): genau eine, benannte Anfrage
    if (requests.length === 0 && graph.overallStatus === 'MANUAL_REVIEW') {
      const reason: HumanInteractionReason = graph.nodes.some((n) => n.state === 'BLOCKED' || n.state === 'FAILED') ? 'BLOCKED_FOR_REVIEW' : 'LIMIT_REACHED';
      const responses = graph.availableActions.filter((a) => ['ADD_FACTS', 'REPLAN', 'CANCEL'].includes(a.commandKey)).map(toResponse);
      add('EXCEPTION_DECISION', reason, graph.attentionReasons[0] ?? 'Dieser Vorgang braucht eine Entscheidung, wie es weitergeht.', { id: 'review', responses, freeText: true, evidence: graph.attentionReasons });
    }
    return requests;
  }

  private responsesOf(node: CaseGraphNode, keys: string[]): HumanInteractionResponse[] {
    return node.availableActions.filter((a) => keys.includes(a.commandKey)).map(toResponse);
  }
}
