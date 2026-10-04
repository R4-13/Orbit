import type { BlueprintDefinition } from './blueprint';
import type { CapabilityDefinition } from './capability';
import { collectReferences, emptyReferences, expressionDepth, MAX_EXPRESSION_DEPTH, type Expr, type ExpressionReferences } from './expressions';
import { PLAN_LIMITS, PlanProposalSchema, type PlanEdge, type PlanNode, type PlanProposal } from './plan';
import type { PolicyMode } from '../policy';

/**
 * Amendment 02 §11.3 — the deterministic plan validator. It is a pure
 * function over a proposal and an explicit context, so the same checks run for
 * an LLM-proposed plan, a deterministic instantiation and a human-edited plan.
 * "Ein plausibler LLM-Plan kann dennoch unzulässig sein": nothing here trusts
 * the proposal. Policy gates are still enforced again by the runtime (§11.2).
 */

export type PlanIssueSeverity = 'ERROR' | 'WARNING';

export interface PlanIssue {
  /** Stable machine code; tests and the UI key off it. */
  code: string;
  severity: PlanIssueSeverity;
  /** The §11.3 check this belongs to (1–11). */
  check: number;
  nodeId?: string;
  edgeId?: string;
  message: string;
}

export interface CapabilityExecutability {
  executable: boolean;
  /** Business-readable reasons when not executable (connector missing, permission, policy disabled, ...). */
  reasons: string[];
}

export interface ConfirmedEffect {
  nodeId: string;
  capability: string;
  purpose?: string;
}

export interface PlanValidationContext {
  /** The bound blueprint; absent for an ad-hoc plan. */
  blueprint?: BlueprintDefinition;
  capabilities: ReadonlyMap<string, CapabilityDefinition>;
  /** Per-tenant executability of each capability key (registered ∩ connection ∩ permissions ∩ policy). */
  executability: ReadonlyMap<string, CapabilityExecutability>;
  /** Fact keys that currently exist on the case. */
  knownFactKeys: ReadonlySet<string>;
  /** Fact keys the blueprint / requirements resolver says may still be collected. */
  collectableFactKeys: ReadonlySet<string>;
  policyModes: ReadonlyMap<string, PolicyMode>;
  /** Effects with a confirmed receipt in earlier revisions — they must survive a replan unchanged (§11.3 item 9). */
  confirmedEffects?: readonly ConfirmedEffect[];
  limits: { maxSteps: number; maxExternalActions: number; maxAutoQuestions: number };
}

export interface PlanValidationResult {
  valid: boolean;
  issues: PlanIssue[];
  /** Normalized proposal (defaults applied); present when the schema check passed. */
  proposal?: PlanProposal;
  stats?: { nodes: number; edges: number; externalActions: number; clarifications: number };
}

/** Input keys under which a model must never supply a literal: recipients, prices, identities (§11.3 item 7). */
export const FORBIDDEN_LITERAL_INPUT_KEYS = [
  'to',
  'cc',
  'bcc',
  'recipient',
  'recipients',
  'email',
  'iban',
  'price',
  'unitprice',
  'amount',
  'total',
  'discount',
  'customerid',
  'contactid',
] as const;

export function isForbiddenLiteralKey(key: string): boolean {
  return (FORBIDDEN_LITERAL_INPUT_KEYS as readonly string[]).includes(key.toLowerCase().replace(/[_-]/g, ''));
}

const DEFAULT_WAIT_TIMEOUT_HINT = 'Ein WAIT_EVENT-Knoten braucht eine Frist (timeout) oder eine Blueprint-Wait-Regel mit Timeout-Policy.';

function incoming(edges: PlanEdge[]): Map<string, PlanEdge[]> {
  const map = new Map<string, PlanEdge[]>();
  for (const edge of edges) map.set(edge.target, [...(map.get(edge.target) ?? []), edge]);
  return map;
}

function outgoing(edges: PlanEdge[]): Map<string, PlanEdge[]> {
  const map = new Map<string, PlanEdge[]>();
  for (const edge of edges) map.set(edge.source, [...(map.get(edge.source) ?? []), edge]);
  return map;
}

/** Returns a topological order, or `undefined` when the graph has a cycle. */
export function topologicalOrder(nodes: readonly { id: string }[], edges: readonly PlanEdge[]): string[] | undefined {
  const indegree = new Map(nodes.map((n) => [n.id, 0]));
  for (const edge of edges) indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  const queue = [...indegree.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  const order: string[] = [];
  const out = new Map<string, string[]>();
  for (const edge of edges) out.set(edge.source, [...(out.get(edge.source) ?? []), edge.target]);
  while (queue.length > 0) {
    const id = queue.shift() as string;
    order.push(id);
    for (const next of out.get(id) ?? []) {
      const d = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, d);
      if (d === 0) queue.push(next);
    }
  }
  return order.length === nodes.length ? order : undefined;
}

function reachableFrom(starts: string[], edges: PlanEdge[]): Set<string> {
  const out = outgoing(edges);
  const seen = new Set<string>(starts);
  const stack = [...starts];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    for (const edge of out.get(id) ?? []) {
      if (!seen.has(edge.target)) {
        seen.add(edge.target);
        stack.push(edge.target);
      }
    }
  }
  return seen;
}

function ancestorsOf(nodeId: string, edges: PlanEdge[]): Set<string> {
  const inc = incoming(edges);
  const seen = new Set<string>();
  const stack = [nodeId];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    for (const edge of inc.get(id) ?? []) {
      if (!seen.has(edge.source)) {
        seen.add(edge.source);
        stack.push(edge.source);
      }
    }
  }
  return seen;
}

function mergeRefs(into: ExpressionReferences, expr: Expr): void {
  collectReferences(expr, into);
}

export function validatePlan(input: unknown, ctx: PlanValidationContext): PlanValidationResult {
  const issues: PlanIssue[] = [];
  const add = (issue: Omit<PlanIssue, 'severity'> & { severity?: PlanIssueSeverity }): void => {
    issues.push({ severity: 'ERROR', ...issue });
  };

  // ── 1. Schema, registered node types / operators, maximum size ────────────
  const parsed = PlanProposalSchema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues.slice(0, 10)) {
      add({ code: 'SCHEMA_INVALID', check: 1, message: `${issue.path.join('.') || '(root)'}: ${issue.message}` });
    }
    return { valid: false, issues };
  }
  const plan = parsed.data;
  const { nodes, edges } = plan;
  if (nodes.length > PLAN_LIMITS.maxNodes || edges.length > PLAN_LIMITS.maxEdges) {
    add({ code: 'PLAN_TOO_LARGE', check: 1, message: 'Der Plan überschreitet die zulässige Größe.' });
  }

  const nodeById = new Map<string, PlanNode>();
  for (const node of nodes) {
    if (nodeById.has(node.id)) add({ code: 'DUPLICATE_NODE_ID', check: 1, nodeId: node.id, message: `Knoten-ID "${node.id}" ist doppelt vergeben.` });
    nodeById.set(node.id, node);
  }
  const edgeIds = new Set<string>();
  for (const edge of edges) {
    if (edgeIds.has(edge.id)) add({ code: 'DUPLICATE_EDGE_ID', check: 1, edgeId: edge.id, message: `Kanten-ID "${edge.id}" ist doppelt vergeben.` });
    edgeIds.add(edge.id);
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) {
      add({ code: 'EDGE_DANGLING', check: 3, edgeId: edge.id, message: `Kante "${edge.id}" verweist auf einen nicht vorhandenen Knoten.` });
    }
    if (edge.source === edge.target) add({ code: 'EDGE_SELF_LOOP', check: 4, edgeId: edge.id, message: `Kante "${edge.id}" verbindet einen Knoten mit sich selbst.` });
    if (edge.condition && expressionDepth(edge.condition) > MAX_EXPRESSION_DEPTH) {
      add({ code: 'EXPRESSION_TOO_DEEP', check: 1, edgeId: edge.id, message: `Bedingung an Kante "${edge.id}" ist zu tief verschachtelt.` });
    }
  }

  // ── 2. Blueprint scope, permitted goals and capabilities ──────────────────
  const blueprint = ctx.blueprint;
  if (blueprint) {
    for (const goal of plan.goalKeys) {
      if (!blueprint.goals.includes(goal)) add({ code: 'GOAL_NOT_IN_BLUEPRINT', check: 2, message: `Das Ziel "${goal}" ist im Blueprint ${blueprint.key} nicht vorgesehen.` });
    }
  }
  for (const node of nodes) {
    if (!node.capability) continue;
    const key = node.capability.key;
    if (!ctx.capabilities.has(key)) {
      add({ code: 'CAPABILITY_UNKNOWN', check: 2, nodeId: node.id, message: `Die Fähigkeit "${key}" existiert nicht. Es werden keine Fähigkeiten erfunden.` });
    } else if (blueprint && !blueprint.allowedCapabilities.includes(key)) {
      add({ code: 'CAPABILITY_NOT_ALLOWED', check: 2, nodeId: node.id, message: `Die Fähigkeit "${key}" ist für ${blueprint.key} nicht freigegeben.` });
    }
  }

  // ── 3. Bindings and dependencies exist and are type-correct ───────────────
  const planNodeIds = new Set(nodeById.keys());
  for (const node of nodes) {
    const ancestors = ancestorsOf(node.id, edges);
    for (const [name, operand] of Object.entries(node.inputs)) {
      if ('stepOutput' in operand) {
        const ref = operand.stepOutput.node;
        if (!planNodeIds.has(ref)) add({ code: 'BINDING_UNKNOWN_NODE', check: 3, nodeId: node.id, message: `Eingabe "${name}" verweist auf den unbekannten Knoten "${ref}".` });
        else if (!ancestors.has(ref)) add({ code: 'BINDING_NOT_UPSTREAM', check: 3, nodeId: node.id, message: `Eingabe "${name}" liest aus "${ref}", das nicht vor diesem Schritt liegt.` });
      }
    }
    const refs = emptyReferences();
    for (const expr of node.preconditions) mergeRefs(refs, expr);
    for (const ref of refs.stepNodes) if (!planNodeIds.has(ref)) add({ code: 'PRECONDITION_UNKNOWN_NODE', check: 3, nodeId: node.id, message: `Vorbedingung verweist auf unbekannten Knoten "${ref}".` });
  }
  for (const edge of edges) {
    if (!edge.condition) continue;
    const refs = collectReferences(edge.condition);
    for (const ref of refs.stepNodes) if (!planNodeIds.has(ref)) add({ code: 'CONDITION_UNKNOWN_NODE', check: 3, edgeId: edge.id, message: `Kantenbedingung verweist auf unbekannten Knoten "${ref}".` });
    for (const cap of refs.capabilities) if (!ctx.capabilities.has(cap)) add({ code: 'CONDITION_UNKNOWN_CAPABILITY', check: 3, edgeId: edge.id, message: `Kantenbedingung verweist auf unbekannte Fähigkeit "${cap}".` });
  }

  // ── 4. Reachability, no invalid cycles, valid terminal paths ──────────────
  const order = issues.some((i) => i.code === 'EDGE_DANGLING') ? undefined : topologicalOrder(nodes, edges);
  if (!issues.some((i) => i.code === 'EDGE_DANGLING') && !order) {
    add({ code: 'CYCLE', check: 4, message: 'Der Plan enthält einen Zyklus. Wiederholungen werden als neue Planrevision über persistente Ereignisse abgebildet.' });
  }
  const validEdges = edges.filter((e) => nodeById.has(e.source) && nodeById.has(e.target));
  const entries = nodes.filter((n) => !validEdges.some((e) => e.target === n.id)).map((n) => n.id);
  if (entries.length === 0) add({ code: 'NO_ENTRY', check: 4, message: 'Der Plan hat keinen Startknoten.' });
  const reachable = reachableFrom(entries, validEdges);
  for (const node of nodes) if (!reachable.has(node.id)) add({ code: 'UNREACHABLE', check: 4, nodeId: node.id, message: `Knoten "${node.id}" ist nicht erreichbar.` });
  const completeNodes = nodes.filter((n) => n.type === 'COMPLETE');
  const out = outgoing(validEdges);
  // A revision may end in a wait or a manual task on purpose (§11.2: the answer continues the case in a new revision).
  const endsInPause = nodes.some((n) => (n.type === 'WAIT_EVENT' || n.type === 'MANUAL_TASK') && (out.get(n.id) ?? []).length === 0);
  if (completeNodes.length === 0 && !endsInPause) add({ code: 'NO_TERMINAL', check: 4, message: 'Der Plan hat weder einen Abschlussknoten (COMPLETE) noch ein definiertes Ende in einer Wartestelle.' });
  for (const node of nodes) {
    // A wait ends the current revision on purpose (§11.2): the answer arrives as an event and continues in a new revision.
    if (node.type === 'COMPLETE' || node.type === 'WAIT_EVENT' || node.type === 'MANUAL_TASK') continue;
    if ((out.get(node.id) ?? []).length === 0) add({ code: 'DEAD_END', check: 4, nodeId: node.id, message: `Knoten "${node.id}" führt nirgendwohin (kein Fehler-/Abschlusspfad).` });
  }

  // ── 5. Required information and source trust for executable steps ─────────
  for (const node of nodes) {
    const cap = node.capability ? ctx.capabilities.get(node.capability.key) : undefined;
    if (node.type === 'ACTION' && !node.capability) add({ code: 'ACTION_WITHOUT_CAPABILITY', check: 5, nodeId: node.id, message: `Aktion "${node.id}" nennt keine Fähigkeit.` });
    for (const [name, operand] of Object.entries(node.inputs)) {
      if (!('fact' in operand)) continue;
      const known = ctx.knownFactKeys.has(operand.fact);
      const collectable = ctx.collectableFactKeys.has(operand.fact);
      if (known || collectable) continue;
      const external = cap?.sideEffect === 'EXTERNAL_WRITE';
      add({
        code: 'BINDING_UNKNOWN_FACT',
        check: 5,
        severity: external ? 'ERROR' : 'WARNING',
        nodeId: node.id,
        message: `Eingabe "${name}" nutzt den Fakt "${operand.fact}", der weder vorhanden noch erhebbar ist.`,
      });
    }
  }

  // ── 6. Connectors, scopes, permissions and policy mapping ─────────────────
  for (const node of nodes) {
    if (!node.capability) continue;
    const cap = ctx.capabilities.get(node.capability.key);
    if (!cap) continue;
    const exec = ctx.executability.get(cap.key);
    if (!exec || !exec.executable) {
      add({
        code: 'CAPABILITY_NOT_EXECUTABLE',
        check: 6,
        nodeId: node.id,
        message: `Die Fähigkeit "${cap.key}" ist für diesen Mandanten nicht ausführbar${exec && exec.reasons.length > 0 ? `: ${exec.reasons.join('; ')}` : '.'}`,
      });
    }
    const purpose = typeof node.config.purpose === 'string' ? node.config.purpose : undefined;
    if (cap.policyActionByPurpose && (!purpose || !(purpose in cap.policyActionByPurpose))) {
      add({ code: 'PURPOSE_MISSING', check: 6, nodeId: node.id, message: `"${cap.key}" braucht einen Zweck (${Object.keys(cap.policyActionByPurpose).join(', ')}), damit die richtige Policy greift.` });
    }
    const action = purpose && cap.policyActionByPurpose?.[purpose] ? cap.policyActionByPurpose[purpose] : cap.policyAction;
    const mode = ctx.policyModes.get(action);
    if (mode === undefined) add({ code: 'POLICY_UNMAPPED', check: 6, nodeId: node.id, message: `Für die Policy-Aktion "${action}" gibt es keine Konfiguration.` });
    else if (mode === 'DISABLED') add({ code: 'POLICY_DISABLED', check: 6, nodeId: node.id, message: `Die Policy-Aktion "${action}" ist deaktiviert.` });
  }

  // ── 7. No invented prices, recipients, identities or action parameters ────
  for (const node of nodes) {
    for (const [name, operand] of Object.entries(node.inputs)) {
      if ('literal' in operand && isForbiddenLiteralKey(name)) {
        add({ code: 'INVENTED_PARAMETER', check: 7, nodeId: node.id, message: `Eingabe "${name}" darf nicht als feste Angabe aus dem Plan stammen; sie muss aus einem geprüften Fakt oder einem Schrittergebnis kommen.` });
      }
    }
    for (const [name, value] of Object.entries(node.config)) {
      if (isForbiddenLiteralKey(name) && value !== null && value !== '') {
        add({ code: 'INVENTED_PARAMETER', check: 7, nodeId: node.id, message: `Die Einstellung "${name}" darf keinen festen Empfänger-, Preis- oder Identitätswert enthalten.` });
      }
    }
  }

  // ── 8. Idempotency / confirmation for every external effect ───────────────
  let externalActions = 0;
  let clarifications = 0;
  for (const node of nodes) {
    if (node.type !== 'ACTION' || !node.capability) continue;
    const cap = ctx.capabilities.get(node.capability.key);
    if (!cap) continue;
    if (cap.sideEffect === 'EXTERNAL_WRITE') {
      externalActions += 1;
      if (cap.idempotencyStrategy === 'NONE' || cap.confirmationStrategy === 'NONE') {
        add({ code: 'EFFECT_WITHOUT_IDEMPOTENCY', check: 8, nodeId: node.id, message: `Die externe Wirkung "${cap.key}" hat keine Idempotenz-/Bestätigungsstrategie.` });
      }
      if (node.config.purpose === 'CLARIFICATION') clarifications += 1;
    }
  }

  // ── 9. A replan never repeats an already confirmed effect ─────────────────
  for (const effect of ctx.confirmedEffects ?? []) {
    const kept = nodeById.get(effect.nodeId);
    if (!kept || kept.capability?.key !== effect.capability || (effect.purpose !== undefined && kept.config.purpose !== effect.purpose)) {
      add({ code: 'REPLAN_DROPS_CONFIRMED_EFFECT', check: 9, nodeId: effect.nodeId, message: `Der bereits bestätigte Schritt "${effect.nodeId}" muss unverändert erhalten bleiben.` });
    }
    const duplicates = nodes.filter(
      (n) => n.id !== effect.nodeId && n.type === 'ACTION' && n.capability?.key === effect.capability && (effect.purpose === undefined || n.config.purpose === effect.purpose),
    );
    for (const duplicate of duplicates) {
      add({ code: 'REPLAN_REPEATS_CONFIRMED_EFFECT', check: 9, nodeId: duplicate.id, message: `"${duplicate.id}" würde die bereits bestätigte Wirkung "${effect.capability}${effect.purpose ? `/${effect.purpose}` : ''}" wiederholen.` });
    }
  }

  // ── 10. Checkable completion criteria, valid wait / timeout handling ──────
  if (blueprint) {
    const refs = collectReferences(blueprint.completionCriteria);
    for (const capKey of refs.capabilities) if (!ctx.capabilities.has(capKey)) add({ code: 'COMPLETION_UNKNOWN_CAPABILITY', check: 10, message: `Abschlusskriterium verweist auf unbekannte Fähigkeit "${capKey}".` });
  }
  for (const node of nodes) {
    if (node.type !== 'WAIT_EVENT') continue;
    const eventType = node.config.eventType;
    if (eventType !== 'communication.received') add({ code: 'WAIT_UNKNOWN_EVENT', check: 10, nodeId: node.id, message: `Warteknoten "${node.id}" nennt kein bekanntes Ereignis.` });
    const ruleCovers = blueprint?.waitRules.some((r) => r.eventType === eventType && r.timeoutPolicyRef) ?? false;
    if (!node.timeout && !ruleCovers) add({ code: 'WAIT_WITHOUT_TIMEOUT', check: 10, nodeId: node.id, message: DEFAULT_WAIT_TIMEOUT_HINT });
  }
  if (completeNodes.length > 0 && blueprint) {
    // The terminal node must be reachable only through the steps the blueprint's criteria depend on; the criteria themselves are evaluated at runtime.
    for (const complete of completeNodes) {
      if (!reachable.has(complete.id)) add({ code: 'COMPLETE_UNREACHABLE', check: 10, nodeId: complete.id, message: 'Der Abschlussknoten ist nicht erreichbar.' });
    }
  }

  // ── 11. Budget, number of external actions, questions, replan limits ──────
  const maxSteps = Math.min(ctx.limits.maxSteps, blueprint?.limits?.maxSteps ?? ctx.limits.maxSteps);
  if (nodes.length > maxSteps) add({ code: 'LIMIT_STEPS', check: 11, message: `Der Plan hat ${nodes.length} Schritte, erlaubt sind ${maxSteps}.` });
  if (externalActions > ctx.limits.maxExternalActions) add({ code: 'LIMIT_EXTERNAL_ACTIONS', check: 11, message: `Der Plan enthält ${externalActions} externe Aktionen, erlaubt sind ${ctx.limits.maxExternalActions}.` });
  const maxQuestions = Math.min(ctx.limits.maxAutoQuestions, blueprint?.limits?.maxAutoQuestions ?? ctx.limits.maxAutoQuestions);
  if (clarifications > maxQuestions) add({ code: 'LIMIT_QUESTIONS', check: 11, message: `Der Plan enthält ${clarifications} Rückfragen, erlaubt sind ${maxQuestions}.` });

  const valid = !issues.some((i) => i.severity === 'ERROR');
  return { valid, issues, proposal: plan, stats: { nodes: nodes.length, edges: edges.length, externalActions, clarifications } };
}
