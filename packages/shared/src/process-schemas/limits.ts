/**
 * Zentrale Grenzen der Orchestrierung (Amendment 02 v1.2 §35, BP-39): eine Quelle für Vorgaben und Obergrenzen. Ein Blueprint darf eine Grenze nur
 * **verschärfen** (unter die Plattformobergrenze legen) – nie darüber hinaus. Fehlt eine Angabe, gilt der Standard. Reine Funktion, deterministisch.
 */

export interface EffectiveLimits {
  /** Maximale Schritte eines Plans. */
  maxSteps: number;
  /** Maximale externe Aktionen eines Plans. */
  maxExternalActions: number;
  /** Maximale automatische Sachrückfragen je Vorgang. */
  maxAutoQuestions: number;
  /** Maximale Neuplanungen je Vorgang. */
  maxReplans: number;
  /** Maximale Aktionen mit Wirkung (Ledger-Absichten) je Vorgang über alle Planrevisionen. */
  maxActionsPerCase: number;
  /** Nach so vielen fehlgeschlagenen Aktionen in Folge wird nichts Neues mehr versucht, sondern geprüft. */
  maxConsecutiveCapabilityFailures: number;
}

export const LIMIT_KEYS = ['maxSteps', 'maxExternalActions', 'maxAutoQuestions', 'maxReplans', 'maxActionsPerCase', 'maxConsecutiveCapabilityFailures'] as const;
export type LimitKey = (typeof LIMIT_KEYS)[number];

/** Standardwerte, wenn der Blueprint nichts angibt. */
export const LIMIT_DEFAULTS: Readonly<EffectiveLimits> = {
  maxSteps: 30,
  maxExternalActions: 6,
  maxAutoQuestions: 2,
  maxReplans: 3,
  maxActionsPerCase: 20,
  maxConsecutiveCapabilityFailures: 3,
};

/** Plattformobergrenzen: kein Blueprint darf darüber hinaus. */
export const LIMIT_CEILINGS: Readonly<EffectiveLimits> = {
  maxSteps: 30,
  maxExternalActions: 6,
  maxAutoQuestions: 2,
  maxReplans: 20,
  maxActionsPerCase: 50,
  maxConsecutiveCapabilityFailures: 10,
};

export type BlueprintLimitsInput = Partial<Record<LimitKey, number | undefined>> | undefined;

export function effectiveLimits(blueprintLimits?: BlueprintLimitsInput): EffectiveLimits {
  const out = { ...LIMIT_DEFAULTS };
  for (const key of LIMIT_KEYS) {
    const requested = blueprintLimits?.[key];
    out[key] = Math.min(LIMIT_CEILINGS[key], requested ?? LIMIT_DEFAULTS[key]);
  }
  return out;
}

/** Ergebnis einer Prüfung der Aktionsgrenzen (vor der Vorbereitung einer neuen Aktion mit Wirkung). */
export interface ActionLimitVerdict {
  allowed: boolean;
  code?: 'LIMIT_ACTIONS_PER_CASE' | 'LIMIT_CONSECUTIVE_FAILURES';
  /** Fachlicher Text für die Prüfung durch einen Menschen (ohne Technikbegriffe). */
  message?: string;
}

/**
 * `existingActions`: bereits vorbereitete oder ausgeführte Aktionen des Vorgangs (ohne abgebrochene).
 * `recentOutcomes`: Ergebnisse der letzten Aktionen, neueste zuerst; `true` = fehlgeschlagen.
 */
export function checkActionLimits(limits: Pick<EffectiveLimits, 'maxActionsPerCase' | 'maxConsecutiveCapabilityFailures'>, existingActions: number, recentOutcomes: readonly boolean[]): ActionLimitVerdict {
  if (existingActions >= limits.maxActionsPerCase) {
    return { allowed: false, code: 'LIMIT_ACTIONS_PER_CASE', message: `Für diesen Vorgang wurden bereits ${existingActions} Aktionen vorbereitet; das Limit von ${limits.maxActionsPerCase} ist erreicht. Bitte prüfen, bevor weitere folgen.` };
  }
  let failures = 0;
  for (const failed of recentOutcomes) {
    if (!failed) break;
    failures += 1;
  }
  if (failures >= limits.maxConsecutiveCapabilityFailures) {
    return { allowed: false, code: 'LIMIT_CONSECUTIVE_FAILURES', message: `${failures} Aktionen in Folge sind fehlgeschlagen. ORBIT versucht nichts Neues, bis jemand die Ursache geprüft hat.` };
  }
  return { allowed: true };
}
