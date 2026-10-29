import type { TriageResult } from './triage';

/**
 * Konzept Flexible Autonomie ADD-3.1 / FX-02 / FX-06: Enthält eine Nachricht **mehrere fachlich getrennte Anliegen**, wird jedes Anliegen als eigener Teilvorgang geführt
 * (verknüpft mit dem Hauptvorgang, der die Nachricht trägt) – nichts geht verloren, und jedes Anliegen hat sein eigenes Ziel und seinen eigenen Abschluss.
 * Die Entscheidung ist deterministisch und liegt hier; die KI liefert nur die Einstufung (Anliegen und Risikohinweis).
 *
 * Es entstehen **alle** Teilvorgänge sofort. Gleichzeitig bearbeitet ORBIT höchstens `MAX_ACTIVE_SPLIT_CHILDREN`; die übrigen bleiben ausdrücklich offen (Status „Eingegangen“) und werden gestartet,
 * sobald Platz ist – oder sie gehen mit Begründung an eine Person. Der Hauptvorgang schließt erst, wenn jeder Teilvorgang berücksichtigt und erledigt ist.
 */
export const MAX_ACTIVE_SPLIT_CHILDREN = 4;
const MIN_INTENT_CONFIDENCE = 0.5;
const MULTIPLE_INTENTS_FLAG = 'MULTIPLE_INTENTS';

export interface SplitChild {
  /** Schlüssel des Anliegens (Kategorie der Registry oder frei benannt). */
  intentKey: string;
  /** Das Ziel dieses Teilvorgangs. */
  goal: string;
  /** Kurzbezeichnung des Anliegens (aus der Zerlegung der Nachricht). */
  title?: string;
  /** Die wörtlichen Sätze der Nachricht, die zu diesem Anliegen gehören (belegt); ohne Auszug bleibt nur das Ziel. */
  segment?: string;
  /** Gemeinsamer Kontext der Nachricht (für alle Anliegen zugänglich). */
  sharedContext?: string;
}

export interface SplitDecision {
  split: boolean;
  /** Alle Teilvorgänge in der Reihenfolge der Nachricht. */
  children: SplitChild[];
  reason: string;
}

export function decideSplit(triage: Pick<TriageResult, 'intents' | 'riskFlags' | 'proposedBusinessGoals'>): SplitDecision {
  if (!triage.riskFlags.includes(MULTIPLE_INTENTS_FLAG)) return { split: false, children: [], reason: 'Die Einstufung nennt nur ein Anliegen.' };
  const seen = new Set<string>();
  const intents = triage.intents.filter((intent) => {
    if (intent.confidence < MIN_INTENT_CONFIDENCE || seen.has(intent.key)) return false;
    seen.add(intent.key);
    return true;
  });
  if (intents.length < 2) return { split: false, children: [], reason: 'Es sind weniger als zwei belastbar unterscheidbare Anliegen erkannt.' };
  // Ziele werden nur zugeordnet, wenn ihre Zahl zu den Anliegen passt – sonst ist die Zuordnung geraten, und das Ziel ist das Anliegen selbst.
  const aligned = triage.proposedBusinessGoals.length === intents.length;
  const children = intents.map((intent, index): SplitChild => ({ intentKey: intent.key, goal: aligned ? (triage.proposedBusinessGoals[index] as string) : intent.key }));
  return { split: true, children, reason: `${intents.length} getrennte Anliegen erkannt.` };
}

export interface ChildSummary {
  title: string;
  status: string;
}

const SETTLED = new Set(['COMPLETED', 'CANCELLED', 'REJECTED']);
const NEEDS_ATTENTION = new Set(['MANUAL_REVIEW', 'FAILED']);
/** Teilvorgänge, die ORBIT gerade selbst bearbeitet (belegen einen Platz). Wartet ein Teilvorgang auf eine Person, belegt er keinen. */
const OCCUPYING = new Set(['IN_PROGRESS', 'READY', 'WAITING_FOR_INFORMATION', 'WAITING_FOR_APPROVAL', 'WAITING_FOR_EXTERNAL_SYSTEM', 'PAUSED']);
/** Noch nicht gestartet: ausdrücklich offen. */
const NOT_STARTED = 'RECEIVED';

export interface ChildRollUp {
  /** `COMPLETE`: alle Teilvorgänge sind abgeschlossen; sonst bleibt der Hauptvorgang offen. */
  outcome: 'COMPLETE' | 'OPEN';
  /** Kurzer Hinweis für den Hauptvorgang (z. B. welche Teilvorgänge Aufmerksamkeit brauchen). */
  attention: string[];
  /** Wie viele noch nicht gestartete Teilvorgänge jetzt gestartet werden können. */
  startable: number;
}

/**
 * Der Hauptvorgang schließt erst, wenn **jeder** Teilvorgang erledigt ist und mindestens einer wirklich abgeschlossen wurde. Ein gescheiterter Teilvorgang schließt den Hauptvorgang nie –
 * er bleibt offen und nennt, was Aufmerksamkeit braucht; ebenso jedes noch nicht begonnene Anliegen.
 */
export function rollUpChildren(children: ReadonlyArray<ChildSummary>, maxActive = MAX_ACTIVE_SPLIT_CHILDREN): ChildRollUp {
  if (children.length === 0) return { outcome: 'OPEN', attention: [], startable: 0 };
  const attention = [
    ...children.filter((c) => NEEDS_ATTENTION.has(c.status)).map((c) => `Teilvorgang „${c.title}“ braucht Prüfung.`),
    // Ein offener Freigabebedarf eines Teilvorgangs steht auch am Hauptvorgang (nicht erst beim Öffnen des Teilvorgangs).
    ...children.filter((c) => c.status === 'WAITING_FOR_APPROVAL').map((c) => `Teilvorgang „${c.title}“ wartet auf Ihre Freigabe.`),
  ];
  const waiting = children.filter((c) => c.status === NOT_STARTED).length;
  if (waiting > 0) attention.push(`${waiting} ${waiting === 1 ? 'Anliegen wartet' : 'Anliegen warten'} auf die Bearbeitung.`);
  const allSettled = children.every((c) => SETTLED.has(c.status));
  const anyCompleted = children.some((c) => c.status === 'COMPLETED');
  const occupied = children.filter((c) => OCCUPYING.has(c.status)).length;
  return { outcome: allSettled && anyCompleted ? 'COMPLETE' : 'OPEN', attention, startable: Math.max(0, Math.min(waiting, maxActive - occupied)) };
}
