import { randomUUID, createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { LLMCompletionRequest, LLMProvider } from '@orbit/agent-core';
import { MockLLMProvider } from '@orbit/agent-core';
import type { OrbitEnv } from '@orbit/config';
import type { Case, IntakeEventStatus, IntakeRelevance, Prisma } from '@orbit/domain';
import { NotFoundError, ValidationFailedError, triageFixtureForScenario, type SimulatedTriageScenario, type TriageResult } from '@orbit/shared';
import { LLM_PROVIDER } from '../agent/agent.tokens';
import { AiProviderResolverService } from '../ai-providers/ai-provider-resolver.service';
import { AuditService } from '../audit/audit.service';
import { CasesService } from '../cases/cases.service';
import { ORBIT_ENV } from '../config/env.token';
import { PrismaService } from '../prisma/prisma.service';
import { BlueprintRegistryService } from '../process/blueprint-registry.service';
import { CaseCorrelationService } from '../process/case-correlation.service';
import { CaseFactsService, type FactInput } from '../process/case-facts.service';
import { CaseLifecycleService } from '../process/case-lifecycle.service';
import { OrchestratorService } from '../process/orchestrator.service';
import { StorageService } from '../storage/storage.service';
import { TasksService } from '../tasks/tasks.service';
import { WorkflowRunnerService } from '../workflows/workflow-runner.service';
import type { NormalizedIntakeEvent } from './channel-event.types';
import type { IncomingEmailDto } from './dto/incoming-email.dto';
import { ExecutionEvidenceService } from './execution-evidence.service';
import { SUBMIT_TRIAGE_TOOL, SemanticTriageService, type TriageOutcome } from './semantic-triage.service';
import { deriveAppliedRelevance, routeForCategory, type DomainRoute } from './triage-decision';

export interface IntakeResult {
  case?: Case;
  category: 'FINANCE' | 'SALES' | 'OTHER';
  agentRunIds: string[];
  intakeEventId: string;
  /** Final processing state of the IntakeEvent — the caller must not have to infer "what happened" from `category`. */
  intakeStatus?: IntakeEventStatus;
}

interface DomainHandlerResult {
  agentRunId?: string;
  /** Set when the durable workflow ended FAILED — the IntakeEvent must then end FAILED, not COMPLETED. */
  failureMessage?: string;
  /** An external effect may have happened (Amendment 02 §15.2) — the IntakeEvent needs review, not a retry. */
  outcomeUnknown?: boolean;
  /** The durable workflow paused for a human approval — the case must say so, not look finished. */
  waitingForApproval?: boolean;
}

/** What `persistIntake()` stored — everything a later retry needs, so a pending triage never loses an input. */
interface PersistedIntake {
  inboundEmailId: string;
  intakeEventId: string;
  documentIds: string[];
}

/** Stored full-text cap: enough for triage/extraction, not an unbounded copy of arbitrary mail (retention applies, Amendment 02 §19.3). */
const MAX_STORED_BODY_CHARS = 100_000;
/** After this many failed triage attempts the input goes to a human instead of retrying forever. */
const MAX_TRIAGE_RETRIES = 6;
const TRIAGE_RETRY_BASE_MS = 60_000;
const TRIAGE_RETRY_MAX_MS = 30 * 60_000;

/** Parses the JSON payload AgentRuntime appends as `[tool_result:toolName] {...}`. */
function parseToolResult<T>(request: LLMCompletionRequest, toolName: string): T | undefined {
  const marker = `[tool_result:${toolName}]`;
  for (let i = request.messages.length - 1; i >= 0; i -= 1) {
    const content = request.messages[i]?.content;
    if (content?.startsWith(marker)) {
      return JSON.parse(content.slice(marker.length).trim()) as T;
    }
  }
  return undefined;
}

function retryDelayMs(retryCount: number): number {
  return Math.min(TRIAGE_RETRY_BASE_MS * 2 ** Math.max(0, retryCount - 1), TRIAGE_RETRY_MAX_MS);
}

/**
 * Channel Event Runtime (docs/CHANNEL_EVENT_RUNTIME_PLAN.md) — the single
 * true entry point for every inbound intake source is `handleIntakeEvent()`.
 * `handleIncomingEmail()` (the `/inbox` "simulate incoming email" form) is a
 * thin adapter onto it; a real channel adapter (`GmailPollAdapter`) converges
 * on the same method.
 *
 * Pipeline (Amendment 02 §5/§6): persist the source (full normalized body,
 * thread headers, attachments as Documents) + an `IntakeEvent` →
 * deterministic safety gates (own outbound message, auto-generated mail) →
 * **semantic triage** through the real provider path (`SemanticTriageService`)
 * → an `IntakeDecision` → deterministic thresholds (`deriveAppliedRelevance`)
 * → only a confidently relevant message with a configured route becomes a
 * `Case` and runs the existing Finance/Sales workflow. Everything uncertain,
 * unsupported or unroutable stays visible as a review item; only a *safely*
 * non-business input is filtered, and then it still has a decision record.
 * A provider outage never filters or completes anything: the input waits as
 * `PENDING_TRIAGE` and is retried.
 *
 * Keyword matching no longer decides relevance or routing. The remaining
 * mock-mode seeding below drives the *domain agents'* tool calls in
 * simulation only and is recorded as SIMULATED execution evidence.
 */
@Injectable()
export class IntakeService {
  constructor(
    @Inject(LLM_PROVIDER) private readonly llm: LLMProvider,
    @Inject(ORBIT_ENV) private readonly env: OrbitEnv,
    private readonly aiProviders: AiProviderResolverService,
    private readonly triage: SemanticTriageService,
    private readonly cases: CasesService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly tasks: TasksService,
    private readonly prisma: PrismaService,
    private readonly workflowRunner: WorkflowRunnerService,
    private readonly executionEvidence: ExecutionEvidenceService,
    private readonly facts: CaseFactsService,
    private readonly lifecycle: CaseLifecycleService,
    private readonly correlation: CaseCorrelationService,
    private readonly blueprints: BlueprintRegistryService,
    private readonly orchestrator: OrchestratorService,
  ) {}

  async handleIncomingEmail(tenantId: string, actorUserId: string | undefined, input: IncomingEmailDto): Promise<IntakeResult> {
    if (input.simulatedTriageScenario) {
      await this.seedSimulatedTriage(tenantId, input.simulatedTriageScenario);
    }
    const event: NormalizedIntakeEvent = {
      tenantId,
      channel: 'SIMULATED',
      provider: 'simulated',
      externalEventId: randomUUID(),
      occurredAt: new Date(),
      sender: { address: input.fromAddress },
      recipients: input.toAddresses.map((address) => ({ address })),
      subject: input.subject,
      content: input.bodyText,
      attachments: input.attachment ? [input.attachment] : undefined,
    };
    return this.handleIntakeEvent(tenantId, actorUserId, event);
  }

  /** Demo/test hook: a chosen scenario becomes the simulated provider's scripted structured answer. Impossible with a real provider. */
  private async seedSimulatedTriage(tenantId: string, scenario: SimulatedTriageScenario): Promise<void> {
    const provider = await this.aiProviders.resolveForTenant(tenantId);
    if (!(provider instanceof MockLLMProvider)) {
      throw new ValidationFailedError(
        'Simulationsszenarien sind nur mit einem simulierten KI-Provider möglich; ein echter Provider entscheidet selbst.',
        { scenario },
      );
    }
    provider.seedResponse({
      toolCalls: [{ toolCallId: randomUUID(), toolName: SUBMIT_TRIAGE_TOOL, input: triageFixtureForScenario(scenario) as unknown as Record<string, unknown> }],
      stopReason: 'tool_use',
    });
  }

  async handleIntakeEvent(tenantId: string, actorUserId: string | undefined, event: NormalizedIntakeEvent): Promise<IntakeResult> {
    const persisted = await this.persistIntake(tenantId, actorUserId, event);
    return this.withFinalStatus(tenantId, await this.processIntake(tenantId, actorUserId, event, persisted));
  }

  private async withFinalStatus(tenantId: string, result: IntakeResult): Promise<IntakeResult> {
    const final = await this.prisma.forTenantId(tenantId).intakeEvent.findUnique({ where: { id: result.intakeEventId }, select: { status: true } });
    return { ...result, intakeStatus: final?.status };
  }

  /**
   * Re-runs a `PENDING_TRIAGE` input from what was persisted (body, thread data, Documents) — no re-poll of the
   * provider needed, so an outage can never lose an input. Called by the channel-sync worker once `nextRetryAt` passes.
   */
  async retryPendingTriage(tenantId: string, intakeEventId: string): Promise<IntakeResult> {
    const scoped = this.prisma.forTenantId(tenantId);
    const intake = await scoped.intakeEvent.findUnique({ where: { id: intakeEventId }, include: { decision: true, emailMessage: true } });
    if (!intake?.emailMessage) throw new NotFoundError('IntakeEvent with a stored message not found.', { intakeEventId });
    if (intake.decision?.status !== 'PENDING_TRIAGE') {
      throw new ValidationFailedError('IntakeEvent is not waiting for triage.', { intakeEventId, status: intake.decision?.status });
    }
    const documents = await scoped.document.findMany({ where: { id: { in: intake.documentIds } } });
    const sender = (intake.senderRef ?? {}) as { address?: string; displayName?: string };
    const event: NormalizedIntakeEvent = {
      tenantId,
      connectionId: intake.connectionId ?? undefined,
      channel: intake.channel,
      provider: intake.provider,
      externalEventId: intake.externalEventId,
      occurredAt: intake.occurredAt,
      sender,
      recipients: ((intake.recipientRefs ?? []) as Array<{ address?: string }>) ?? [],
      subject: intake.subject ?? undefined,
      content: intake.emailMessage.bodyText ?? intake.emailMessage.bodyPreview ?? '',
      // Attachment bytes already live in storage as Documents; triage only needs name and type.
      attachments: documents.map((d) => ({ fileName: d.fileName, mimeType: d.mimeType, contentBase64: '' })),
      threadId: intake.emailMessage.threadId ?? undefined,
      rfcMessageId: intake.emailMessage.rfcMessageId ?? undefined,
      inReplyTo: intake.emailMessage.inReplyTo ?? undefined,
      references: intake.emailMessage.references,
    };
    return this.withFinalStatus(
      tenantId,
      await this.processIntake(tenantId, undefined, event, {
        inboundEmailId: intake.emailMessage.id,
        intakeEventId: intake.id,
        documentIds: intake.documentIds,
      }),
    );
  }

  private async persistIntake(tenantId: string, actorUserId: string | undefined, event: NormalizedIntakeEvent): Promise<PersistedIntake> {
    const scoped = this.prisma.forTenantId(tenantId);
    const body = (event.content ?? '').slice(0, MAX_STORED_BODY_CHARS);
    const contentHash = createHash('sha256')
      .update([event.subject ?? '', body, ...(event.attachments ?? []).map((a) => `${a.fileName}:${a.contentBase64.length}`)].join('\n'))
      .digest('hex');
    const direction = event.direction ?? 'INBOUND';

    // Our own sent message comes back through the mailbox sync: it was already stored when it was sent (with its case),
    // so it is reused instead of violating the provider-id uniqueness or creating a second copy.
    const knownOwn =
      direction === 'OUTBOUND' && event.channel !== 'SIMULATED'
        ? await scoped.emailMessage.findFirst({ where: { providerMessageId: event.externalEventId, direction: 'OUTBOUND' } })
        : null;
    const inboundEmail =
      knownOwn ??
      (await scoped.emailMessage.create({
      data: {
        tenantId,
        direction,
        fromAddress: event.sender?.address ?? '',
        toAddresses: (event.recipients ?? []).map((r) => r.address ?? '').filter(Boolean),
        subject: event.subject,
        bodyPreview: event.content?.slice(0, 500),
        bodyText: body,
        contentHash,
        threadId: event.threadId,
        rfcMessageId: event.rfcMessageId,
        inReplyTo: event.inReplyTo,
        references: event.references ?? [],
        providerMessageId: event.channel === 'SIMULATED' ? null : event.externalEventId,
        receivedAt: event.occurredAt,
      },
    }));
    if (!knownOwn) await this.audit.record({
      tenantId,
      eventType: 'EMAIL_RECEIVED',
      actorType: 'AGENT',
      entityType: 'EmailMessage',
      entityId: inboundEmail.id,
      payload: { fromAddress: event.sender?.address, subject: event.subject, direction },
    });

    // Attachments become Documents immediately (before triage), so a pending triage still holds every input byte.
    const documentIds: string[] = [];
    for (const attachment of event.attachments ?? []) {
      const bytes = Buffer.from(attachment.contentBase64, 'base64');
      const storageKey = this.storage.buildStorageKey(tenantId, attachment.fileName);
      await this.storage.putObjectBytes(storageKey, bytes, attachment.mimeType);
      const document = await scoped.document.create({
        data: {
          tenantId,
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
          sizeBytes: bytes.byteLength,
          storageKey,
          checksum: createHash('sha256').update(bytes).digest('hex'),
          uploadedByUserId: actorUserId,
        },
      });
      await this.audit.record({
        tenantId,
        eventType: 'DOCUMENT_UPLOADED',
        actorType: 'AGENT',
        actorUserId,
        entityType: 'Document',
        entityId: document.id,
        payload: { fileName: document.fileName },
      });
      documentIds.push(document.id);
    }

    const intakeEvent = await scoped.intakeEvent.create({
      data: {
        tenantId,
        connectionId: event.connectionId,
        channel: event.channel,
        provider: event.provider,
        externalEventId: event.externalEventId,
        occurredAt: event.occurredAt,
        senderRef: event.sender as Prisma.InputJsonValue | undefined,
        recipientRefs: event.recipients as Prisma.InputJsonValue | undefined,
        subject: event.subject,
        emailMessageId: inboundEmail.id,
        documentIds,
        status: 'RECEIVED',
      },
    });

    // Record what is real vs. simulated for THIS run now (Amendment 02 §19.4), before anything can fail.
    const execution = await this.executionEvidence.capture(tenantId, {
      channelProvider: event.provider,
      simulatedChannel: event.channel === 'SIMULATED',
    });
    await scoped.intakeEvent.update({
      where: { id: intakeEvent.id },
      data: { metadata: { execution } as unknown as Prisma.InputJsonValue },
    });

    return { inboundEmailId: inboundEmail.id, intakeEventId: intakeEvent.id, documentIds };
  }

  private async processIntake(
    tenantId: string,
    actorUserId: string | undefined,
    event: NormalizedIntakeEvent,
    persisted: PersistedIntake,
  ): Promise<IntakeResult> {
    const scoped = this.prisma.forTenantId(tenantId);
    const { intakeEventId } = persisted;
    const skipped: IntakeResult = { category: 'OTHER', agentRunIds: [], intakeEventId };

    // Gate 1 — our own outbound message: recorded for correlation, never a customer request (Amendment 02 §5.1, E19).
    if (event.direction === 'OUTBOUND') {
      await scoped.intakeEvent.update({
        where: { id: intakeEventId },
        data: { status: 'SKIPPED_NON_ACTIONABLE', metadata: await this.mergeMetadata(tenantId, intakeEventId, { skipReason: 'OWN_OUTBOUND_MESSAGE' }) },
      });
      return skipped;
    }

    // Gate 2 — auto-generated mail (out-of-office, delivery report): deterministic, still gets a visible decision record
    // and — crucially for later wait/resume — can never be mistaken for a customer's answer (E18).
    if (event.hints?.autoGenerated) {
      await this.saveDecision(tenantId, intakeEventId, {
        status: 'DECIDED',
        appliedRelevance: 'NON_ACTIONABLE',
        hints: { skipReason: 'AUTO_GENERATED', ...event.hints },
      });
      await scoped.intakeEvent.update({ where: { id: intakeEventId }, data: { relevance: 'NON_ACTIONABLE', status: 'SKIPPED_NON_ACTIONABLE' } });
      return skipped;
    }

    // Gate 3 — a reply to a process-bound case continues that case (Amendment 02 §13): strong references only.
    const continued = await this.continueCorrelatedCase(tenantId, actorUserId, event, persisted);
    if (continued) return continued;

    const outcome = await this.triage.triage(tenantId, actorUserId, event);
    const hints = event.hints ? ({ ...event.hints } as Prisma.InputJsonValue) : undefined;
    const executionJson = outcome.execution as unknown as Prisma.InputJsonValue;

    if (outcome.status === 'PENDING_TRIAGE') {
      return this.handlePendingTriage(tenantId, actorUserId, event, persisted, outcome, hints, executionJson);
    }

    if (outcome.status === 'REVIEW_REQUIRED') {
      await this.saveDecision(tenantId, intakeEventId, {
        status: 'REVIEW_REQUIRED',
        appliedRelevance: 'UNKNOWN_REQUIRES_REVIEW',
        failureReason: `${outcome.failureReason}: ${outcome.detail}`,
        execution: executionJson,
        hints,
      });
      await this.sendToReview(tenantId, actorUserId, event, intakeEventId, outcome.detail, 'UNKNOWN_REQUIRES_REVIEW');
      return skipped;
    }

    const applied = deriveAppliedRelevance(outcome.result, {
      minConfidence: this.env.TRIAGE_MIN_CONFIDENCE,
      exclusionMinConfidence: this.env.TRIAGE_EXCLUSION_MIN_CONFIDENCE,
    });
    await this.saveDecision(tenantId, intakeEventId, {
      status: 'DECIDED',
      result: outcome.result as unknown as Prisma.InputJsonValue,
      appliedRelevance: applied.relevance,
      execution: executionJson,
      hints: { ...(hints as object | undefined), basis: applied.basis } as Prisma.InputJsonValue,
    });
    await scoped.intakeEvent.update({ where: { id: intakeEventId }, data: { relevance: applied.relevance, status: 'TRIAGED' } });

    if (applied.relevance === 'NON_ACTIONABLE' || applied.relevance === 'PRIVATE_PERSONAL') {
      await scoped.intakeEvent.update({ where: { id: intakeEventId }, data: { status: 'SKIPPED_NON_ACTIONABLE' } });
      return skipped;
    }

    if (applied.relevance === 'UNKNOWN_REQUIRES_REVIEW') {
      await this.sendToReview(tenantId, actorUserId, event, intakeEventId, `${applied.basis} Begründung der KI: ${outcome.result.conciseReason}`, applied.relevance);
      return skipped;
    }

    return this.routeBusinessInput(tenantId, actorUserId, event, persisted, outcome.result);
  }

  private async routeBusinessInput(
    tenantId: string,
    actorUserId: string | undefined,
    event: NormalizedIntakeEvent,
    persisted: PersistedIntake,
    triage: TriageResult,
  ): Promise<IntakeResult> {
    const scoped = this.prisma.forTenantId(tenantId);
    const { intakeEventId, inboundEmailId, documentIds } = persisted;
    const route = routeForCategory(triage.category);

    // A relevant business input with no configured process is NOT filtered out (Amendment 02 §6.1, E11-E14/E24).
    if (!route) {
      await scoped.emailMessage.update({ where: { id: inboundEmailId }, data: { classification: triage.category } });
      await this.sendToReview(
        tenantId,
        actorUserId,
        event,
        intakeEventId,
        `Geschäftlich relevant (Kategorie ${triage.category}), aber für diese Kategorie ist kein Prozess hinterlegt. Begründung der KI: ${triage.conciseReason}`,
        'BUSINESS_ACTIONABLE',
      );
      return { category: 'OTHER', agentRunIds: [], intakeEventId };
    }

    await scoped.emailMessage.update({ where: { id: inboundEmailId }, data: { classification: triage.category } });
    await scoped.intakeEvent.update({ where: { id: intakeEventId }, data: { domainCategory: route, status: 'ROUTED' } });

    const businessCase = await this.cases.create(tenantId, actorUserId ?? '', {
      type: route,
      title: route === 'FINANCE' ? `Rechnungseingang: ${event.subject ?? ''}` : `Neue Anfrage: ${event.subject ?? ''}`,
      description: event.content?.slice(0, 1000),
    });
    await scoped.emailMessage.update({ where: { id: inboundEmailId }, data: { caseId: businessCase.id } });
    if (documentIds.length > 0) {
      await scoped.document.updateMany({ where: { id: { in: documentIds } }, data: { caseId: businessCase.id } });
    }
    await scoped.intakeEvent.update({ where: { id: intakeEventId }, data: { caseId: businessCase.id, status: 'PROCESSING' } });

    // Universal Case (Amendment 02 §7): goals and intent from the triage, extracted facts as CANDIDATES with their
    // evidence (never promoted to confirmed here), and an honest process state from the first moment.
    await this.lifecycle.setGoals(tenantId, businessCase.id, { businessGoals: triage.proposedBusinessGoals, currentIntent: triage.intents[0]?.key });
    await this.facts.propose(
      tenantId,
      businessCase.id,
      triage.extractedFactCandidates.map(
        (candidate): FactInput => ({
          key: candidate.key,
          value: candidate.value,
          valueSchemaRef: candidate.valueSchemaRef,
          unit: candidate.unit,
          currency: candidate.currency,
          confidence: candidate.confidence,
          evidenceRefs: candidate.evidenceRefs,
          sourceType: 'EMAIL',
          sourceRef: inboundEmailId,
        }),
      ),
    );
    await this.lifecycle.transition(tenantId, businessCase.id, { to: 'IN_PROGRESS' }, { type: 'AGENT' });

    // A tenant with an active, published blueprint for this intent runs the generic process engine; otherwise the
    // pre-existing domain workflow stays exactly as it was.
    const blueprint = await this.blueprints.findActiveForIntent(tenantId, triage.category);
    if (blueprint) return this.runBlueprintProcess(tenantId, actorUserId, businessCase, intakeEventId, blueprint.row.key, route, event.subject ?? '');

    const handler = this.domainWorkflowHandlers[route];
    let agentRunIds: string[] = [];
    let workflowFailure: string | undefined;
    let workflowOutcomeUnknown = false;
    let handled: DomainHandlerResult | null = null;
    try {
      handled = handler ? await handler(tenantId, actorUserId, businessCase, event, intakeEventId, documentIds) : null;
      agentRunIds = handled?.agentRunId ? [handled.agentRunId] : [];
      workflowFailure = handled?.failureMessage;
      workflowOutcomeUnknown = handled?.outcomeUnknown ?? false;
    } catch (error) {
      await scoped.intakeEvent.update({
        where: { id: intakeEventId },
        data: { status: 'FAILED', errorMessage: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }

    // The category is routed but the handler had nothing to act on (e.g. an invoice mail without attachment): visible review, not "done".
    if (handled === null) {
      await this.lifecycle.transition(
        tenantId,
        businessCase.id,
        { to: 'MANUAL_REVIEW', attentionReasons: ['Die Voraussetzungen für den automatischen Ablauf fehlen (z. B. kein Anhang).'] },
        { type: 'AGENT' },
      );
      await this.sendToReview(
        tenantId,
        actorUserId,
        event,
        intakeEventId,
        `Kategorie ${triage.category} erkannt, aber die Voraussetzungen für den automatischen Ablauf fehlen (z. B. kein Anhang).`,
        'BUSINESS_ACTIONABLE',
      );
      return { case: businessCase, category: route, agentRunIds, intakeEventId };
    }

    // The case state follows the real outcome. A legacy domain workflow that succeeded only created records
    // (e.g. a lead) — that is not a verified completed process (§20.6), so the case stays open.
    if (workflowFailure) {
      await this.lifecycle.transition(
        tenantId,
        businessCase.id,
        { to: workflowOutcomeUnknown ? 'MANUAL_REVIEW' : 'FAILED', attentionReasons: [workflowFailure] },
        { type: 'AGENT' },
      );
    } else if (handled?.waitingForApproval) {
      await this.lifecycle.transition(tenantId, businessCase.id, { to: 'WAITING_FOR_APPROVAL', attentionReasons: ['Eine Freigabe ist offen.'] }, { type: 'AGENT' });
    }

    // A failed workflow is not a completed intake — without this the IntakeEvent (and anything
    // derived from it, e.g. the connector's operational status) would claim success.
    await scoped.intakeEvent.update({
      where: { id: intakeEventId },
      data: workflowFailure
        ? { status: workflowOutcomeUnknown ? 'NEEDS_REVIEW' : 'FAILED', errorMessage: workflowFailure }
        : { status: 'COMPLETED' },
    });
    return { case: businessCase, category: route, agentRunIds, intakeEventId };
  }

  private async runBlueprintProcess(
    tenantId: string,
    actorUserId: string | undefined,
    businessCase: Case,
    intakeEventId: string,
    blueprintKey: string,
    route: DomainRoute,
    subject: string,
  ): Promise<IntakeResult> {
    const scoped = this.prisma.forTenantId(tenantId);
    let failure: string | undefined;
    let outcome: Awaited<ReturnType<OrchestratorService['startCase']>> | undefined;
    try {
      outcome = await this.orchestrator.startCase(tenantId, businessCase.id, { userId: actorUserId, blueprintKey, intentSummary: subject });
      await this.orchestrator.advance(tenantId, businessCase.id);
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
    const fresh = (await scoped.case.findUnique({ where: { id: businessCase.id } })) ?? businessCase;
    // The intake is done once the process owns the case; what the case still needs is visible on the case itself.
    const needsReview = failure !== undefined || outcome?.outcome === 'MANUAL_REVIEW';
    await scoped.intakeEvent.update({
      where: { id: intakeEventId },
      data: failure
        ? { status: 'FAILED', errorMessage: failure.slice(0, 300) }
        : needsReview
          ? { status: 'NEEDS_REVIEW', errorMessage: (outcome?.reasons ?? []).join(' ').slice(0, 300) || null }
          : { status: 'COMPLETED' },
    });
    return { case: fresh, category: route, agentRunIds: [], intakeEventId };
  }

  /** Returns a result when the message was handled as part of an existing case (or sent to review), otherwise null. */
  private async continueCorrelatedCase(tenantId: string, actorUserId: string | undefined, event: NormalizedIntakeEvent, persisted: PersistedIntake): Promise<IntakeResult | null> {
    const scoped = this.prisma.forTenantId(tenantId);
    const { intakeEventId, inboundEmailId } = persisted;
    const result = await this.correlation.correlate({
      tenantId,
      emailMessageId: inboundEmailId,
      threadId: event.threadId,
      inReplyTo: event.inReplyTo,
      references: event.references,
      senderAddress: event.sender?.address,
    });

    if (result.status === 'AMBIGUOUS') {
      await this.saveDecision(tenantId, intakeEventId, {
        status: 'REVIEW_REQUIRED',
        appliedRelevance: 'UNKNOWN_REQUIRES_REVIEW',
        failureReason: 'CORRELATION_AMBIGUOUS: ' + (result.note ?? 'Mehrere Vorgänge kommen in Frage.'),
        hints: { candidateCaseIds: result.candidateCaseIds },
      });
      await this.sendToReview(tenantId, actorUserId, event, intakeEventId, 'Die Nachricht passt zu mehreren Vorgängen und wurde nicht automatisch zugeordnet.', 'UNKNOWN_REQUIRES_REVIEW');
      return { category: 'OTHER', agentRunIds: [], intakeEventId };
    }
    if (result.status !== 'MATCHED' || !result.caseId) return null;

    const matched = await scoped.case.findUnique({ where: { id: result.caseId } });
    // Only cases that run on a blueprint are continued here; legacy cases keep their pre-existing behaviour.
    if (!matched?.blueprintKey) return null;

    await scoped.emailMessage.update({ where: { id: inboundEmailId }, data: { caseId: matched.id } });
    await scoped.intakeEvent.update({ where: { id: intakeEventId }, data: { caseId: matched.id, status: 'PROCESSING' } });
    await this.saveDecision(tenantId, intakeEventId, { status: 'DECIDED', appliedRelevance: 'BUSINESS_ACTIONABLE', hints: { correlation: result.rule, caseId: matched.id } });
    await scoped.intakeEvent.update({ where: { id: intakeEventId }, data: { relevance: 'BUSINESS_ACTIONABLE' } });

    let failure: string | undefined;
    try {
      await this.orchestrator.receiveInbound(tenantId, matched.id, {
        type: 'communication.received',
        payload: { emailMessageId: inboundEmailId, threadId: event.threadId ?? null, from: event.sender?.address ?? null, rule: result.rule },
        dedupeKey: 'inbound:' + inboundEmailId,
      });
      await this.orchestrator.advance(tenantId, matched.id);
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
    await scoped.intakeEvent.update({ where: { id: intakeEventId }, data: failure ? { status: 'FAILED', errorMessage: failure.slice(0, 300) } : { status: 'COMPLETED' } });
    const fresh = (await scoped.case.findUnique({ where: { id: matched.id } })) ?? matched;
    return { case: fresh, category: matched.type === 'FINANCE' ? 'FINANCE' : 'SALES', agentRunIds: [], intakeEventId };
  }

  private async handlePendingTriage(
    tenantId: string,
    actorUserId: string | undefined,
    event: NormalizedIntakeEvent,
    persisted: PersistedIntake,
    outcome: Extract<TriageOutcome, { status: 'PENDING_TRIAGE' }>,
    hints: Prisma.InputJsonValue | undefined,
    executionJson: Prisma.InputJsonValue,
  ): Promise<IntakeResult> {
    const scoped = this.prisma.forTenantId(tenantId);
    const { intakeEventId } = persisted;
    const existing = await scoped.intakeDecision.findUnique({ where: { intakeEventId } });
    const retryCount = (existing?.retryCount ?? 0) + 1;

    if (retryCount >= MAX_TRIAGE_RETRIES) {
      await this.saveDecision(tenantId, intakeEventId, {
        status: 'REVIEW_REQUIRED',
        appliedRelevance: 'UNKNOWN_REQUIRES_REVIEW',
        failureReason: `${outcome.failureReason}: ${outcome.detail} (nach ${retryCount} Versuchen)`,
        execution: executionJson,
        hints,
        retryCount,
      });
      await this.sendToReview(tenantId, actorUserId, event, intakeEventId, `Die KI-Triage war auch nach ${retryCount} Versuchen nicht möglich: ${outcome.detail}`, 'UNKNOWN_REQUIRES_REVIEW');
      return { category: 'OTHER', agentRunIds: [], intakeEventId };
    }

    await this.saveDecision(tenantId, intakeEventId, {
      status: 'PENDING_TRIAGE',
      failureReason: `${outcome.failureReason}: ${outcome.detail}`,
      execution: executionJson,
      hints,
      retryCount,
      nextRetryAt: new Date(Date.now() + retryDelayMs(retryCount)),
    });
    await scoped.intakeEvent.update({ where: { id: intakeEventId }, data: { status: 'PENDING_TRIAGE', errorMessage: outcome.detail } });
    return { category: 'OTHER', agentRunIds: [], intakeEventId };
  }

  private async sendToReview(
    tenantId: string,
    actorUserId: string | undefined,
    event: NormalizedIntakeEvent,
    intakeEventId: string,
    reason: string,
    relevance: IntakeRelevance,
  ): Promise<void> {
    await this.tasks.create(
      tenantId,
      actorUserId,
      {
        title: `Prüfung erforderlich: ${event.subject ?? '(ohne Betreff)'}`,
        description: `${reason} Bitte manuell prüfen, wie mit diesem Eingang verfahren wird.`,
      },
      'AGENT',
      'AGENT',
    );
    await this.prisma.forTenantId(tenantId).intakeEvent.update({
      where: { id: intakeEventId },
      data: { relevance, status: 'NEEDS_REVIEW' },
    });
  }

  private async saveDecision(
    tenantId: string,
    intakeEventId: string,
    data: {
      status: 'DECIDED' | 'PENDING_TRIAGE' | 'REVIEW_REQUIRED';
      result?: Prisma.InputJsonValue;
      appliedRelevance?: IntakeRelevance;
      failureReason?: string;
      execution?: Prisma.InputJsonValue;
      hints?: Prisma.InputJsonValue;
      retryCount?: number;
      nextRetryAt?: Date;
    },
  ): Promise<void> {
    const common = {
      status: data.status,
      result: data.result,
      appliedRelevance: data.appliedRelevance,
      failureReason: data.failureReason ?? null,
      execution: data.execution,
      hints: data.hints,
      retryCount: data.retryCount ?? 0,
      nextRetryAt: data.nextRetryAt ?? null,
    };
    await this.prisma.forTenantId(tenantId).intakeDecision.upsert({
      where: { intakeEventId },
      create: { tenantId, intakeEventId, ...common },
      update: common,
    });
  }

  private async mergeMetadata(tenantId: string, intakeEventId: string, extra: Record<string, unknown>): Promise<Prisma.InputJsonValue> {
    const current = await this.prisma.forTenantId(tenantId).intakeEvent.findUnique({ where: { id: intakeEventId }, select: { metadata: true } });
    const base = current?.metadata && typeof current.metadata === 'object' && !Array.isArray(current.metadata) ? current.metadata : {};
    return { ...base, ...extra } as Prisma.InputJsonValue;
  }

  private async runFinanceAgent(
    tenantId: string,
    actorUserId: string | undefined,
    businessCase: Case,
    event: NormalizedIntakeEvent,
    intakeEventId: string,
    documentIds: string[],
  ): Promise<DomainHandlerResult> {
    const documentId = documentIds[0];
    if (!documentId) {
      throw new Error('runFinanceAgent called without a stored document — caller (domainWorkflowHandlers.FINANCE) must guard this.');
    }

    if (this.llm instanceof MockLLMProvider) {
      this.llm.seedResponse({
        toolCalls: [{ toolCallId: randomUUID(), toolName: 'extract_invoice', input: { documentId, caseId: businessCase.id } }],
        stopReason: 'tool_use',
      });
      this.llm.seedResponse((request) => {
        const invoice = parseToolResult<{ id: string; amountGross?: string | number | null }>(request, 'extract_invoice');
        if (!invoice || invoice.amountGross === null || invoice.amountGross === undefined) {
          return { toolCalls: [], stopReason: 'end_turn' };
        }
        return {
          toolCalls: [
            {
              toolCallId: randomUUID(),
              toolName: 'create_booking_proposal',
              input: {
                invoiceId: invoice.id,
                accountCode: '4400',
                description: 'Automatisch vom Finance Agent vorgeschlagen.',
                amount: Number(invoice.amountGross),
              },
            },
          ],
          stopReason: 'tool_use',
        };
      });
      // No trailing manual end_turn seed: MockLLMProvider returns a safe empty end_turn once its queue runs dry, and a
      // leftover unconsumed seed would corrupt the next, unrelated call on this process-wide singleton.
    }

    return this.triggerWorkflow(tenantId, actorUserId, 'finance-invoice-intake', businessCase.id, intakeEventId, {
      documentId,
      caseId: businessCase.id,
      subject: event.subject ?? '',
    });
  }

  private async runSalesAgent(
    tenantId: string,
    actorUserId: string | undefined,
    businessCase: Case,
    event: NormalizedIntakeEvent,
    intakeEventId: string,
  ): Promise<DomainHandlerResult> {
    const fromAddress = event.sender?.address ?? '';
    const domain = fromAddress.split('@')[1] ?? 'unbekannt.example';
    const companyNameGuess = domain.split('.')[0];
    const companyName = (companyNameGuess ?? 'Unbekannt').charAt(0).toUpperCase() + (companyNameGuess ?? 'unbekannt').slice(1);
    const localPart = fromAddress.split('@')[0] ?? 'kontakt';
    const [firstNameGuess, lastNameGuess] = localPart.split(/[._-]/);
    const firstName = firstNameGuess ? firstNameGuess.charAt(0).toUpperCase() + firstNameGuess.slice(1) : 'Neuer';
    const lastName = lastNameGuess ? lastNameGuess.charAt(0).toUpperCase() + lastNameGuess.slice(1) : 'Kontakt';

    if (this.llm instanceof MockLLMProvider) {
      this.llm.seedResponse({
        toolCalls: [{ toolCallId: randomUUID(), toolName: 'create_company', input: { name: companyName, domain } }],
        stopReason: 'tool_use',
      });
      this.llm.seedResponse((request) => {
        const company = parseToolResult<{ id: string }>(request, 'create_company');
        return {
          toolCalls: [
            {
              toolCallId: randomUUID(),
              toolName: 'create_contact',
              input: { email: fromAddress, firstName, lastName, companyId: company?.id },
            },
          ],
          stopReason: 'tool_use',
        };
      });
      this.llm.seedResponse((request) => {
        const contact = parseToolResult<{ id: string }>(request, 'create_contact');
        const company = parseToolResult<{ id: string }>(request, 'create_company');
        if (!contact) {
          return { toolCalls: [], stopReason: 'end_turn' };
        }
        return {
          toolCalls: [
            {
              toolCallId: randomUUID(),
              toolName: 'create_lead',
              input: {
                contactId: contact.id,
                companyId: company?.id,
                source: 'EMAIL',
                notes: event.content?.slice(0, 500),
                caseId: businessCase.id,
              },
            },
          ],
          stopReason: 'tool_use',
        };
      });
    }

    return this.triggerWorkflow(tenantId, actorUserId, 'sales-lead-intake', businessCase.id, intakeEventId, {
      subject: event.subject ?? '',
      content: event.content ?? '',
      caseId: businessCase.id,
    });
  }

  /**
   * Increment G (docs/CHANNEL_EVENT_RUNTIME_PLAN.md) — the single dispatch point for domain workflows:
   * `WorkflowRunnerService.trigger()` starts the AgentRun, runs the turn and creates FOLLOW_UP approvals for any
   * non-ALLOW outcome, then this links the resulting `WorkflowRun` back onto the triggering `IntakeEvent`.
   */
  private async triggerWorkflow(
    tenantId: string,
    actorUserId: string | undefined,
    workflowKey: string,
    caseId: string,
    intakeEventId: string,
    triggerInput: Record<string, unknown>,
  ): Promise<DomainHandlerResult> {
    const result = await this.workflowRunner.trigger(tenantId, actorUserId ?? '', workflowKey, triggerInput, caseId);
    await this.prisma.forTenantId(tenantId).intakeEvent.update({
      where: { id: intakeEventId },
      data: { workflowRunId: result.workflowRunId },
    });
    const failureMessage =
      result.status === 'FAILED'
        ? ((await this.prisma.forTenantId(tenantId).workflowRun.findUnique({ where: { id: result.workflowRunId } }))?.errorMessage ??
          'Der Workflow ist fehlgeschlagen.')
        : undefined;
    return {
      agentRunId: result.steps[0]?.agentRunId,
      failureMessage,
      outcomeUnknown: result.steps.some((step) => step.status === 'OUTCOME_UNKNOWN'),
      waitingForApproval: result.status === 'WAITING_FOR_APPROVAL',
    };
  }

  /**
   * Domain routing as a lookup table, not nested if/else: a future domain adds one entry here and one private method
   * above — the dispatch in `routeBusinessInput()` never changes. Each handler decides internally whether it has enough
   * to act (e.g. FINANCE needs a stored document); returning `null` sends the input to visible review.
   */
  private readonly domainWorkflowHandlers: Record<
    string,
    (
      tenantId: string,
      actorUserId: string | undefined,
      businessCase: Case,
      event: NormalizedIntakeEvent,
      intakeEventId: string,
      documentIds: string[],
    ) => Promise<DomainHandlerResult | null>
  > = {
    FINANCE: (tenantId, actorUserId, businessCase, event, intakeEventId, documentIds) => {
      if (documentIds.length === 0) return Promise.resolve(null);
      return this.runFinanceAgent(tenantId, actorUserId, businessCase, event, intakeEventId, documentIds);
    },
    SALES: (tenantId, actorUserId, businessCase, event, intakeEventId) =>
      this.runSalesAgent(tenantId, actorUserId, businessCase, event, intakeEventId),
  };
}
