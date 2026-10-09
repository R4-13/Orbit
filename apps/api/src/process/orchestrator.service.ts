import { Inject, Injectable, Logger } from '@nestjs/common';
import { classifyThrownToolError, decidePolicyAction, normalizeToolOutput, type ToolRegistry } from '@orbit/agent-core';
import type { Case, CaseFact, Prisma, ProcessPlanNode } from '@orbit/domain';
import {
  NotFoundError,
  bindInputs,
  effectiveLimits,
  evaluateCompletion,
  nextActions,
  type BlueprintDefinition,
  type EvalContext,
  type ExecutionMode,
  type PlanNode,
  type RequirementState,
  type RuntimeEdge,
  type RuntimeNode,
} from '@orbit/shared';
import { randomUUID } from 'node:crypto';
import { TOOL_REGISTRY } from '../agent/agent.tokens';
import { ApprovalsService } from '../approvals/approvals.service';
import { AuditService } from '../audit/audit.service';
import { PolicyEnforcementService } from '../policy/policy-enforcement.service';
import { PrismaService } from '../prisma/prisma.service';
import { ActionLedgerService, ActionLimitReachedError } from './action-ledger.service';
import { BlueprintRegistryService } from './blueprint-registry.service';
import { CapabilityRegistryService } from './capability-registry.service';
import { CASE_EVENT_TYPES, CaseEventsService } from './case-events.service';
import { CaseFactsService } from './case-facts.service';
import { CaseLifecycleService } from './case-lifecycle.service';
import { PlannerService } from './planner.service';
import { PlanStoreService, type PlanGraph } from './plan-store.service';
import { LiveReconciliationService } from './live-reconciliation.service';

const LEASE_MS = 60_000;
const MAX_ITERATIONS = 60;
const DEFAULT_WAIT_HOURS = 72;
const TERMINAL_CASE_STATUSES = new Set(['COMPLETED', 'REJECTED', 'CANCELLED', 'FAILED']);

export interface AdvanceResult {
  status: 'IDLE' | 'TERMINAL' | 'PAUSED' | 'LEASED_ELSEWHERE';
  executed: string[];
}

export interface StartCaseOptions {
  userId?: string;
  /** Start exactly this blueprint (must be active for the tenant). */
  blueprintKey?: string;
  /** Otherwise: the active blueprint that declares this intent key. */
  intentKey?: string;
  intentSummary?: string;
}

export interface StartCaseResult {
  outcome: 'RUNNING' | 'AWAITING_PLAN_APPROVAL' | 'MANUAL_REVIEW';
  planId?: string;
  blueprint?: { key: string; version: string };
  reasons: string[];
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function safeMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 300);
}

/**
 * Amendment 02 §12 — the durable, generic orchestrator. It knows only node
 * *types* and the capability catalogue; everything process-specific (steps,
 * conditions, texts, rules) is data in a blueprint or plan. Safety rules it
 * enforces for every process, independent of what a plan says:
 *
 *  - one worker per case (lease) and compare-and-set node transitions,
 *  - policy and executability re-checked immediately before each node (§12.3),
 *  - every external effect goes through the action ledger: persisted first,
 *    dispatch claimed exactly once, provider receipt required, an unknown
 *    outcome is never retried blindly (§15),
 *  - approvals are bound to an immutable payload and void when the plan changes,
 *  - a case completes only when the blueprint's completion criteria hold (§20.6).
 */
@Injectable()
export class OrchestratorService {
  private readonly logger = new Logger(OrchestratorService.name);
  private readonly owner = `orchestrator-${process.pid}-${randomUUID().slice(0, 8)}`;

  constructor(
    private readonly prisma: PrismaService,
    private readonly store: PlanStoreService,
    private readonly events: CaseEventsService,
    private readonly ledger: ActionLedgerService,
    private readonly facts: CaseFactsService,
    private readonly lifecycle: CaseLifecycleService,
    private readonly capabilities: CapabilityRegistryService,
    private readonly blueprints: BlueprintRegistryService,
    private readonly planner: PlannerService,
    private readonly policy: PolicyEnforcementService,
    private readonly approvals: ApprovalsService,
    private readonly audit: AuditService,
    private readonly live: LiveReconciliationService,
    @Inject(TOOL_REGISTRY) private readonly tools: ToolRegistry,
  ) {}

  // ── Starting a case ─────────────────────────────────────────────────────────

  async startCase(tenantId: string, caseId: string, options: StartCaseOptions = {}): Promise<StartCaseResult> {
    const active = options.blueprintKey ? await this.blueprints.getActive(tenantId, options.blueprintKey) : options.intentKey ? await this.blueprints.findActiveForIntent(tenantId, options.intentKey) : null;
    if (options.blueprintKey && !active) {
      await this.lifecycle.transition(tenantId, caseId, { to: 'MANUAL_REVIEW', attentionReasons: [`Der Prozess ${options.blueprintKey} ist für diesen Mandanten nicht aktiviert.`] });
      return { outcome: 'MANUAL_REVIEW', reasons: [`Der Prozess ${options.blueprintKey} ist nicht aktiviert.`] };
    }
    if (active) {
      await this.lifecycle.setGoals(tenantId, caseId, { businessGoals: active.definition.goals, currentIntent: options.intentKey, blueprint: { key: active.row.key, version: active.row.version } });
    }
    const blueprint = active ? { definition: active.definition, key: active.row.key, version: active.row.version } : undefined;
    return this.planAndActivate(tenantId, caseId, { trigger: 'INITIAL', userId: options.userId, blueprint, intentSummary: options.intentSummary });
  }

  private async planAndActivate(tenantId: string, caseId: string, request: Parameters<PlannerService['plan']>[2]): Promise<StartCaseResult> {
    const outcome = await this.planner.plan(tenantId, caseId, request);
    const blueprintRef = request.blueprint ? { key: request.blueprint.key, version: request.blueprint.version } : undefined;
    if (outcome.status === 'REVIEW_REQUIRED') {
      const reasons = [outcome.reason, ...(outcome.validation?.issues.filter((i) => i.severity === 'ERROR').slice(0, 3).map((i) => i.message) ?? [])];
      await this.lifecycle.transition(tenantId, caseId, { to: 'MANUAL_REVIEW', attentionReasons: reasons });
      return { outcome: 'MANUAL_REVIEW', blueprint: blueprintRef, reasons };
    }
    if (outcome.needsHumanApproval) {
      await this.lifecycle.transition(tenantId, caseId, { to: 'WAITING_FOR_APPROVAL', attentionReasons: ['Ein Ad-hoc-Plan wartet auf Ihre Bestätigung, bevor etwas ausgeführt wird.'] });
      return { outcome: 'AWAITING_PLAN_APPROVAL', planId: outcome.graph.plan.id, blueprint: blueprintRef, reasons: [] };
    }
    await this.activatePlan(tenantId, caseId, outcome.graph.plan.id, request.userId);
    return { outcome: 'RUNNING', planId: outcome.graph.plan.id, blueprint: blueprintRef, reasons: [] };
  }

  /** Activates a validated plan: replaced work is cancelled (open approvals void, nothing already confirmed is touched). */
  private async activatePlan(tenantId: string, caseId: string, planId: string, userId?: string): Promise<void> {
    const before = await this.store.getActive(tenantId, caseId);
    await this.store.activate(tenantId, planId);
    if (before && before.plan.id !== planId) await this.voidOpenApprovals(tenantId, caseId, 'Der Plan wurde geändert; die Freigabe gilt nicht mehr.');
    await this.lifecycle.transition(tenantId, caseId, { to: 'IN_PROGRESS' }, { type: userId ? 'USER' : 'SYSTEM', userId });
    await this.audit.record({ tenantId, eventType: 'PROCESS_PLAN_ACTIVATED', actorType: userId ? 'USER' : 'SYSTEM', actorUserId: userId, entityType: 'ProcessPlan', entityId: planId, payload: { caseId } });
  }

  private async voidOpenApprovals(tenantId: string, caseId: string, _reason: string): Promise<void> {
    const open = await this.ledger.openIntents(tenantId, caseId);
    for (const intent of open.filter((i) => i.status === 'AWAITING_APPROVAL' || i.status === 'PREPARED' || i.status === 'APPROVED')) {
      await this.prisma.forTenantId(tenantId).actionIntent.updateMany({ where: { id: intent.id, status: { in: ['PREPARED', 'AWAITING_APPROVAL', 'APPROVED'] } }, data: { status: 'CANCELLED', errorCode: 'PLAN_CHANGED' } });
      await this.approvals.markDecided(tenantId, 'PROCESS_ACTION', intent.id, 'system', 'REJECTED').catch(() => undefined);
    }
  }

  // ── The advance loop ────────────────────────────────────────────────────────

  async advance(tenantId: string, caseId: string): Promise<AdvanceResult> {
    if (!(await this.acquireLease(tenantId, caseId))) return { status: 'LEASED_ELSEWHERE', executed: [] };
    const executed: string[] = [];
    try {
      for (let i = 0; i < MAX_ITERATIONS; i += 1) {
        const caseRow = await this.loadCase(tenantId, caseId);
        if (TERMINAL_CASE_STATUSES.has(caseRow.orchestrationStatus)) {
          // A finished case does not wake up: a late event is consumed (so nothing re-triggers it forever) and stays in the log.
          for (let event = await this.events.nextInbound(tenantId, caseId); event; event = await this.events.nextInbound(tenantId, caseId)) {
            await this.events.markProcessed(tenantId, event.id);
          }
          return { status: 'TERMINAL', executed };
        }
        if (caseRow.orchestrationStatus === 'PAUSED') return { status: 'PAUSED', executed };
        await this.renewLease(tenantId, caseId);

        const inbound = await this.events.nextInbound(tenantId, caseId);
        if (inbound) {
          await this.consumeInbound(tenantId, caseRow, inbound);
          continue;
        }
        if (await this.expireWaits(tenantId, caseRow)) continue;

        const graph = await this.store.getActive(tenantId, caseId);
        if (!graph) return { status: 'IDLE', executed };

        if (await this.resumeDecidedApprovals(tenantId, caseRow, graph, executed)) continue;

        const ctx = await this.buildEvalContext(tenantId, caseRow, graph);
        const allActions = nextActions(this.runtimeNodes(graph), this.runtimeEdges(graph), ctx);
        // Eine Wiederholung hat eine Wartezeit (Backoff): ein Schritt vor seinem `retryAt` wird nicht erneut versucht, sonst wären alle Versuche in
        // Sekunden verbraucht. Der Sweep nimmt den Fall nach Ablauf der Wartezeit wieder auf.
        const now = Date.now();
        const retryAtOf = (nodeKey: string) => graph.nodes.find((n) => n.nodeKey === nodeKey)?.retryAt?.getTime() ?? 0;
        const actions = allActions.filter((a) => a.action !== 'EXECUTE' || retryAtOf(a.nodeKey) <= now);
        if (actions.length === 0 && allActions.length > 0) {
          await this.lifecycle.transition(tenantId, caseId, { to: 'WAITING_FOR_EXTERNAL_SYSTEM', attentionReasons: ['Ein Schritt wird nach kurzer Wartezeit automatisch wiederholt.'] });
          return { status: 'IDLE', executed };
        }
        if (actions.length === 0) {
          await this.settle(tenantId, caseRow, graph);
          return { status: 'IDLE', executed };
        }
        for (const action of actions) {
          const node = graph.nodes.find((n) => n.nodeKey === action.nodeKey);
          if (!node) continue;
          if (action.action === 'SKIP') {
            await this.store.transitionNode(tenantId, caseId, graph.plan.id, node.nodeKey, 'PLANNED', { state: 'SKIPPED', completedAt: new Date(), errorMessage: action.reason });
          } else if (action.action === 'BLOCK') {
            await this.store.transitionNode(tenantId, caseId, graph.plan.id, node.nodeKey, 'PLANNED', { state: 'BLOCKED', errorCode: 'EXPRESSION_INVALID', errorMessage: action.reason });
          } else {
            await this.ensureInProgress(tenantId, caseId);
            await this.executeNode(tenantId, await this.loadCase(tenantId, caseId), graph, node, ctx);
            executed.push(node.nodeKey);
          }
          const fresh = await this.loadCase(tenantId, caseId);
          if (TERMINAL_CASE_STATUSES.has(fresh.orchestrationStatus) || fresh.orchestrationStatus === 'PAUSED') break;
        }
      }
      await this.lifecycle.transition(tenantId, caseId, { to: 'MANUAL_REVIEW', attentionReasons: ['Die Bearbeitung hat das Schrittlimit eines Durchlaufs erreicht und wurde zur Prüfung angehalten.'] });
      return { status: 'IDLE', executed };
    } finally {
      await this.releaseLease(tenantId, caseId);
    }
  }

  private async ensureInProgress(tenantId: string, caseId: string): Promise<void> {
    const row = await this.loadCase(tenantId, caseId);
    if (row.orchestrationStatus !== 'IN_PROGRESS' && !TERMINAL_CASE_STATUSES.has(row.orchestrationStatus) && row.orchestrationStatus !== 'PAUSED') {
      await this.lifecycle.transition(tenantId, caseId, { to: 'IN_PROGRESS' });
    }
  }

  // ── Node execution ──────────────────────────────────────────────────────────

  private async executeNode(tenantId: string, caseRow: Case, graph: PlanGraph, node: ProcessPlanNode, ctx: EvalContext): Promise<void> {
    const def = node.definition as unknown as PlanNode;
    const claimed = await this.store.transitionNode(tenantId, caseRow.id, graph.plan.id, node.nodeKey, ['PLANNED', 'READY'], { state: 'RUNNING', startedAt: new Date(), attempts: node.attempts + 1 });
    if (!claimed) return;
    const fresh: ProcessPlanNode = { ...node, attempts: node.attempts + 1 };
    try {
      switch (def.type) {
        case 'INTERPRET':
        case 'DECISION':
        case 'REASSESS':
          await this.succeed(tenantId, caseRow.id, graph, node, { marker: def.type }, 'LIVE');
          return;
        case 'WAIT_EVENT':
          await this.startWait(tenantId, caseRow, graph, fresh, def);
          return;
        case 'MANUAL_TASK':
        case 'APPROVAL':
          await this.startManual(tenantId, caseRow, graph, fresh, def);
          return;
        case 'COMPLETE':
          await this.completeCase(tenantId, caseRow, graph, fresh, ctx);
          return;
        default:
          if (def.type === 'EVALUATE_REQUIREMENTS' && !def.capability) {
            await this.evaluateRequirements(tenantId, caseRow, graph, fresh);
            return;
          }
          if (!def.capability) {
            await this.succeed(tenantId, caseRow.id, graph, node, { marker: def.type }, 'LIVE');
            return;
          }
          await this.runCapability(tenantId, caseRow, graph, fresh, def, ctx);
      }
    } catch (error) {
      this.logger.error(`node ${node.nodeKey} of case ${caseRow.id} failed unexpectedly: ${safeMessage(error)}`);
      await this.failNode(tenantId, caseRow, graph, fresh, def, 'ORCHESTRATOR_ERROR', 'Ein interner Fehler hat den Schritt unterbrochen.');
    }
  }

  private async succeed(tenantId: string, caseId: string, graph: PlanGraph, node: ProcessPlanNode, output: unknown, mode: ExecutionMode): Promise<void> {
    await this.store.transitionNode(tenantId, caseId, graph.plan.id, node.nodeKey, ['RUNNING'], { state: 'SUCCEEDED', output: asJson(output), executionMode: mode, completedAt: new Date() });
  }

  /** Marks a node failed and moves the case according to the node's declared failure policy (§12.5). */
  private async failNode(tenantId: string, caseRow: Case, graph: PlanGraph, node: ProcessPlanNode, def: PlanNode, errorCode: string, message: string, from: ProcessPlanNode['state'][] = ['RUNNING']): Promise<void> {
    if (def.optional && def.onFailure === 'SKIP') {
      await this.store.transitionNode(tenantId, caseRow.id, graph.plan.id, node.nodeKey, from, { state: 'SKIPPED', errorCode, errorMessage: message, completedAt: new Date() });
      return;
    }
    await this.store.transitionNode(tenantId, caseRow.id, graph.plan.id, node.nodeKey, from, { state: 'FAILED', errorCode, errorMessage: message, completedAt: new Date() });
    await this.lifecycle.transition(tenantId, caseRow.id, { to: def.onFailure === 'FAIL' ? 'FAILED' : 'MANUAL_REVIEW', attentionReasons: [`${def.title}: ${message}`] });
  }

  private async blockNode(tenantId: string, caseRow: Case, graph: PlanGraph, node: ProcessPlanNode, def: PlanNode, errorCode: string, message: string, caseStatus: 'MANUAL_REVIEW' | 'WAITING_FOR_EXTERNAL_SYSTEM' | 'WAITING_FOR_INFORMATION'): Promise<void> {
    await this.store.transitionNode(tenantId, caseRow.id, graph.plan.id, node.nodeKey, ['RUNNING'], { state: 'BLOCKED', errorCode, errorMessage: message });
    await this.lifecycle.transition(tenantId, caseRow.id, { to: caseStatus, attentionReasons: [`${def.title}: ${message}`] });
  }

  private async runCapability(tenantId: string, caseRow: Case, graph: PlanGraph, node: ProcessPlanNode, def: PlanNode, ctx: EvalContext): Promise<void> {
    const capability = this.capabilities.get(def.capability?.key ?? '');
    if (!capability) return this.failNode(tenantId, caseRow, graph, node, def, 'CAPABILITY_UNKNOWN', 'Die Fähigkeit existiert nicht.');

    // Right before execution (§12.3): is it still executable for this tenant?
    const executability = (await this.capabilities.executabilityFor(tenantId)).get(capability.key);
    if (!executability?.executable) {
      return this.blockNode(tenantId, caseRow, graph, node, def, 'CAPABILITY_NOT_EXECUTABLE', executability?.reasons.join(' ') || 'Nicht ausführbar.', 'WAITING_FOR_EXTERNAL_SYSTEM');
    }
    const tool = this.capabilities.toolFor(capability);
    if (!tool) return this.failNode(tenantId, caseRow, graph, node, def, 'TOOL_MISSING', 'Die Umsetzung der Fähigkeit fehlt.');

    const bound = bindInputs(def, ctx);
    if (bound.missing.length > 0) {
      return this.blockNode(tenantId, caseRow, graph, node, def, 'MISSING_INPUT', `Es fehlen Angaben: ${bound.missing.join(', ')}.`, 'WAITING_FOR_INFORMATION');
    }

    const purpose = typeof def.config.purpose === 'string' ? def.config.purpose : undefined;
    const policyAction = this.capabilities.policyActionFor(capability, purpose);
    const decision = decidePolicyAction(await this.policy.resolveMode(tenantId, policyAction as never));
    if (decision === 'DENY') return this.blockNode(tenantId, caseRow, graph, node, def, 'POLICY_DENIED', 'Die Policy verbietet diese Aktion.', 'MANUAL_REVIEW');
    if (decision === 'SUGGEST_ONLY') return this.blockNode(tenantId, caseRow, graph, node, def, 'POLICY_SUGGEST_ONLY', 'Die Policy erlaubt hier nur einen Vorschlag; bitte manuell ausführen.', 'MANUAL_REVIEW');

    const needsLedger = capability.sideEffect !== 'NONE' || decision === 'REQUIRE_APPROVAL';
    const input = { ...bound.values, ...(purpose ? { purpose } : {}) };
    let intentId: string | undefined;

    if (needsLedger) {
      let prepared: Awaited<ReturnType<ActionLedgerService['prepare']>>;
      try {
        prepared = await this.ledger.prepare(
          tenantId,
          {
            caseId: caseRow.id,
            planId: graph.plan.id,
            planRevision: graph.plan.revision,
            caseRevision: caseRow.revision,
            nodeKey: node.nodeKey,
            capabilityKey: capability.key,
            purpose,
            payload: { capability: capability.key, purpose: purpose ?? null, input: bound.values },
          },
          effectiveLimits((await this.blueprintFor(tenantId, caseRow))?.limits),
        );
      } catch (error) {
        if (error instanceof ActionLimitReachedError) return this.blockNode(tenantId, caseRow, graph, node, def, error.code, error.message, 'MANUAL_REVIEW');
        throw error;
      }
      let { intent } = prepared;
      intentId = intent.id;
      // Eine live wiederholte, bereits von einer Person freigegebene Nachricht (gleicher Inhalt) braucht keine zweite Freigabe.
      if (prepared.created && decision === 'REQUIRE_APPROVAL' && (await this.ledger.carryOverApproval(tenantId, intent))) intent = await this.ledger.get(tenantId, intent.id);

      if (intent.status === 'CONFIRMED') {
        // Already done (e.g. replan, lease takeover, duplicate delivery): reuse the receipt, never execute again.
        const receipt = (await this.ledger.receipts(tenantId, intent.id)).find((r) => r.status === 'CONFIRMED');
        const evidence = (receipt?.evidence ?? {}) as Record<string, unknown>;
        return this.succeed(tenantId, caseRow.id, graph, node, { ...(evidence.output as object | undefined), reusedReceipt: true, providerRef: receipt?.providerRef ?? null }, (receipt?.executionMode as ExecutionMode) ?? 'LIVE');
      }
      if (intent.status === 'DISPATCHING' || intent.status === 'OUTCOME_UNKNOWN') {
        await this.store.transitionNode(tenantId, caseRow.id, graph.plan.id, node.nodeKey, ['RUNNING'], { state: 'OUTCOME_UNKNOWN', errorCode: intent.errorCode ?? 'OUTCOME_UNKNOWN', errorMessage: 'Das Ergebnis einer früheren Ausführung ist ungewiss; bitte zuerst abgleichen.' });
        await this.lifecycle.transition(tenantId, caseRow.id, { to: 'MANUAL_REVIEW', attentionReasons: [`${def.title}: Ergebnis ungewiss – Abgleich nötig.`] });
        return;
      }
      if (intent.status === 'CANCELLED') return this.failNode(tenantId, caseRow, graph, node, def, 'ACTION_REJECTED', 'Die Aktion wurde nicht freigegeben.');
      if (intent.status === 'FAILED') return this.failNode(tenantId, caseRow, graph, node, def, intent.errorCode ?? 'ACTION_FAILED', 'Die Aktion ist zuvor fehlgeschlagen.');

      if (decision === 'REQUIRE_APPROVAL' && intent.status !== 'APPROVED') {
        if (!intent.approvalId) {
          const approval = await this.approvals.create(tenantId, {
            entityType: 'PROCESS_ACTION',
            entityId: intent.id,
            policyAction,
            reason: `${def.title} (${capability.key}${purpose ? `, ${purpose}` : ''}) wartet auf Freigabe.`,
          });
          await this.ledger.awaitApproval(tenantId, intent.id, approval.id);
        }
        await this.store.transitionNode(tenantId, caseRow.id, graph.plan.id, node.nodeKey, ['RUNNING'], { state: 'AWAITING_APPROVAL' });
        await this.lifecycle.transition(tenantId, caseRow.id, { to: 'WAITING_FOR_APPROVAL', attentionReasons: [`${def.title}: Freigabe erforderlich.`] });
        return;
      }
      if (!(await this.ledger.beginDispatch(tenantId, intent.id))) return; // someone else owns the dispatch
    }

    await this.dispatchTool(tenantId, caseRow, graph, node, def, capability, tool.name, input, intentId);
  }

  private async dispatchTool(
    tenantId: string,
    caseRow: Case,
    graph: PlanGraph,
    node: ProcessPlanNode,
    def: PlanNode,
    capability: NonNullable<ReturnType<CapabilityRegistryService['get']>>,
    toolName: string,
    input: Record<string, unknown>,
    intentId: string | undefined,
  ): Promise<void> {
    const run = await this.prisma.forTenantId(tenantId).agentRun.create({
      data: { tenantId, caseId: caseRow.id, agentType: 'ORCHESTRATOR', triggerType: 'MANUAL', status: 'RUNNING', input: asJson({ nodeKey: node.nodeKey, capability: capability.key, planId: graph.plan.id }) },
    });

    let output: unknown;
    let contract: ReturnType<typeof normalizeToolOutput>;
    try {
      output = await this.tools.execute(toolName, input, { tenantId, agentRunId: run.id });
      contract = normalizeToolOutput(output);
    } catch (error) {
      contract = classifyThrownToolError(error);
      output = { error: contract.message };
    }

    const record = output as Record<string, unknown> | undefined;
    const reportedMode = record && typeof record === 'object' && (record.executionMode === 'SIMULATED' || record.executionMode === 'LIVE') ? (record.executionMode as ExecutionMode) : 'LIVE';
    const providerRef = record && typeof record === 'object' && typeof record.providerRef === 'string' ? record.providerRef : undefined;

    // §12.5/§15: a real external write without a provider receipt is not a confirmed success.
    if (contract.status === 'SUCCEEDED' && capability.sideEffect === 'EXTERNAL_WRITE' && capability.confirmationStrategy === 'PROVIDER_RECEIPT' && !providerRef) {
      contract = { status: 'OUTCOME_UNKNOWN', errorCode: 'MISSING_PROVIDER_RECEIPT', message: 'Der Anbieter hat den Versand nicht bestätigt.', retryable: false };
    }

    await this.prisma.forTenantId(tenantId).toolInvocation.create({
      data: {
        tenantId,
        agentRunId: run.id,
        toolCallId: `orch-${randomUUID()}`,
        toolName,
        policyAction: this.tools.get(toolName)?.policyAction,
        input: asJson(input),
        status: contract.status === 'SUCCEEDED' ? 'SUCCESS' : contract.status === 'OUTCOME_UNKNOWN' ? 'OUTCOME_UNKNOWN' : 'FAILED',
        output: asJson({ output, result: contract }),
      },
    });
    await this.prisma.forTenantId(tenantId).agentRun.update({ where: { id: run.id }, data: { status: contract.status === 'FAILED' ? 'FAILED' : 'COMPLETED', completedAt: new Date(), output: asJson({ result: contract }) } });

    if (contract.status === 'SUCCEEDED') {
      if (intentId) await this.ledger.confirm(tenantId, intentId, { providerRef, executionMode: reportedMode, evidence: { output: asJson(output), nodeKey: node.nodeKey } });
      await this.recordOutputFacts(tenantId, caseRow.id, record);
      await this.store.transitionNode(tenantId, caseRow.id, graph.plan.id, node.nodeKey, ['RUNNING'], { state: 'SUCCEEDED', output: asJson(output), executionMode: reportedMode, agentRunId: run.id, completedAt: new Date() });
      return;
    }
    if (contract.status === 'OUTCOME_UNKNOWN') {
      if (intentId) await this.ledger.markUnknown(tenantId, intentId, contract.errorCode ?? 'OUTCOME_UNKNOWN', { message: contract.message });
      await this.store.transitionNode(tenantId, caseRow.id, graph.plan.id, node.nodeKey, ['RUNNING'], { state: 'OUTCOME_UNKNOWN', errorCode: contract.errorCode, errorMessage: contract.message, agentRunId: run.id });
      await this.lifecycle.transition(tenantId, caseRow.id, { to: 'MANUAL_REVIEW', attentionReasons: [`${def.title}: Das Ergebnis ist ungewiss – bitte abgleichen, bevor etwas erneut ausgeführt wird.`] });
      return;
    }
    // FAILED
    if (intentId) await this.ledger.fail(tenantId, intentId, contract.errorCode ?? 'TOOL_FAILED', { message: contract.message });
    const maxAttempts = def.retry?.maxAttempts ?? 1;
    if (contract.retryable && node.attempts < maxAttempts) {
      if (intentId) await this.prisma.forTenantId(tenantId).actionIntent.updateMany({ where: { id: intentId, status: 'FAILED' }, data: { status: 'PREPARED', errorCode: null } });
      await this.store.transitionNode(tenantId, caseRow.id, graph.plan.id, node.nodeKey, ['RUNNING'], { state: 'PLANNED', errorCode: contract.errorCode, errorMessage: contract.message, retryAt: new Date(Date.now() + 30_000 * node.attempts), agentRunId: run.id });
      return;
    }
    await this.store.transitionNode(tenantId, caseRow.id, graph.plan.id, node.nodeKey, ['RUNNING'], { agentRunId: run.id, state: 'RUNNING' }).catch(() => undefined);
    await this.failNode(tenantId, caseRow, graph, node, def, contract.errorCode ?? 'TOOL_FAILED', contract.message ?? 'Der Schritt ist fehlgeschlagen.');
  }

  /** A tool may report facts it established (with provenance); they enter the case through the normal fact path. */
  private async recordOutputFacts(tenantId: string, caseId: string, output: Record<string, unknown> | undefined): Promise<void> {
    const list = output && Array.isArray(output.facts) ? (output.facts as unknown[]) : [];
    const valid = list.filter((f): f is { key: string; value: unknown; sourceType: 'EMAIL' | 'ATTACHMENT' | 'SYSTEM_OF_RECORD' | 'CONFIGURATION' | 'HUMAN'; sourceRef?: string; confidence?: number } => {
      const r = f as Record<string, unknown>;
      return typeof r?.key === 'string' && r.value !== undefined && typeof r.sourceType === 'string';
    });
    if (valid.length === 0) return;
    const created = await this.facts.propose(tenantId, caseId, valid.map((f) => ({ key: f.key, value: f.value as never, sourceType: f.sourceType, sourceRef: f.sourceRef, confidence: f.confidence })));
    for (const fact of created) {
      if (fact.status === "CANDIDATE" && (fact.sourceType === "SYSTEM_OF_RECORD" || fact.sourceType === "CONFIGURATION")) await this.facts.confirmFromTrustedSource(tenantId, fact.id);
    }
  }

  // ── Built-in node types ─────────────────────────────────────────────────────

  /** Generic requirement evaluation from the blueprint's declared `requiredFacts` (no process knowledge in the engine). */
  private async evaluateRequirements(tenantId: string, caseRow: Case, graph: PlanGraph, node: ProcessPlanNode): Promise<void> {
    const blueprint = await this.blueprintFor(tenantId, caseRow);
    const current = await this.facts.getCurrent(tenantId, caseRow.id);
    const requirements = this.requirementStates(blueprint, current);
    const missing = Object.entries(requirements).filter(([, state]) => state !== 'SATISFIED').map(([key]) => key);
    await this.succeed(tenantId, caseRow.id, graph, node, { requirements, missing }, 'LIVE');
  }

  private requirementStates(blueprint: BlueprintDefinition | undefined, current: CaseFact[]): Record<string, RequirementState> {
    const result: Record<string, RequirementState> = {};
    for (const required of blueprint?.requiredFacts ?? []) {
      const forKey = current.filter((f) => f.key === required.key);
      if (forKey.some((f) => f.status === 'CONFLICTED')) result[required.key] = 'CONFLICTED';
      else if (forKey.some((f) => f.status === 'CONFIRMED')) result[required.key] = 'SATISFIED';
      else if (forKey.some((f) => f.status === 'CANDIDATE')) result[required.key] = 'INVALID';
      else result[required.key] = 'MISSING';
    }
    return result;
  }

  private async startWait(tenantId: string, caseRow: Case, graph: PlanGraph, node: ProcessPlanNode, def: PlanNode): Promise<void> {
    const eventType = typeof def.config.eventType === 'string' ? def.config.eventType : 'communication.received';
    const hours = def.timeout?.hours ?? DEFAULT_WAIT_HOURS;
    const receipts = await this.ledger.confirmedEffects(tenantId, caseRow.id);
    const correlation = { caseId: caseRow.id, awaitedAfter: receipts.map((r) => r.providerRef).filter(Boolean) };
    await this.prisma.inTenantTransaction(tenantId, async (tx) => {
      await tx.waitSubscription.create({ data: { tenantId, caseId: caseRow.id, planId: graph.plan.id, nodeKey: node.nodeKey, eventType, correlation: asJson(correlation), deadlineAt: new Date(Date.now() + hours * 3_600_000) } });
      await this.events.appendInTx(tx, tenantId, caseRow.id, { type: CASE_EVENT_TYPES.WAIT_STARTED, payload: { nodeKey: node.nodeKey, eventType, deadlineHours: hours } });
    });
    await this.store.transitionNode(tenantId, caseRow.id, graph.plan.id, node.nodeKey, ['RUNNING'], { state: 'WAITING' });
    await this.lifecycle.transition(tenantId, caseRow.id, { to: 'WAITING_FOR_INFORMATION', attentionReasons: [`${def.title}: Wartet auf eine Antwort.`] });
  }

  private async startManual(tenantId: string, caseRow: Case, graph: PlanGraph, node: ProcessPlanNode, def: PlanNode): Promise<void> {
    await this.prisma.forTenantId(tenantId).task.create({
      data: { tenantId, caseId: caseRow.id, title: def.title, description: def.purpose ?? 'Manueller Schritt im Prozess.', source: 'AGENT' },
    });
    await this.store.transitionNode(tenantId, caseRow.id, graph.plan.id, node.nodeKey, ['RUNNING'], { state: 'WAITING' });
    await this.lifecycle.transition(tenantId, caseRow.id, { to: 'MANUAL_REVIEW', attentionReasons: [`${def.title}: Bitte manuell bearbeiten.`] });
  }

  private async completeCase(tenantId: string, caseRow: Case, graph: PlanGraph, node: ProcessPlanNode, ctx: EvalContext): Promise<void> {
    // Ein Vorgang wird nicht mit einem simulierten Schritt abgeschlossen, solange der echte Weg offen ist: erst wird live wiederholt.
    if ((await this.live.reconcile(tenantId, caseRow.id, { runningCompleteKey: node.nodeKey })).redone.length > 0) return;
    const blueprint = await this.blueprintFor(tenantId, caseRow);
    const evidence = (await this.ledger.confirmedEffects(tenantId, caseRow.id)).map((e) => `${e.capabilityKey}${e.purpose ? `/${e.purpose}` : ''}${e.providerRef ? `:${e.providerRef}` : ''}`);
    let met: boolean;
    if (blueprint) {
      // BP-40: deterministische Bewertung je Ziel; der Schnappschuss wird festgehalten, ob erfüllt oder nicht.
      const evaluation = evaluateCompletion({ goals: blueprint.goals, completionCriteria: blueprint.completionCriteria, goalCriteria: blueprint.goalCriteria }, ctx, evidence);
      met = evaluation.met;
      await this.events.append(tenantId, caseRow.id, { type: CASE_EVENT_TYPES.COMPLETION_EVALUATED, payload: { met: evaluation.met, criteriaMet: evaluation.criteriaMet, goals: evaluation.goals, evidenceRefs: evaluation.evidenceRefs } });
      if (evaluation.criteriaMet === null) this.logger.warn(`completion criteria of case ${caseRow.id} not evaluable`);
    } else {
      met = graph.nodes.every((n) => n.nodeKey === node.nodeKey || ['SUCCEEDED', 'SKIPPED', 'SUPERSEDED'].includes(n.state));
    }
    if (!met) {
      await this.store.transitionNode(tenantId, caseRow.id, graph.plan.id, node.nodeKey, ['RUNNING'], { state: 'BLOCKED', errorCode: 'COMPLETION_CRITERIA_NOT_MET', errorMessage: 'Die Abschlusskriterien sind nicht erfüllt.' });
      await this.lifecycle.transition(tenantId, caseRow.id, { to: 'MANUAL_REVIEW', attentionReasons: ['Der Ablauf ist durchgelaufen, aber die Abschlusskriterien sind nicht nachweislich erfüllt.'] });
      return;
    }
    await this.succeed(tenantId, caseRow.id, graph, node, { criteriaMet: true }, 'LIVE');
    await this.lifecycle.transition(tenantId, caseRow.id, { to: 'COMPLETED', outcome: { code: blueprint ? 'COMPLETION_CRITERIA_MET' : 'PLAN_EXECUTED', evidenceRefs: evidence } });
  }

  // ── Waiting, events, approvals ──────────────────────────────────────────────

  /** Accepts an inbound event (e.g. a correlated reply). Idempotent by `dedupeKey`; processing happens in `advance`. */
  async receiveInbound(tenantId: string, caseId: string, input: { type: string; payload: Record<string, unknown>; dedupeKey: string }): Promise<{ accepted: boolean; duplicate: boolean }> {
    const { duplicate } = await this.events.append(tenantId, caseId, { type: input.type, payload: input.payload, inbound: true, dedupeKey: input.dedupeKey });
    return { accepted: !duplicate, duplicate };
  }

  private async consumeInbound(tenantId: string, caseRow: Case, event: { id: string; type: string; payload: unknown }): Promise<void> {
    if (!(await this.events.markProcessed(tenantId, event.id))) return;
    if (event.type !== CASE_EVENT_TYPES.COMMUNICATION_RECEIVED) return;

    // Maßgeblich ist nur die Erwartung des aktiven Plans; Erwartungen eines abgelösten Plans werden mit ihm beendet und nie als Empfänger gewählt.
    const activePlan = await this.store.getActive(tenantId, caseRow.id);
    const subscription = await this.prisma.forTenantId(tenantId).waitSubscription.findFirst({ where: { caseId: caseRow.id, status: 'WAITING', eventType: 'communication.received', ...(activePlan ? { planId: activePlan.plan.id } : {}) }, orderBy: { createdAt: 'asc' } });
    if (!subscription || !subscription.planId || !subscription.nodeKey) {
      if (!TERMINAL_CASE_STATUSES.has(caseRow.orchestrationStatus)) {
        await this.lifecycle.transition(tenantId, caseRow.id, { to: caseRow.orchestrationStatus === 'RECEIVED' ? 'RECEIVED' : 'MANUAL_REVIEW', attentionReasons: [...caseRow.attentionReasons, 'Eine neue Nachricht ist eingegangen, auf die kein Schritt wartet.'].slice(-5) });
      }
      return;
    }
    await this.prisma.inTenantTransaction(tenantId, async (tx) => {
      await tx.waitSubscription.updateMany({ where: { id: subscription.id, status: 'WAITING' }, data: { status: 'SATISFIED', satisfiedByEventId: event.id, resolvedAt: new Date() } });
      await this.events.appendInTx(tx, tenantId, caseRow.id, { type: CASE_EVENT_TYPES.WAIT_SATISFIED, payload: { nodeKey: subscription.nodeKey, eventId: event.id } });
    });
    const graph = await this.store.getActive(tenantId, caseRow.id);
    if (!graph || graph.plan.id !== subscription.planId) return;
    const messageId = (event.payload as Record<string, unknown> | undefined)?.emailMessageId;
    await this.store.transitionNode(tenantId, caseRow.id, graph.plan.id, subscription.nodeKey, ['WAITING'], { state: 'SUCCEEDED', output: asJson({ eventId: event.id, emailMessageId: messageId ?? null }), executionMode: 'LIVE', completedAt: new Date() });
    await this.lifecycle.transition(tenantId, caseRow.id, { to: 'IN_PROGRESS' });

    const hasContinuation = graph.edges.some((e) => e.sourceKey === subscription.nodeKey);
    if (!hasContinuation) await this.replan(tenantId, caseRow.id, undefined);
  }

  /** Waits whose deadline passed: the awaiting node fails per its policy, visibly (§13.4). */
  private async expireWaits(tenantId: string, caseRow: Case): Promise<boolean> {
    const due = await this.prisma.forTenantId(tenantId).waitSubscription.findFirst({ where: { caseId: caseRow.id, status: 'WAITING', deadlineAt: { lt: new Date() } } });
    if (!due || !due.planId || !due.nodeKey) return false;
    await this.prisma.inTenantTransaction(tenantId, async (tx) => {
      await tx.waitSubscription.updateMany({ where: { id: due.id, status: 'WAITING' }, data: { status: 'TIMED_OUT', resolvedAt: new Date() } });
      await this.events.appendInTx(tx, tenantId, caseRow.id, { type: CASE_EVENT_TYPES.WAIT_TIMED_OUT, payload: { nodeKey: due.nodeKey } });
    });
    const graph = await this.store.getActive(tenantId, caseRow.id);
    const node = graph?.nodes.find((n) => n.nodeKey === due.nodeKey);
    if (graph && node) {
      await this.failNode(tenantId, caseRow, graph, node, node.definition as unknown as PlanNode, 'WAIT_TIMEOUT', 'Die erwartete Antwort ist nicht rechtzeitig eingegangen.', ['WAITING']);
    }
    return true;
  }

  private async resumeDecidedApprovals(tenantId: string, caseRow: Case, graph: PlanGraph, executed: string[]): Promise<boolean> {
    const awaiting = graph.nodes.filter((n) => n.state === 'AWAITING_APPROVAL');
    for (const node of awaiting) {
      const intent = await this.prisma.forTenantId(tenantId).actionIntent.findFirst({ where: { caseId: caseRow.id, nodeKey: node.nodeKey, planId: graph.plan.id }, orderBy: { createdAt: 'desc' } });
      if (!intent) continue;
      if (intent.status === 'APPROVED') {
        const ctx = await this.buildEvalContext(tenantId, caseRow, graph);
        const claimed = await this.store.transitionNode(tenantId, caseRow.id, graph.plan.id, node.nodeKey, ['AWAITING_APPROVAL'], { state: 'RUNNING' });
        if (!claimed) continue;
        await this.ensureInProgress(tenantId, caseRow.id);
        await this.runCapability(tenantId, await this.loadCase(tenantId, caseRow.id), graph, node, node.definition as unknown as PlanNode, ctx);
        executed.push(node.nodeKey);
        return true;
      }
      if (intent.status === 'CANCELLED') {
        await this.failNode(tenantId, caseRow, graph, node, node.definition as unknown as PlanNode, 'ACTION_REJECTED', 'Die Aktion wurde nicht freigegeben.', ['AWAITING_APPROVAL']);
        return true;
      }
    }
    return false;
  }

  /** Derives the case state when nothing can run: what is the case waiting for? */
  private async settle(tenantId: string, caseRow: Case, graph: PlanGraph): Promise<void> {
    const states = graph.nodes.map((n) => n.state);
    let target: { to: 'WAITING_FOR_APPROVAL' | 'WAITING_FOR_INFORMATION' | 'MANUAL_REVIEW' | 'WAITING_FOR_EXTERNAL_SYSTEM'; reason: string } | undefined;
    if (states.includes('AWAITING_APPROVAL')) target = { to: 'WAITING_FOR_APPROVAL', reason: 'Eine Freigabe ist offen.' };
    else if (states.includes('OUTCOME_UNKNOWN')) target = { to: 'MANUAL_REVIEW', reason: 'Das Ergebnis einer Aktion ist ungewiss.' };
    else if (states.includes('WAITING')) {
      const waitingManual = graph.nodes.some((n) => n.state === 'WAITING' && ['MANUAL_TASK', 'APPROVAL'].includes(n.type));
      target = waitingManual ? { to: 'MANUAL_REVIEW', reason: 'Ein manueller Schritt ist offen.' } : { to: 'WAITING_FOR_INFORMATION', reason: 'Wartet auf eine Antwort.' };
    } else if (states.includes('BLOCKED') || states.includes('FAILED')) {
      // Why a step is blocked decides who can resolve it: a missing capability/connection is an external matter, missing input is information.
      const blocked = graph.nodes.filter((n) => n.state === 'BLOCKED');
      const onlyBlocked = blocked.length > 0 && !states.includes('FAILED');
      target =
        onlyBlocked && blocked.every((n) => n.errorCode === 'CAPABILITY_NOT_EXECUTABLE')
          ? { to: 'WAITING_FOR_EXTERNAL_SYSTEM', reason: 'Eine benötigte Fähigkeit oder Verbindung ist nicht verfügbar.' }
          : onlyBlocked && blocked.every((n) => n.errorCode === 'MISSING_INPUT')
            ? { to: 'WAITING_FOR_INFORMATION', reason: 'Es fehlen Angaben für den nächsten Schritt.' }
            : { to: 'MANUAL_REVIEW', reason: 'Ein Schritt ist blockiert oder fehlgeschlagen.' };
    }
    if (target && caseRow.orchestrationStatus !== target.to) {
      await this.lifecycle.transition(tenantId, caseRow.id, { to: target.to, attentionReasons: caseRow.attentionReasons.length > 0 ? caseRow.attentionReasons : [target.reason] });
    }
  }

  // ── Replanning, commands support ────────────────────────────────────────────

  async replan(tenantId: string, caseId: string, userId: string | undefined): Promise<StartCaseResult> {
    const caseRow = await this.loadCase(tenantId, caseId);
    const blueprint = await this.blueprintRefFor(tenantId, caseRow);
    const maxReplans = effectiveLimits(blueprint?.definition.limits).maxReplans;
    const revisions = await this.store.listRevisions(tenantId, caseId);
    if (revisions.length > maxReplans) {
      const reasons = [`Das Limit von ${maxReplans} Neuplanungen ist erreicht.`];
      await this.lifecycle.transition(tenantId, caseId, { to: 'MANUAL_REVIEW', attentionReasons: reasons });
      return { outcome: 'MANUAL_REVIEW', reasons };
    }
    return this.planAndActivate(tenantId, caseId, { trigger: 'REPLAN', userId, blueprint });
  }

  async approvePlan(tenantId: string, userId: string, planId: string): Promise<void> {
    const graph = await this.store.load(tenantId, planId);
    if (graph.plan.status !== 'AWAITING_APPROVAL') throw new NotFoundError('Plan awaits no approval.', { planId });
    await this.activatePlan(tenantId, graph.plan.caseId, planId, userId);
  }

  async rejectPlan(tenantId: string, userId: string, planId: string, reason?: string): Promise<void> {
    const graph = await this.store.load(tenantId, planId);
    await this.store.setStatus(tenantId, planId, 'REJECTED');
    await this.lifecycle.transition(tenantId, graph.plan.caseId, { to: 'MANUAL_REVIEW', attentionReasons: [reason ? `Plan abgelehnt: ${reason}` : 'Der vorgeschlagene Plan wurde abgelehnt.'] }, { type: 'USER', userId });
  }

  async decideAction(tenantId: string, userId: string, intentId: string, decision: 'APPROVED' | 'REJECTED', reason?: string): Promise<{ applied: boolean; reason?: string }> {
    const intent = await this.ledger.get(tenantId, intentId);
    const result = await this.ledger.decide(tenantId, intentId, decision, intent.payloadHash);
    if (!result.applied) return result;
    await this.approvals.markDecided(tenantId, 'PROCESS_ACTION', intentId, userId, decision);
    await this.audit.record({ tenantId, eventType: 'CASE_COMMAND_EXECUTED', actorType: 'USER', actorUserId: userId, entityType: 'ActionIntent', entityId: intentId, payload: { decision, reason: reason ?? null, payloadHash: intent.payloadHash } });
    return { applied: true };
  }

  async retryNode(tenantId: string, caseId: string, nodeKey: string): Promise<boolean> {
    const graph = await this.store.getActive(tenantId, caseId);
    const node = graph?.nodes.find((n) => n.nodeKey === nodeKey);
    if (!graph || !node || !['FAILED', 'BLOCKED'].includes(node.state)) return false;
    const intent = await this.prisma.forTenantId(tenantId).actionIntent.findFirst({ where: { caseId, nodeKey, planId: graph.plan.id }, orderBy: { createdAt: 'desc' } });
    if (intent?.status === 'FAILED') await this.prisma.forTenantId(tenantId).actionIntent.updateMany({ where: { id: intent.id, status: 'FAILED' }, data: { status: 'PREPARED', errorCode: null } });
    if (intent && ['OUTCOME_UNKNOWN', 'DISPATCHING'].includes(intent.status)) return false;
    const reset = await this.store.transitionNode(tenantId, caseId, graph.plan.id, nodeKey, ['FAILED', 'BLOCKED'], { state: 'PLANNED', errorCode: null, errorMessage: null, completedAt: null });
    if (reset) await this.lifecycle.transition(tenantId, caseId, { to: 'IN_PROGRESS' });
    return reset;
  }

  /**
   * Human reconciliation of an OUTCOME_UNKNOWN effect (§15.2): either it did happen (proven by the person, e.g. the sent
   * mail is in the mailbox) and the node completes without re-executing, or it did not and the node may be retried.
   */
  async reconcile(tenantId: string, userId: string, caseId: string, intentId: string, happened: boolean, note?: string): Promise<boolean> {
    const intent = await this.ledger.get(tenantId, intentId);
    if (intent.caseId !== caseId || intent.status !== 'OUTCOME_UNKNOWN') return false;
    const evidence = { reconciledByUserId: userId, note: note ?? null };
    if (happened) await this.ledger.reconcile(tenantId, intentId, { happened: true, evidence, executionMode: 'LIVE' });
    else await this.ledger.reconcile(tenantId, intentId, { happened: false, evidence });
    const graph = await this.store.getActive(tenantId, caseId);
    if (graph) {
      await this.store.transitionNode(
        tenantId,
        caseId,
        graph.plan.id,
        intent.nodeKey,
        ['OUTCOME_UNKNOWN'],
        happened ? { state: 'SUCCEEDED', output: asJson({ reconciled: true, note: note ?? null }), executionMode: 'LIVE', completedAt: new Date() } : { state: 'FAILED', errorCode: 'RECONCILED_NOT_EXECUTED', errorMessage: 'Die Aktion wurde nachweislich nicht ausgeführt.', completedAt: new Date() },
      );
    }
    await this.lifecycle.transition(tenantId, caseId, happened ? { to: 'IN_PROGRESS' } : { to: 'MANUAL_REVIEW', attentionReasons: ['Die Aktion wurde nicht ausgeführt; Schritt kann erneut versucht werden.'] }, { type: 'USER', userId });
    return true;
  }

  async completeManual(tenantId: string, userId: string, caseId: string, nodeKey: string, result: Record<string, unknown>): Promise<boolean> {
    const graph = await this.store.getActive(tenantId, caseId);
    const node = graph?.nodes.find((n) => n.nodeKey === nodeKey);
    if (!graph || !node || node.state !== 'WAITING' || !['MANUAL_TASK', 'APPROVAL'].includes(node.type)) return false;
    const rejected = node.type === 'APPROVAL' && result.decision === 'REJECTED';
    if (rejected) {
      await this.store.transitionNode(tenantId, caseId, graph.plan.id, nodeKey, ['WAITING'], { state: 'FAILED', errorCode: 'APPROVAL_REJECTED', errorMessage: 'Abgelehnt.', completedAt: new Date() });
      await this.lifecycle.transition(tenantId, caseId, { to: 'MANUAL_REVIEW', attentionReasons: [`${node.title}: abgelehnt.`] }, { type: 'USER', userId });
      return true;
    }
    await this.store.transitionNode(tenantId, caseId, graph.plan.id, nodeKey, ['WAITING'], { state: 'SUCCEEDED', output: asJson({ ...result, completed: true }), executionMode: 'LIVE', completedAt: new Date() });
    await this.prisma.forTenantId(tenantId).task.updateMany({ where: { caseId, title: node.title, status: 'OPEN' }, data: { status: 'DONE' } });
    await this.lifecycle.transition(tenantId, caseId, { to: 'IN_PROGRESS' }, { type: 'USER', userId });
    return true;
  }

  /**
   * An input of a node changed after an action was prepared or approved for it (e.g. the draft text was edited): the old
   * intent and its approval are void (§14.4), the node is reset and will prepare a fresh intent from the new input.
   */
  async invalidateNodeApprovals(tenantId: string, caseId: string, nodeKey: string): Promise<void> {
    const intents = await this.prisma.forTenantId(tenantId).actionIntent.findMany({ where: { caseId, nodeKey, status: { in: ['PREPARED', 'AWAITING_APPROVAL', 'APPROVED'] } } });
    for (const intent of intents) {
      await this.prisma.forTenantId(tenantId).actionIntent.updateMany({ where: { id: intent.id, status: { in: ['PREPARED', 'AWAITING_APPROVAL', 'APPROVED'] } }, data: { status: 'CANCELLED', errorCode: 'INPUT_CHANGED' } });
      await this.approvals.markDecided(tenantId, 'PROCESS_ACTION', intent.id, 'system', 'REJECTED').catch(() => undefined);
    }
    const graph = await this.store.getActive(tenantId, caseId);
    if (graph) {
      await this.store.transitionNode(tenantId, caseId, graph.plan.id, nodeKey, ['AWAITING_APPROVAL', 'BLOCKED', 'FAILED'], { state: 'PLANNED', errorCode: null, errorMessage: null, completedAt: null });
    }
    await this.lifecycle.transition(tenantId, caseId, { to: 'IN_PROGRESS' });
  }

  async pause(tenantId: string, caseId: string, userId: string): Promise<void> {
    await this.lifecycle.transition(tenantId, caseId, { to: 'PAUSED', attentionReasons: ['Die Bearbeitung wurde angehalten.'] }, { type: 'USER', userId });
  }

  async resume(tenantId: string, caseId: string, userId: string): Promise<void> {
    await this.lifecycle.transition(tenantId, caseId, { to: 'IN_PROGRESS' }, { type: 'USER', userId });
  }

  async cancel(tenantId: string, caseId: string, userId: string): Promise<void> {
    const graph = await this.store.getActive(tenantId, caseId);
    if (graph) {
      for (const node of graph.nodes.filter((n) => !['SUCCEEDED', 'SKIPPED', 'FAILED', 'CANCELLED', 'SUPERSEDED'].includes(n.state))) {
        await this.store.transitionNode(tenantId, caseId, graph.plan.id, node.nodeKey, [node.state], { state: 'CANCELLED', completedAt: new Date() });
      }
    }
    await this.voidOpenApprovals(tenantId, caseId, 'Der Vorgang wurde abgebrochen.');
    await this.prisma.forTenantId(tenantId).waitSubscription.updateMany({ where: { caseId, status: 'WAITING' }, data: { status: 'CANCELLED', resolvedAt: new Date() } });
    await this.lifecycle.transition(tenantId, caseId, { to: 'CANCELLED' }, { type: 'USER', userId });
  }

  // ── Context, leases ─────────────────────────────────────────────────────────

  /** The evaluation context of the active plan — also used by the read model to decide which edges are taken. */
  async buildEvalContext(tenantId: string, caseRow: Case, graph: PlanGraph): Promise<EvalContext> {
    // Sequential: each read is its own short tenant transaction; a fan-out can starve a small connection pool under load.
    const current = await this.facts.getCurrent(tenantId, caseRow.id);
    const executability = await this.capabilities.executabilityFor(tenantId);
    const confirmed = await this.ledger.confirmedEffects(tenantId, caseRow.id);
    const blueprint = await this.blueprintFor(tenantId, caseRow);
    const facts: Record<string, unknown> = {};
    for (const fact of current) if (fact.status === 'CONFIRMED') facts[fact.key] = fact.value;

    const stepOutputs: Record<string, unknown> = {};
    // Requirements a dynamic resolver reported are a snapshot from when it ran; the live fact state for the blueprint's
    // declared requirements always wins (a later answer must not be shadowed by an earlier "MISSING").
    const requirements: Record<string, RequirementState> = {};
    for (const node of graph.nodes) {
      if (node.output !== null && node.output !== undefined) stepOutputs[node.nodeKey] = node.output;
      const reported = (node.output as { requirements?: Record<string, RequirementState> } | null)?.requirements;
      if (node.type === 'EVALUATE_REQUIREMENTS' && reported && node.state === 'SUCCEEDED') Object.assign(requirements, reported);
    }
    Object.assign(requirements, this.requirementStates(blueprint, current));
    const sourceRefs: Record<string, unknown> = { "case.id": caseRow.id };
    const latestInbound = await this.prisma.forTenantId(tenantId).emailMessage.findFirst({ where: { caseId: caseRow.id, direction: "INBOUND" }, orderBy: { createdAt: "desc" } });
    if (latestInbound) {
      sourceRefs["inbound.latestMessageId"] = latestInbound.id;
      if (latestInbound.threadId) sourceRefs["inbound.latestThreadId"] = latestInbound.threadId;
    }

    return {
      facts,
      stepOutputs,
      config: {},
      sourceRefs,
      requirements,
      capabilities: new Set([...executability].filter(([, e]) => e.executable).map(([key]) => key)),
      receipts: new Set(confirmed.map((c) => c.purpose).filter((p): p is string => Boolean(p))),
    };
  }

  private runtimeNodes(graph: PlanGraph): RuntimeNode[] {
    return graph.nodes.map((n) => ({ key: n.nodeKey, state: n.state, definition: n.definition as unknown as PlanNode }));
  }

  private runtimeEdges(graph: PlanGraph): RuntimeEdge[] {
    return graph.edges.map((e) => ({ key: e.edgeKey, source: e.sourceKey, target: e.targetKey, condition: (e.condition ?? undefined) as RuntimeEdge['condition'] }));
  }

  private async blueprintRefFor(tenantId: string, caseRow: Case): Promise<{ definition: BlueprintDefinition; key: string; version: string } | undefined> {
    const definition = await this.blueprintFor(tenantId, caseRow);
    return definition && caseRow.blueprintKey && caseRow.blueprintVersion ? { definition, key: caseRow.blueprintKey, version: caseRow.blueprintVersion } : undefined;
  }

  /** The blueprint version the case was started with (never silently swapped for a newer one). */
  private async blueprintFor(tenantId: string, caseRow: Case): Promise<BlueprintDefinition | undefined> {
    if (!caseRow.blueprintKey || !caseRow.blueprintVersion) return undefined;
    const row = await this.blueprints.get(tenantId, caseRow.blueprintKey, caseRow.blueprintVersion).catch(() => undefined);
    return row ? (row.definition as unknown as BlueprintDefinition) : undefined;
  }

  private async loadCase(tenantId: string, caseId: string): Promise<Case> {
    const found = await this.prisma.forTenantId(tenantId).case.findUnique({ where: { id: caseId } });
    if (!found) throw new NotFoundError('Case not found.', { caseId });
    return found;
  }

  private async acquireLease(tenantId: string, caseId: string): Promise<boolean> {
    const now = new Date();
    const result = await this.prisma.forTenantId(tenantId).case.updateMany({
      where: { id: caseId, OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }, { leaseOwner: this.owner }] },
      data: { leaseOwner: this.owner, leaseExpiresAt: new Date(now.getTime() + LEASE_MS) },
    });
    return result.count === 1;
  }

  private async renewLease(tenantId: string, caseId: string): Promise<void> {
    await this.prisma.forTenantId(tenantId).case.updateMany({ where: { id: caseId, leaseOwner: this.owner }, data: { leaseExpiresAt: new Date(Date.now() + LEASE_MS) } });
  }

  private async releaseLease(tenantId: string, caseId: string): Promise<void> {
    await this.prisma.forTenantId(tenantId).case.updateMany({ where: { id: caseId, leaseOwner: this.owner }, data: { leaseOwner: null, leaseExpiresAt: null } });
  }
}
