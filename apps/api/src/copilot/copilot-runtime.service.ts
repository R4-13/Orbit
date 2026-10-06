import { Inject, Injectable } from '@nestjs/common';
import { AgentRuntime, buildLayeredSystemPrompt, type AgentTurnEvent, type LLMMessage, type ToolRegistry } from '@orbit/agent-core';
import type { ConversationMessage } from '@orbit/domain';
import { TOOL_REGISTRY } from '../agent/agent.tokens';
import { AgentRunRecorderService } from '../agent/agent-run-recorder.service';
import { AiProviderResolverService } from '../ai-providers/ai-provider-resolver.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { PolicyEnforcementService } from '../policy/policy-enforcement.service';
import { PrismaService } from '../prisma/prisma.service';
import type { Permission } from '@orbit/shared';
import { SondeCaseContextService, type SondeCaseContext } from './case-context.service';
import { CopilotConversationService } from './copilot-conversation.service';
import type { CopilotStreamEvent } from './copilot-stream-event';
import type { SondeRequestMode } from './dto/send-message.dto';
import { SONDE_ACT_TOOL_NAMES, SONDE_ASK_TOOL_NAMES, SONDE_PREPARE_TOOL_NAMES } from './tools/sonde.tools';

/** §31 des Master-Dokuments ("Sonde memory") — "recent messages... Do not send unlimited history." Ein fester, dokumentierter Wert statt einer echten Zusammenfassungs-Kompression (siehe docs/ASSUMPTIONS.md, ConversationSummary bewusst nicht Teil dieser Phase). */
const MAX_HISTORY_MESSAGES = 10;

/** Who is asking, and which case they are looking at — both come from the authenticated request, never from message text. */
export interface SondeViewer {
  permissions: readonly Permission[];
  context?: SondeCaseContext;
  /** Gewählter Modus dieser Nachricht (UI v2 §8.3). Fehlt er, gilt der sicherste: nur Lese-Werkzeuge. */
  mode?: SondeRequestMode;
}

/** Werkzeuge je Modus: jeder Modus enthält die Fähigkeiten der vorherigen – und ersetzt nie Policy oder Freigabe. */
export function toolNamesForMode(mode: SondeRequestMode | undefined): readonly string[] {
  switch (mode) {
    case 'ACT':
      return [...SONDE_ASK_TOOL_NAMES, ...SONDE_PREPARE_TOOL_NAMES, ...SONDE_ACT_TOOL_NAMES];
    case 'PREPARE':
      return [...SONDE_ASK_TOOL_NAMES, ...SONDE_PREPARE_TOOL_NAMES];
    default:
      return [...SONDE_ASK_TOOL_NAMES];
  }
}

/** §51 des Master-Dokuments ("Provider Failure Behaviour") — wörtlich vorgeschriebener Text, kein eigener Wortlaut. */
const PROVIDER_UNAVAILABLE_MESSAGE = 'Der KI-Dienst ist momentan nicht verfügbar. Ich habe keine Aktion ausgeführt.';

/**
 * §26/§29 des Master-Dokuments — Sonde ASK+PREPARE+ACT-Modus: baut pro
 * Nachricht einen frischen `AgentRuntime`, beschränkt auf die Vereinigung
 * aus ASK-, PREPARE- und ACT-Tools (dieselbe `ToolRegistry.subset()`-
 * Technik wie `AgentDefinitionResolverService`), und führt exakt
 * denselben `AgentRuntime.runTurn()` → Policy-Engine-Pfad wie jeder
 * andere Agent — keine reduzierte "Copilot-Sonderbehandlung" (§25:
 * "Sonde talks to the user. ORBIT does the work" — Sonde bekommt keinen
 * privilegierten Zugriff, den ein normaler Agent nicht auch hätte). Die
 * PREPARE-/ACT-Tools sind bewusst dieselben, bereits existierenden
 * Domain-Agent-Tools, die Finance/Sales schon verwenden — siehe
 * Kopfkommentar in `tools/sonde.tools.ts`. §27 ("Sonde cannot bypass
 * RBAC → Policy Engine → Approval Rules") gilt dadurch automatisch auch
 * für ACT: `send_email` ist `REQUIRE_APPROVAL`, ein Sonde-Aufruf
 * versendet also nie direkt, sondern landet als `FOLLOW_UP`-Freigabe
 * (derselbe generische Mechanismus unten).
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
    private readonly caseContext: SondeCaseContextService,
  ) {}

  sendMessage(tenantId: string, actorUserId: string, conversationId: string, content: string, viewer?: SondeViewer): Promise<ConversationMessage> {
    return this.runAskTurn(tenantId, actorUserId, conversationId, content, undefined, viewer);
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
    viewer?: SondeViewer,
  ): Promise<void> {
    try {
      const assistantMessage = await this.runAskTurn(tenantId, actorUserId, conversationId, content, (event) => {
        if (event.type === 'tool.started') {
          emit({ type: 'tool.started', data: { toolName: event.toolName } });
        } else {
          emit({ type: 'tool.completed', data: { toolName: event.toolName, decision: event.decision, error: event.error } });
        }
      }, viewer);
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
    viewer?: SondeViewer,
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

    const llm = await this.aiProviders.resolveForTenant(tenantId, 'COPILOT_INTERACTIVE');
    const mode: SondeRequestMode = viewer?.mode ?? 'ASK';
    const scopedTools = this.toolRegistry.subset([...toolNamesForMode(mode)]);
    const runtime = new AgentRuntime(llm, scopedTools, (action, ctx) => this.policy.resolveMode(ctx.tenantId, action));
    // Case context (Amendment 02 §17.4): built on the server for this user, read-only; absent when the user may not read the case.
    const contextBlock = viewer?.context ? await this.caseContext.build(tenantId, viewer.permissions, viewer.context) : null;
    const modeBlock = `Aktueller Modus dieser Nachricht: ${mode}. Nur die Werkzeuge dieses Modus stehen zur Verfügung. Wünscht der Nutzer etwas, das mehr verlangt (Entwürfe oder Aktionen), erkläre kurz, dass er dafür oben im Sonde-Panel den Modus „Vorbereiten“ bzw. „Ausführen“ wählen muss – tue nie so, als hättest du es ohne passendes Werkzeug getan.`;
    const systemPrompt = buildLayeredSystemPrompt([SONDE_SYSTEM_PROMPT, modeBlock, contextBlock].filter(Boolean).join('\n\n'));

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

Du unterstützt aktuell drei Modi:

- ASK: Du beantwortest Fragen zum aktuellen operativen Stand (offene Vorgänge, Aufgaben, ausstehende Freigaben) auf Basis der dir bereitgestellten Lese-Tools. Du erklärst, fasst zusammen und beantwortest Fragen.
- PREPARE: Du kannst einen E-Mail-Antwortentwurf speichern (draft_email — wird NICHT versendet), einen Terminvorschlag mit Alternativslots anlegen (create_meeting — muss von einem Menschen final bestätigt werden) und einen Buchungsvorschlag für eine zur Freigabe anstehende Rechnung erstellen (create_booking_proposal — bucht nichts, wartet auf menschliche Freigabe). Jedes dieser Tools erzeugt nur einen Vorschlag, nie eine endgültige Aktion.
- ACT: Du kannst eine Aufgabe anlegen (create_task), einen Kontakt anlegen (create_contact), einen Lead anlegen (create_lead) — diese drei wirken sofort und endgültig, genau wie wenn ein Mensch sie selbst anlegt. Du kannst außerdem eine zuvor entworfene E-Mail zum Versand vorschlagen (send_email) — das versendet NICHT sofort, sondern wartet immer auf eine menschliche Freigabe, unabhängig davon, was der Nutzer sagt.

Du darfst in dieser Version KEINE anderen Aktionen ausführen: keine Workflows starten, keine Termine final bestätigen, keine Rechnungen freigeben oder buchen, keine Zahlungen auslösen. Wenn ein Nutzer danach fragt, erkläre ehrlich, dass das in ORBIT aktuell noch nicht freigeschaltet ist, statt es zu simulieren.

Antworte prägnant, geschäftlich und auf Deutsch. Wenn du eine Frage mit den verfügbaren Tools nicht beantworten kannst, sag das ehrlich, statt etwas zu erfinden.`;
