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
  /** Geschätzte KI-Kosten je Vorgang (in der Währung des Kostenprofils); danach wird nichts Neues mehr gestartet, sondern geprüft. Wirkt nur mit gepflegtem Kostenprofil. */
  maxAiCostPerCase: number;
}

export const LIMIT_KEYS = ['maxSteps', 'maxExternalActions', 'maxAutoQuestions', 'maxReplans', 'maxActionsPerCase', 'maxConsecutiveCapabilityFailures', 'maxAiCostPerCase'] as const;
export type LimitKey = (typeof LIMIT_KEYS)[number];

/** Standardwerte, wenn der Blueprint nichts angibt. */
export const LIMIT_DEFAULTS: Readonly<EffectiveLimits> = {
  maxSteps: 30,
  maxExternalActions: 6,
  maxAutoQuestions: 2,
  maxReplans: 3,
  maxActionsPerCase: 20,
  maxConsecutiveCapabilityFailures: 3,
  maxAiCostPerCase: 5,
};

/** Plattformobergrenzen: kein Blueprint darf darüber hinaus. */
export const LIMIT_CEILINGS: Readonly<EffectiveLimits> = {
  maxSteps: 30,
  maxExternalActions: 6,
  /** Höchstens drei Klärungsrunden mit der Kundschaft; danach übernimmt ein Mensch (der Standard bleibt bei zwei). */
  maxAutoQuestions: 3,
  maxReplans: 20,
  maxActionsPerCase: 50,
  maxConsecutiveCapabilityFailures: 10,
  maxAiCostPerCase: 100,
};

export type BlueprintLimitsInput = Partial<Record<LimitKey, number | undefined>> | undefined;

/** Grenzen, die ein Betrieb selbst setzen darf (BPF-04): nur verschärfen, nie über die Plattformobergrenze. */
export const TENANT_LIMIT_KEYS = ['maxActionsPerCase', 'maxReplans', 'maxConsecutiveCapabilityFailures', 'maxAiCostPerCase'] as const satisfies readonly LimitKey[];
export type TenantLimitKey = (typeof TENANT_LIMIT_KEYS)[number];
export type TenantLimitsInput = Partial<Record<TenantLimitKey, number | null | undefined>> | null | undefined;

export const LIMIT_LABELS: Record<TenantLimitKey, { label: string; hint: string; unit: string }> = {
  maxActionsPerCase: { label: 'Aktionen je Vorgang', hint: 'Wie viele Aktionen mit Wirkung (z. B. Nachrichten senden) ORBIT je Vorgang vorbereitet, bevor ein Mensch prüft.', unit: 'Aktionen' },
  maxReplans: { label: 'Neuplanungen je Vorgang', hint: 'Wie oft ORBIT den Ablauf eines Vorgangs neu planen darf.', unit: 'Neuplanungen' },
  maxConsecutiveCapabilityFailures: { label: 'Fehlversuche in Folge', hint: 'Nach so vielen fehlgeschlagenen Aktionen in Folge versucht ORBIT nichts Neues, bis jemand die Ursache geprüft hat.', unit: 'Fehlversuche' },
  maxAiCostPerCase: { label: 'KI-Kosten je Vorgang', hint: 'Geschätzte KI-Kosten, ab denen ORBIT einen Vorgang zur Prüfung vorlegt. Wirkt nur, wenn für das Modell ein Kostenprofil gepflegt ist.', unit: 'Währungseinheiten' },
};

/**
 * Die wirksamen Grenzen: Standard, ggf. vom Blueprint **verschärft**, ggf. vom Betrieb **weiter verschärft** – nie über der Plattformobergrenze. Fehlende oder ungültige
 * (nicht positive) Angaben des Betriebs zählen nicht.
 */
export function effectiveLimits(blueprintLimits?: BlueprintLimitsInput, tenantLimits?: TenantLimitsInput): EffectiveLimits {
  const out = { ...LIMIT_DEFAULTS };
  for (const key of LIMIT_KEYS) {
    const requested = blueprintLimits?.[key];
    let value = Math.min(LIMIT_CEILINGS[key], requested ?? LIMIT_DEFAULTS[key]);
    const own = (TENANT_LIMIT_KEYS as readonly string[]).includes(key) ? tenantLimits?.[key as TenantLimitKey] : undefined;
    if (typeof own === 'number' && Number.isFinite(own) && (own > 0 || (key === 'maxReplans' && own === 0))) value = Math.min(value, own);
    out[key] = value;
  }
  return out;
}

/** Prüft die geschätzten KI-Kosten eines Vorgangs gegen die Grenze (die Summe nur in einer Währung; ohne Kostenangaben ist nichts zu prüfen). */
export function checkAiCostLimit(limit: number, spent: number): ActionLimitVerdict {
  if (spent < limit) return { allowed: true };
  return { allowed: false, code: 'LIMIT_AI_COST', message: `Die geschätzten KI-Kosten dieses Vorgangs (${spent.toFixed(2)}) haben die Grenze von ${limit.toFixed(2)} erreicht. Bitte prüfen, bevor weitere Schritte folgen.` };
}

/** Ergebnis einer Prüfung der Aktionsgrenzen (vor der Vorbereitung einer neuen Aktion mit Wirkung). */
export interface ActionLimitVerdict {
  allowed: boolean;
  code?: 'LIMIT_ACTIONS_PER_CASE' | 'LIMIT_CONSECUTIVE_FAILURES' | 'LIMIT_AI_COST';
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
