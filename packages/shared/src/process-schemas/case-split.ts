import type { TriageResult } from './triage';

/**
 * Konzept Flexible Autonomie ADD-3.1 / FX-02 / FX-06: Enthält eine Nachricht **mehrere fachlich getrennte Anliegen**, wird jedes Anliegen als eigener Teilvorgang geführt
 * (verknüpft mit dem Hauptvorgang, der die Nachricht trägt) – nichts geht verloren, und jedes Anliegen hat sein eigenes Ziel und seinen eigenen Abschluss.
 * Die Entscheidung ist deterministisch und liegt hier; die KI liefert nur die Einstufung (Anliegen und Risikohinweis).
 */
export const MAX_SPLIT_CHILDREN = 4;
const MIN_INTENT_CONFIDENCE = 0.5;
const MULTIPLE_INTENTS_FLAG = 'MULTIPLE_INTENTS';

export interface SplitChild {
  /** Schlüssel des Anliegens (Kategorie der Registry oder frei benannt). */
  intentKey: string;
  /** Das Ziel dieses Teilvorgangs. */
  goal: string;
}

export interface SplitDecision {
  split: boolean;
  children: SplitChild[];
  /** Anliegen über der Obergrenze: sie werden nicht verworfen, sondern am Hauptvorgang genannt (eine Person entscheidet). */
  overflow: string[];
  reason: string;
}

export function decideSplit(triage: Pick<TriageResult, 'intents' | 'riskFlags' | 'proposedBusinessGoals'>): SplitDecision {
  if (!triage.riskFlags.includes(MULTIPLE_INTENTS_FLAG)) return { split: false, children: [], overflow: [], reason: 'Die Einstufung nennt nur ein Anliegen.' };
  const seen = new Set<string>();
  const intents = triage.intents.filter((intent) => {
    if (intent.confidence < MIN_INTENT_CONFIDENCE || seen.has(intent.key)) return false;
    seen.add(intent.key);
    return true;
  });
  if (intents.length < 2) return { split: false, children: [], overflow: [], reason: 'Es sind weniger als zwei belastbar unterscheidbare Anliegen erkannt.' };
  // Ziele werden nur zugeordnet, wenn ihre Zahl zu den Anliegen passt – sonst ist die Zuordnung geraten, und das Ziel ist das Anliegen selbst.
  const aligned = triage.proposedBusinessGoals.length === intents.length;
  const all = intents.map((intent, index): SplitChild => ({ intentKey: intent.key, goal: aligned ? (triage.proposedBusinessGoals[index] as string) : intent.key }));
  return { split: true, children: all.slice(0, MAX_SPLIT_CHILDREN), overflow: all.slice(MAX_SPLIT_CHILDREN).map((c) => c.intentKey), reason: `${intents.length} getrennte Anliegen erkannt.` };
}

export interface ChildRollUp {
  /** `COMPLETE`: alle Teilvorgänge sind abgeschlossen; sonst bleibt der Hauptvorgang offen. */
  outcome: 'COMPLETE' | 'OPEN';
  /** Kurzer Hinweis für den Hauptvorgang (z. B. welche Teilvorgänge Aufmerksamkeit brauchen). */
  attention: string[];
}

const SETTLED = new Set(['COMPLETED', 'CANCELLED', 'REJECTED']);
const NEEDS_ATTENTION = new Set(['MANUAL_REVIEW', 'FAILED']);

/**
 * Der Hauptvorgang schließt erst, wenn **jeder** Teilvorgang erledigt ist und mindestens einer wirklich abgeschlossen wurde. Ein gescheiterter Teilvorgang schließt den
 * Hauptvorgang nie – er bleibt offen und nennt, was Aufmerksamkeit braucht.
 */
export function rollUpChildren(children: ReadonlyArray<{ title: string; status: string }>): ChildRollUp {
  if (children.length === 0) return { outcome: 'OPEN', attention: [] };
  const attention = children.filter((c) => NEEDS_ATTENTION.has(c.status)).map((c) => `Teilvorgang „${c.title}“ braucht Prüfung.`);
  const allSettled = children.every((c) => SETTLED.has(c.status));
  const anyCompleted = children.some((c) => c.status === 'COMPLETED');
  return { outcome: allSettled && anyCompleted ? 'COMPLETE' : 'OPEN', attention };
}
