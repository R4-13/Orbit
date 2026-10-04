import { TRIAGE_SCHEMA_VERSION, UNKNOWN_CATEGORY, type TriageResult } from './triage';

/**
 * Fixture-specific structured triage results for the simulated provider
 * (Amendment 02 §22.4: "MockLLMProvider liefert fixturespezifische
 * strukturierte Ergebnisse nach demselben Schema"). These are *scripted
 * answers for a scenario the user picks* — they are not a classification of
 * the message text, and a run that uses one is always labelled SIMULATED.
 * They exist for tests and for the demo "simulate incoming email" form; they
 * are never consulted when a real provider is connected.
 */
export const SIMULATED_TRIAGE_SCENARIOS = ['REQUEST_FOR_QUOTE', 'INVOICE_RECEIVED', 'NEWSLETTER', 'PRIVATE', 'UNCERTAIN'] as const;
export type SimulatedTriageScenario = (typeof SIMULATED_TRIAGE_SCENARIOS)[number];

export const SIMULATED_TRIAGE_SCENARIO_LABELS: Record<SimulatedTriageScenario, string> = {
  REQUEST_FOR_QUOTE: 'Angebotsanfrage (KI-Ergebnis: geschäftlich relevant)',
  INVOICE_RECEIVED: 'Eingangsrechnung (KI-Ergebnis: geschäftlich relevant)',
  NEWSLETTER: 'Newsletter (KI-Ergebnis: nicht geschäftlich)',
  PRIVATE: 'Private Nachricht (KI-Ergebnis: nicht geschäftlich)',
  UNCERTAIN: 'Unklar (KI-Ergebnis: unsicher → Prüfung)',
};

const BASE: TriageResult = {
  schemaVersion: TRIAGE_SCHEMA_VERSION,
  businessRelevance: 'UNCERTAIN',
  category: UNKNOWN_CATEGORY,
  intents: [],
  proposedBusinessGoals: [],
  conversationRelation: 'NEW',
  senderRoleHypothesis: 'UNKNOWN',
  urgency: 'UNKNOWN',
  extractedFactCandidates: [],
  confidence: { relevance: 0.5, intent: 0.5 },
  riskFlags: [],
  conciseReason: 'Simuliertes Triage-Ergebnis.',
  evidenceRefs: [],
};

/** Builds a valid `TriageResult` with the given overrides — the single place tests and the simulator derive fixtures from. */
export function buildTriageFixture(overrides: Partial<TriageResult> = {}): TriageResult {
  return { ...BASE, ...overrides };
}

export function triageFixtureForScenario(scenario: SimulatedTriageScenario): TriageResult {
  switch (scenario) {
    case 'REQUEST_FOR_QUOTE':
      return buildTriageFixture({
        businessRelevance: 'RELEVANT',
        category: 'REQUEST_FOR_QUOTE',
        intents: [{ key: 'REQUEST_FOR_QUOTE', confidence: 0.93, evidenceRefs: ['body'] }],
        proposedBusinessGoals: ['CREATE_AND_DELIVER_QUOTE'],
        senderRoleHypothesis: 'PROSPECT',
        urgency: 'NORMAL',
        confidence: { relevance: 0.95, intent: 0.93 },
        conciseReason: 'Simuliert: der Absender bittet um ein Angebot.',
      });
    case 'INVOICE_RECEIVED':
      return buildTriageFixture({
        businessRelevance: 'RELEVANT',
        category: 'INVOICE_RECEIVED',
        intents: [{ key: 'INVOICE_RECEIVED', confidence: 0.92, evidenceRefs: ['attachment'] }],
        proposedBusinessGoals: ['PROCESS_SUPPLIER_INVOICE'],
        senderRoleHypothesis: 'SUPPLIER',
        confidence: { relevance: 0.94, intent: 0.92 },
        conciseReason: 'Simuliert: eine Eingangsrechnung mit Anhang.',
      });
    case 'NEWSLETTER':
      return buildTriageFixture({
        businessRelevance: 'NON_BUSINESS',
        category: 'NEWSLETTER_OR_MARKETING',
        confidence: { relevance: 0.96, intent: 0.9 },
        conciseReason: 'Simuliert: Newsletter beziehungsweise Werbung.',
      });
    case 'PRIVATE':
      return buildTriageFixture({
        businessRelevance: 'NON_BUSINESS',
        category: 'PRIVATE',
        confidence: { relevance: 0.95, intent: 0.9 },
        conciseReason: 'Simuliert: private Nachricht ohne Geschäftsbezug.',
      });
    case 'UNCERTAIN':
      return buildTriageFixture({
        businessRelevance: 'UNCERTAIN',
        category: UNKNOWN_CATEGORY,
        confidence: { relevance: 0.4, intent: 0.3 },
        conciseReason: 'Simuliert: die Relevanz ist nicht sicher einzustufen.',
      });
  }
}
