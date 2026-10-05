/**
 * UI/UX v2 §26.2 — gemeinsame UI-Projektionen. Sie sind Lese-Sichten auf die fachlichen Daten, keine zweite
 * Domänenpersistenz: Mandant und Nutzer kommen immer aus dem Authentifizierungskontext des Servers, Rechte und
 * `availableActions` aus autoritativen Diensten, `href` nur als validiertes internes Ziel (nie aus LLM-Ausgabe).
 */

export type EntityType =
  | 'CASE'
  | 'INVOICE'
  | 'SUPPLIER'
  | 'LEAD'
  | 'OPPORTUNITY'
  | 'COMPANY'
  | 'CONTACT'
  | 'TASK'
  | 'APPROVAL'
  | 'DOCUMENT'
  | 'EMAIL'
  | 'INTEGRATION';

export interface EntityRef {
  type: EntityType;
  id: string;
  /** Fachlicher Anzeigename, nie eine nackte technische ID. */
  label: string;
  /** Ausschließlich validiertes internes Ziel (siehe `internalHref`). */
  href?: string;
}

export type AttentionPriority = 'CRITICAL' | 'HIGH' | 'NORMAL';

export interface AttentionAction {
  key: string;
  label: string;
  href?: string;
}

export interface AttentionItem {
  id: string;
  /** Derselbe Vorgang erscheint nicht mehrfach, nur weil Aufgabe und Freigabe dieselbe menschliche Handlung meinen. */
  deduplicationKey: string;
  title: string;
  reason: string;
  priority: AttentionPriority;
  dueAt?: string;
  /** Sortierhilfe: 0 kritisch, 1 überfällig, 2 heute fällig, 3 übrige. */
  rank: number;
  statusLabel: string;
  primaryEntity: EntityRef;
  relatedEntities: EntityRef[];
  availableActions: AttentionAction[];
  /** Wie viele zugrunde liegende Objekte der Eintrag bündelt (Freigabe + Aufgabe …). */
  underlyingCount: number;
  createdAt: string;
}

export type MetricBasis = 'PERIOD' | 'CURRENT';

export interface DashboardMetric {
  key: DashboardMetricKey;
  /** `null` = noch nicht verfügbar; nie als 0 darstellen (§7). */
  value: number | null;
  basis: MetricBasis;
  definitionKey: string;
}

export const DASHBOARD_METRIC_KEYS = ['processed', 'automated', 'approvalsOpen', 'problems', 'timeSaved'] as const;
export type DashboardMetricKey = (typeof DASHBOARD_METRIC_KEYS)[number];

export type DashboardView = 'MINE' | 'TEAM';
export type DashboardPeriod = 'TODAY' | 'WEEK' | 'MONTH';

export interface InboxPreviewItem {
  id: string;
  source: 'EMAIL';
  /** Anzeigename des Absenders; kein erfundener Name aus einer Adresse. */
  senderLabel: string;
  subject: string;
  statusLabel: string;
  occurredAt: string;
  nextActionLabel?: string;
  caseRef?: EntityRef;
  hasProcess: boolean;
  href: string;
}

export interface TaskPreviewItem {
  id: string;
  title: string;
  dueAt?: string;
  overdue: boolean;
  relatedCase?: EntityRef;
  href: string;
}

export interface CompletedPreviewItem {
  id: string;
  /** „Angebot versandt (simuliert)“ nur mit Nachweis; Klassifikation allein ist kein Abschluss. */
  title: string;
  at: string;
  executionMode?: 'LIVE' | 'SIMULATED';
  entity?: EntityRef;
}

export interface FinanceOverview {
  toReview: number;
  approvalOpen: number;
  transferred: number;
  hint?: { text: string; entity: EntityRef };
}

export interface SalesOverview {
  newInquiries: number;
  replyOpen: number;
  dueToday: number;
  hint?: { text: string; entity: EntityRef };
}

export interface DashboardSnapshot {
  generatedAt: string;
  snapshotId: string;
  scope: {
    view: DashboardView;
    timezone: string;
    period: DashboardPeriod;
    periodStart: string;
    periodEnd: string;
  };
  metrics: DashboardMetric[];
  attentionPreview: AttentionItem[];
  attentionTotal: number;
  inboxPreview: InboxPreviewItem[];
  inboxTotal: number;
  /** Der Zeitraum, auf den sich `inboxTotal` bezieht („Neu“ = die letzten N Tage). */
  inboxWindowDays: number;
  tasksPreview: TaskPreviewItem[];
  tasksTotal: number;
  completedPreview: CompletedPreviewItem[];
  /** `null`, wenn der Nutzer den Bereich nicht sehen darf – dann bekommt der andere Bereich den Platz. */
  finance: FinanceOverview | null;
  sales: SalesOverview | null;
  /** Der Wert, mit dem „Zeitersparnis“ berechnet wurde (Minuten je automatisiert abgeschlossenem Vorgang). */
  assumptions: { minutesSavedPerAutomatedCase: number };
}

/** Stabile Reihenfolge der Aufmerksamkeit: kritisch → überfällig → heute fällig → übrige; danach neueste zuerst, dann ID. */
export function compareAttention(a: AttentionItem, b: AttentionItem): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  const byTime = b.createdAt.localeCompare(a.createdAt);
  if (byTime !== 0) return byTime;
  return a.id.localeCompare(b.id);
}

/**
 * Vereint Einträge mit gleichem `deduplicationKey` zu einem: der mit dem niedrigsten Rang gewinnt, die übrigen werden
 * als `relatedEntities` und `underlyingCount` mitgeführt (Freigabe und Aufgabe zum selben Vorgang sind eine Handlung).
 */
export function deduplicateAttention(items: AttentionItem[]): AttentionItem[] {
  const groups = new Map<string, AttentionItem[]>();
  for (const item of items) {
    const group = groups.get(item.deduplicationKey);
    if (group) group.push(item);
    else groups.set(item.deduplicationKey, [item]);
  }
  const merged: AttentionItem[] = [];
  for (const group of groups.values()) {
    const sorted = [...group].sort(compareAttention);
    const [lead, ...rest] = sorted;
    if (!lead) continue;
    const related = new Map<string, EntityRef>();
    for (const entity of [...lead.relatedEntities, ...rest.flatMap((item) => [item.primaryEntity, ...item.relatedEntities])]) {
      if (entity.id === lead.primaryEntity.id && entity.type === lead.primaryEntity.type) continue;
      related.set(`${entity.type}:${entity.id}`, entity);
    }
    const actions = new Map<string, AttentionAction>();
    for (const action of [...lead.availableActions, ...rest.flatMap((item) => item.availableActions)]) {
      if (!actions.has(action.key)) actions.set(action.key, action);
    }
    merged.push({
      ...lead,
      relatedEntities: [...related.values()],
      availableActions: [...actions.values()],
      underlyingCount: group.reduce((sum, item) => sum + item.underlyingCount, 0),
    });
  }
  return merged.sort(compareAttention);
}

/** Nur interne, absolute Pfade ohne Protokoll/Host sind als Linkziel zulässig (UI v2 §9.2 LINK-04). */
export function isInternalHref(href: string): boolean {
  return /^\/(?!\/)[A-Za-z0-9_\-./?=&%#]*$/.test(href);
}

/** Interne Zielrouten je Objekttyp – eine zentrale Stelle statt verteilter String-Konkatenation. */
export function internalHref(type: EntityType, id: string): string | undefined {
  const encoded = encodeURIComponent(id);
  switch (type) {
    case 'CASE':
      return `/cases/${encoded}`;
    case 'INVOICE':
      return `/finance/invoices/${encoded}`;
    case 'LEAD':
      return `/sales/leads/${encoded}`;
    case 'OPPORTUNITY':
      return `/sales/opportunities/${encoded}`;
    case 'APPROVAL':
      return `/approvals?focus=${encoded}`;
    case 'TASK':
      return `/tasks?focus=${encoded}`;
    case 'SUPPLIER':
      return `/finance/suppliers?focus=${encoded}`;
    case 'EMAIL':
      return `/inbox?focus=${encoded}`;
    case 'INTEGRATION':
      return `/integrations`;
    default:
      return undefined;
  }
}
