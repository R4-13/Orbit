import type { IntakeRelevance } from '@orbit/domain';
import { riskFlagLabel, type TriageResult } from '@orbit/shared';

/**
 * Deterministic application logic that turns the model's *proposal* into a
 * binding decision (Amendment 02 §3.1: "Das LLM versteht und plant; ORBIT
 * entscheidet verbindlich"; §14.3: confidence is a hint, never an
 * authorization). Pure and provider-independent, so the rules are unit-tested
 * without any model.
 */
export interface TriageThresholds {
  /** Minimum relevance confidence before a RELEVANT proposal is acted on automatically. */
  minConfidence: number;
  /** Stricter bar before a message may be filtered out of the business inbox — hiding a real request is the costlier error. */
  exclusionMinConfidence: number;
}

/** Risk flags that always force human review, whatever the model concluded (security treatment, §19.2/E10). */
export const REVIEW_FORCING_RISK_FLAGS: ReadonlySet<string> = new Set([
  'PROMPT_INJECTION_SUSPECTED',
  'PHISHING_SUSPECTED',
  'IDENTITY_MISMATCH',
]);

export interface AppliedRelevance {
  relevance: IntakeRelevance;
  /** Why the proposal was or was not followed — shown with the decision, never hidden. */
  basis: string;
}

export function deriveAppliedRelevance(result: TriageResult, thresholds: TriageThresholds): AppliedRelevance {
  const forcing = result.riskFlags.find((flag) => REVIEW_FORCING_RISK_FLAGS.has(flag));
  if (forcing) {
    return { relevance: 'UNKNOWN_REQUIRES_REVIEW', basis: `Risikohinweis „${riskFlagLabel(forcing)}“ erzwingt eine menschliche Prüfung.` };
  }

  switch (result.businessRelevance) {
    case 'UNCERTAIN':
      return { relevance: 'UNKNOWN_REQUIRES_REVIEW', basis: 'Die Relevanz wurde als unsicher eingestuft.' };

    case 'RELEVANT':
      if (result.confidence.relevance < thresholds.minConfidence) {
        return {
          relevance: 'UNKNOWN_REQUIRES_REVIEW',
          basis: `Relevanz-Konfidenz ${result.confidence.relevance.toFixed(2)} liegt unter der konfigurierten Schwelle ${thresholds.minConfidence}.`,
        };
      }
      return { relevance: 'BUSINESS_ACTIONABLE', basis: 'Geschäftlich relevant mit ausreichender Konfidenz.' };

    case 'NON_BUSINESS':
      // Never hide on low confidence: a wrongly filtered customer request is worse than one extra review item.
      if (result.confidence.relevance < thresholds.exclusionMinConfidence) {
        return {
          relevance: 'UNKNOWN_REQUIRES_REVIEW',
          basis: `Als nicht geschäftlich eingestuft, aber Konfidenz ${result.confidence.relevance.toFixed(2)} liegt unter der Ausschluss-Schwelle ${thresholds.exclusionMinConfidence}.`,
        };
      }
      return {
        relevance: result.category === 'PRIVATE' ? 'PRIVATE_PERSONAL' : 'NON_ACTIONABLE',
        basis: 'Sicher nicht geschäftsrelevant; es wird kein Geschäftsprozess gestartet.',
      };
  }
}

export type DomainRoute = 'FINANCE' | 'SALES';

/**
 * Category → existing domain workflow. This is configuration, not framework
 * logic: it only connects triage categories to the already-implemented
 * Finance/Sales workflows until blueprint-based planning takes over
 * (Phase BP-2). A relevant category with no route is NOT filtered out — it
 * gets a visible review item (Amendment 02 §6.1: no capability is no reason
 * to hide a business request).
 */
export const CATEGORY_DOMAIN_ROUTES: Readonly<Record<string, DomainRoute>> = {
  REQUEST_FOR_QUOTE: 'SALES',
  SALES_INQUIRY: 'SALES',
  INVOICE_RECEIVED: 'FINANCE',
};

export function routeForCategory(category: string): DomainRoute | undefined {
  return CATEGORY_DOMAIN_ROUTES[category];
}
