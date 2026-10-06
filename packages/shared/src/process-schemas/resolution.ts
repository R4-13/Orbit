/**
 * Auflösungsleiter für fehlende Angaben (Amendment 02 v1.2 §30, BP-32): bevor ORBIT einen Menschen einbezieht, wird eine fehlende Information aus bereits
 * vorhandenen Fakten, früherer Kommunikation und autorisierten Quellen beschafft; erst danach folgt – wenn nur der Geschäftspartner sie liefern kann und die
 * Policy es erlaubt – die externe Sachrückfrage, zuletzt die menschliche Klärung.
 *
 *  R0 vorhandener bestätigter Fakt · R1 Kommunikation/Anhang/Thread · R2 System of Record · R3 andere autorisierte Quelle ·
 *  R4 externe Rückfrage · R5 menschliche Klärung · R6 Blockierung
 */

export const RESOLUTION_STRATEGIES = ['CASE_FACT', 'COMMUNICATION', 'SYSTEM_OF_RECORD', 'AUTHORIZED_SOURCE', 'EXTERNAL_CLARIFICATION', 'HUMAN_REVIEW'] as const;
export type ResolutionStrategy = (typeof RESOLUTION_STRATEGIES)[number];

export const RESOLUTION_RESULTS = ['SATISFIED', 'NOT_FOUND', 'CONFLICT', 'SOURCE_UNAVAILABLE', 'NOT_AUTHORIZED', 'FAILED'] as const;
export type ResolutionResult = (typeof RESOLUTION_RESULTS)[number];

/** Reihenfolge der Leiter: niedrigere Stufen werden zuerst genutzt und nicht ohne Grund übersprungen. */
export const RESOLUTION_LADDER: readonly ResolutionStrategy[] = ['CASE_FACT', 'COMMUNICATION', 'SYSTEM_OF_RECORD', 'AUTHORIZED_SOURCE', 'EXTERNAL_CLARIFICATION', 'HUMAN_REVIEW'];

/** Protokolleintrag je Anforderung (als Fallereignis `context.resolution_attempted`, keine eigene Tabelle). */
export interface ContextResolutionAttempt {
  requirementKey: string;
  /** Die Strategie, die das Ergebnis geliefert hat – oder, bei NOT_FOUND/CONFLICT, die zuletzt versuchte. */
  strategy: ResolutionStrategy;
  result: ResolutionResult;
  /** Bereits versuchte Stufen dieser Auswertung, in Leiterreihenfolge. */
  triedStrategies: ResolutionStrategy[];
  evidenceRefs: string[];
  nextAllowedStrategies: ResolutionStrategy[];
}

export interface ResolutionFactView {
  id: string;
  status: string;
  sourceType: string;
}

const SOURCE_TO_STRATEGY: Record<string, ResolutionStrategy> = {
  EMAIL: 'COMMUNICATION',
  ATTACHMENT: 'COMMUNICATION',
  SYSTEM_OF_RECORD: 'SYSTEM_OF_RECORD',
  CONFIGURATION: 'CASE_FACT',
  HUMAN: 'HUMAN_REVIEW',
};

/**
 * Wertet den Stand einer Anforderung als Auflösungsversuch aus. Deterministisch: kein Modell entscheidet, welche Stufe als Nächstes zulässig ist.
 * `externalClarificationAvailable` sagt, ob eine externe Sachrückfrage überhaupt möglich ist (Capability ausführbar, Policy nicht DISABLED, Limit nicht erreicht);
 * ohne sie bleibt nur die menschliche Klärung.
 */
export function resolutionAttemptFor(requirementKey: string, state: string, facts: readonly ResolutionFactView[], options: { externalClarificationAvailable: boolean }): ContextResolutionAttempt {
  const forKey = facts;
  const confirmed = forKey.filter((f) => f.status === 'CONFIRMED');
  const evidenceRefs = forKey.map((f) => f.id);
  const afterReading: ResolutionStrategy[] = options.externalClarificationAvailable ? ['EXTERNAL_CLARIFICATION', 'HUMAN_REVIEW'] : ['HUMAN_REVIEW'];

  if (state === 'SATISFIED' && confirmed.length > 0) {
    const strategy = SOURCE_TO_STRATEGY[confirmed[0]!.sourceType] ?? 'CASE_FACT';
    return { requirementKey, strategy, result: 'SATISFIED', triedStrategies: RESOLUTION_LADDER.slice(0, RESOLUTION_LADDER.indexOf(strategy) + 1), evidenceRefs: confirmed.map((f) => f.id), nextAllowedStrategies: [] };
  }
  if (state === 'CONFLICTED') {
    return { requirementKey, strategy: 'COMMUNICATION', result: 'CONFLICT', triedStrategies: ['CASE_FACT', 'COMMUNICATION'], evidenceRefs, nextAllowedStrategies: ['HUMAN_REVIEW'] };
  }
  // MISSING / INVALID (ein unbestätigter Kandidat zählt nicht als Auflösung): Fakten, Kommunikation und Systeme wurden ohne Treffer geprüft.
  return { requirementKey, strategy: 'COMMUNICATION', result: 'NOT_FOUND', triedStrategies: ['CASE_FACT', 'COMMUNICATION'], evidenceRefs, nextAllowedStrategies: afterReading };
}

/** Stabiler Schlüssel: dieselbe Auswertung desselben Faktenstands wird nur einmal protokolliert. */
export function resolutionDedupeKey(caseId: string, attempt: ContextResolutionAttempt): string {
  return `resolution:${caseId}:${attempt.requirementKey}:${attempt.result}:${attempt.strategy}:${[...attempt.evidenceRefs].sort().join(',')}`;
}

const STRATEGY_LABELS: Record<ResolutionStrategy, string> = {
  CASE_FACT: 'bereits bekannte Angabe',
  COMMUNICATION: 'frühere Nachricht',
  SYSTEM_OF_RECORD: 'Fachsystem',
  AUTHORIZED_SOURCE: 'weitere zugelassene Quelle',
  EXTERNAL_CLARIFICATION: 'Rückfrage beim Geschäftspartner',
  HUMAN_REVIEW: 'Klärung durch einen Menschen',
};

/** Fachliche Zeile für die Vorgangshistorie (ohne Technikbegriffe). */
export function describeResolutionAttempt(attempt: Pick<ContextResolutionAttempt, 'requirementKey' | 'strategy' | 'result' | 'nextAllowedStrategies'>): string {
  const subject = `Angabe „${attempt.requirementKey}“`;
  if (attempt.result === 'SATISFIED') return `${subject}: geklärt über ${STRATEGY_LABELS[attempt.strategy]}`;
  if (attempt.result === 'CONFLICT') return `${subject}: widersprüchlich – braucht eine Entscheidung`;
  const next = attempt.nextAllowedStrategies[0];
  return `${subject}: nicht gefunden${next ? ` – nächster Schritt: ${STRATEGY_LABELS[next]}` : ''}`;
}
