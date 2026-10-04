import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { POLICY_ACTIONS } from '@orbit/shared';
import type { ToolDefinition, ToolRegistry } from '@orbit/agent-core';
import { FINANCE_KEYWORDS, SALES_KEYWORDS } from './communication.tools';

const MARKETING_PATTERNS = ['unsubscribe', 'abmelden', 'newsletter', 'no-reply', 'noreply'];

/**
 * Channel Event Runtime — the Relevance/Triage stage (`docs/CHANNEL_EVENT_RUNTIME_PLAN.md`),
 * run by `IntakeService.assessRelevance()` BEFORE any FINANCE/SALES/OTHER
 * domain classification. Same "deterministic heuristic stands in for what
 * a real LLM would otherwise decide" pattern as `classify_message`
 * (communication.tools.ts) — not a hand-rolled ML model, a single,
 * inspectable, testable, auditable step regardless of whether the outer
 * LLM is mock or real.
 *
 * Deliberately conservative: the heuristic only ever actively produces
 * `NON_ACTIONABLE` (clear marketing/newsletter patterns) or
 * `BUSINESS_ACTIONABLE` (recognizable Finance/Sales keywords, reusing the
 * SAME keyword lists `classify_message` uses — one list, not two that
 * could drift). Everything else — including genuinely detecting
 * `PRIVATE_PERSONAL`/`BUSINESS_INFORMATIONAL`, which need real semantic
 * understanding no keyword list can honestly provide — falls through to
 * `UNKNOWN_REQUIRES_REVIEW` with low confidence, routing to human review
 * rather than guessing. `IntakeService` enforces the confidence threshold
 * itself (§4 of the user's design: "thresholds... enforced deterministically
 * by application/policy logic", not by this tool).
 */
@Injectable()
export class TriageAgentTools {
  register(registry: ToolRegistry): void {
    registry.register(this.assessRelevanceTool());
  }

  private assessRelevanceTool(): ToolDefinition {
    const inputSchema = z.object({
      subject: z.string(),
      content: z.string(),
    });

    return {
      name: 'assess_relevance',
      description:
        'Stuft ein eingehendes Ereignis ein: BUSINESS_ACTIONABLE, BUSINESS_INFORMATIONAL, NON_ACTIONABLE, PRIVATE_PERSONAL oder UNKNOWN_REQUIRES_REVIEW. Führt selbst keine Aktion aus.',
      inputSchema,
      policyAction: POLICY_ACTIONS.EMAIL_TRIAGE,
      execute: async (input) => {
        const haystack = `${input.subject} ${input.content}`.toLowerCase();

        if (MARKETING_PATTERNS.some((pattern) => haystack.includes(pattern))) {
          return {
            relevance: 'NON_ACTIONABLE' as const,
            confidence: 0.9,
            reasoning: 'Enthält typische Marketing-/Newsletter-Muster (Abmelde-Link, No-Reply-Absender).',
          };
        }

        const hasBusinessSignal =
          FINANCE_KEYWORDS.some((word) => haystack.includes(word)) || SALES_KEYWORDS.some((word) => haystack.includes(word));
        if (hasBusinessSignal) {
          return {
            relevance: 'BUSINESS_ACTIONABLE' as const,
            confidence: 0.85,
            reasoning: 'Enthält erkennbare Finance- oder Sales-Schlüsselwörter.',
          };
        }

        return {
          relevance: 'UNKNOWN_REQUIRES_REVIEW' as const,
          confidence: 0.2,
          reasoning: 'Keine eindeutigen Geschäfts- oder Marketing-Signale erkannt — sichere Einstufung erfordert menschliche Prüfung.',
        };
      },
    };
  }
}
