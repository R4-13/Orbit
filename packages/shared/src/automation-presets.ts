import { DEFAULT_POLICY_CONFIG, POLICY_ACTIONS, policyModeRank, type PolicyActionKey, type PolicyMode } from './policy';

/**
 * Automatisierungsgrad eines Mandanten: drei verständliche Voreinstellungen für die Regeln & Freigaben, statt jede Aktion einzeln zu stellen.
 * Sie ändern nur, was ohne Risiko für Geld oder Rechtsfolgen steuerbar ist – gesperrte Aktionen (neuer Lieferant, Bankdaten, Zahlung) bleiben in jeder
 * Stufe unverändert, denn ihre Obergrenze liegt fest (`locked`). Der Zustand „Individuell“ entsteht, sobald einzelne Regeln abweichen.
 */
export const AUTOMATION_PRESET_KEYS = ['CAUTIOUS', 'BALANCED', 'HIGH'] as const;
export type AutomationPresetKey = (typeof AUTOMATION_PRESET_KEYS)[number];
export type AutomationLevel = AutomationPresetKey | 'CUSTOM';

export interface AutomationPreset {
  key: AutomationPresetKey;
  label: string;
  description: string;
  /** Abweichungen von der Grundeinstellung (`DEFAULT_POLICY_CONFIG`); alles andere bleibt wie dort. */
  overrides: Readonly<Partial<Record<PolicyActionKey, PolicyMode>>>;
}

export const AUTOMATION_PRESETS: Readonly<Record<AutomationPresetKey, AutomationPreset>> = {
  CAUTIOUS: {
    key: 'CAUTIOUS',
    label: 'Vorsichtig',
    description: 'Jede E-Mail an Kunden, jeder Termin und jede Übertragung an die Buchhaltung braucht Ihre Freigabe.',
    overrides: {},
  },
  BALANCED: {
    key: 'BALANCED',
    label: 'Ausgewogen (empfohlen)',
    description:
      'Rückfragen an Absender („Welche Menge benötigen Sie?“) gehen selbstständig hinaus. Angebote, Follow-ups, Termine und Buchhaltung bleiben freigabepflichtig.',
    overrides: { [POLICY_ACTIONS.EMAIL_SEND_CLARIFICATION]: 'AUTONOMOUS' },
  },
  HIGH: {
    key: 'HIGH',
    label: 'Hochautomatisiert',
    description:
      'ORBIT erledigt Rückfragen, Angebotsversand, Follow-ups, Termine und die Übertragung an die Buchhaltung selbstständig, wenn die Prüfungen bestanden sind. Sie sehen alles im Verlauf; Freigaben bleiben nur für gesperrte Aktionen (neuer Lieferant, geänderte Bankdaten) und bei auffälligen Fällen.',
    overrides: {
      [POLICY_ACTIONS.EMAIL_SEND_CLARIFICATION]: 'AUTONOMOUS',
      [POLICY_ACTIONS.EMAIL_SEND_QUOTE_DELIVERY]: 'AUTONOMOUS',
      [POLICY_ACTIONS.FOLLOW_UP_SEND]: 'AUTONOMOUS',
      [POLICY_ACTIONS.MEETING_CREATE]: 'AUTONOMOUS',
      [POLICY_ACTIONS.INVOICE_TRANSFER_TO_FIBU]: 'AUTONOMOUS',
    },
  },
};

/** Der Modus, den eine Stufe für eine Aktion vorsieht – nie über der festen Obergrenze einer gesperrten Aktion. */
export function presetModeFor(preset: AutomationPresetKey, action: PolicyActionKey): PolicyMode {
  const base = DEFAULT_POLICY_CONFIG[action];
  const wanted = AUTOMATION_PRESETS[preset].overrides[action] ?? base.mode;
  return base.locked && policyModeRank(wanted) > policyModeRank(base.mode) ? base.mode : wanted;
}

/** Welche Stufe entspricht den aktuellen Regeln? Weicht auch nur eine bekannte Regel ab, ist es „Individuell“. */
export function detectAutomationLevel(current: Readonly<Record<string, PolicyMode>>): AutomationLevel {
  const actions = (Object.values(POLICY_ACTIONS) as PolicyActionKey[]).filter((action) => current[action] !== undefined);
  // Die vorsichtigste Stufe zuerst: stimmen mehrere überein (nur bei leeren Overrides), gilt die engere.
  for (const key of AUTOMATION_PRESET_KEYS) {
    if (actions.every((action) => current[action] === presetModeFor(key, action))) return key;
  }
  return 'CUSTOM';
}
