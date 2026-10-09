import { Injectable } from '@nestjs/common';
import type { ActionIntent, ActionReceipt, Prisma } from '@orbit/domain';
import { NotFoundError, checkActionLimits, type EffectiveLimits, type ExecutionMode } from '@orbit/shared';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { hashOf, sha256 } from './canonical';
import { CASE_EVENT_TYPES, CaseEventsService } from './case-events.service';

export interface PrepareActionInput {
  caseId: string;
  planId: string;
  planRevision: number;
  caseRevision: number;
  nodeKey: string;
  capabilityKey: string;
  purpose?: string;
  payload: Record<string, unknown>;
}

/** Eine neue Aktion würde ein zentrales Limit (BP-39) überschreiten: der Vorgang geht zur Prüfung, es wird nichts vorbereitet. */
export class ActionLimitReachedError extends Error {
  constructor(
    readonly code: 'LIMIT_ACTIONS_PER_CASE' | 'LIMIT_CONSECUTIVE_FAILURES',
    message: string,
  ) {
    super(message);
    this.name = 'ActionLimitReachedError';
  }
}

export interface ConfirmedEffectRef {
  nodeKey: string;
  capabilityKey: string;
  purpose: string | null;
  providerRef: string | null;
  executionMode: string;
}

/**
 * Amendment 02 §15 — the action ledger. Every external effect is persisted as
 * an `ActionIntent` with a stable idempotency key BEFORE it is attempted, the
 * start of dispatch is claimed atomically (so a second worker or a lease
 * takeover can never send twice), and the result is stored as a receipt. An
 * unknown outcome (a timeout after submission) is its own state and is never
 * retried blindly — it is reconciled (§15.2). Approvals bind to the payload
 * hash: if the payload changes, the approval no longer applies.
 */
@Injectable()
export class ActionLedgerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: CaseEventsService,
    private readonly audit: AuditService,
  ) {}

  /** Stable per (tenant, case, node, capability, purpose, payload): the same effect always maps to the same intent. */
  idempotencyKeyFor(tenantId: string, input: PrepareActionInput): string {
    return sha256(`${tenantId}|${input.caseId}|${input.nodeKey}|${input.capabilityKey}|${input.purpose ?? ''}|${hashOf(input.payload)}`);
  }

  /**
   * Bereitet eine Aktion vor. Dieselbe Aktion (gleicher Schlüssel) liefert immer dieselbe Absicht zurück und zählt nie gegen ein Limit; nur eine **neue**
   * Absicht wird gegen die Grenzen des Vorgangs geprüft (BP-39).
   */
  async prepare(tenantId: string, input: PrepareActionInput, limits?: Pick<EffectiveLimits, 'maxActionsPerCase' | 'maxConsecutiveCapabilityFailures'>): Promise<{ intent: ActionIntent; created: boolean }> {
    const idempotencyKey = this.idempotencyKeyFor(tenantId, input);
    const existing = await this.prisma.forTenantId(tenantId).actionIntent.findFirst({ where: { idempotencyKey } });
    if (existing) return { intent: existing, created: false };
    if (limits) {
      const scoped = this.prisma.forTenantId(tenantId);
      const [existingActions, recent] = await Promise.all([
        scoped.actionIntent.count({ where: { caseId: input.caseId, status: { not: 'CANCELLED' } } }),
        scoped.actionIntent.findMany({ where: { caseId: input.caseId, status: { not: 'CANCELLED' } }, orderBy: { createdAt: 'desc' }, take: limits.maxConsecutiveCapabilityFailures, select: { status: true } }),
      ]);
      const verdict = checkActionLimits(limits, existingActions, recent.map((r) => r.status === 'FAILED'));
      if (!verdict.allowed && verdict.code) throw new ActionLimitReachedError(verdict.code, verdict.message ?? 'Ein Limit ist erreicht.');
    }

    const intent = await this.prisma.inTenantTransaction(tenantId, async (tx) => {
      const created = await tx.actionIntent.create({
        data: {
          tenantId,
          caseId: input.caseId,
          planId: input.planId,
          planRevision: input.planRevision,
          caseRevision: input.caseRevision,
          nodeKey: input.nodeKey,
          capabilityKey: input.capabilityKey,
          purpose: input.purpose,
          payload: input.payload as Prisma.InputJsonValue,
          payloadHash: hashOf(input.payload),
          idempotencyKey,
          status: 'PREPARED',
        },
      });
      await this.events.appendInTx(tx, tenantId, input.caseId, {
        type: CASE_EVENT_TYPES.ACTION_PREPARED,
        payload: { intentId: created.id, nodeKey: input.nodeKey, capability: input.capabilityKey, purpose: input.purpose ?? null },
      });
      return created;
    });
    await this.audit.record({
      tenantId,
      eventType: 'PROCESS_ACTION_PREPARED',
      actorType: 'SYSTEM',
      entityType: 'ActionIntent',
      entityId: intent.id,
      payload: { caseId: input.caseId, capability: input.capabilityKey, purpose: input.purpose ?? null, payloadHash: intent.payloadHash },
    });
    return { intent, created: true };
  }

  /**
   * Wird ein simulierter Schritt live wiederholt, gilt die Freigabe, die eine Person für genau diesen Inhalt erteilt hat, weiter: die freigegebene Nachricht
   * soll ja hinausgehen. Nur bei gleichem Inhalt (Nutzlast-Hash) und nur, wenn die frühere Freigabe tatsächlich erteilt wurde.
   */
  async carryOverApproval(tenantId: string, intent: ActionIntent): Promise<boolean> {
    if (intent.status !== 'PREPARED') return false;
    const scoped = this.prisma.forTenantId(tenantId);
    const predecessor = await scoped.actionIntent.findFirst({
      where: { caseId: intent.caseId, nodeKey: intent.nodeKey, payloadHash: intent.payloadHash, status: 'CANCELLED', errorCode: 'SIMULATION_SUPERSEDED', approvalId: { not: null }, NOT: { id: intent.id } },
      orderBy: { createdAt: 'desc' },
    });
    if (!predecessor?.approvalId) return false;
    const approval = await scoped.approval.findFirst({ where: { id: predecessor.approvalId } });
    if (approval?.status !== 'APPROVED') return false;
    const result = await scoped.actionIntent.updateMany({ where: { id: intent.id, status: 'PREPARED' }, data: { status: 'APPROVED', approvalId: approval.id } });
    return result.count === 1;
  }

  async get(tenantId: string, intentId: string): Promise<ActionIntent> {
    const found = await this.prisma.forTenantId(tenantId).actionIntent.findFirst({ where: { id: intentId } });
    if (!found) throw new NotFoundError('Action intent not found.', { intentId });
    return found;
  }

  async receipts(tenantId: string, intentId: string): Promise<ActionReceipt[]> {
    return this.prisma.forTenantId(tenantId).actionReceipt.findMany({ where: { intentId }, orderBy: { createdAt: 'asc' } });
  }

  async awaitApproval(tenantId: string, intentId: string, approvalId: string): Promise<void> {
    await this.prisma.forTenantId(tenantId).actionIntent.updateMany({ where: { id: intentId, status: { in: ['PREPARED', 'AWAITING_APPROVAL'] } }, data: { status: 'AWAITING_APPROVAL', approvalId } });
  }

  /**
   * Records the human decision. The approval only applies to the payload it was requested for: if the intent's payload
   * hash no longer equals `boundPayloadHash` the approval is void (§14.4) and the caller must request a new one.
   */
  async decide(tenantId: string, intentId: string, decision: 'APPROVED' | 'REJECTED', boundPayloadHash: string): Promise<{ applied: boolean; reason?: string }> {
    const intent = await this.get(tenantId, intentId);
    if (intent.status !== 'AWAITING_APPROVAL') return { applied: false, reason: `Die Wirkung ist ${intent.status} und wartet nicht auf eine Freigabe.` };
    if (intent.payloadHash !== boundPayloadHash) return { applied: false, reason: 'Die Nutzlast hat sich seit der Freigabeanfrage geändert; eine neue Freigabe ist nötig.' };
    await this.prisma.forTenantId(tenantId).actionIntent.updateMany({ where: { id: intentId, status: 'AWAITING_APPROVAL' }, data: { status: decision === 'APPROVED' ? 'APPROVED' : 'CANCELLED' } });
    return { applied: true };
  }

  /** Claims the right to dispatch. Exactly one caller gets `true`; everyone else must not execute the effect. */
  async beginDispatch(tenantId: string, intentId: string): Promise<boolean> {
    const result = await this.prisma.forTenantId(tenantId).actionIntent.updateMany({ where: { id: intentId, status: { in: ['PREPARED', 'APPROVED'] } }, data: { status: 'DISPATCHING' } });
    return result.count === 1;
  }

  async confirm(tenantId: string, intentId: string, receipt: { providerRef?: string; evidence: Record<string, unknown>; executionMode: ExecutionMode }): Promise<ActionReceipt> {
    const intent = await this.get(tenantId, intentId);
    const created = await this.prisma.inTenantTransaction(tenantId, async (tx) => {
      await tx.actionIntent.updateMany({ where: { id: intentId, status: { in: ['DISPATCHING', 'OUTCOME_UNKNOWN'] } }, data: { status: 'CONFIRMED', errorCode: null } });
      const r = await tx.actionReceipt.create({
        data: { tenantId, intentId, status: 'CONFIRMED', providerRef: receipt.providerRef, evidence: receipt.evidence as Prisma.InputJsonValue, executionMode: receipt.executionMode },
      });
      await this.events.appendInTx(tx, tenantId, intent.caseId, {
        type: CASE_EVENT_TYPES.ACTION_CONFIRMED,
        payload: { intentId, nodeKey: intent.nodeKey, capability: intent.capabilityKey, purpose: intent.purpose, executionMode: receipt.executionMode, providerRef: receipt.providerRef ?? null },
      });
      return r;
    });
    await this.audit.record({
      tenantId,
      eventType: 'PROCESS_ACTION_CONFIRMED',
      actorType: 'SYSTEM',
      entityType: 'ActionIntent',
      entityId: intentId,
      payload: { caseId: intent.caseId, capability: intent.capabilityKey, executionMode: receipt.executionMode, providerRef: receipt.providerRef ?? null },
    });
    return created;
  }

  async fail(tenantId: string, intentId: string, errorCode: string, evidence: Record<string, unknown> = {}): Promise<void> {
    await this.prisma.inTenantTransaction(tenantId, async (tx) => {
      await tx.actionIntent.updateMany({ where: { id: intentId, status: { in: ['DISPATCHING', 'PREPARED', 'APPROVED'] } }, data: { status: 'FAILED', errorCode } });
      await tx.actionReceipt.create({ data: { tenantId, intentId, status: 'FAILED', evidence: { errorCode, ...evidence } as Prisma.InputJsonValue, executionMode: 'LIVE' } });
    });
  }

  /** The outcome of a dispatched effect is unknown: stop, keep the evidence, require reconciliation. */
  async markUnknown(tenantId: string, intentId: string, errorCode: string, evidence: Record<string, unknown> = {}): Promise<void> {
    const intent = await this.get(tenantId, intentId);
    await this.prisma.inTenantTransaction(tenantId, async (tx) => {
      await tx.actionIntent.updateMany({ where: { id: intentId, status: 'DISPATCHING' }, data: { status: 'OUTCOME_UNKNOWN', errorCode } });
      await tx.actionReceipt.create({ data: { tenantId, intentId, status: 'OUTCOME_UNKNOWN', evidence: { errorCode, ...evidence } as Prisma.InputJsonValue, executionMode: 'LIVE' } });
      await this.events.appendInTx(tx, tenantId, intent.caseId, { type: CASE_EVENT_TYPES.ACTION_UNKNOWN, payload: { intentId, nodeKey: intent.nodeKey, capability: intent.capabilityKey, errorCode } });
    });
    await this.audit.record({
      tenantId,
      eventType: 'PROCESS_ACTION_OUTCOME_UNKNOWN',
      actorType: 'SYSTEM',
      entityType: 'ActionIntent',
      entityId: intentId,
      payload: { caseId: intent.caseId, capability: intent.capabilityKey, errorCode },
    });
  }

  /**
   * Resolves an OUTCOME_UNKNOWN intent after checking the provider (or a human decision): either the effect is proven
   * (CONFIRMED, with evidence) or proven not to have happened (FAILED → a new attempt becomes legitimate).
   */
  async reconcile(tenantId: string, intentId: string, resolution: { happened: true; providerRef?: string; evidence: Record<string, unknown>; executionMode: ExecutionMode } | { happened: false; evidence: Record<string, unknown> }): Promise<void> {
    const intent = await this.get(tenantId, intentId);
    if (intent.status !== 'OUTCOME_UNKNOWN') return;
    if (resolution.happened) {
      await this.confirm(tenantId, intentId, { providerRef: resolution.providerRef, evidence: { reconciled: true, ...resolution.evidence }, executionMode: resolution.executionMode });
    } else {
      await this.prisma.forTenantId(tenantId).actionIntent.updateMany({ where: { id: intentId, status: 'OUTCOME_UNKNOWN' }, data: { status: 'FAILED', errorCode: 'RECONCILED_NOT_EXECUTED' } });
    }
  }

  async cancelOpen(tenantId: string, caseId: string): Promise<number> {
    const result = await this.prisma.forTenantId(tenantId).actionIntent.updateMany({
      where: { caseId, status: { in: ['PREPARED', 'AWAITING_APPROVAL', 'APPROVED'] } },
      data: { status: 'CANCELLED' },
    });
    return result.count;
  }

  /** Effects with a confirmed receipt: the replan validator forbids dropping or repeating these (§11.3 item 9). */
  async confirmedEffects(tenantId: string, caseId: string): Promise<ConfirmedEffectRef[]> {
    const intents = await this.prisma.forTenantId(tenantId).actionIntent.findMany({ where: { caseId, status: 'CONFIRMED' } });
    const result: ConfirmedEffectRef[] = [];
    for (const intent of intents) {
      const receipts = await this.receipts(tenantId, intent.id);
      const confirmed = [...receipts].reverse().find((r) => r.status === 'CONFIRMED');
      result.push({ nodeKey: intent.nodeKey, capabilityKey: intent.capabilityKey, purpose: intent.purpose, providerRef: confirmed?.providerRef ?? null, executionMode: confirmed?.executionMode ?? 'LIVE' });
    }
    return result;
  }

  async openIntents(tenantId: string, caseId: string): Promise<ActionIntent[]> {
    return this.prisma.forTenantId(tenantId).actionIntent.findMany({ where: { caseId, status: { in: ['PREPARED', 'AWAITING_APPROVAL', 'APPROVED', 'DISPATCHING', 'OUTCOME_UNKNOWN'] } }, orderBy: { createdAt: 'asc' } });
  }
}
