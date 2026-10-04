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
}
