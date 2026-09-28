import { Inject, Injectable } from '@nestjs/common';
import { AgentRuntime, buildLayeredSystemPrompt, type LLMMessage, type ToolRegistry } from '@orbit/agent-core';
import type { ConversationMessage } from '@orbit/domain';
import { TOOL_REGISTRY } from '../agent/agent.tokens';
import { AgentRunRecorderService } from '../agent/agent-run-recorder.service';
import { AiProviderResolverService } from '../ai-providers/ai-provider-resolver.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { PolicyEnforcementService } from '../policy/policy-enforcement.service';
import { PrismaService } from '../prisma/prisma.service';
import { CopilotConversationService } from './copilot-conversation.service';
import { SONDE_ASK_TOOL_NAMES } from './tools/sonde.tools';

/** §31 des Master-Dokuments ("Sonde memory") — "recent messages... Do not send unlimited history." Ein fester, dokumentierter Wert statt einer echten Zusammenfassungs-Kompression (siehe docs/ASSUMPTIONS.md, ConversationSummary bewusst nicht Teil dieser Phase). */
const MAX_HISTORY_MESSAGES = 10;

/** §51 des Master-Dokuments ("Provider Failure Behaviour") — wörtlich vorgeschriebener Text, kein eigener Wortlaut. */
const PROVIDER_UNAVAILABLE_MESSAGE = 'Der KI-Dienst ist momentan nicht verfügbar. Ich habe keine Aktion ausgeführt.';

/**
 * §26/§29 des Master-Dokuments — Sonde ASK-Modus: baut pro Nachricht einen
 * frischen, auf die ASK-Tools beschränkten `AgentRuntime` (dieselbe
 * `ToolRegistry.subset()`-Technik wie `AgentDefinitionResolverService`)
 * und führt exakt denselben `AgentRuntime.runTurn()` → Policy-Engine-Pfad
 * wie jeder andere Agent — keine reduzierte "Copilot-Sonderbehandlung"
 * (§25: "Sonde talks to the user. ORBIT does the work" — Sonde bekommt
 * keinen privilegierten Zugriff, den ein normaler Agent nicht auch hätte).
 *
 * Bewusst **synchron** (kein SSE-Streaming) — das ist Phase 8 der
 * Roadmap (§63), hier nur das Konversations-Fundament + ein echter
 * ASK-Modus.
 */
@Injectable()
export class CopilotRuntimeService {
  constructor(
    private readonly conversations: CopilotConversationService,
    private readonly prisma: PrismaService,
    @Inject(TOOL_REGISTRY) private readonly toolRegistry: ToolRegistry,
    private readonly aiProviders: AiProviderResolverService,
    private readonly policy: PolicyEnforcementService,
    private readonly runs: AgentRunRecorderService,
    private readonly approvals: ApprovalsService,
  ) {}

  async sendMessage(
    tenantId: string,
    actorUserId: string,
    conversationId: string,
    content: string,
  ): Promise<ConversationMessage> {
    // Validates that this conversation belongs to actorUserId — throws NotFoundError otherwise (§29: conversations are personal).
    await this.conversations.getConversation(tenantId, actorUserId, conversationId);

    const priorMessages = await this.prisma.forTenantId(tenantId).conversationMessage.findMany({
      where: { conversationId, role: { in: ['USER', 'ASSISTANT'] } },
      orderBy: { createdAt: 'desc' },
      take: MAX_HISTORY_MESSAGES,
    });
    const history: LLMMessage[] = priorMessages
      .reverse()
      .map((m) => ({ role: m.role === 'USER' ? 'user' : 'assistant', content: m.content }));

    await this.prisma.forTenantId(tenantId).conversationMessage.create({
      data: { tenantId, conversationId, userId: actorUserId, role: 'USER', content },
    });

    const llm = await this.aiProviders.resolveForTenant(tenantId);
    const scopedTools = this.toolRegistry.subset([...SONDE_ASK_TOOL_NAMES]);
    const runtime = new AgentRuntime(llm, scopedTools, (action, ctx) => this.policy.resolveMode(ctx.tenantId, action));
    const systemPrompt = buildLayeredSystemPrompt(SONDE_ASK_SYSTEM_PROMPT);

    const agentRun = await this.runs.start({
      tenantId,
      agentType: 'ORCHESTRATOR',
      triggerType: 'MANUAL',
      input: { conversationId, content },
    });

    let assistantContent: string;
    try {
      const result = await runtime.runTurn(
        { tenantId, agentRunId: agentRun.id, actorUserId },
        { systemPrompt, messages: [...history, { role: 'user', content }] },
      );
      await this.runs.recordToolCalls(tenantId, agentRun.id, result.toolCallOutcomes);
      await this.runs.complete(tenantId, agentRun.id, result);

      for (const outcome of result.toolCallOutcomes) {
        if (outcome.decision === 'ALLOW' || outcome.decision === 'DENY') continue;
        await this.approvals.create(tenantId, {
          entityType: 'FOLLOW_UP',
          entityId: outcome.toolCallId,
          policyAction: outcome.toolName,
          requestedByUserId: actorUserId,
          reason: `Sonde-Anfrage „${outcome.toolName}" wartet auf Freigabe.`,
        });
      }

      assistantContent = result.finalText?.trim() || 'Dazu habe ich aktuell keine Antwort.';
    } catch (error) {
      await this.runs.fail(tenantId, agentRun.id, error instanceof Error ? error.message : String(error));
      assistantContent = PROVIDER_UNAVAILABLE_MESSAGE;
    }

    const assistantMessage = await this.prisma.forTenantId(tenantId).conversationMessage.create({
      data: { tenantId, conversationId, role: 'ASSISTANT', content: assistantContent, agentRunId: agentRun.id },
    });

    await this.prisma.forTenantId(tenantId).conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date() },
    });

    return assistantMessage;
  }
}

const SONDE_ASK_SYSTEM_PROMPT = `Du bist Sonde, der anwendungsweite Copilot von ORBIT.

Du befindest dich aktuell ausschließlich im ASK-Modus: Du beantwortest Fragen zum aktuellen operativen Stand (offene Vorgänge, Aufgaben, ausstehende Freigaben) auf Basis der dir bereitgestellten Tools. Du erklärst, fasst zusammen und beantwortest Fragen — du schlägst in diesem Modus keine Aktionen vor und führst keine Änderungen aus.

Antworte prägnant, geschäftlich und auf Deutsch. Wenn du eine Frage mit den verfügbaren Tools nicht beantworten kannst, sag das ehrlich, statt etwas zu erfinden.`;
