import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { POLICY_ACTIONS } from '@orbit/shared';
import type { ToolDefinition, ToolRegistry } from '@orbit/agent-core';

const FINANCE_KEYWORDS = ['rechnung', 'invoice', 'zahlung', 'beleg', 'fällig'];
const SALES_KEYWORDS = ['interesse', 'angebot', 'anfrage', 'beratung', 'demo', 'kaufen', 'preis'];

/**
 * Communication/Intake Agent tool (§12). `classify_message`'s
 * implementation is a plain keyword heuristic, not a hand-rolled ML
 * model — deliberately so: it stands in for what the LLM itself would
 * normally decide directly (an outer AgentRuntime.runTurn() call could
 * just as well skip this tool and have the LLM route to Finance/Sales
 * tools on its own reasoning). Registering it as an explicit tool matches
 * §14's tool list and gives IntakeService a single, inspectable,
 * testable classification step with its own audit trail entry, whether
 * the outer LLM is MockLLMProvider (scripted) or a real provider.
 * See docs/ASSUMPTIONS.md Phase 18.
 */
@Injectable()
export class CommunicationAgentTools {
  register(registry: ToolRegistry): void {
    registry.register(this.classifyMessageTool());
  }

  private classifyMessageTool(): ToolDefinition {
    const inputSchema = z.object({
      subject: z.string(),
      bodyText: z.string(),
      hasAttachment: z.boolean(),
    });

    return {
      name: 'classify_message',
      description: 'Klassifiziert eine eingehende Nachricht als FINANCE, SALES oder OTHER.',
      inputSchema,
      policyAction: POLICY_ACTIONS.EMAIL_CLASSIFY,
      execute: async (input) => {
        const haystack = `${input.subject} ${input.bodyText}`.toLowerCase();
        const financeScore = FINANCE_KEYWORDS.filter((word) => haystack.includes(word)).length + (input.hasAttachment ? 1 : 0);
        const salesScore = SALES_KEYWORDS.filter((word) => haystack.includes(word)).length;

        if (financeScore === 0 && salesScore === 0) {
          return { category: 'OTHER' as const, reasoning: 'Keine erkennbaren Finance- oder Sales-Schlüsselwörter gefunden.' };
        }
        if (financeScore >= salesScore) {
          return { category: 'FINANCE' as const, reasoning: 'Enthält rechnungsbezogene Begriffe und/oder einen Anhang.' };
        }
        return { category: 'SALES' as const, reasoning: 'Enthält vertriebsbezogene Begriffe (Interesse/Anfrage/Angebot).' };
      },
    };
  }
}
