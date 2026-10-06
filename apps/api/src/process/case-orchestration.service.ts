import { Injectable } from '@nestjs/common';
import type { ActionIntent, Case, CommunicationDraft, ProcessPlanNode, Quote } from '@orbit/domain';
import {
  NotFoundError,
  PERMISSIONS,
  evaluateExpr,
  type ActionDescriptor,
  type ActionPreview,
  type BlueprintDefinition,
  type CaseGraphEdge,
  type CaseGraphNode,
  type CaseGraphView,
  type CaseNodeDetail,
  type EvalContext,
  type Expr,
  type NodeState,
  type Permission,
  type PlanNode,
  redactString,
  redactValue,
} from '@orbit/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ActionLedgerService } from './action-ledger.service';
import { CapabilityRegistryService } from './capability-registry.service';
import { CaseFactsService } from './case-facts.service';
import { OrchestratorService } from './orchestrator.service';
import { PlanStoreService, type PlanGraph } from './plan-store.service';
import { formatEuro } from './reference/money';

export type OrchestrationMode = 'COMBINED' | 'ACTUAL' | 'DEFINITION';

const TERMINAL_CASE = new Set(['COMPLETED', 'REJECTED', 'CANCELLED', 'FAILED']);
const PASSING: ReadonlySet<NodeState> = new Set<NodeState>(['SUCCEEDED', 'SKIPPED']);
const ATTENTION: ReadonlySet<NodeState> = new Set<NodeState>(['RUNNING', 'WAITING', 'AWAITING_APPROVAL', 'READY', 'BLOCKED', 'FAILED', 'OUTCOME_UNKNOWN']);

export interface Viewer {
  tenantId: string;
  permissions: readonly Permission[];
}

const STATE_EXPLANATIONS: Record<NodeState, string> = {
  PLANNED: 'Dieser Schritt ist geplant und wartet darauf, dass seine Voraussetzungen erfüllt sind.',
  READY: 'Dieser Schritt ist bereit zur Ausführung.',
  RUNNING: 'Dieser Schritt wird gerade ausgeführt.',
  WAITING: 'Dieser Schritt wartet auf ein Ereignis oder eine manuelle Eingabe.',
  AWAITING_APPROVAL: 'Die Ausführung ist vorbereitet und wartet auf Ihre Freigabe. Bis dahin wurde nichts versendet oder verändert.',
  SUCCEEDED: 'Dieser Schritt wurde erfolgreich abgeschlossen.',
  SKIPPED: 'Dieser Schritt war nicht erforderlich und wurde übersprungen.',
  BLOCKED: 'Dieser Schritt kann gerade nicht ausgeführt werden.',
  FAILED: 'Dieser Schritt ist fehlgeschlagen.',
  CANCELLED: 'Dieser Schritt wurde abgebrochen.',
  SUPERSEDED: 'Dieser Schritt wurde durch einen neuen Plan ersetzt.',
  OUTCOME_UNKNOWN: 'Es ist ungewiss, ob die Aktion ausgeführt wurde. Sie wird nicht erneut versucht, bevor das geklärt ist.',
};

/** Fachliche Fehlermeldung für die Business-Projektion: Secrets geschwärzt, gekürzt, ohne Zeilenumbrüche/Stacktrace-Reste (BP-42/43). */
export function businessMessage(message: string | null | undefined): string {
  const text = redactString(message ?? '').split(/\r?\n/)[0]?.trim() ?? '';
  if (text.length === 0) return 'Der Schritt konnte nicht abgeschlossen werden.';
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

function iso(date: Date | null | undefined): string | undefined {
  return date ? date.toISOString() : undefined;
}

/**
 * Amendment 02 §16/§18 — the read model of the case orchestration view. It assembles the graph exclusively from
 * persisted data (plan nodes and edges, ledger, drafts, quotes, waits, events); the frontend renders it and invents
 * nothing. The set of actions is computed here, against the viewer's permissions and the case revision, so a button can
 * only exist if the server would accept the command behind it.
 */
@Injectable()
export class CaseOrchestrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly store: PlanStoreService,
    private readonly orchestrator: OrchestratorService,
    private readonly ledger: ActionLedgerService,
    private readonly facts: CaseFactsService,
    private readonly capabilities: CapabilityRegistryService,
  ) {}

  async projection(viewer: Viewer, caseId: string, options: { mode?: OrchestrationMode; planRevision?: number } = {}): Promise<CaseGraphView> {
    const scoped = this.prisma.forTenantId(viewer.tenantId);
    const caseRow = await scoped.case.findUnique({ where: { id: caseId } });
    if (!caseRow) throw new NotFoundError('Case not found.', { caseId });

    const mode = options.mode ?? 'COMBINED';
    const revisions = await this.store.listRevisions(viewer.tenantId, caseId);
    const latest = revisions.at(-1);
    const wanted = options.planRevision ? revisions.find((r) => r.revision === options.planRevision) : latest;
    const graph = wanted ? await this.store.load(viewer.tenantId, wanted.id) : undefined;
    const isLatest = !graph || graph.plan.id === latest?.id;
    const blueprint = await this.blueprintOf(viewer.tenantId, caseRow);

    const base = {
      caseId,
      caseRevision: caseRow.revision,
      projectionRevision: caseRow.eventSequence,
      planId: graph?.plan.id,
      planRevision: graph?.plan.revision,
      lastEventSequence: caseRow.eventSequence,
      generatedAt: new Date().toISOString(),
      mode,
      overallStatus: caseRow.orchestrationStatus,
      attentionReasons: caseRow.attentionReasons,
      revisions: revisions.map((r) => ({
        revision: r.revision,
        status: r.status,
        source: r.source,
        createdAt: r.createdAt.toISOString(),
        explanation: r.explanation,
        diff: (r.diffFromParent as { added: string[]; removed: string[]; changed: string[]; kept: string[] } | null) ?? null,
      })),
      blueprint: blueprint ? { key: blueprint.key, version: caseRow.blueprintVersion ?? blueprint.version, title: blueprint.title } : undefined,
    };

    if (mode === 'DEFINITION') {
      const reference = blueprint?.referenceGraph;
      const nodes: CaseGraphNode[] = (reference?.nodes ?? []).map((n) => ({
        id: n.id,
        planNodeId: n.id,
        title: n.title,
        type: n.type,
        state: 'PLANNED',
        provenance: 'BLUEPRINT',
        conciseReason: n.purpose,
        availableActions: [],
      }));
      const edges: CaseGraphEdge[] = (reference?.edges ?? []).map((e) => ({ id: e.id, source: e.source, target: e.target, label: e.label, disposition: 'POSSIBLE' }));
      return { ...base, currentNodeIds: [], nodes, edges, availableActions: [] };
    }

    if (!graph) {
      return { ...base, currentNodeIds: [], nodes: [], edges: [], availableActions: this.caseActions(viewer, caseRow, undefined, isLatest) };
    }

    const ctx = isLatest ? await this.orchestrator.buildEvalContext(viewer.tenantId, caseRow, graph) : undefined;
    const intents = await this.prisma.forTenantId(viewer.tenantId).actionIntent.findMany({ where: { caseId, planId: graph.plan.id } });
    const drafts = await this.prisma.forTenantId(viewer.tenantId).communicationDraft.findMany({ where: { caseId } });

    const visible = graph.nodes.filter((n) => mode !== 'ACTUAL' || (n.state !== 'PLANNED' && n.state !== 'SUPERSEDED'));
    const visibleKeys = new Set(visible.map((n) => n.nodeKey));
    const nodes = visible.map((n) => this.projectNode(viewer, caseRow, graph, n, intents, drafts, isLatest));
    const stateByKey = new Map(graph.nodes.map((n) => [n.nodeKey, n.state]));
    const edges: CaseGraphEdge[] = graph.edges
      .filter((e) => visibleKeys.has(e.sourceKey) && visibleKeys.has(e.targetKey))
      .map((e) => ({ id: e.edgeKey, source: e.sourceKey, target: e.targetKey, label: e.label ?? undefined, disposition: this.disposition(stateByKey.get(e.sourceKey), stateByKey.get(e.targetKey), e.condition as Expr | null, ctx) }));

    return {
      ...base,
      currentNodeIds: nodes.filter((n) => ATTENTION.has(n.state)).map((n) => n.id),
      nodes,
      edges,
      availableActions: this.caseActions(viewer, caseRow, graph, isLatest),
    };
  }

  async nodeDetail(viewer: Viewer, caseId: string, nodeId: string, planRevision?: number): Promise<CaseNodeDetail> {
    const scoped = this.prisma.forTenantId(viewer.tenantId);
    const caseRow = await scoped.case.findUnique({ where: { id: caseId } });
    if (!caseRow) throw new NotFoundError('Case not found.', { caseId });
    const revisions = await this.store.listRevisions(viewer.tenantId, caseId);
    const plan = planRevision ? revisions.find((r) => r.revision === planRevision) : revisions.at(-1);
    if (!plan) throw new NotFoundError('Plan not found.', { caseId });
    const graph = await this.store.load(viewer.tenantId, plan.id);
    const node = graph.nodes.find((n) => n.nodeKey === nodeId);
    if (!node) throw new NotFoundError('Node not found.', { nodeId });
    const isLatest = plan.id === revisions.at(-1)?.id;

    const def = node.definition as unknown as PlanNode;
    const capability = def.capability ? this.capabilities.get(def.capability.key) : undefined;
    const intents = await scoped.actionIntent.findMany({ where: { caseId, planId: plan.id, nodeKey: node.nodeKey }, orderBy: { createdAt: 'desc' } });
    const intent = intents[0];
    const drafts = await scoped.communicationDraft.findMany({ where: { caseId } });
    const subscription = await scoped.waitSubscription.findFirst({ where: { caseId, planId: plan.id, nodeKey: node.nodeKey }, orderBy: { createdAt: 'desc' } });

    const currentFacts = await this.facts.getCurrent(viewer.tenantId, caseId);
    const factKeys = Object.values(def.inputs).flatMap((operand) => ('fact' in operand ? [operand.fact] : []));
    const outputFacts = ((node.output as { recorded?: Array<{ key: string }> } | null)?.recorded ?? []).map((r) => r.key);

    const inputs = Object.entries(def.inputs).map(([name, operand]) => {
      if ('fact' in operand) return { name, source: `Fakt „${operand.fact}“`, value: currentFacts.find((f) => f.key === operand.fact && f.status === 'CONFIRMED')?.value };
      if ('stepOutput' in operand) return { name, source: `Ergebnis von „${operand.stepOutput.node}“ (${operand.stepOutput.path})` };
      if ('sourceRef' in operand) return { name, source: `Quelle „${operand.sourceRef}“` };
      if ('config' in operand) return { name, source: `Einstellung „${operand.config}“` };
      return { name, source: 'Fester Wert', value: operand.literal };
    });

    const preview = await this.previewFor(viewer.tenantId, caseId, intent, node, drafts);
    const receipts = intent ? await this.ledger.receipts(viewer.tenantId, intent.id) : [];
    const detail: CaseNodeDetail = {
      nodeId: node.nodeKey,
      title: node.title,
      type: node.type,
      state: node.state,
      purpose: def.purpose,
      capability: capability ? { key: capability.key, description: capability.description, sideEffect: capability.sideEffect } : undefined,
      stateExplanation: node.errorMessage && ['FAILED', 'BLOCKED', 'OUTCOME_UNKNOWN'].includes(node.state) ? `${STATE_EXPLANATIONS[node.state]} ${businessMessage(node.errorMessage)}` : STATE_EXPLANATIONS[node.state],
      retried: node.attempts > 1 ? true : undefined,
      startedAt: iso(node.startedAt),
      completedAt: iso(node.completedAt),
      executionMode: (node.executionMode as 'LIVE' | 'SIMULATED' | null) ?? undefined,
      error: node.errorCode ? { message: businessMessage(node.errorMessage) } : undefined,
      inputs: redactValue(inputs) as CaseNodeDetail['inputs'],
      facts: currentFacts
        .filter((f) => factKeys.includes(f.key) || outputFacts.includes(f.key))
        .map((f) => ({ key: f.key, value: redactValue(f.value), status: f.status, sourceType: f.sourceType, evidence: f.evidenceRefs })),
      action: intent
        ? { intentId: intent.id, status: intent.status, purpose: intent.purpose ?? undefined, approvalId: intent.approvalId ?? undefined, receipts: receipts.map((r) => ({ status: r.status, executionMode: r.executionMode, at: r.createdAt.toISOString(), evidenceAvailable: Boolean(r.providerRef) || r.status === 'CONFIRMED' })) }
        : undefined,
      wait: subscription ? { eventType: subscription.eventType, status: subscription.status, deadlineAt: iso(subscription.deadlineAt) } : undefined,
      preview,
      availableActions: this.nodeActions(viewer, caseRow, node, intents, drafts, isLatest),
    };
    return detail;
  }

  // ── projection helpers ─────────────────────────────────────────────────────

  private projectNode(viewer: Viewer, caseRow: Case, graph: PlanGraph, node: ProcessPlanNode, intents: ActionIntent[], drafts: CommunicationDraft[], isLatest: boolean): CaseGraphNode {
    const def = node.definition as unknown as PlanNode;
    const executed = !['PLANNED', 'READY', 'SUPERSEDED'].includes(node.state);
    return {
      id: node.nodeKey,
      planNodeId: node.nodeKey,
      title: node.title,
      type: node.type,
      state: node.state,
      provenance: executed ? 'EXECUTED' : graph.plan.source === 'BLUEPRINT_INSTANTIATION' ? 'PLANNED' : 'PLANNED',
      executionMode: (node.executionMode as 'LIVE' | 'SIMULATED' | null) ?? undefined,
      conciseReason: node.errorMessage ? businessMessage(node.errorMessage) : (def.purpose ?? undefined),
      detailsRef: node.nodeKey,
      availableActions: this.nodeActions(viewer, caseRow, node, intents.filter((i) => i.nodeKey === node.nodeKey), drafts, isLatest),
    };
  }

  private disposition(source: NodeState | undefined, target: NodeState | undefined, condition: Expr | null, ctx: EvalContext | undefined): CaseGraphEdge['disposition'] {
    if (!source) return 'POSSIBLE';
    if (PASSING.has(source)) {
      let conditionHolds = true;
      if (condition && ctx) {
        try {
          conditionHolds = evaluateExpr(condition, ctx);
        } catch {
          conditionHolds = false;
        }
      }
      if (!conditionHolds) return 'NOT_TAKEN';
      return target && target !== 'SKIPPED' ? 'TAKEN' : target === 'SKIPPED' ? 'NOT_TAKEN' : 'TAKEN';
    }
    if (source === 'CANCELLED' || source === 'SUPERSEDED') return 'NOT_TAKEN';
    return 'POSSIBLE';
  }

  private can(viewer: Viewer, permission: Permission): boolean {
    return viewer.permissions.includes(permission);
  }

  private caseActions(viewer: Viewer, caseRow: Case, graph: PlanGraph | undefined, isLatest: boolean): ActionDescriptor[] {
    if (!isLatest || !this.can(viewer, PERMISSIONS.CASE_MANAGE)) return [];
    const revision = caseRow.revision;
    const open = !TERMINAL_CASE.has(caseRow.orchestrationStatus);
    const actions: ActionDescriptor[] = [];
    if (open && caseRow.orchestrationStatus !== 'PAUSED') {
      actions.push({ commandKey: 'PAUSE', title: 'Anhalten', fields: [], requiresPreview: false, expectedCaseRevision: revision });
    }
    if (caseRow.orchestrationStatus === 'PAUSED') {
      actions.push({ commandKey: 'RESUME', title: 'Fortsetzen', fields: [], requiresPreview: false, expectedCaseRevision: revision });
    }
    if (open) {
      actions.push({
        commandKey: 'ADD_FACTS',
        title: 'Angabe ergänzen',
        fields: [
          { name: 'key', label: 'Angabe (z. B. request.quantity)', type: 'text', required: true },
          { name: 'value', label: 'Wert', type: 'text', required: true },
        ],
        requiresPreview: false,
        expectedCaseRevision: revision,
      });
      actions.push({ commandKey: 'REPLAN', title: 'Neu planen', fields: [], requiresPreview: false, expectedCaseRevision: revision });
      actions.push({ commandKey: 'CANCEL', title: 'Vorgang abbrechen', fields: [], requiresPreview: false, expectedCaseRevision: revision, destructive: true });
    }
    if (graph?.plan.status === 'AWAITING_APPROVAL' && this.can(viewer, PERMISSIONS.APPROVAL_DECIDE)) {
      actions.unshift(
        { commandKey: 'APPROVE_PLAN', title: 'Plan bestätigen', fields: [], requiresPreview: true, expectedCaseRevision: revision, payload: { planId: graph.plan.id } },
        { commandKey: 'REJECT_PLAN', title: 'Plan ablehnen', fields: [{ name: 'reason', label: 'Begründung', type: 'textarea', required: false }], requiresPreview: false, expectedCaseRevision: revision, payload: { planId: graph.plan.id }, destructive: true },
      );
    }
    return actions;
  }

  private nodeActions(viewer: Viewer, caseRow: Case, node: ProcessPlanNode, intents: ActionIntent[], drafts: CommunicationDraft[], isLatest: boolean): ActionDescriptor[] {
    if (!isLatest || TERMINAL_CASE.has(caseRow.orchestrationStatus) || caseRow.orchestrationStatus === 'PAUSED') return [];
    const revision = caseRow.revision;
    const def = node.definition as unknown as PlanNode;
    const actions: ActionDescriptor[] = [];
    const manage = this.can(viewer, PERMISSIONS.CASE_MANAGE);
    const decide = this.can(viewer, PERMISSIONS.APPROVAL_DECIDE);
    const intent = [...intents].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

    if (node.state === 'AWAITING_APPROVAL' && intent?.status === 'AWAITING_APPROVAL' && decide) {
      const label = intent.purpose === 'QUOTE_DELIVERY' ? 'Angebot freigeben & senden' : intent.purpose === 'CLARIFICATION' ? 'Rückfrage freigeben & senden' : 'Genehmigen & ausführen';
      actions.push(
        { commandKey: 'APPROVE_ACTION', title: label, fields: [], requiresPreview: true, expectedCaseRevision: revision, targetRef: node.nodeKey, payload: { intentId: intent.id } },
        { commandKey: 'REJECT_ACTION', title: 'Ablehnen', fields: [{ name: 'reason', label: 'Begründung', type: 'textarea', required: false }], requiresPreview: false, expectedCaseRevision: revision, targetRef: node.nodeKey, payload: { intentId: intent.id }, destructive: true, approvalId: intent.approvalId ?? undefined },
      );
    }
    if (node.state === 'OUTCOME_UNKNOWN' && intent?.status === 'OUTCOME_UNKNOWN' && decide) {
      actions.push(
        { commandKey: 'RECONCILE_ACTION', title: 'Wurde ausgeführt (nachgewiesen)', fields: [{ name: 'note', label: 'Nachweis / Notiz', type: 'textarea', required: false }], requiresPreview: false, expectedCaseRevision: revision, targetRef: node.nodeKey, payload: { intentId: intent.id, happened: true } },
        { commandKey: 'RECONCILE_ACTION', title: 'Wurde nicht ausgeführt', fields: [{ name: 'note', label: 'Nachweis / Notiz', type: 'textarea', required: false }], requiresPreview: false, expectedCaseRevision: revision, targetRef: node.nodeKey, payload: { intentId: intent.id, happened: false } },
      );
    }
    if ((node.state === 'FAILED' || node.state === 'BLOCKED') && manage && node.type !== 'COMPLETE') {
      actions.push({ commandKey: 'RETRY_STEP', title: 'Schritt wiederholen', fields: [], requiresPreview: false, expectedCaseRevision: revision, targetRef: node.nodeKey, payload: { stepRunId: node.nodeKey } });
    }
    if (node.state === 'WAITING' && def.type === 'MANUAL_TASK' && manage) {
      actions.push({ commandKey: 'COMPLETE_MANUAL_TASK', title: 'Als erledigt markieren', fields: [{ name: 'note', label: 'Notiz', type: 'textarea', required: false }], requiresPreview: false, expectedCaseRevision: revision, targetRef: node.nodeKey, payload: { nodeId: node.nodeKey } });
    }
    if (node.state === 'WAITING' && def.type === 'APPROVAL' && decide) {
      actions.push(
        { commandKey: 'COMPLETE_MANUAL_TASK', title: 'Genehmigen', fields: [], requiresPreview: false, expectedCaseRevision: revision, targetRef: node.nodeKey, payload: { nodeId: node.nodeKey, result: { decision: 'APPROVED' } } },
        { commandKey: 'COMPLETE_MANUAL_TASK', title: 'Ablehnen', fields: [], requiresPreview: false, expectedCaseRevision: revision, targetRef: node.nodeKey, payload: { nodeId: node.nodeKey, result: { decision: 'REJECTED' } }, destructive: true },
      );
    }
    // A draft can be edited while its message has not been sent.
    const draftId = (node.output as { draftId?: string } | null)?.draftId;
    const draft = draftId ? drafts.find((d) => d.id === draftId) : undefined;
    if (node.state === 'SUCCEEDED' && draft?.status === 'DRAFT' && manage) {
      actions.push({
        commandKey: 'EDIT_DRAFT',
        title: 'Entwurf bearbeiten',
        fields: [
          { name: 'subject', label: 'Betreff', type: 'text', required: false, initialValue: draft.subject },
          { name: 'bodyText', label: 'Text', type: 'textarea', required: false, initialValue: draft.bodyText },
        ],
        requiresPreview: false,
        expectedCaseRevision: revision,
        targetRef: node.nodeKey,
        payload: { draftId: draft.id },
      });
    }
    return actions;
  }

  /** Recipient, text, attachment and amount — everything a person must see before confirming (§17.2). */
  private async previewFor(tenantId: string, caseId: string, intent: ActionIntent | undefined, node: ProcessPlanNode, drafts: CommunicationDraft[]): Promise<ActionPreview | undefined> {
    const scoped = this.prisma.forTenantId(tenantId);
    const payloadInput = (intent?.payload as { input?: { draftId?: string } } | undefined)?.input;
    const draftId = payloadInput?.draftId ?? (node.output as { draftId?: string } | null)?.draftId;
    const draft = draftId ? drafts.find((d) => d.id === draftId) : undefined;
    if (draft) {
      const attachments = draft.attachmentDocumentIds.length > 0 ? await scoped.document.findMany({ where: { id: { in: draft.attachmentDocumentIds } }, select: { fileName: true, mimeType: true } }) : [];
      const quote = draft.attachmentDocumentIds.length > 0 ? await scoped.quote.findFirst({ where: { caseId, documentId: { in: draft.attachmentDocumentIds } } }) : null;
      return { kind: quote ? 'QUOTE' : 'COMMUNICATION', recipient: draft.toAddress, subject: draft.subject, bodyText: draft.bodyText, attachments, quote: quote ? this.quoteView(quote) : undefined, sourceNote: quote?.priceSource.startsWith('TEST_SOR') ? 'Preise stammen aus einem Testdatenbestand (nicht verbindlich).' : undefined };
    }
    const quoteId = (node.output as { quoteId?: string } | null)?.quoteId;
    if (quoteId) {
      const quote = await scoped.quote.findFirst({ where: { id: quoteId, caseId } });
      if (quote) return { kind: 'QUOTE', quote: this.quoteView(quote), sourceNote: quote.priceSource.startsWith('TEST_SOR') ? 'Preise stammen aus einem Testdatenbestand (nicht verbindlich).' : undefined };
    }
    return undefined;
  }

  private quoteView(quote: Quote): NonNullable<ActionPreview['quote']> {
    const lines = quote.lines as unknown as Array<{ name: string; sku: string; quantity: number; unit: string; unitPriceCents: number; netCents: number }>;
    return {
      number: quote.number,
      currency: quote.currency,
      netAmount: quote.netAmount.toString(),
      taxAmount: quote.taxAmount.toString(),
      grossAmount: quote.grossAmount.toString(),
      validUntil: quote.validUntil.toISOString(),
      priceSource: quote.priceSource,
      lines: lines.map((l) => ({ name: l.name, sku: l.sku, quantity: l.quantity, unit: l.unit, unitPrice: formatEuro(l.unitPriceCents), net: formatEuro(l.netCents) })),
    };
  }

  private async blueprintOf(tenantId: string, caseRow: Case): Promise<BlueprintDefinition | undefined> {
    if (!caseRow.blueprintKey || !caseRow.blueprintVersion) return undefined;
    const row = await this.prisma.forTenantId(tenantId).processBlueprint.findFirst({ where: { key: caseRow.blueprintKey, version: caseRow.blueprintVersion } });
    return row ? (row.definition as unknown as BlueprintDefinition) : undefined;
  }
}
