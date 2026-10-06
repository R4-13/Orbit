import type { CaseCommandType } from './commands';

/**
 * HumanInteractionRequest (Amendment 02 v1.2 §31, BP-35) – die konkrete, begründete Bitte an einen Menschen. Keine zweite Tabelle (Governance 5.1): eine
 * Projektion über die bestehenden Objekte (gebundene Freigabe, Plan-Bestätigung, Fakt-Konflikt, ungewisse Wirkung, manueller Schritt, Prüfung).
 * Human-in-the-Loop ist Ausnahme-, Freigabe- und Eskalationsmechanismus – nie die Standardfortsetzung nach einem Schritt.
 */

export const HUMAN_INTERACTION_TYPES = ['APPROVAL', 'FACT_CONFIRMATION', 'CONFLICT_RESOLUTION', 'PLAN_REVIEW', 'EXCEPTION_DECISION', 'SECURITY_REVIEW'] as const;
export type HumanInteractionType = (typeof HUMAN_INTERACTION_TYPES)[number];

/** Zulässige fachliche Gründe (Amendment 02 v1.2 §31.2). Ein Request ohne einen dieser Gründe darf nicht entstehen. */
export const HUMAN_INTERACTION_REASONS = {
  POLICY_REQUIRES_APPROVAL: 'Die Policy verlangt für diese Aktion eine Freigabe.',
  PLAN_REQUIRES_REVIEW: 'Ein Plan ohne freigegebene Vorlage darf nicht ohne Bestätigung ausgeführt werden.',
  FACT_CONFLICT: 'Angaben widersprechen sich und können nicht verlässlich aufgelöst werden.',
  OUTCOME_UNKNOWN: 'Es ist ungewiss, ob eine Aktion nach außen wirksam wurde; sie wird nicht blind wiederholt.',
  MANUAL_STEP_OPEN: 'Der Prozess sieht an dieser Stelle einen manuellen Schritt vor.',
  LIMIT_REACHED: 'Ein konfiguriertes Limit (z. B. Rückfragen, Neuplanungen) ist erreicht – ORBIT stoppt sicher.',
  BLOCKED_FOR_REVIEW: 'Ein Schritt ist blockiert oder fehlgeschlagen und braucht eine Entscheidung.',
} as const;

export type HumanInteractionReason = keyof typeof HUMAN_INTERACTION_REASONS;

export interface HumanInteractionResponse {
  /** Der Befehl, den die Antwort auslöst (`CaseCommandType`). */
  key: CaseCommandType;
  label: string;
  /** Was diese Antwort konkret bewirkt – kein „OK“, kein „Weiter?“. */
  effectDescription: string;
  destructive?: boolean;
  requiresPreview: boolean;
  targetRef?: string;
  payload?: Record<string, unknown>;
  fields: Array<{ name: string; label: string; type: string; required: boolean }>;
}

export interface HumanInteractionRequest {
  id: string;
  caseId: string;
  goalKeys: string[];
  type: HumanInteractionType;
  businessQuestion: string;
  reasonCode: HumanInteractionReason;
  reasonText: string;
  nodeId?: string;
  evidenceRefs: string[];
  allowedResponses: HumanInteractionResponse[];
  freeTextAllowed: boolean;
  expiresAt?: string;
}

/** Wirkungsbeschreibung je Befehl (Amendment 02 v1.2 §31.3). */
export const COMMAND_EFFECTS: Partial<Record<CaseCommandType, string>> = {
  APPROVE_ACTION: 'Die vorbereitete Aktion wird genau einmal ausgeführt; der Nachweis wird im Vorgang gespeichert.',
  REJECT_ACTION: 'Die Aktion wird nicht ausgeführt; der Schritt endet sichtbar als nicht freigegeben.',
  APPROVE_PLAN: 'Der Plan wird freigegeben und danach schrittweise unter den bestehenden Policies ausgeführt.',
  REJECT_PLAN: 'Der Plan wird verworfen; es wird nichts ausgeführt, der Vorgang bleibt zur Prüfung offen.',
  RECONCILE_ACTION: 'Sie bestätigen mit Nachweis, ob die Aktion tatsächlich erfolgt ist; erst danach kann der Vorgang fortfahren – ohne Wiederholung.',
  COMPLETE_MANUAL_TASK: 'Der manuelle Schritt gilt als erledigt; der Vorgang setzt mit Ihrem Ergebnis fort.',
  RESOLVE_FACT_CONFLICT: 'Der gewählte Wert gilt als bestätigt (Herkunft „Mensch“); die widersprüchlichen Kandidaten werden ersetzt und der Vorgang prüft neu.',
  CORRECT_FACT: 'Die Angabe wird korrigiert und mit Herkunft „Mensch“ gespeichert; die frühere Fassung bleibt in der Historie.',
  ADD_FACTS: 'Die Angabe wird als bestätigter Fakt mit Herkunft „Mensch“ gespeichert und ersetzt widersprüchliche Kandidaten; der Vorgang prüft neu.',
  REPLAN: 'Der Plan wird auf Basis der aktuellen Angaben neu erstellt; erledigte Schritte und Nachweise bleiben unverändert.',
  CANCEL: 'Der Vorgang wird abgebrochen; offene Freigaben werden ungültig, bereits Erfolgtes bleibt dokumentiert.',
  PAUSE: 'Der Vorgang wird angehalten und führt nichts mehr aus, bis er fortgesetzt wird.',
  RESUME: 'Der Vorgang läuft an der unterbrochenen Stelle weiter.',
  EDIT_DRAFT: 'Der Entwurf wird geändert; eine an den alten Inhalt gebundene Freigabe wird ungültig und neu angefordert.',
  RETRY_STEP: 'Der Schritt wird erneut versucht (nur wenn dadurch keine doppelte Wirkung entsteht).',
};

export function isHumanInteractionReason(value: string): value is HumanInteractionReason {
  return value in HUMAN_INTERACTION_REASONS;
}
