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

export type CaseTab = 'overview' | 'orchestration' | 'communication' | 'documents' | 'history';

/** Direkter Einstieg in einen Tab des Vorgangs, z. B. „Orchestrierung anzeigen“ (UI v2 §16.2). */
export function caseTabHref(caseId: string, tab: CaseTab): string {
  return `/cases/${encodeURIComponent(caseId)}${tab === 'overview' ? '' : `?tab=${tab}`}`;
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
      return `/inbox/${encoded}`;
    case 'INTEGRATION':
      return `/integrations`;
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Posteingang (UI v2 §11)
// ---------------------------------------------------------------------------------------------------------------------

export const INBOX_STAGES = ['ATTENTION', 'NEW', 'IN_PROGRESS', 'DONE'] as const;
export type InboxStage = (typeof INBOX_STAGES)[number];

export type InboxFilter = 'ALL' | InboxStage | 'FINANCE' | 'SALES';

export interface InboxListItem {
  id: string;
  emailMessageId?: string;
  source: 'EMAIL';
  senderLabel: string;
  senderAddress?: string;
  subject: string;
  occurredAt: string;
  /** Fachlicher Typ, z. B. „Angebotsanfrage“ (aus der Label-Registry), nie ein Enum-Schlüssel. */
  typeLabel: string;
  categoryKey?: string;
  domain: 'FINANCE' | 'SALES' | null;
  stage: InboxStage;
  statusLabel: string;
  nextActionLabel: string;
  needsAttention: boolean;
  /** Sicher ausgefiltert (Kein Geschäftsprozess ausgelöst): erscheint nur, wenn die Sicht es erlaubt. */
  excluded: boolean;
  caseRef?: EntityRef;
  hasProcess: boolean;
  /** Erweiterte Felder (Spaltenwahl/Detail), nicht Teil der Standardliste. */
  details: { agentLabel?: string; relevanceLabel?: string; confidence?: number; executionMode?: 'LIVE' | 'SIMULATED' };
}

export interface InboxListResponse {
  items: InboxListItem[];
  total: number;
  page: number;
  pageSize: number;
  /** Zähler je Filter, damit die Filterleiste ohne weitere Anfrage ehrlich beschriftet werden kann. */
  counts: Record<InboxFilter, number>;
  generatedAt: string;
  /** Wird die Standardansicht ohne ausgefilterte Eingänge geliefert? */
  excludedHidden: boolean;
}

export interface InboxFactView {
  key: string;
  label: string;
  valueText: string;
  confirmed: boolean;
  sourceLabel: string;
  evidence?: string;
}

export interface InboxDetail extends InboxListItem {
  bodyPreview?: string;
  recipients: string[];
  attachments: Array<{ id: string; name: string; mimeType: string; sizeBytes: number }>;
  /** Kurze fachliche Einordnung mit Begründung der Entscheidung. */
  reason?: string;
  facts: InboxFactView[];
  /** „Aktion: Keine“ bei nicht geschäftsrelevanten Eingängen (§11.2). */
  actionStatement?: string;
}

// ---------------------------------------------------------------------------------------------------------------------
// Freigaben (UI v2 §14)
// ---------------------------------------------------------------------------------------------------------------------

export type ApprovalDecisionMode = 'ENTITY' | 'FOLLOW_UP' | 'PROCESS_ACTION' | 'NONE';

export interface ApprovalQueueItem {
  id: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  /** Was soll geschehen? „Bankverbindung eines Lieferanten ändern“, nie ein Policy-Schlüssel. */
  actionLabel: string;
  /** Betroffene Person/Firma bzw. das Geschäftsobjekt. */
  object?: EntityRef;
  subtitle?: string;
  amountText?: string;
  /** Grund/Risiko in einem Satz. */
  reason: string;
  risk: 'CRITICAL' | 'NORMAL';
  requestedAt: string;
  decidedAt?: string;
  href: string;
  canDecide: boolean;
}

export interface ApprovalFieldView {
  label: string;
  value: string;
  emphasis?: boolean;
}

export interface ApprovalDetail extends ApprovalQueueItem {
  /** Die Fragen des Entscheidungsdetails (§14.2): was, für wen, mit welchen Daten, in welches System, warum, danach. */
  forWhom?: EntityRef;
  fields: ApprovalFieldView[];
  targetSystem: string;
  whyRequired: string;
  afterwards: string;
  related: EntityRef[];
  decision: {
    mode: ApprovalDecisionMode;
    approveLabel: string;
    rejectLabel: string;
    rejectNeedsReason: boolean;
    /** Die Endpunkte (PATCH) des Besitzers der Entscheidung – der Server legt fest, wo entschieden wird; die Oberfläche spiegelt diese Logik nicht. */
    endpoints?: { approve: string; reject: string };
  };
  /** Nur bei vorbereiteten externen Wirkungen: die Entscheidung läuft über die Orchestrierung des Vorgangs mit gebundener Nutzlast. */
  processAction?: { caseId: string; nodeId: string };
  /** „Diese Freigabe wurde durch eine Änderung ersetzt.“ */
  stale: boolean;
  /** Grund, warum (noch) nicht entschieden werden kann, in Klartext. */
  cannotDecideReason?: string;
}

// ---------------------------------------------------------------------------------------------------------------------
// Aktivitäten (UI v2 §17)
// ---------------------------------------------------------------------------------------------------------------------

export interface ActivityEvidence {
  label: string;
  executionMode: 'LIVE' | 'SIMULATED';
  providerRef?: string;
  /** Nur ein bestätigtes Receipt belegt eine externe Wirkung. */
  confirmed: boolean;
}

export interface ActivityEntry {
  id: string;
  at: string;
  /** „Antwort versandt“, „Freigabe erteilt“ – verständlich, ohne Ereignisschlüssel. */
  title: string;
  actorLabel: string;
  actorType: 'USER' | 'AGENT' | 'SYSTEM';
  /** RESULT = bestätigtes Ergebnis/Entscheidung, EVENT = Zwischenschritt. */
  kind: 'RESULT' | 'EVENT';
  entity?: EntityRef;
  evidence?: ActivityEvidence;
}

export interface ActivityFeed {
  entries: ActivityEntry[];
  total: number;
  page: number;
  pageSize: number;
  generatedAt: string;
}

// ---------------------------------------------------------------------------------------------------------------------
// Vorgänge (UI v2 §16.1)
// ---------------------------------------------------------------------------------------------------------------------

export type CaseListFilter = 'OPEN' | 'ATTENTION' | 'DONE' | 'ALL';

export interface CaseListItem {
  id: string;
  title: string;
  typeLabel: string;
  /** Firma oder Person, um die es geht (aus Interessent bzw. Lieferant), falls bekannt. */
  counterparty?: EntityRef;
  statusLabel: string;
  statusTone: 'neutral' | 'info' | 'warning' | 'success' | 'danger';
  /** Nächster Schritt bzw. Wartegrund in Klartext. */
  nextStep: string;
  ownerLabel?: string;
  updatedAt: string;
  needsAttention: boolean;
  hasProcess: boolean;
  href: string;
}

export interface CaseListResponse {
  items: CaseListItem[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<CaseListFilter, number>;
  generatedAt: string;
}

// ---------------------------------------------------------------------------------------------------------------------
// Aufgaben (UI v2 §15)
// ---------------------------------------------------------------------------------------------------------------------

export type TaskSection = 'OVERDUE' | 'TODAY' | 'LATER' | 'NO_DUE_DATE' | 'DONE';

export interface TaskListItem {
  id: string;
  title: string;
  /** Welches konkrete Ergebnis wird benötigt? */
  expectedResult?: string;
  status: 'OPEN' | 'DONE' | 'CANCELLED';
  section: TaskSection;
  dueAt?: string;
  assigneeLabel?: string;
  assignedToMe: boolean;
  fromAssistant: boolean;
  relatedCase?: EntityRef;
  /** Läuft der zugehörige Vorgang über einen Prozess? Dann wird er dort bearbeitet – kein loses „Erledigt“ (§15). */
  caseHasProcess: boolean;
  /** Fachlicher Bereich des Vorgangs (Finanzen/Vertrieb), falls zugeordnet. */
  areaLabel?: string;
  href: string;
}

export interface TaskListResponse {
  items: TaskListItem[];
  total: number;
  counts: { OVERDUE: number; TODAY: number; LATER: number; NO_DUE_DATE: number; DONE: number };
  generatedAt: string;
}

// ---------------------------------------------------------------------------------------------------------------------
// Vertrieb (UI v2 §13)
// ---------------------------------------------------------------------------------------------------------------------

export type LeadFilter = 'OPEN' | 'NEW' | 'REPLY_MISSING' | 'DUE_TODAY' | 'DONE' | 'ALL';

export interface LeadListItem {
  id: string;
  contactLabel: string;
  companyLabel?: string;
  sourceLabel: string;
  statusLabel: string;
  statusTone: 'neutral' | 'info' | 'warning' | 'success' | 'danger';
  /** Verständlicher nächster Schritt: offene Aufgabe, Wartegrund des Vorgangs oder Vorschlag aus dem Status. */
  nextStep: string;
  dueAt?: string;
  replyMissing: boolean;
  dueToday: boolean;
  /** „bestätigt“ nur bei erfolgter CRM-Zuordnung – sonst bleibt der Konflikt sichtbar (§13.2). */
  crmLabel: string;
  createdAt: string;
  caseRef?: EntityRef;
  href: string;
}

export interface LeadListResponse {
  items: LeadListItem[];
  total: number;
  counts: Record<LeadFilter, number>;
  generatedAt: string;
}
