import { evaluateGoals, type GoalEvidence, type GoalResult } from './goal-catalogue';

/**
 * Konzept Flexible Autonomie §5a (Präzisierung 1), Addendum ADD-2.2/ADD-2.3 – Abschluss **frei geplanter** Abläufe (ohne hinterlegten Prozess).
 *
 * Ein Plan, der „einfach durchgelaufen“ ist, ist noch kein erreichtes Ziel. Abgeschlossen wird erst, wenn **jedes Ziel des Vorgangs** (Planvertrag, siehe `goal-catalogue.ts`) durch die dafür
 * festgelegten Nachweise belegt ist. Eine Zusammenfassung, eine Aufgabe oder eine Meldung schließt nur dann ab, wenn das Ziel genau das ist. Unbekannte Ziele und Ziele, die bei einer Person
 * liegen, schließt ORBIT nie von selbst ab: der Vorgang bleibt in der Prüfung, bis ein Mensch ihn abschließt.
 *
 * Diese Funktion löst die frühere allgemeine Regel „Abschluss nur mit versendeter inhaltlicher Antwort“ ab (die nur eine Zwischenlösung war): E-Mail ist ein Nachweis unter mehreren, weder für
 * jeden Vorgang nötig noch allgemein ausreichend.
 */
export type AdHocCompletionReason = 'PROVEN' | 'NODES_PENDING' | 'GOAL_NOT_ACHIEVED' | 'GOAL_NEEDS_HUMAN' | 'NO_GOAL';

export interface AdHocCompletionEvaluation {
  met: boolean;
  reason: AdHocCompletionReason;
  goals: GoalResult[];
  /** Die Nachweise, die den Abschluss tragen. */
  evidence: string[];
  /** Fachliche Erklärung für Verlauf und Hinweis. */
  description: string;
}

export function evaluateAdHocCompletion(input: { allOtherNodesDone: boolean; goalKeys: readonly string[]; evidence: GoalEvidence }): AdHocCompletionEvaluation {
  const { met, goals } = evaluateGoals(input.goalKeys, input.evidence);
  const evidence = goals.flatMap((goal) => goal.evidence);
  if (goals.length === 0) {
    return { met: false, reason: 'NO_GOAL', goals, evidence, description: 'Für diesen Vorgang ist kein Ziel festgelegt; eine Person schließt ihn ab.' };
  }
  if (!input.allOtherNodesDone) {
    return { met: false, reason: 'NODES_PENDING', goals, evidence, description: 'Es sind noch nicht alle Schritte des Ablaufs abgeschlossen.' };
  }
  if (met) return { met: true, reason: 'PROVEN', goals, evidence, description: `Abschluss nachgewiesen: ${goals.map((g) => g.label).join(', ')}.` };

  const human = goals.filter((g) => g.status === 'NEEDS_HUMAN' || g.status === 'UNKNOWN_GOAL');
  if (human.length > 0) {
    return {
      met: false,
      reason: 'GOAL_NEEDS_HUMAN',
      goals,
      evidence,
      description: `Der Ablauf ist durchgelaufen. ${human.map((g) => `„${g.label}“`).join(', ')} liegt bei einer Person (oder ist kein bekanntes Ziel) und wird nicht von ORBIT abgeschlossen – bitte prüfen und abschließen.`,
    };
  }
  const open = goals.filter((g) => g.status === 'NOT_ACHIEVED');
  return {
    met: false,
    reason: 'GOAL_NOT_ACHIEVED',
    goals,
    evidence,
    description: `Der Ablauf ist durchgelaufen, aber ${open.map((g) => `„${g.label}“`).join(', ')} ist nicht nachgewiesen. Bitte prüfen und selbst abschließen.`,
  };
}
