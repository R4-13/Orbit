import { Injectable } from '@nestjs/common';
import { Prisma, type ProcessNodeState, type ProcessPlan, type ProcessPlanEdge, type ProcessPlanNode, type ProcessPlanSource, type ProcessPlanStatus } from '@orbit/domain';
import { NotFoundError, type PlanNode, type PlanProposal } from '@orbit/shared';
import { PrismaService } from '../prisma/prisma.service';
import { hashOf } from './canonical';
import { CASE_EVENT_TYPES, CaseEventsService } from './case-events.service';

export interface PlanGraph {
  plan: ProcessPlan;
  nodes: ProcessPlanNode[];
  edges: ProcessPlanEdge[];
}

export interface PlanDiff {
  added: string[];
  removed: string[];
  changed: string[];
  kept: string[];
}

export interface CreateRevisionInput {
  proposal: PlanProposal;
  source: ProcessPlanSource;
  status: ProcessPlanStatus;
  basedOnCaseRevision: number;
  validation: unknown;
  blueprint?: { key: string; version: string };
  parentPlanId?: string;
  createdByUserId?: string;
}

/** Node states whose work is done and must survive a replan untouched (§11.5: no silent rewriting of history). */
const CARRIED_STATES: ReadonlySet<ProcessNodeState> = new Set<ProcessNodeState>(['SUCCEEDED', 'SKIPPED']);
/** States that no longer take part in the execution once the plan is replaced. */
const TERMINAL_STATES: ReadonlySet<ProcessNodeState> = new Set<ProcessNodeState>(['SUCCEEDED', 'SKIPPED', 'FAILED', 'CANCELLED', 'SUPERSEDED']);

/**
 * Persistence of process plans (Amendment 02 §11/§16): immutable revisions with
 * nodes, edges and a compact diff against the predecessor. A new revision
 * carries over every already-executed node (state, output, timestamps) when
 * its definition is unchanged — confirmed work is never repeated or rewritten.
 */
@Injectable()
export class PlanStoreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: CaseEventsService,
  ) {}

  async createRevision(tenantId: string, caseId: string, input: CreateRevisionInput): Promise<PlanGraph> {
    return this.prisma.inTenantTransaction(tenantId, async (tx) => {
      const last = await tx.processPlan.findFirst({ where: { tenantId, caseId }, orderBy: { revision: 'desc' }, select: { revision: true } });
      const parent = input.parentPlanId
        ? await tx.processPlan.findFirst({ where: { id: input.parentPlanId, tenantId, caseId }, include: { nodes: true } })
        : null;
      if (input.parentPlanId && !parent) throw new NotFoundError('Parent plan not found.', { parentPlanId: input.parentPlanId });

      const parentNodes = new Map((parent?.nodes ?? []).map((n) => [n.nodeKey, n]));
      const diff = this.diff(parent?.nodes ?? [], input.proposal.nodes);

      const plan = await tx.processPlan.create({
        data: {
          tenantId,
          caseId,
          revision: (last?.revision ?? 0) + 1,
          parentPlanId: parent?.id,
          status: input.status,
          source: input.source,
          blueprintKey: input.blueprint?.key,
          blueprintVersion: input.blueprint?.version,
          goalKeys: input.proposal.goalKeys,
          basedOnCaseRevision: input.basedOnCaseRevision,
          explanation: input.proposal.conciseExplanation,
          assumptions: input.proposal.assumptions as unknown as Prisma.InputJsonValue,
          unresolvedRequirements: input.proposal.unresolvedRequirements,
          planHash: hashOf({ nodes: input.proposal.nodes, edges: input.proposal.edges }),
          validation: input.validation as Prisma.InputJsonValue,
          createdByUserId: input.createdByUserId,
          diffFromParent: parent ? (diff as unknown as Prisma.InputJsonValue) : undefined,
        },
      });

      for (const node of input.proposal.nodes) {
        const previous = parentNodes.get(node.id);
        const carry = previous && CARRIED_STATES.has(previous.state) && hashOf(previous.definition) === hashOf(node);
        await tx.processPlanNode.create({
          data: {
            tenantId,
            planId: plan.id,
            nodeKey: node.id,
            type: node.type,
            title: node.title,
            definition: node as unknown as Prisma.InputJsonValue,
            ...(carry && previous
              ? {
                  state: previous.state,
                  attempts: previous.attempts,
                  output: previous.output ?? undefined,
                  executionMode: previous.executionMode,
                  agentRunId: previous.agentRunId,
                  startedAt: previous.startedAt,
                  completedAt: previous.completedAt,
                }
              : { state: 'PLANNED' as const }),
          },
        });
      }
      for (const edge of input.proposal.edges) {
        await tx.processPlanEdge.create({
          data: {
            tenantId,
            planId: plan.id,
            edgeKey: edge.id,
            sourceKey: edge.source,
            targetKey: edge.target,
            label: edge.label,
            condition: edge.condition ? (edge.condition as unknown as Prisma.InputJsonValue) : undefined,
          },
        });
      }

      await this.events.appendInTx(tx, tenantId, caseId, {
        type: CASE_EVENT_TYPES.PLAN_CREATED,
        payload: { planId: plan.id, revision: plan.revision, status: plan.status, source: plan.source, diff: parent ? diff : null },
      });
      return this.loadInTx(tx, tenantId, plan.id);
    });
  }

  /** Makes a plan the executing one; the previous active plan and its unfinished nodes become SUPERSEDED. */
  async activate(tenantId: string, planId: string): Promise<PlanGraph> {
    return this.prisma.inTenantTransaction(tenantId, async (tx) => {
      const plan = await tx.processPlan.findFirst({ where: { id: planId, tenantId } });
      if (!plan) throw new NotFoundError('Plan not found.', { planId });
      const previous = await tx.processPlan.findMany({ where: { tenantId, caseId: plan.caseId, status: 'ACTIVE', NOT: { id: planId } } });
      for (const old of previous) {
        await tx.processPlan.update({ where: { id: old.id }, data: { status: 'SUPERSEDED' } });
        await tx.processPlanNode.updateMany({ where: { tenantId, planId: old.id, state: { notIn: [...TERMINAL_STATES] } }, data: { state: 'SUPERSEDED' } });
        await this.events.appendInTx(tx, tenantId, plan.caseId, { type: CASE_EVENT_TYPES.PLAN_SUPERSEDED, payload: { planId: old.id, revision: old.revision, by: plan.revision } });
      }
      await tx.processPlan.update({ where: { id: planId }, data: { status: 'ACTIVE', activatedAt: new Date() } });
      await this.events.appendInTx(tx, tenantId, plan.caseId, { type: CASE_EVENT_TYPES.PLAN_ACTIVATED, payload: { planId, revision: plan.revision } });
      return this.loadInTx(tx, tenantId, planId);
    });
  }

  async setStatus(tenantId: string, planId: string, status: ProcessPlanStatus): Promise<void> {
    await this.prisma.forTenantId(tenantId).processPlan.update({ where: { id: planId }, data: { status } });
  }

  async load(tenantId: string, planId: string): Promise<PlanGraph> {
    return this.prisma.inTenantTransaction(tenantId, (tx) => this.loadInTx(tx, tenantId, planId));
  }

  /** The currently executing plan, or undefined. */
  async getActive(tenantId: string, caseId: string): Promise<PlanGraph | undefined> {
    const plan = await this.prisma.forTenantId(tenantId).processPlan.findFirst({ where: { caseId, status: 'ACTIVE' }, orderBy: { revision: 'desc' } });
    return plan ? this.load(tenantId, plan.id) : undefined;
  }

  /** The newest revision in any state (proposed, awaiting approval, active, ...) — what the orchestration view shows. */
  async getLatest(tenantId: string, caseId: string): Promise<PlanGraph | undefined> {
    const plan = await this.prisma.forTenantId(tenantId).processPlan.findFirst({ where: { caseId }, orderBy: { revision: 'desc' } });
    return plan ? this.load(tenantId, plan.id) : undefined;
  }

  async listRevisions(tenantId: string, caseId: string): Promise<ProcessPlan[]> {
    return this.prisma.forTenantId(tenantId).processPlan.findMany({ where: { caseId }, orderBy: { revision: 'asc' } });
  }

  /** Compare-and-set a node's state: only moves forward from `from` so two workers cannot both claim the node. */
  async transitionNode(
    tenantId: string,
    caseId: string,
    planId: string,
    nodeKey: string,
    from: ProcessNodeState | ProcessNodeState[],
    patch: { state: ProcessNodeState; output?: Prisma.InputJsonValue | null } & Partial<Pick<ProcessPlanNode, 'errorCode' | 'errorMessage' | 'executionMode' | 'agentRunId' | 'startedAt' | 'completedAt' | 'retryAt' | 'attempts'>>,
  ): Promise<boolean> {
    const fromStates = Array.isArray(from) ? from : [from];
    return this.prisma.inTenantTransaction(tenantId, async (tx) => {
      const { output, ...rest } = patch;
      const result = await tx.processPlanNode.updateMany({
        where: { tenantId, planId, nodeKey, state: { in: fromStates } },
        data: { ...rest, ...(output !== undefined ? { output: output === null ? Prisma.JsonNull : output } : {}) },
      });
      if (result.count !== 1) return false;
      await this.events.appendInTx(tx, tenantId, caseId, {
        type: CASE_EVENT_TYPES.NODE_STATE_CHANGED,
        payload: { planId, nodeKey, state: patch.state, errorCode: patch.errorCode ?? null, executionMode: patch.executionMode ?? null },
      });
      return true;
    });
  }

  /** Replaces the recorded output of a finished node (a person edited what it produced); the change is a case event. */
  async setNodeOutput(tenantId: string, caseId: string, planId: string, nodeKey: string, output: Prisma.InputJsonValue): Promise<boolean> {
    return this.prisma.inTenantTransaction(tenantId, async (tx) => {
      const result = await tx.processPlanNode.updateMany({ where: { tenantId, planId, nodeKey }, data: { output } });
      if (result.count !== 1) return false;
      await this.events.appendInTx(tx, tenantId, caseId, { type: CASE_EVENT_TYPES.NODE_STATE_CHANGED, payload: { planId, nodeKey, outputChanged: true } });
      return true;
    });
  }

  private async loadInTx(tx: Prisma.TransactionClient, tenantId: string, planId: string): Promise<PlanGraph> {
    const plan = await tx.processPlan.findFirst({ where: { id: planId, tenantId } });
    if (!plan) throw new NotFoundError('Plan not found.', { planId });
    const [nodes, edges] = await Promise.all([
      tx.processPlanNode.findMany({ where: { planId, tenantId }, orderBy: { nodeKey: 'asc' } }),
      tx.processPlanEdge.findMany({ where: { planId, tenantId }, orderBy: { edgeKey: 'asc' } }),
    ]);
    return { plan, nodes, edges };
  }

  private diff(previous: ProcessPlanNode[], next: PlanNode[]): PlanDiff {
    const before = new Map(previous.map((n) => [n.nodeKey, n]));
    const after = new Map(next.map((n) => [n.id, n]));
    const added = [...after.keys()].filter((k) => !before.has(k));
    const removed = [...before.keys()].filter((k) => !after.has(k));
    const changed: string[] = [];
    const kept: string[] = [];
    for (const [key, node] of after) {
      const old = before.get(key);
      if (!old) continue;
      (hashOf(old.definition) === hashOf(node) ? kept : changed).push(key);
    }
    return { added, removed, changed, kept };
  }
}
