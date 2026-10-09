import type { CaseCommandType } from './commands';
import type { CaseOrchestrationStatusValue } from './case-status';
import type { ExecutionMode } from '../connector-operational-status';

/**
 * Amendment 02 §16.5 / §18.1 — the contract the orchestration view renders.
 * The frontend never invents a state, an edge or an action: every node state,
 * every edge disposition and every button comes from the server projection of
 * persisted data. Colour is never the only carrier of meaning (§16.5): every
 * state has a label and a symbol.
 */
export const NODE_STATES = [
  'PLANNED',
  'READY',
  'RUNNING',
  'WAITING',
  'AWAITING_APPROVAL',
  'SUCCEEDED',
  'SKIPPED',
  'BLOCKED',
  'FAILED',
  'CANCELLED',
  'SUPERSEDED',
  'OUTCOME_UNKNOWN',
] as const;
export type NodeState = (typeof NODE_STATES)[number];

export type PresentationTone = 'neutral' | 'info' | 'warning' | 'success' | 'danger';

/** §16.5 table: runtime state → business wording + symbol + semantic tone. */
export const NODE_STATE_PRESENTATION: Record<NodeState, { label: string; symbol: string; tone: PresentationTone }> = {
  SUCCEEDED: { label: 'Erledigt', symbol: '✓', tone: 'success' },
  RUNNING: { label: 'In Bearbeitung', symbol: '◔', tone: 'info' },
  WAITING: { label: 'Wartet', symbol: '⏳', tone: 'warning' },
  AWAITING_APPROVAL: { label: 'Freigabe erforderlich', symbol: '✋', tone: 'warning' },
  PLANNED: { label: 'Geplant', symbol: '○', tone: 'neutral' },
  READY: { label: 'Bereit', symbol: '◎', tone: 'info' },
  BLOCKED: { label: 'Blockiert', symbol: '⛔', tone: 'danger' },
  FAILED: { label: 'Fehlgeschlagen', symbol: '✕', tone: 'danger' },
  OUTCOME_UNKNOWN: { label: 'Ergebnis wird geprüft', symbol: '?', tone: 'warning' },
  SKIPPED: { label: 'Nicht erforderlich', symbol: '–', tone: 'neutral' },
  SUPERSEDED: { label: 'Durch neuen Plan ersetzt', symbol: '↺', tone: 'neutral' },
  CANCELLED: { label: 'Abgebrochen', symbol: '⊘', tone: 'neutral' },
};

export type NodeProvenance = 'BLUEPRINT' | 'PLANNED' | 'EXECUTED';
export type EdgeDisposition = 'TAKEN' | 'POSSIBLE' | 'NOT_TAKEN';

/** A server-computed, currently permitted action. Buttons are rendered only from these (§17.2). */
export interface ActionDescriptor {
  commandKey: CaseCommandType;
  /** Business wording, e.g. "Genehmigen & ausführen". */
  title: string;
  /** Flat field descriptors for the input form; the server re-validates against the real command schema. */
  fields: Array<{ name: string; label: string; type: 'text' | 'textarea' | 'number' | 'email' | 'json'; required: boolean; initialValue?: string }>;
  /** The user must see recipient / text / attachment / amount before confirming (§17.2). */
  requiresPreview: boolean;
  /** Version binding: the case revision this action was computed for. */
  expectedCaseRevision: number;
  targetRef?: string;
  /** Values the command always carries (e.g. the intent id, or "happened: true") — the user does not type them. */
  payload?: Record<string, unknown>;
  destructive?: boolean;
  /** `APPROVAL` actions run through the existing approval API, referenced here; commands do not reimplement it. */
  approvalId?: string;
}

export interface CaseGraphNode {
  id: string;
  planNodeId?: string;
  stepRunId?: string;
  title: string;
  type: string;
  state: NodeState;
  provenance: NodeProvenance;
  /** Whether the actual execution of this node was real or simulated (§16.6); absent until it ran. */
  executionMode?: ExecutionMode;
  conciseReason?: string;
  /** Opaque reference for the node-detail request. */
  detailsRef?: string;
  availableActions: ActionDescriptor[];
}

export interface CaseGraphEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  disposition: EdgeDisposition;
}

export interface CaseGraphView {
  caseId: string;
  caseRevision: number;
  projectionRevision: number;
  planId?: string;
  planRevision?: number;
  /** Highest case event sequence included — a reconnecting client resumes from here (§18.2). */
  lastEventSequence: number;
  generatedAt: string;
  mode: 'COMBINED' | 'ACTUAL' | 'DEFINITION';
  overallStatus: CaseOrchestrationStatusValue;
  currentNodeIds: string[];
  attentionReasons: string[];
  nodes: CaseGraphNode[];
  edges: CaseGraphEdge[];
  availableActions: ActionDescriptor[];
  /** All plan revisions of the case, oldest first — the revision selector (§16.4). */
  revisions: Array<{ revision: number; status: string; source: string; createdAt: string; explanation: string; diff: { added: string[]; removed: string[]; changed: string[]; kept: string[] } | null }>;
  /** The blueprint the case runs on, if any. */
  blueprint?: { key: string; version: string; title: string };
}

/** What the user sees before confirming an outgoing message or a quote (§17.2: recipient, text, attachment, amount). */
export interface ActionPreview {
  kind: 'COMMUNICATION' | 'QUOTE' | 'GENERIC';
  recipient?: string;
  subject?: string;
  bodyText?: string;
  attachments?: Array<{ fileName: string; mimeType: string }>;
  quote?: { number: string; currency: string; netAmount: string; taxAmount: string; grossAmount: string; validUntil: string; priceSource: string; lines: Array<{ name: string; sku: string; quantity: number; unit: string; unitPrice: string; net: string }> };
  /** Where the prices come from, in business words — e.g. a test data set is labelled as such. */
  sourceNote?: string;
}

/**
 * Business-Projektion eines Knotens (Amendment 02 v1.2 §35.2, BP-42/43): was ein Mandantennutzer mit `case.read` sehen darf. Bewusst OHNE
 * technische Interna – keine Fehlercodes, kein Roh-Output des Schritts, keine Payload-Hashes, keine Anbieter-Referenzen, keine Versuchszähler,
 * keine Prompt-/Token-/Providerdaten. Diese stehen ausschließlich in der Diagnostic Projection (`/platform/diagnostics`, Plattformrolle).
 */
export interface CaseNodeDetail {
  nodeId: string;
  title: string;
  type: string;
  state: NodeState;
  purpose?: string;
  capability?: { key: string; description: string; sideEffect: string };
  /** Business explanation of the current state, derived from facts — never raw model output. */
  stateExplanation: string;
  /** Hinweis zum Live-Abgleich: warum ein Schritt (noch) simuliert ist bzw. auf eine Verbindung wartet und ob ORBIT ihn automatisch live wiederholt. */
  liveHint?: string;
  /** Das Ergebnis des Schritts in Worten (was erkannt wurde, was fehlt, welcher nächste Schritt gewählt wurde) – nie der Roh-Output. */
  resultLines?: string[];
  /** Der Schritt wurde mindestens einmal wiederholt (ohne Zähler). */
  retried?: boolean;
  startedAt?: string;
  completedAt?: string;
  executionMode?: ExecutionMode;
  /** Fachlich formulierte Fehlerbeschreibung (geschwärzt, gekürzt) – ohne internen Fehlercode. */
  error?: { message: string };
  inputs: Array<{ name: string; source: string; value?: unknown }>;
  facts: Array<{ key: string; value: unknown; status: string; sourceType: string; evidence?: string[] }>;
  action?: { intentId: string; status: string; purpose?: string; approvalId?: string; receipts: Array<{ status: string; executionMode: string; at: string; evidenceAvailable: boolean }> };
  wait?: { eventType: string; status: string; deadlineAt?: string };
  preview?: ActionPreview;
  availableActions: ActionDescriptor[];
}
