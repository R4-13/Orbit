import { randomUUID, createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { LLMCompletionRequest, LLMProvider } from '@orbit/agent-core';
import { MockLLMProvider, wrapUntrustedContent } from '@orbit/agent-core';
import type { Case, IntakeRelevance, Prisma } from '@orbit/domain';
import { LLM_PROVIDER } from '../agent/agent.tokens';
import { AgentRunRecorderService } from '../agent/agent-run-recorder.service';
import { AgentDefinitionResolverService } from '../agent-definitions/agent-definition-resolver.service';
import { AuditService } from '../audit/audit.service';
import { CasesService } from '../cases/cases.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { TasksService } from '../tasks/tasks.service';
import { WorkflowRunnerService } from '../workflows/workflow-runner.service';
import { ExecutionEvidenceService } from './execution-evidence.service';
import type { NormalizedIntakeEvent } from './channel-event.types';
import type { IncomingEmailDto } from './dto/incoming-email.dto';

export interface IntakeResult {
  case?: Case;
  category: 'FINANCE' | 'SALES' | 'OTHER';
  agentRunIds: string[];
  intakeEventId: string;
}

/** Low-confidence or ambiguous triage verdicts are forced to UNKNOWN_REQUIRES_REVIEW here — deterministic application logic, not left to the LLM/tool's own judgment (§4 of docs/CHANNEL_EVENT_RUNTIME_PLAN.md). */
interface DomainHandlerResult {
  agentRunId?: string;
  /** Set when the durable workflow ended FAILED — the IntakeEvent must then end FAILED, not COMPLETED. */
  failureMessage?: string;
  /** An external effect may have happened (Amendment 02 §15.2) — the IntakeEvent needs review, not a retry. */
  outcomeUnknown?: boolean;
}

const RELEVANCE_CONFIDENCE_THRESHOLD = 0.5;

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

/**
 * Channel Event Runtime (docs/CHANNEL_EVENT_RUNTIME_PLAN.md) — the single
 * true entry point for every inbound intake source is `handleIntakeEvent()`.
 * `handleIncomingEmail()` (the `/inbox` "simulate incoming email" form's
 * target, and still `IntakeController`'s public contract) is now a thin
 * adapter that builds a `NormalizedIntakeEvent` and calls it — simulation
 * is "just another source" into the same pipeline, not a parallel path.
 * A real channel adapter (Increment C's `GmailPollAdapter`) converges on
 * the exact same method.
 *
 * Pipeline per event: persist `EmailMessage` (full source data) +
 * `IntakeEvent` (orchestration/audit record, references only — see its
 * schema doc comment) → Relevance/Triage (`assessRelevance()`, a dedicated
 * `AgentRun`, BEFORE any domain classification) → only
 * `BUSINESS_ACTIONABLE` proceeds to the existing FINANCE/SALES/OTHER
 * `classify()` step, unchanged → `Case` creation → domain-specific agent
 * turn via `DOMAIN_WORKFLOW_HANDLERS` (a lookup table, not nested if/else —
 * a future domain registers one new entry, no change to this dispatch
 * loop). `UNKNOWN_REQUIRES_REVIEW` creates a human-review `Task` instead of
 * guessing a domain; `NON_ACTIONABLE`/`PRIVATE_PERSONAL` are logged and
 * skipped; `BUSINESS_INFORMATIONAL` is logged with no automatic workflow.
 *
 * **Increment G (docs/CHANNEL_EVENT_RUNTIME_PLAN.md):** Finance/Sales now
 * execute via `triggerWorkflow()` -> `WorkflowRunnerService.trigger()`, the
 * durable `WorkflowDefinition`/`WorkflowRun`/`WorkflowStepRun` engine —
 * not the bespoke per-service agent-turn+approval orchestration this file
 * used before. Document upload, name-guessing, and MockLLMProvider seeding
 * in `runFinanceAgent()`/`runSalesAgent()` are unchanged; only the final
 * dispatch call moved.
 */
@Injectable()
export class IntakeService {
  constructor(
    @Inject(LLM_PROVIDER) private readonly llm: LLMProvider,
    private readonly agentDefinitions: AgentDefinitionResolverService,
    private readonly runs: AgentRunRecorderService,
    private readonly cases: CasesService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly tasks: TasksService,
    private readonly prisma: PrismaService,
    private readonly workflowRunner: WorkflowRunnerService,
    private readonly executionEvidence: ExecutionEvidenceService,
  ) {}

  async handleIncomingEmail(tenantId: string, actorUserId: string | undefined, input: IncomingEmailDto): Promise<IntakeResult> {
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

  async handleIntakeEvent(tenantId: string, actorUserId: string | undefined, event: NormalizedIntakeEvent): Promise<IntakeResult> {
    const inboundEmail = await this.prisma.forTenantId(tenantId).emailMessage.create({
      data: {
        tenantId,
        direction: 'INBOUND',
        fromAddress: event.sender?.address ?? '',
        toAddresses: (event.recipients ?? []).map((r) => r.address ?? '').filter(Boolean),
        subject: event.subject,
        bodyPreview: event.content?.slice(0, 500),
        providerMessageId: event.channel === 'SIMULATED' ? null : event.externalEventId,
        receivedAt: event.occurredAt,
      },
    });
    await this.audit.record({
      tenantId,
      eventType: 'EMAIL_RECEIVED',
      actorType: 'AGENT',
      entityType: 'EmailMessage',
      entityId: inboundEmail.id,
      payload: { fromAddress: event.sender?.address, subject: event.subject },
    });

    const intakeEvent = await this.prisma.forTenantId(tenantId).intakeEvent.create({
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
        status: 'RECEIVED',
      },
    });

    // Record what is real vs. simulated for THIS run now (Amendment 02 §19.4), before anything can fail.
    const execution = await this.executionEvidence.capture(tenantId, {
      channelProvider: event.provider,
      simulatedChannel: event.channel === 'SIMULATED',
    });
    await this.prisma.forTenantId(tenantId).intakeEvent.update({
      where: { id: intakeEvent.id },
      data: { metadata: { execution } as unknown as Prisma.InputJsonValue },
    });

    const triage = await this.assessRelevance(tenantId, actorUserId, event);
    const relevance = this.enforceRelevanceThreshold(triage);
    await this.prisma.forTenantId(tenantId).intakeEvent.update({
      where: { id: intakeEvent.id },
      data: { relevance, status: 'TRIAGED' },
    });

    if (relevance === 'NON_ACTIONABLE' || relevance === 'PRIVATE_PERSONAL') {
      await this.prisma.forTenantId(tenantId).intakeEvent.update({
        where: { id: intakeEvent.id },
        data: { status: 'SKIPPED_NON_ACTIONABLE' },
      });
      return { category: 'OTHER', agentRunIds: [], intakeEventId: intakeEvent.id };
    }

    if (relevance === 'UNKNOWN_REQUIRES_REVIEW') {
      await this.tasks.create(
        tenantId,
        actorUserId,
        {
          title: `Prüfung erforderlich: ${event.subject ?? '(ohne Betreff)'}`,
          description: `Der Triage-Agent konnte die Relevanz nicht sicher einstufen (Begründung: ${triage.reasoning}). Bitte manuell prüfen, ob dies ein geschäftlicher Vorgang ist.`,
        },
        'AGENT',
        'AGENT',
      );
      await this.prisma.forTenantId(tenantId).intakeEvent.update({
        where: { id: intakeEvent.id },
        data: { status: 'NEEDS_REVIEW' },
      });
      return { category: 'OTHER', agentRunIds: [], intakeEventId: intakeEvent.id };
    }

    if (relevance === 'BUSINESS_INFORMATIONAL') {
      await this.prisma.forTenantId(tenantId).intakeEvent.update({
        where: { id: intakeEvent.id },
        data: { status: 'COMPLETED' },
      });
      return { category: 'OTHER', agentRunIds: [], intakeEventId: intakeEvent.id };
    }

    // relevance === 'BUSINESS_ACTIONABLE' — proceed to the existing domain classification/routing, unchanged.
    const category = await this.classify(tenantId, actorUserId, {
      subject: event.subject ?? '',
      bodyText: event.content ?? '',
      hasAttachment: Boolean(event.attachments?.length),
    });
    await this.prisma.forTenantId(tenantId).emailMessage.update({ where: { id: inboundEmail.id }, data: { classification: category } });
    await this.prisma
      .forTenantId(tenantId)
      .intakeEvent.update({ where: { id: intakeEvent.id }, data: { domainCategory: category, status: 'ROUTED' } });

    if (category === 'OTHER') {
      await this.prisma.forTenantId(tenantId).intakeEvent.update({ where: { id: intakeEvent.id }, data: { status: 'COMPLETED' } });
      return { category, agentRunIds: [], intakeEventId: intakeEvent.id };
    }

    const businessCase = await this.cases.create(tenantId, actorUserId ?? '', {
      type: category,
      title: category === 'FINANCE' ? `Rechnungseingang: ${event.subject ?? ''}` : `Neue Anfrage: ${event.subject ?? ''}`,
      description: event.content?.slice(0, 1000),
    });
    await this.prisma.forTenantId(tenantId).emailMessage.update({ where: { id: inboundEmail.id }, data: { caseId: businessCase.id } });
    await this.prisma
      .forTenantId(tenantId)
      .intakeEvent.update({ where: { id: intakeEvent.id }, data: { caseId: businessCase.id, status: 'PROCESSING' } });

    const handler = this.domainWorkflowHandlers[category];
    let agentRunIds: string[] = [];
    let workflowFailure: string | undefined;
    let workflowOutcomeUnknown = false;
    try {
      const handled = handler ? await handler(tenantId, actorUserId, businessCase, event, intakeEvent.id) : null;
      agentRunIds = handled?.agentRunId ? [handled.agentRunId] : [];
      workflowFailure = handled?.failureMessage;
      workflowOutcomeUnknown = handled?.outcomeUnknown ?? false;
    } catch (error) {
      await this.prisma.forTenantId(tenantId).intakeEvent.update({
        where: { id: intakeEvent.id },
        data: { status: 'FAILED', errorMessage: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }

    // A failed workflow is not a completed intake — without this the IntakeEvent (and anything
    // derived from it, e.g. the connector's operational status) would claim success.
    await this.prisma.forTenantId(tenantId).intakeEvent.update({
      where: { id: intakeEvent.id },
      data: workflowFailure
        ? { status: workflowOutcomeUnknown ? 'NEEDS_REVIEW' : 'FAILED', errorMessage: workflowFailure }
        : { status: 'COMPLETED' },
    });
    return { case: businessCase, category, agentRunIds, intakeEventId: intakeEvent.id };
  }

  /**
   * Relevance/Triage — runs BEFORE domain classification, its own
   * `AgentRun` (no `caseId`, same shape as `classify()`'s own run — a
   * `Case` may not even exist yet at this point, matches how
   * `AgentRun.caseId` is already nullable for exactly this reason).
   * Resolves the dedicated "triage" `AgentDefinition` — a 4th key next to
   * communication-intake/finance-intake/sales-intake, same resolver, no
   * special-casing needed (§5 of the user's design: a dedicated Triage
   * agent reusing AgentRuntime/ToolRegistry/AgentDefinitionResolverService
   * is fine).
   */
  private async assessRelevance(
    tenantId: string,
    actorUserId: string | undefined,
    event: NormalizedIntakeEvent,
  ): Promise<{ relevance: IntakeRelevance; confidence: number; reasoning: string }> {
    if (this.llm instanceof MockLLMProvider) {
      this.llm.seedResponse({
        toolCalls: [
          {
            toolCallId: randomUUID(),
            toolName: 'assess_relevance',
            input: { subject: event.subject ?? '', content: event.content ?? '' },
          },
        ],
        stopReason: 'tool_use',
      });
    }

    const run = await this.runs.start({
      tenantId,
      agentType: 'COMMUNICATION',
      triggerType: event.channel === 'SIMULATED' ? 'MANUAL' : 'EMAIL',
      input: { subject: event.subject },
    });

    const { systemPrompt, runtime } = await this.agentDefinitions.resolve(tenantId, 'triage');
    const result = await runtime.runTurn(
      { tenantId, agentRunId: run.id, actorUserId },
      {
        systemPrompt,
        messages: [{ role: 'user', content: wrapUntrustedContent(`Betreff: ${event.subject ?? ''}\n\n${event.content ?? ''}`) }],
        maxToolIterations: 2,
      },
    );

    await this.runs.recordToolCalls(tenantId, run.id, result.toolCallOutcomes);
    await this.runs.complete(tenantId, run.id, result);

    const outcome = result.toolCallOutcomes.find((o) => o.toolName === 'assess_relevance');
    const output = outcome?.output as { relevance?: IntakeRelevance; confidence?: number; reasoning?: string } | undefined;
    return {
      relevance: output?.relevance ?? 'UNKNOWN_REQUIRES_REVIEW',
      confidence: output?.confidence ?? 0,
      reasoning: output?.reasoning ?? 'Keine Einstufung durch den Triage-Agenten erhalten.',
    };
  }

  /** Deterministic enforcement, independent of what the tool/LLM itself returned — §4: "thresholds and consequences of low confidence must be enforced deterministically by application/policy logic." */
  private enforceRelevanceThreshold(triage: { relevance: IntakeRelevance; confidence: number }): IntakeRelevance {
    if (triage.confidence < RELEVANCE_CONFIDENCE_THRESHOLD) {
      return 'UNKNOWN_REQUIRES_REVIEW';
    }
    return triage.relevance;
  }

  private async classify(
    tenantId: string,
    actorUserId: string | undefined,
    input: { subject: string; bodyText: string; hasAttachment: boolean },
  ): Promise<'FINANCE' | 'SALES' | 'OTHER'> {
    if (this.llm instanceof MockLLMProvider) {
      // Deliberately seeds only this one response, not a trailing
      // "end_turn" too: MockLLMProvider.complete() already returns a safe
      // empty end_turn once its queue runs dry, so a manually-seeded
      // trailing entry would only ever be *right* when the tool call
      // before it happens to lead to exactly one more iteration — wrong
      // whenever it doesn't, since MockLLMProvider is a single
      // process-wide singleton and a leftover unconsumed seed then
      // corrupts the *next*, unrelated intake call's first response.
      // Found live via apps/api/test/intake-workflow.e2e-spec.ts — see
      // docs/ASSUMPTIONS.md Phase 18.
      this.llm.seedResponse({
        toolCalls: [
          {
            toolCallId: randomUUID(),
            toolName: 'classify_message',
            input: { subject: input.subject, bodyText: input.bodyText, hasAttachment: input.hasAttachment },
          },
        ],
        stopReason: 'tool_use',
      });
    }

    const run = await this.runs.start({
      tenantId,
      agentType: 'COMMUNICATION',
      triggerType: 'EMAIL',
      input: { subject: input.subject },
    });

    const { systemPrompt, runtime } = await this.agentDefinitions.resolve(tenantId, 'communication-intake');
    const result = await runtime.runTurn(
      { tenantId, agentRunId: run.id, actorUserId },
      {
        systemPrompt,
        messages: [{ role: 'user', content: wrapUntrustedContent(`Betreff: ${input.subject}\n\n${input.bodyText}`) }],
        maxToolIterations: 2,
      },
    );

    await this.runs.recordToolCalls(tenantId, run.id, result.toolCallOutcomes);
    await this.runs.complete(tenantId, run.id, result);

    const classification = result.toolCallOutcomes.find((o) => o.toolName === 'classify_message');
    const output = classification?.output as { category?: 'FINANCE' | 'SALES' | 'OTHER' } | undefined;
    return output?.category ?? 'OTHER';
  }

  private async runFinanceAgent(
    tenantId: string,
    actorUserId: string | undefined,
    businessCase: Case,
    event: NormalizedIntakeEvent,
    intakeEventId: string,
  ): Promise<DomainHandlerResult> {
    const attachment = event.attachments?.[0];
    if (!attachment) {
      throw new Error('runFinanceAgent called without an attachment — caller (domainWorkflowHandlers.FINANCE) must guard this.');
    }
    const bytes = Buffer.from(attachment.contentBase64, 'base64');
    const checksum = createHash('sha256').update(bytes).digest('hex');
    const storageKey = this.storage.buildStorageKey(tenantId, attachment.fileName);
    await this.storage.putObjectBytes(storageKey, bytes, attachment.mimeType);

    const document = await this.prisma.forTenantId(tenantId).document.create({
      data: {
        tenantId,
        caseId: businessCase.id,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        sizeBytes: bytes.byteLength,
        storageKey,
        checksum,
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

    if (this.llm instanceof MockLLMProvider) {
      this.llm.seedResponse({
        toolCalls: [
          { toolCallId: randomUUID(), toolName: 'extract_invoice', input: { documentId: document.id, caseId: businessCase.id } },
        ],
        stopReason: 'tool_use',
      });
      this.llm.seedResponse((request) => {
        const invoice = parseToolResult<{ id: string; amountGross?: string | number | null }>(
          request,
          'extract_invoice',
        );
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
      // No trailing manual end_turn seed — see the comment in classify().
    }

    return this.triggerWorkflow(tenantId, actorUserId, 'finance-invoice-intake', businessCase.id, intakeEventId, {
      documentId: document.id,
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
      // No trailing manual end_turn seed — see the comment in classify().
    }

    return this.triggerWorkflow(tenantId, actorUserId, 'sales-lead-intake', businessCase.id, intakeEventId, {
      subject: event.subject ?? '',
      content: event.content ?? '',
      caseId: businessCase.id,
    });
  }

  /**
   * Increment G (docs/CHANNEL_EVENT_RUNTIME_PLAN.md) — the single dispatch
   * point both `runFinanceAgent()`/`runSalesAgent()` now call instead of
   * the removed bespoke `runAgentTurn()`. `WorkflowRunnerService.trigger()`
   * already does everything that method used to do by hand: starts the
   * `AgentRun`, runs the turn, and creates `FOLLOW_UP` `Approval` rows for
   * any non-ALLOW/non-DENY tool outcome (identical shape to the removed
   * `createApprovalsForBlockedCalls()` — safe to delete, not reimplemented).
   * Also links the resulting `WorkflowRun` back onto the `IntakeEvent` that
   * triggered it (the `workflowRunId` field added in Increment A for
   * exactly this purpose).
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
    };
  }

  /**
   * Domain routing as a lookup table, not nested if/else (§8 of
   * docs/CHANNEL_EVENT_RUNTIME_PLAN.md: "Do not overfit to the current two
   * domains... extensible so future workflow types can be registered
   * without rebuilding the... runtime"). A future domain adds one entry
   * here and one private method above — `handleIntakeEvent()`'s dispatch
   * loop itself never changes. Each handler decides internally whether it
   * has enough to act (e.g. FINANCE needs an attachment) — the generic
   * dispatcher doesn't encode any domain-specific precondition. A class
   * field (not a module-level const) so the arrow functions can close
   * over `this` and call the private `runFinanceAgent`/`runSalesAgent`
   * methods directly, no awkward external-access workaround needed.
   */
  private readonly domainWorkflowHandlers: Record<
    string,
    (
      tenantId: string,
      actorUserId: string | undefined,
      businessCase: Case,
      event: NormalizedIntakeEvent,
      intakeEventId: string,
    ) => Promise<DomainHandlerResult | null>
  > = {
    FINANCE: (tenantId, actorUserId, businessCase, event, intakeEventId) => {
      if (!event.attachments?.length) return Promise.resolve(null);
      return this.runFinanceAgent(tenantId, actorUserId, businessCase, event, intakeEventId);
    },
    SALES: (tenantId, actorUserId, businessCase, event, intakeEventId) =>
      this.runSalesAgent(tenantId, actorUserId, businessCase, event, intakeEventId),
  };
}
