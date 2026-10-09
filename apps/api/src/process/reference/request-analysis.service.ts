import { Inject, Injectable } from '@nestjs/common';
import { AgentRuntime, ToolFailedError, buildLayeredSystemPrompt, wrapUntrustedContent, type ToolDefinition, type ToolRegistry } from '@orbit/agent-core';
import { AiProviderUnavailableError } from '@orbit/shared';
import { TOOL_REGISTRY } from '../../agent/agent.tokens';
import { AiProviderResolverService } from '../../ai-providers/ai-provider-resolver.service';
import { PolicyEnforcementService } from '../../policy/policy-enforcement.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CASE_EVENT_TYPES, CaseEventsService } from '../case-events.service';
import { CaseFactsService } from '../case-facts.service';
import { REQUEST_ANALYSIS_TOOL, RequestAnalysisSchema, analysisPrompt, evaluateAnalysis, type AnalysisResult, type RequestAnalysis } from './request-analysis';
import { ReferenceProcessService } from './reference-process.service';

const MAX_BODY_CHARS = 12_000;

export interface AnalysisContext {
  tenantId: string;
  caseId: string;
  agentRunId: string;
}

export interface AnalysisOutcome {
  /** Die (neue oder frühere) Analyse; `undefined`, wenn keine durchgeführt wurde. */
  result?: AnalysisResult;
  /** `LIVE`, wenn eine echte KI die Anfrage analysiert hat; sonst `SIMULATED` (kein KI-Dienst verbunden). */
  mode: 'LIVE' | 'SIMULATED';
  /** Warum keine Analyse stattgefunden hat. */
  skipped?: 'NO_AI_PROVIDER' | 'ALREADY_ASKED' | 'NO_MESSAGE';
}

/**
 * Die Anforderungsanalyse: eine KI versteht die Anfrage, entnimmt die vorhandenen Angaben, ermittelt gezielt die fehlenden, entscheidet über einen
 * Vor-Ort- oder Telefontermin und wählt den nächsten Schritt. Das Ergebnis wird als Ereignis am Vorgang festgehalten (nachvollziehbar, nur einmal je
 * Vorgang); die entnommenen Angaben werden – nur mit wörtlichem Beleg – als Fakten bestätigt.
 */
@Injectable()
export class RequestAnalysisService {
  constructor(
    @Inject(TOOL_REGISTRY) private readonly registry: ToolRegistry,
    private readonly prisma: PrismaService,
    private readonly aiProviders: AiProviderResolverService,
    private readonly policy: PolicyEnforcementService,
    private readonly facts: CaseFactsService,
    private readonly caseEvents: CaseEventsService,
    private readonly reference: ReferenceProcessService,
  ) {}

  /** Das Einreichungswerkzeug: führt nichts aus, die Prüfung geschieht in `evaluateAnalysis`. */
  submitTool(): ToolDefinition {
    return {
      name: REQUEST_ANALYSIS_TOOL,
      description: 'Übermittelt die Analyse der Anfrage (Art, vorhandene und fehlende Angaben, Terminbedarf, nächster Schritt). Führt nichts aus.',
      inputSchema: RequestAnalysisSchema as never,
      policyAction: 'email.triage',
      execute: async (input: RequestAnalysis) => input,
    };
  }

  /** Die zuletzt festgehaltene Analyse des Vorgangs. */
  async latest(tenantId: string, caseId: string): Promise<AnalysisResult | undefined> {
    const event = await this.prisma.forTenantId(tenantId).caseEvent.findFirst({ where: { caseId, type: CASE_EVENT_TYPES.REQUIREMENTS_ANALYZED }, orderBy: { sequence: 'desc' } });
    const payload = event?.payload as { analysis?: AnalysisResult } | null | undefined;
    return payload?.analysis;
  }

  async analyzeOnce(ctx: AnalysisContext, reserved: { keys: ReadonlySet<string>; description: string }): Promise<AnalysisOutcome> {
    const existing = await this.latest(ctx.tenantId, ctx.caseId);
    if (existing) return { result: existing, mode: 'LIVE' };

    const scoped = this.prisma.forTenantId(ctx.tenantId);
    // Nach einer gesendeten Rückfrage wird nicht mehr neu analysiert: die Antwort gehört zur ursprünglichen Fragestellung.
    // Eine nur simulierte Sendung (Beleg „sim-…“) hat die Kundschaft nie erreicht und zählt nicht.
    const alreadyAsked = await scoped.emailMessage.count({ where: { caseId: ctx.caseId, direction: 'OUTBOUND', OR: [{ providerMessageId: null }, { NOT: { providerMessageId: { startsWith: 'sim-' } } }] } });
    if (alreadyAsked > 0) return { mode: 'LIVE', skipped: 'ALREADY_ASKED' };

    const message = await scoped.emailMessage.findFirst({ where: { caseId: ctx.caseId, direction: 'INBOUND' }, orderBy: { createdAt: 'asc' } });
    if (!message) return { mode: 'SIMULATED', skipped: 'NO_MESSAGE' };

    const llm = await this.aiProviders.resolveForTenant(ctx.tenantId, 'DOCUMENT_EXTRACTION').catch((error: unknown) => {
      if (error instanceof AiProviderUnavailableError) throw new ToolFailedError('Der KI-Dienst ist für die Anfrageanalyse nicht verfügbar.', { errorCode: 'AI_UNAVAILABLE', retryable: true });
      throw error;
    });
    // Ohne echten KI-Dienst (Testbetrieb) gibt es keine Analyse – nichts wird vorgetäuscht, die festen Regeln bleiben die Grundlage.
    if (llm.providerName.toLowerCase().includes('mock')) return { mode: 'SIMULATED', skipped: 'NO_AI_PROVIDER' };

    const tenant = await this.prisma.withRlsBypass((tx) => tx.tenant.findUnique({ where: { id: ctx.tenantId }, select: { name: true } }));
    const catalog = await this.reference.catalog(ctx.tenantId);
    const text = `Betreff: ${message.subject ?? ''}\n\n${(message.bodyText ?? message.bodyPreview ?? '').slice(0, MAX_BODY_CHARS)}`;
    const runtime = new AgentRuntime(llm, this.registry.subset([REQUEST_ANALYSIS_TOOL]), (action, c) => this.policy.resolveMode(c.tenantId, action));
    const system = buildLayeredSystemPrompt(
      analysisPrompt({ catalog: catalog.map((c) => `${c.name} (${c.category})`).join('; '), reservedRequirements: reserved.description, companyName: tenant?.name ?? 'dem Betrieb' }),
    );
    const turn = await runtime
      .runTurn({ tenantId: ctx.tenantId, agentRunId: ctx.agentRunId }, { systemPrompt: system, messages: [{ role: 'user', content: wrapUntrustedContent(text) }], maxToolIterations: 2 })
      .catch(() => {
        throw new ToolFailedError('Der KI-Dienst ist für die Anfrageanalyse nicht verfügbar.', { errorCode: 'AI_UNAVAILABLE', retryable: true });
      });
    const submitted = [...turn.toolCallOutcomes.filter((o) => o.toolName === REQUEST_ANALYSIS_TOOL)].reverse().find((o) => o.result?.status === 'SUCCEEDED');
    if (!submitted) throw new ToolFailedError('Die KI hat keine gültige Analyse geliefert.', { errorCode: 'INVALID_ANALYSIS', retryable: true });

    const result = evaluateAnalysis(RequestAnalysisSchema.parse(submitted.output), text, reserved.keys);

    // Entnommene Angaben: nur mit wörtlichem Beleg (bereits in evaluateAnalysis geprüft) und gültigem Typ als bestätigter Fakt.
    for (const item of result.known) {
      const type = typeof item.value === 'number' ? 'number' : 'string';
      const created = await this.facts.propose(ctx.tenantId, ctx.caseId, [{ key: item.key, value: item.value, valueType: type, sourceType: 'EMAIL', sourceRef: `message:${message.id}`, evidenceRefs: [item.evidence], confidence: item.confidence }]);
      for (const fact of created) if (fact.status === 'CANDIDATE') await this.facts.confirmBySchema(ctx.tenantId, fact.id, type);
    }
    await this.caseEvents.append(ctx.tenantId, ctx.caseId, { type: CASE_EVENT_TYPES.REQUIREMENTS_ANALYZED, payload: { analysis: result, messageId: message.id }, dedupeKey: `analysis:${ctx.caseId}` });
    return { result, mode: 'LIVE' };
  }
}
