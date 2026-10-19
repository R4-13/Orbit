/**
 * Konzept Flexible Autonomie §5a (Präzisierung 1), Addendum ADD-2.2/ADD-2.3 – **zielbezogene, überprüfbare Abschlusskriterien** für frei geplante Vorgänge.
 *
 * Ein Ziel ist erreicht, wenn die Nachweise vorliegen, die *dieses* Ziel belegen – nicht, weil ein Plan „durchgelaufen“ ist und nicht, weil eine bestimmte Wirkung (etwa eine E-Mail) für jeden
 * Vorgang nötig wäre. Eine versendete Antwort ist der Nachweis für ein Kommunikationsziel; ein interner Auftrag („Erinnere Herrn Meier an …“) ist mit der bestätigten Meldung an die Person erreicht;
 * ein Ziel, das ein Mensch verantwortet, schließt ein Mensch ab. Die Kriterien liegen fest im Code: Plan, KI und Planrevisionen können sie weder ändern noch abschwächen.
 *
 * Die Ziele eines Vorgangs stehen mit der ersten Planung fest (Planvertrag) und gelten für alle Revisionen; eine Revision darf sie ergänzen, aber keines streichen (Planprüfung `GOAL_CONTRACT_VIOLATION`).
 */
export type GoalCriterion =
  /** Eine bestätigte Wirkung (Beleg im Ausführungsprotokoll), optional mit bestimmtem Zweck. */
  | { kind: 'EFFECT'; capability: string; purposes?: readonly string[] }
  /** Mindestens eine Aufgabe für eine Person wurde angelegt. */
  | { kind: 'TASK' };

export interface GoalDefinition {
  key: string;
  label: string;
  /** Alle Kriterien müssen erfüllt sein. Leer + `humanOnly`: das Ziel schließt ein Mensch ab. */
  requires: readonly GoalCriterion[];
  /** Das Ziel liegt bei einem Menschen (Übergabe, Notfall, Prüfung): ORBIT bereitet vor, schließt aber nie von selbst ab. */
  humanOnly?: boolean;
}

export const GOAL_CATALOGUE: Readonly<Record<string, GoalDefinition>> = {
  'inquiry.answered': { key: 'inquiry.answered', label: 'Anfrage beantwortet', requires: [{ kind: 'EFFECT', capability: 'email.send', purposes: ['INFORMATION', 'STATUS_UPDATE'] }] },
  'receipt.acknowledged': { key: 'receipt.acknowledged', label: 'Eingang bestätigt', requires: [{ kind: 'EFFECT', capability: 'email.send', purposes: ['ACKNOWLEDGEMENT'] }] },
  'quote.delivered': { key: 'quote.delivered', label: 'Angebot zugestellt', requires: [{ kind: 'EFFECT', capability: 'email.send', purposes: ['QUOTE_DELIVERY'] }] },
  'appointment.booked': { key: 'appointment.booked', label: 'Termin gebucht', requires: [{ kind: 'EFFECT', capability: 'calendar.book' }] },
  'staff.informed': { key: 'staff.informed', label: 'Zuständige Person informiert', requires: [{ kind: 'EFFECT', capability: 'staff.notify' }] },
  'task.created': { key: 'task.created', label: 'Aufgabe angelegt', requires: [{ kind: 'TASK' }] },
  'request.handed_over': { key: 'request.handed_over', label: 'Anfrage übergeben', requires: [{ kind: 'EFFECT', capability: 'crm.lead.create', purposes: ['CRM_HANDOFF'] }] },
  'emergency.handled': { key: 'emergency.handled', label: 'Notfall bearbeitet', requires: [], humanOnly: true },
  'human.review': { key: 'human.review', label: 'Prüfung durch eine Person', requires: [], humanOnly: true },
};

export interface GoalEvidence {
  /** Bestätigte Wirkungen des Vorgangs (Ausführungsprotokoll). */
  effects: ReadonlyArray<{ capabilityKey: string; purpose?: string | null }>;
  /** Anzahl der für den Vorgang angelegten Aufgaben. */
  tasksCreated: number;
}

export type CatalogueGoalStatus = 'ACHIEVED' | 'NOT_ACHIEVED' | 'NEEDS_HUMAN' | 'UNKNOWN_GOAL';

export interface GoalResult {
  goal: string;
  label: string;
  status: CatalogueGoalStatus;
  /** Welche Nachweise tragen das Ziel (`capability/purpose`, `task`)? */
  evidence: string[];
}

function criterionMet(criterion: GoalCriterion, evidence: GoalEvidence): string | undefined {
  if (criterion.kind === 'TASK') return evidence.tasksCreated > 0 ? 'task' : undefined;
  const hit = evidence.effects.find((e) => e.capabilityKey === criterion.capability && (!criterion.purposes || criterion.purposes.includes(e.purpose ?? '')));
  return hit ? `${hit.capabilityKey}${hit.purpose ? `/${hit.purpose}` : ''}` : undefined;
}

/** Wertet ein Ziel deterministisch aus. Ein unbekanntes Ziel ist nie „erreicht“ – ein Mensch entscheidet. */
export function evaluateGoal(goalKey: string, evidence: GoalEvidence): GoalResult {
  const definition = GOAL_CATALOGUE[goalKey];
  if (!definition) return { goal: goalKey, label: goalKey, status: 'UNKNOWN_GOAL', evidence: [] };
  if (definition.humanOnly) return { goal: goalKey, label: definition.label, status: 'NEEDS_HUMAN', evidence: [] };
  const found = definition.requires.map((criterion) => criterionMet(criterion, evidence));
  const achieved = found.every((hit) => hit !== undefined);
  return { goal: goalKey, label: definition.label, status: achieved ? 'ACHIEVED' : 'NOT_ACHIEVED', evidence: found.filter((hit): hit is string => hit !== undefined) };
}

/** Erfüllt eine Menge von Plänen-Zielen? Nur wenn jedes Ziel erreicht ist (und es mindestens eines gibt). */
export function evaluateGoals(goalKeys: readonly string[], evidence: GoalEvidence): { met: boolean; goals: GoalResult[] } {
  const goals = [...new Set(goalKeys)].map((key) => evaluateGoal(key, evidence));
  return { met: goals.length > 0 && goals.every((goal) => goal.status === 'ACHIEVED'), goals };
}

/** Für den Planer: der Katalog in Textform. */
export function describeGoalCatalogue(): string {
  return Object.values(GOAL_CATALOGUE)
    .map((goal) => `- ${goal.key}: ${goal.label}${goal.humanOnly ? ' (liegt bei einer Person; ORBIT bereitet vor und übergibt)' : ''}`)
    .join('\n');
}
