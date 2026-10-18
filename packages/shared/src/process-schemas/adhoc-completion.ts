/**
 * Konzept Flexible Autonomie §5a (Präzisierung 1), Addendum ADD-2.2/ADD-2.3 – Abschlussnachweis für **frei geplante** Abläufe (ohne hinterlegten Prozess).
 *
 * Ein Plan, der „einfach durchgelaufen“ ist, ist noch kein erreichtes Ziel: eine Zusammenfassung, eine Aufgabe oder eine interne Meldung beantwortet das Anliegen
 * der Kundschaft nicht. Ein frei geplanter Vorgang gilt deshalb erst als erledigt, wenn ein **belegter Wirkungsnachweis** vorliegt, der das Anliegen tatsächlich
 * abschließt (eine versendete inhaltliche Antwort). Alles andere endet in einem zulässigen Endzustand (Wartepunkt, Freigabe, Übergabe) – ein Mensch schließt dann ab.
 *
 * Die Kriterien stehen hier fest im Code. Weder die KI noch eine Planrevision kann sie ändern, abschwächen oder weglassen: sie werden aus den bestätigten Wirkungen des
 * Vorgangs ausgewertet, nicht aus dem, was der Plan über sich selbst sagt.
 */
export interface ClosingProofEffect {
  capabilityKey: string;
  purpose?: string | null;
}

/** Wirkungen, die ein Anliegen inhaltlich abschließen (nicht: Rückfrage, Eingangsbestätigung, Anhang anfordern – sie lassen das Anliegen offen). */
export const ADHOC_CLOSING_PROOFS: ReadonlyArray<{ capability: string; purposes: readonly string[]; label: string }> = [
  { capability: 'email.send', purposes: ['INFORMATION', 'STATUS_UPDATE', 'QUOTE_DELIVERY', 'APPOINTMENT_CONFIRMATION'], label: 'inhaltliche Antwort an die Kundschaft versendet' },
];

export type AdHocCompletionReason = 'PROVEN' | 'NODES_PENDING' | 'NO_CLOSING_PROOF';

export interface AdHocCompletionEvaluation {
  met: boolean;
  reason: AdHocCompletionReason;
  /** Die Nachweise, die den Abschluss tragen (`capability/purpose`). */
  evidence: string[];
  /** Fachliche Erklärung für Verlauf und Hinweis. */
  description: string;
}

export function evaluateAdHocCompletion(input: { allOtherNodesDone: boolean; effects: readonly ClosingProofEffect[] }): AdHocCompletionEvaluation {
  if (!input.allOtherNodesDone) {
    return { met: false, reason: 'NODES_PENDING', evidence: [], description: 'Es sind noch nicht alle Schritte des Ablaufs abgeschlossen.' };
  }
  const evidence = input.effects
    .filter((effect) => ADHOC_CLOSING_PROOFS.some((proof) => proof.capability === effect.capabilityKey && proof.purposes.includes(effect.purpose ?? '')))
    .map((effect) => `${effect.capabilityKey}${effect.purpose ? `/${effect.purpose}` : ''}`);
  if (evidence.length === 0) {
    return {
      met: false,
      reason: 'NO_CLOSING_PROOF',
      evidence: [],
      description: 'Der Ablauf ist durchgelaufen, aber es gibt keinen Nachweis, dass das Anliegen beantwortet ist (z. B. eine versendete inhaltliche Antwort). Bitte prüfen und selbst abschließen.',
    };
  }
  return { met: true, reason: 'PROVEN', evidence, description: `Abschluss nachgewiesen: ${ADHOC_CLOSING_PROOFS[0]!.label}.` };
}
