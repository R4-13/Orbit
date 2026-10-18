import { DEFAULT_POLICY_CONFIG, POLICY_ACTIONS, policyModeRank, type PolicyActionKey, type PolicyMode } from './policy';

/**
 * Konzept Flexible Autonomie §8.1a/§8.2 (Addendum ADD-4.1, ADD-6.1): verständliche Darstellung der Regeln – **keine zweite Policy**.
 *
 * Die sechs Gruppen sind eine reine **Sicht** über die vorhandenen Policy-Aktionen (die vier Modi bleiben die einzige Laufzeitsemantik, A02 §32.1). Sie
 * dürfen künftige Prozesse nicht technisch beschränken: jede Aktion, die in keiner Gruppe steht (z. B. eine neue Fähigkeit), fällt auf die sichtbare
 * Standardregel „Sonstiges / neue Fähigkeiten“ (Freigabe nötig) – nie auf „erlaubt“.
 */
export const POLICY_GROUP_KEYS = ['CUSTOMER_COMMUNICATION', 'APPOINTMENTS', 'CRM_CONTACTS', 'STAFF_NOTIFICATION', 'INVOICING', 'SUPPLIERS'] as const;
export type PolicyGroupKey = (typeof POLICY_GROUP_KEYS)[number];

export interface PolicyGroup {
  key: PolicyGroupKey;
  label: string;
  description: string;
  /** Aktionen, die der Betrieb in dieser Gruppe verantwortet (Wirkung nach außen oder auf Geschäftsdaten). */
  actions: readonly PolicyActionKey[];
}

export const POLICY_GROUPS: Readonly<Record<PolicyGroupKey, PolicyGroup>> = {
  CUSTOMER_COMMUNICATION: {
    key: 'CUSTOMER_COMMUNICATION',
    label: 'Kundenkommunikation',
    description: 'Rückfragen, Bestätigungen, Auskünfte, Angebotsversand und Folgenachrichten an Kundschaft und Interessenten.',
    actions: [
      POLICY_ACTIONS.EMAIL_SEND_CLARIFICATION,
      POLICY_ACTIONS.EMAIL_SEND_ACKNOWLEDGEMENT,
      POLICY_ACTIONS.EMAIL_SEND_INFORMATION,
      POLICY_ACTIONS.EMAIL_SEND_QUOTE_DELIVERY,
      POLICY_ACTIONS.FOLLOW_UP_SEND,
    ],
  },
  APPOINTMENTS: {
    key: 'APPOINTMENTS',
    label: 'Termine',
    description: 'Termine vorschlagen ist frei, einen Termin verbindlich buchen ist eine Entscheidung.',
    actions: [POLICY_ACTIONS.MEETING_PROPOSE, POLICY_ACTIONS.MEETING_CREATE, POLICY_ACTIONS.BOOKING_PROPOSAL_CREATE],
  },
  CRM_CONTACTS: {
    key: 'CRM_CONTACTS',
    label: 'CRM und Kontakte',
    description: 'Kontakte und Anfragen im CRM anlegen und Aktivitäten festhalten.',
    actions: [POLICY_ACTIONS.LEAD_CREATE, POLICY_ACTIONS.CONTACT_MANAGE, POLICY_ACTIONS.CRM_ACTIVITY_LOG],
  },
  STAFF_NOTIFICATION: {
    key: 'STAFF_NOTIFICATION',
    label: 'Mitarbeitende informieren',
    description: 'Interne Meldungen, Erinnerungen und Aufgaben an Personen im Betrieb.',
    actions: [POLICY_ACTIONS.STAFF_NOTIFY, POLICY_ACTIONS.TASK_CREATE],
  },
  INVOICING: {
    key: 'INVOICING',
    label: 'Rechnungen und Buchhaltung',
    description: 'Eingangsrechnungen erfassen und an die Buchhaltung übertragen. Zahlungen ausführen ist in dieser Ausbaustufe gesperrt.',
    actions: [POLICY_ACTIONS.INVOICE_INTAKE, POLICY_ACTIONS.INVOICE_TRANSFER_TO_FIBU],
  },
  SUPPLIERS: {
    key: 'SUPPLIERS',
    label: 'Lieferanten',
    description: 'Neue Lieferanten anlegen und Bankdaten ändern – beides bleibt immer bei einem Menschen.',
    actions: [POLICY_ACTIONS.SUPPLIER_CREATE, POLICY_ACTIONS.SUPPLIER_BANK_DETAILS_CHANGE],
  },
};

/** Reine Lese-, Analyse- und Entwurfsschritte ohne Wirkung nach außen: keine Entscheidung des Betriebs, in keiner Gruppe (Konzept §2: „reine Technik“). */
export const TECHNICAL_POLICY_ACTIONS: readonly PolicyActionKey[] = [
  POLICY_ACTIONS.EMAIL_CLASSIFY,
  POLICY_ACTIONS.EMAIL_TRIAGE,
  POLICY_ACTIONS.EMAIL_DRAFT,
  POLICY_ACTIONS.COPILOT_READ,
  POLICY_ACTIONS.CALENDAR_READ,
  POLICY_ACTIONS.CONTEXT_LOOKUP,
  POLICY_ACTIONS.REQUIREMENTS_RESOLVE,
  POLICY_ACTIONS.PRICING_RESOLVE,
  POLICY_ACTIONS.QUOTE_CREATE,
  POLICY_ACTIONS.QUOTE_RENDER,
  POLICY_ACTIONS.KNOWLEDGE_ANSWER,
  POLICY_ACTIONS.PROCESS_PLAN,
];

/** Gehören zum Autonomiegrad selbst (Voreinstellung), nicht zu einer Gruppe: darf ORBIT einen frei geplanten Ablauf ohne vorherige Bestätigung des ganzen Plans starten? */
export const AUTONOMY_LEVEL_POLICY_ACTIONS: readonly PolicyActionKey[] = [POLICY_ACTIONS.PROCESS_PLAN_ACTIVATE];

/** Plattformseitig gesperrt, nicht einstellbar und in keiner Gruppe (Zahlung ausführen: in dieser Ausbaustufe nie ausführbar, auch nicht nach Freigabe). */
export const PLATFORM_BLOCKED_POLICY_ACTIONS: readonly PolicyActionKey[] = [POLICY_ACTIONS.PAYMENT_EXECUTE];

/** Die sichtbare Standardregel für alles, was keiner Gruppe zugeordnet ist (neue Fähigkeiten): Freigabe nötig. */
export const UNGROUPED_DEFAULT_MODE: PolicyMode = 'REQUIRE_APPROVAL';

export type PolicyActionPlacement = { kind: 'GROUP'; group: PolicyGroupKey } | { kind: 'TECHNICAL' } | { kind: 'AUTONOMY_LEVEL' } | { kind: 'PLATFORM_BLOCKED' } | { kind: 'UNGROUPED' };

const GROUP_OF = new Map<string, PolicyGroupKey>(POLICY_GROUP_KEYS.flatMap((key) => POLICY_GROUPS[key].actions.map((action) => [action, key] as const)));

export function placementOf(action: string): PolicyActionPlacement {
  const group = GROUP_OF.get(action);
  if (group) return { kind: 'GROUP', group };
  if ((TECHNICAL_POLICY_ACTIONS as readonly string[]).includes(action)) return { kind: 'TECHNICAL' };
  if ((AUTONOMY_LEVEL_POLICY_ACTIONS as readonly string[]).includes(action)) return { kind: 'AUTONOMY_LEVEL' };
  if ((PLATFORM_BLOCKED_POLICY_ACTIONS as readonly string[]).includes(action)) return { kind: 'PLATFORM_BLOCKED' };
  return { kind: 'UNGROUPED' };
}

/**
 * Der Wert einer Gruppe = der **strengste** Modus ihrer Aktionen (kleinster Rang). Weicht eine Aktion ab, bleibt sie als „abweichende Einzelregel“ sichtbar
 * (`deviations`); die Gruppe wird nie lockerer dargestellt, als es die strengste Einzelregel ist.
 */
export function groupModeOf(
  group: PolicyGroupKey,
  modes: Readonly<Record<string, PolicyMode>>,
): { mode: PolicyMode; uniform: boolean; deviations: Array<{ action: PolicyActionKey; mode: PolicyMode }> } {
  const entries = POLICY_GROUPS[group].actions.map((action) => ({ action, mode: modes[action] ?? DEFAULT_POLICY_CONFIG[action].mode }));
  const strictest = entries.reduce((min, e) => (policyModeRank(e.mode) < policyModeRank(min) ? e.mode : min), entries[0]!.mode);
  const deviations = entries.filter((e) => e.mode !== strictest);
  return { mode: strictest, uniform: deviations.length === 0, deviations };
}

/**
 * Klassen der Aktionen (Konzept §8.1a, ADD-4.1): was ist technisch/plattformseitig gesperrt, was geht nur nach menschlicher Freigabe, was ist innerhalb der Vollmacht
 * autonom? „Nur Vorschlag“ ist eine Freigabe-Variante (nichts wird ausgeführt, ohne dass ein Mensch es tut).
 */
export type ActionClass = 'BLOCKED' | 'AFTER_APPROVAL' | 'AUTONOMOUS';

export function actionClassOf(action: PolicyActionKey, mode: PolicyMode): ActionClass {
  const def = DEFAULT_POLICY_CONFIG[action];
  // Eine feste Obergrenze DISABLED (z. B. Zahlung ausführen) gilt unabhängig vom eingestellten Wert: auch mit Freigabe nicht ausführbar.
  if (def.locked && def.mode === 'DISABLED') return 'BLOCKED';
  if (mode === 'DISABLED') return 'BLOCKED';
  if (mode === 'AUTONOMOUS') return 'AUTONOMOUS';
  return 'AFTER_APPROVAL';
}

export interface MigrationCheck {
  /** `true`, wenn die neuen Modi für keine Aktion lockerer sind als die bisherigen. */
  neverLooser: boolean;
  loosened: Array<{ action: string; before: PolicyMode; after: PolicyMode }>;
}

/** Prüfung für die Migration der Einzelregeln in die Gruppendarstellung (AD-01): das Ergebnis darf nirgends lockerer sein als der Bestand. */
export function checkNeverLooser(before: Readonly<Record<string, PolicyMode>>, after: Readonly<Record<string, PolicyMode>>): MigrationCheck {
  const loosened: MigrationCheck['loosened'] = [];
  for (const [action, was] of Object.entries(before)) {
    const now = after[action];
    if (now !== undefined && policyModeRank(now) > policyModeRank(was)) loosened.push({ action, before: was, after: now });
  }
  return { neverLooser: loosened.length === 0, loosened };
}

/**
 * Wendet einen Gruppenwert auf die Einzelregeln an – gesperrte Aktionen bleiben bei ihrer festen Obergrenze (`locked`). Wer den Wert einer Gruppe auf den
 * strengsten Wert ihrer Einzelregeln setzt (`groupModeOf`), lockert dadurch nie eine Aktion.
 */
export function applyGroupMode(group: PolicyGroupKey, mode: PolicyMode, current: Readonly<Record<string, PolicyMode>>): Record<string, PolicyMode> {
  const next: Record<string, PolicyMode> = { ...current };
  for (const action of POLICY_GROUPS[group].actions) {
    const def = DEFAULT_POLICY_CONFIG[action];
    let wanted = mode;
    if (def.locked && policyModeRank(wanted) > policyModeRank(def.mode)) wanted = def.mode;
    next[action] = wanted;
  }
  return next;
}
