import { Inject, Injectable } from '@nestjs/common';
import { AgentRuntime, buildLayeredSystemPrompt, type AgentTurnEvent, type LLMMessage, type ToolRegistry } from '@orbit/agent-core';
import type { ConversationMessage } from '@orbit/domain';
import { TOOL_REGISTRY } from '../agent/agent.tokens';
import { AgentRunRecorderService } from '../agent/agent-run-recorder.service';
import { AiProviderResolverService } from '../ai-providers/ai-provider-resolver.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { PolicyEnforcementService } from '../policy/policy-enforcement.service';
import { PrismaService } from '../prisma/prisma.service';
import { CopilotConversationService } from './copilot-conversation.service';
import type { CopilotStreamEvent } from './copilot-stream-event';
import { SONDE_ASK_TOOL_NAMES, SONDE_PREPARE_TOOL_NAMES } from './tools/sonde.tools';

/** §31 des Master-Dokuments ("Sonde memory") — "recent messages... Do not send unlimited history." Ein fester, dokumentierter Wert statt einer echten Zusammenfassungs-Kompression (siehe docs/ASSUMPTIONS.md, ConversationSummary bewusst nicht Teil dieser Phase). */
const MAX_HISTORY_MESSAGES = 10;

/** §51 des Master-Dokuments ("Provider Failure Behaviour") — wörtlich vorgeschriebener Text, kein eigener Wortlaut. */
const PROVIDER_UNAVAILABLE_MESSAGE = 'Der KI-Dienst ist momentan nicht verfügbar. Ich habe keine Aktion ausgeführt.';

/**
 * §26/§29 des Master-Dokuments — Sonde ASK+PREPARE-Modus: baut pro
 * Nachricht einen frischen `AgentRuntime`, beschränkt auf die Vereinigung
 * aus ASK- und PREPARE-Tools (dieselbe `ToolRegistry.subset()`-Technik wie
 * `AgentDefinitionResolverService`), und führt exakt denselben
 * `AgentRuntime.runTurn()` → Policy-Engine-Pfad wie jeder andere Agent —
 * keine reduzierte "Copilot-Sonderbehandlung" (§25: "Sonde talks to the
 * user. ORBIT does the work" — Sonde bekommt keinen privilegierten
 * Zugriff, den ein normaler Agent nicht auch hätte). Die PREPARE-Tools
 * (`draft_email`/`create_meeting`/`create_booking_proposal`) sind
 * bewusst dieselben, bereits existierenden Domain-Agent-Tools, die
 * Finance/Sales schon verwenden — siehe Kopfkommentar in
 * `tools/sonde.tools.ts`.
 *
 * `sendMessage()` (synchron, Phase 7) und `streamMessage()` (SSE, Phase 8,
 * §33) teilen sich dieselbe `runAskTurn()`-Implementierung — nur die
 * Übergabe des optionalen `onToolEvent`-Fortschritts-Callbacks
 * unterscheidet sie. Kein zweiter, paralleler "Streaming-Sonderpfad".
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

  sendMessage(tenantId: string, actorUserId: string, conversationId: string, content: string): Promise<ConversationMessage> {
    return this.runAskTurn(tenantId, actorUserId, conversationId, content);
  }

  /**
   * SSE-Variante von `sendMessage()` — emittiert `tool.started`/
   * `tool.completed` in Echtzeit über `emit`, gefolgt von genau einem
   * abschließenden `message.completed` (mit derselben persistierten
   * `ConversationMessage` wie `sendMessage()` sie zurückgeben würde).
   * Wirft nichts nach außen: Ein Fehler landet als `error`-Event, damit der
   * Aufrufer (Controller) die bereits offene SSE-Verbindung sauber mit
   * `res.end()` abschließen kann statt einen unbehandelten Reject zu sehen.
   */
  async streamMessage(
    tenantId: string,
    actorUserId: string,
    conversationId: string,
    content: string,
    emit: (event: CopilotStreamEvent) => void,
  ): Promise<void> {
    try {
      const assistantMessage = await this.runAskTurn(tenantId, actorUserId, conversationId, content, (event) => {
        if (event.type === 'tool.started') {
          emit({ type: 'tool.started', data: { toolName: event.toolName } });
        } else {
          emit({ type: 'tool.completed', data: { toolName: event.toolName, decision: event.decision, error: event.error } });
        }
      });
      emit({ type: 'message.completed', data: assistantMessage });
    } catch (error) {
      emit({ type: 'error', data: { message: error instanceof Error ? error.message : String(error) } });
    }
  }

  private async runAskTurn(
    tenantId: string,
    actorUserId: string,
    conversationId: string,
    content: string,
    onToolEvent?: (event: AgentTurnEvent) => void,
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
    const scopedTools = this.toolRegistry.subset([...SONDE_ASK_TOOL_NAMES, ...SONDE_PREPARE_TOOL_NAMES]);
    const runtime = new AgentRuntime(llm, scopedTools, (action, ctx) => this.policy.resolveMode(ctx.tenantId, action));
    const systemPrompt = buildLayeredSystemPrompt(SONDE_SYSTEM_PROMPT);

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
        { systemPrompt, messages: [...history, { role: 'user', content }], onEvent: onToolEvent },
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

const SONDE_SYSTEM_PROMPT = `Du bist Sonde, der anwendungsweite Copilot von ORBIT.

Du unterstützt aktuell zwei Modi:

- ASK: Du beantwortest Fragen zum aktuellen operativen Stand (offene Vorgänge, Aufgaben, ausstehende Freigaben) auf Basis der dir bereitgestellten Lese-Tools. Du erklärst, fasst zusammen und beantwortest Fragen.
- PREPARE: Du kannst einen E-Mail-Antwortentwurf speichern (draft_email — wird NICHT versendet), einen Terminvorschlag mit Alternativslots anlegen (create_meeting — muss von einem Menschen final bestätigt werden) und einen Buchungsvorschlag für eine zur Freigabe anstehende Rechnung erstellen (create_booking_proposal — bucht nichts, wartet auf menschliche Freigabe). Jedes dieser Tools erzeugt nur einen Vorschlag, nie eine endgültige Aktion.

Du darfst in dieser Version KEINE anderen Aktionen ausführen: keine E-Mails tatsächlich versenden, keine Aufgaben/Kontakte/Leads anlegen, keine Workflows starten, keine Termine final bestätigen. Wenn ein Nutzer danach fragt, erkläre ehrlich, dass das in ORBIT aktuell noch nicht freigeschaltet ist, statt es zu simulieren.

Antworte prägnant, geschäftlich und auf Deutsch. Wenn du eine Frage mit den verfügbaren Tools nicht beantworten kannst, sag das ehrlich, statt etwas zu erfinden.`;
