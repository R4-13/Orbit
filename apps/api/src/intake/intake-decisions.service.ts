import { Injectable } from '@nestjs/common';
import type { IntakeDecision, IntakeEvent, IntakeRelevance } from '@orbit/domain';
import type { Prisma } from '@orbit/domain';
import { NotFoundError, ValidationFailedError, type ExecutionEvidenceSnapshot, type TriageResult } from '@orbit/shared';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { TasksService } from '../tasks/tasks.service';

/** Which slice of decisions a caller wants (Amendment 02 §19.2/§19.3). */
export type IntakeDecisionView = 'EXCLUDED' | 'REVIEW' | 'PENDING' | 'ALL';

export interface IntakeDecisionListItem {
  id: string;
  intakeEventId: string;
  status: IntakeDecision['status'];
  appliedRelevance: IntakeRelevance | null;
  category: string | null;
  businessRelevance: TriageResult['businessRelevance'] | null;
  conciseReason: string | null;
  confidence: TriageResult['confidence'] | null;
  riskFlags: string[];
  /** Why the proposal was or was not followed (deterministic thresholds, hard flags, deterministic skips). */
  basis: string | null;
  failureReason: string | null;
  execution: { provider: string; model: string | null; mode: string; latencyMs: number; promptVersion?: string } | null;
  channel: IntakeEvent['channel'];
  provider: string;
  subject: string | null;
  sender: { address?: string; displayName?: string } | null;
  occurredAt: Date;
  /** §19.2: an excluded input triggers no business action — always stated explicitly. */
  action: 'Keine' | 'Prüfung erforderlich' | 'Triage ausstehend';
  reviewed: { byUserId: string | null; at: Date | null; note: string | null; previousRelevance: IntakeRelevance | null } | null;
}

function viewFilter(view: IntakeDecisionView): Prisma.IntakeDecisionWhereInput {
  switch (view) {
    case 'EXCLUDED':
      // Only deliberate exclusions: certain non-business verdicts and deterministic skips — never review items.
      return { status: { in: ['DECIDED', 'OVERRIDDEN'] }, appliedRelevance: { in: ['NON_ACTIONABLE', 'PRIVATE_PERSONAL'] } };
    case 'REVIEW':
      return { OR: [{ status: 'REVIEW_REQUIRED' }, { status: 'OVERRIDDEN' }, { appliedRelevance: 'UNKNOWN_REQUIRES_REVIEW' }] };
    case 'PENDING':
      return { status: 'PENDING_TRIAGE' };
    case 'ALL':
      return {};
  }
}

/**
 * Amendment 02 §19 / §17.2 — reads and corrects triage decisions.
 *
 * - `list()` powers the separate "Kein Geschäftsprozess ausgelöst" view
 *   (testbetrieb: visible; produktiv: hidden by default, explicit filter),
 * - `review()` is the auditable "Als geschäftsrelevant prüfen" override: it
 *   never starts a process by itself, it turns a wrongly excluded input into
 *   a visible review item with a task, remembers the previous verdict and
 *   writes an audit event. Nothing is deleted from the mailbox or here.
 */
@Injectable()
export class IntakeDecisionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tasks: TasksService,
  ) {}

  async list(tenantId: string, view: IntakeDecisionView, limit = 50): Promise<IntakeDecisionListItem[]> {
    const rows = await this.prisma.forTenantId(tenantId).intakeDecision.findMany({
      where: viewFilter(view),
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
      include: { intakeEvent: true },
    });
    return rows.map((row) => this.toItem(row, row.intakeEvent));
  }

  async findOne(tenantId: string, id: string): Promise<IntakeDecisionListItem> {
    const row = await this.prisma.forTenantId(tenantId).intakeDecision.findUnique({ where: { id }, include: { intakeEvent: true } });
    if (!row) throw new NotFoundError('Intake decision not found.', { id });
    return this.toItem(row, row.intakeEvent);
  }

  async review(tenantId: string, actorUserId: string, id: string, note: string | undefined): Promise<IntakeDecisionListItem> {
    const scoped = this.prisma.forTenantId(tenantId);
    const decision = await scoped.intakeDecision.findUnique({ where: { id }, include: { intakeEvent: true } });
    if (!decision) throw new NotFoundError('Intake decision not found.', { id });
    if (decision.status === 'OVERRIDDEN') {
      // Idempotent: a second click returns the already-reviewed state instead of failing or creating a second task.
      return this.toItem(decision, decision.intakeEvent);
    }
    if (decision.appliedRelevance !== 'NON_ACTIONABLE' && decision.appliedRelevance !== 'PRIVATE_PERSONAL') {
      throw new ValidationFailedError('Only an excluded input can be re-opened for business review.', {
        id,
        appliedRelevance: decision.appliedRelevance,
      });
    }

    const updated = await scoped.intakeDecision.update({
      where: { id },
      data: {
        status: 'OVERRIDDEN',
        previousRelevance: decision.appliedRelevance,
        appliedRelevance: 'UNKNOWN_REQUIRES_REVIEW',
        reviewedByUserId: actorUserId,
        reviewedAt: new Date(),
        reviewNote: note ?? null,
      },
      include: { intakeEvent: true },
    });
    await scoped.intakeEvent.update({
      where: { id: decision.intakeEventId },
      data: { relevance: 'UNKNOWN_REQUIRES_REVIEW', status: 'NEEDS_REVIEW' },
    });
    await this.tasks.create(
      tenantId,
      actorUserId,
      {
        title: `Prüfung erforderlich: ${decision.intakeEvent.subject ?? '(ohne Betreff)'}`,
        description: `Ein Mitarbeiter hat diesen als nicht geschäftsrelevant ausgefilterten Eingang zur Prüfung freigegeben.${note ? ` Hinweis: ${note}` : ''}`,
      },
      'USER',
      'USER',
    );
    await this.audit.record({
      tenantId,
      eventType: 'INTAKE_DECISION_OVERRIDDEN',
      actorType: 'USER',
      actorUserId,
      entityType: 'IntakeDecision',
      entityId: id,
      payload: { intakeEventId: decision.intakeEventId, previousRelevance: decision.appliedRelevance, note: note ?? null },
    });
    return this.toItem(updated, updated.intakeEvent);
  }

  private toItem(decision: IntakeDecision, event: IntakeEvent): IntakeDecisionListItem {
    const result = (decision.result ?? null) as TriageResult | null;
    const hints = (decision.hints ?? {}) as { basis?: string; skipReason?: string };
    const execution = (decision.execution ?? null) as (ExecutionEvidenceSnapshot & Record<string, unknown>) | null;
    const excluded = decision.appliedRelevance === 'NON_ACTIONABLE' || decision.appliedRelevance === 'PRIVATE_PERSONAL';
    return {
      id: decision.id,
      intakeEventId: decision.intakeEventId,
      status: decision.status,
      appliedRelevance: decision.appliedRelevance,
      category: result?.category ?? null,
      businessRelevance: result?.businessRelevance ?? null,
      conciseReason: result?.conciseReason ?? (hints.skipReason === 'AUTO_GENERATED' ? 'Automatisch erzeugte Nachricht (z. B. Abwesenheitsnotiz).' : null),
      confidence: result?.confidence ?? null,
      riskFlags: result?.riskFlags ?? [],
      basis: hints.basis ?? null,
      failureReason: decision.failureReason,
      execution: execution
        ? {
            provider: String(execution.provider ?? ''),
            model: (execution.model as string | null | undefined) ?? null,
            mode: String(execution.mode ?? ''),
            latencyMs: Number(execution.latencyMs ?? 0),
            promptVersion: execution.promptVersion as string | undefined,
          }
        : null,
      channel: event.channel,
      provider: event.provider,
      subject: event.subject,
      sender: (event.senderRef ?? null) as IntakeDecisionListItem['sender'],
      occurredAt: event.occurredAt,
      action: excluded ? 'Keine' : decision.status === 'PENDING_TRIAGE' ? 'Triage ausstehend' : 'Prüfung erforderlich',
      reviewed:
        decision.status === 'OVERRIDDEN'
          ? {
              byUserId: decision.reviewedByUserId,
              at: decision.reviewedAt,
              note: decision.reviewNote,
              previousRelevance: decision.previousRelevance,
            }
          : null,
    };
  }
}
