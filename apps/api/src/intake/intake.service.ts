import { randomUUID, createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { LLMCompletionRequest, LLMProvider, ToolCallOutcome } from '@orbit/agent-core';
import { MockLLMProvider } from '@orbit/agent-core';
import type { Case } from '@orbit/domain';
import { LLM_PROVIDER } from '../agent/agent.tokens';
import { AgentRunRecorderService } from '../agent/agent-run-recorder.service';
import { AgentDefinitionResolverService } from '../agent-definitions/agent-definition-resolver.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { AuditService } from '../audit/audit.service';
import { CasesService } from '../cases/cases.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import type { IncomingEmailDto } from './dto/incoming-email.dto';

export interface IntakeResult {
  case?: Case;
  category: 'FINANCE' | 'SALES' | 'OTHER';
  agentRunIds: string[];
}

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
 * The Orchestrator + Communication/Intake Agent's entry point (§12): the
 * one place an "email arrived" event enters the system, since this MVP
 * has no real mail connector (§23/§29) to call it for us — see
 * docs/KNOWN_LIMITATIONS.md. Classifies the message, creates the Case
 * (closing the auto-Case-creation gap noted in MASTER_SPEC_GAP_ANALYSIS.md
 * §11 for this path specifically — existing direct human-driven
 * invoice/lead creation is deliberately left unchanged, see
 * docs/ASSUMPTIONS.md Phase 18), and dispatches to the Finance or Sales
 * agent turn.
 *
 * The *orchestration* itself (which agent runs next, in what order) is
 * still this hard-coded if/else — docs/AGENT_STUDIO_CONCEPT.md Abschnitt 3
 * explicitly defers generalizing that into a configurable
 * WorkflowDefinition to its own, later phase. What *is* wired up (Abschnitt
 * 1, "Agenten-Konfiguration"): each of the three `runAgentTurn`/`classify`
 * call sites resolves its system prompt + allowed tool set from a stored
 * `AgentDefinition` (via AgentDefinitionResolverService, key
 * "communication-intake"/"finance-intake"/"sales-intake") instead of a
 * literal string — editing an agent's prompt or tool grants at
 * /admin/agents changes what these calls actually do on the next request.
 */
@Injectable()
export class IntakeService {
  constructor(
    @Inject(LLM_PROVIDER) private readonly llm: LLMProvider,
    private readonly agentDefinitions: AgentDefinitionResolverService,
    private readonly runs: AgentRunRecorderService,
    private readonly cases: CasesService,
    private readonly approvals: ApprovalsService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly prisma: PrismaService,
  ) {}

  async handleIncomingEmail(tenantId: string, actorUserId: string | undefined, input: IncomingEmailDto): Promise<IntakeResult> {
    const inboundEmail = await this.prisma.forTenantId(tenantId).emailMessage.create({
      data: {
        tenantId,
        direction: 'INBOUND',
        fromAddress: input.fromAddress,
        toAddresses: input.toAddresses,
        subject: input.subject,
        bodyPreview: input.bodyText.slice(0, 500),
        receivedAt: new Date(),
      },
    });
    await this.audit.record({
      tenantId,
      eventType: 'EMAIL_RECEIVED',
      actorType: 'AGENT',
      entityType: 'EmailMessage',
      entityId: inboundEmail.id,
      payload: { fromAddress: input.fromAddress, subject: input.subject },
    });

    const category = await this.classify(tenantId, actorUserId, input);
    await this.prisma.forTenantId(tenantId).emailMessage.update({
      where: { id: inboundEmail.id },
      data: { classification: category },
    });

    if (category === 'OTHER') {
      return { category, agentRunIds: [] };
    }

    const businessCase = await this.cases.create(tenantId, actorUserId ?? '', {
      type: category,
      title: category === 'FINANCE' ? `Rechnungseingang: ${input.subject}` : `Neue Anfrage: ${input.subject}`,
      description: input.bodyText.slice(0, 1000),
    });
    await this.prisma.forTenantId(tenantId).emailMessage.update({
      where: { id: inboundEmail.id },
      data: { caseId: businessCase.id },
    });

    const agentRunIds: string[] = [];
    if (category === 'FINANCE' && input.attachment) {
      agentRunIds.push(await this.runFinanceAgent(tenantId, actorUserId, businessCase, input));
    } else if (category === 'SALES') {
      agentRunIds.push(await this.runSalesAgent(tenantId, actorUserId, businessCase, input));
    }

    return { case: businessCase, category, agentRunIds };
  }

  private async classify(
    tenantId: string,
    actorUserId: string | undefined,
    input: IncomingEmailDto,
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
            input: { subject: input.subject, bodyText: input.bodyText, hasAttachment: Boolean(input.attachment) },
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
        messages: [{ role: 'user', content: `Betreff: ${input.subject}\n\n${input.bodyText}` }],
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
    input: IncomingEmailDto,
  ): Promise<string> {
    const attachment = input.attachment!;
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

    return this.runAgentTurn(
      tenantId,
      actorUserId,
      'FINANCE',
      businessCase.id,
      'finance-intake',
      `Neue Rechnung eingegangen: ${input.subject}. Dokument-ID: ${document.id}.`,
      3,
    );
  }

  private async runSalesAgent(
    tenantId: string,
    actorUserId: string | undefined,
    businessCase: Case,
    input: IncomingEmailDto,
  ): Promise<string> {
    const domain = input.fromAddress.split('@')[1] ?? 'unbekannt.example';
    const companyNameGuess = domain.split('.')[0];
    const companyName = (companyNameGuess ?? 'Unbekannt').charAt(0).toUpperCase() + (companyNameGuess ?? 'unbekannt').slice(1);
    const localPart = input.fromAddress.split('@')[0] ?? 'kontakt';
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
              input: { email: input.fromAddress, firstName, lastName, companyId: company?.id },
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
                notes: input.bodyText.slice(0, 500),
                caseId: businessCase.id,
              },
            },
          ],
          stopReason: 'tool_use',
        };
      });
      // No trailing manual end_turn seed — see the comment in classify().
    }

    return this.runAgentTurn(
      tenantId,
      actorUserId,
      'SALES',
      businessCase.id,
      'sales-intake',
      `Neue Interessenten-E-Mail: ${input.subject}\n\n${input.bodyText}`,
      4,
    );
  }

  private async runAgentTurn(
    tenantId: string,
    actorUserId: string | undefined,
    agentType: 'FINANCE' | 'SALES',
    caseId: string,
    agentDefinitionKey: string,
    userMessage: string,
    maxToolIterations: number,
  ): Promise<string> {
    const run = await this.runs.start({ tenantId, agentType, triggerType: 'EMAIL', caseId });

    let outcomes: ToolCallOutcome[] = [];
    try {
      const { systemPrompt, runtime } = await this.agentDefinitions.resolve(tenantId, agentDefinitionKey);
      const result = await runtime.runTurn(
        { tenantId, agentRunId: run.id, actorUserId },
        { systemPrompt, messages: [{ role: 'user', content: userMessage }], maxToolIterations },
      );
      outcomes = result.toolCallOutcomes;
      await this.runs.recordToolCalls(tenantId, run.id, outcomes);
      await this.runs.complete(tenantId, run.id, result);
    } catch (error) {
      await this.runs.fail(tenantId, run.id, error instanceof Error ? error.message : String(error));
      throw error;
    }

    await this.createApprovalsForBlockedCalls(tenantId, actorUserId, outcomes);
    return run.id;
  }

  /**
   * AgentRuntime never executes a tool whose policy decision isn't ALLOW
   * (see its own doc comment) — it's the caller's job to act on that.
   * Most of this MVP's tools default to AUTONOMOUS, so this normally has
   * nothing to do; it matters once a tenant (or a future tool) is
   * configured for REQUIRE_APPROVAL/SUGGEST_ONLY.
   */
  private async createApprovalsForBlockedCalls(
    tenantId: string,
    actorUserId: string | undefined,
    outcomes: ToolCallOutcome[],
  ): Promise<void> {
    for (const outcome of outcomes) {
      if (outcome.decision === 'ALLOW' || outcome.decision === 'DENY') continue;
      await this.approvals.create(tenantId, {
        entityType: 'FOLLOW_UP',
        entityId: outcome.toolCallId,
        policyAction: outcome.toolName,
        requestedByUserId: actorUserId,
        reason: `Agent-Vorschlag „${outcome.toolName}“ wartet auf Freigabe.`,
      });
    }
  }
}
