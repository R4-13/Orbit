import type { BlueprintDefinition } from './blueprint';
import type { CapabilityDefinition } from './capability';
import { collectReferences, emptyReferences, expressionDepth, MAX_EXPRESSION_DEPTH, type Expr, type ExpressionReferences } from './expressions';
import { PLAN_LIMITS, PlanProposalSchema, type PlanEdge, type PlanNode, type PlanProposal } from './plan';
import type { PolicyMode } from '../policy';
import { isReplanPoint as isReplanNode } from './plan-approval';

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
  /**
   * Strenge Bindungsprüfung für frei geplante Abläufe (ohne Blueprint): Eingaben müssen im Steckbrief der Fähigkeit stehen, Pflichteingaben fehlen nicht, Fakten
   * existieren (oder legt eine Fähigkeit im Plan selbst an), und gelesene Ausgabefelder gehören zur Fähigkeit des vorgelagerten Schritts. Ohne diese Strenge scheitert ein
   * Plan erst bei der Ausführung – bei einem frei geplanten Ablauf wartet dann niemand darauf.
   */
  strictBindings?: boolean;
  /**
   * Planvertrag (Konzept Flexible Autonomie §5a, ADD-2.3): die Ziele der ersten Planung eines frei geplanten Vorgangs. Jede Revision muss sie enthalten – eine Revision darf Ziele ergänzen,
   * aber keines streichen oder durch ein leichteres ersetzen (sonst ließe sich ein Vorgang durch Umplanen „erledigen“).
   */
  contractGoalKeys?: readonly string[];
  /** Bereits gesendete Rückfragen des Vorgangs aus früheren Planungen: die Grenze gilt je Vorgang, nicht je Plan (frei geplante Abläufe). */
  priorClarifications?: number;
  /**
   * Frei geplanter Ablauf: Anzahl der Angaben, die die Anforderungsprüfung als fehlend ermittelt hat und die nur die Kundschaft kennt. Wer sie kennt und noch nicht gefragt hat, übergibt nicht stumm: der Plan muss
   * eine gebündelte Rückfrage enthalten (`CLARIFICATION_EXPECTED`), bevor er an eine Person übergibt.
   */
  customerQuestionsOpen?: number;
  /** Frei geplanter Ablauf: ist die Anforderungsprüfung für diesen Vorgang schon gelaufen? `false`: ihr Ergebnis ist beim Planen noch unbekannt. */
  requirementsAnalyzed?: boolean;
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

/** Die Quellen, die der Ausführung für `sourceRef` bekannt sind (siehe Orchestrator `buildEvalContext`). */
export const KNOWN_SOURCE_REFS: readonly string[] = ['case.id', 'inbound.latestMessageId', 'inbound.latestThreadId'];

export function isForbiddenLiteralKey(key: string): boolean {
  return (FORBIDDEN_LITERAL_INPUT_KEYS as readonly string[]).includes(key.toLowerCase().replace(/[_-]/g, ''));
}

/** Zeitgesteuertes Ereignis: ein Warteknoten, der zu einem festen Zeitpunkt weiterläuft (Wiedervorlage, Erinnerung). */
export const TIME_REACHED_EVENT = 'time.reached';
export const MAX_TIME_WAIT_DAYS = 90;
const DEFAULT_WAIT_TIMEOUT_HINT = 'Ein WAIT_EVENT-Knoten braucht eine Frist (timeout) oder eine Blueprint-Wait-Regel mit Timeout-Policy.';

/**
 * Ein Schritt, dessen Vorbedingung ausdrücklich verlangt, dass seine eigene Fähigkeit verfügbar ist (`capabilityAvailable`), ist für Betriebe ohne diese Fähigkeit kein Fehler:
 * er wird dort zur Laufzeit übersprungen. So bleibt ein Ablauf für verschieden ausgestattete Betriebe (z. B. mit und ohne Kalender) derselbe, ohne dass sich jemand etwas ausdenkt.
 * Nur eine Bedingung auf oberster Ebene bzw. in einem `all` zählt – in `any`/`not` wäre die Fähigkeit nicht zwingend vorausgesetzt.
 */
function guardedByAvailability(node: PlanNode, capabilityKey: string): boolean {
  const demands = (expr: Expr): boolean => ('capabilityAvailable' in expr ? expr.capabilityAvailable === capabilityKey : 'all' in expr ? expr.all.some(demands) : false);
  return node.preconditions.some(demands);
}

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
  const isReplanPoint = isReplanNode;
  const endsInPause = nodes.some((n) => (n.type === 'WAIT_EVENT' || n.type === 'MANUAL_TASK' || isReplanPoint(n)) && (out.get(n.id) ?? []).length === 0);
  if (completeNodes.length === 0 && !endsInPause) add({ code: 'NO_TERMINAL', check: 4, message: 'Der Plan hat weder einen Abschlussknoten (COMPLETE) noch ein definiertes Ende in einer Wartestelle.' });
  for (const node of nodes) {
    // A wait ends the current revision on purpose (§11.2): the answer arrives as an event and continues in a new revision.
    if (node.type === 'COMPLETE' || node.type === 'WAIT_EVENT' || node.type === 'MANUAL_TASK' || isReplanPoint(node)) continue;
    // Ein bereits bestätigter (ausgeführter) Schritt ist Verlauf, keine offene Sackgasse: er muss in einer Neuplanung nicht weiterverbunden werden.
    if ((ctx.confirmedEffects ?? []).some((effect) => effect.nodeId === node.id)) continue;
    if ((out.get(node.id) ?? []).length === 0) add({ code: 'DEAD_END', check: 4, nodeId: node.id, message: `Knoten "${node.id}" führt nirgendwohin (kein Fehler-/Abschlusspfad).` });
  }

  // ── 5. Required information and source trust for executable steps ─────────
  const producedFacts = new Set<string>();
  for (const node of nodes) for (const key of (node.capability ? ctx.capabilities.get(node.capability.key) : undefined)?.contract?.producesFacts ?? []) producedFacts.add(key);
  for (const node of nodes) {
    const cap = node.capability ? ctx.capabilities.get(node.capability.key) : undefined;
    if (node.type === 'ACTION' && !node.capability) add({ code: 'ACTION_WITHOUT_CAPABILITY', check: 5, nodeId: node.id, message: `Aktion "${node.id}" nennt keine Fähigkeit.` });
    for (const [name, operand] of Object.entries(node.inputs)) {
      if (!('fact' in operand)) continue;
      const known = ctx.knownFactKeys.has(operand.fact);
      const collectable = ctx.collectableFactKeys.has(operand.fact) || producedFacts.has(operand.fact);
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

  // ── 5b. Strenge Bindungen (nur frei geplante Abläufe) ─────────────────────
  if (ctx.strictBindings) {
    for (const node of nodes) {
      if (!node.capability) {
        // Ein Schritt ohne Fähigkeit führt nichts aus und liefert nichts: seine Ausgabe zu lesen ist erfunden.
        continue;
      }
      const cap = ctx.capabilities.get(node.capability.key);
      if (!cap?.contract) continue;
      if (cap.contract.scope === 'BLUEPRINT_ONLY' && !ctx.blueprint) {
        add({ code: 'CAPABILITY_BLUEPRINT_ONLY', check: 5, nodeId: node.id, message: `Die Fähigkeit "${cap.key}" ist nur in einem hinterlegten Prozess nutzbar, nicht in einem frei geplanten Ablauf.` });
      }
      const allowed = new Map(cap.contract.inputs.map((i) => [i.name, i]));
      for (const name of Object.keys(node.inputs)) {
        if (!allowed.has(name)) {
          add({ code: 'INPUT_UNKNOWN', check: 5, nodeId: node.id, message: `"${cap.key}" kennt die Eingabe "${name}" nicht. Erlaubt: ${[...allowed.keys()].join(', ') || '(keine)'}.` });
        }
      }
      for (const input of cap.contract.inputs) {
        if (input.required && !(input.name in node.inputs)) {
          add({ code: 'INPUT_MISSING', check: 5, nodeId: node.id, message: `"${cap.key}" braucht die Eingabe "${input.name}"${input.hint ? ` (${input.hint})` : ''}.` });
        }
      }
      for (const [name, operand] of Object.entries(node.inputs)) {
        if ('sourceRef' in operand && !KNOWN_SOURCE_REFS.includes(operand.sourceRef)) {
          add({ code: 'SOURCE_REF_UNKNOWN', check: 5, nodeId: node.id, message: `Eingabe "${name}": die Quelle "${operand.sourceRef}" gibt es nicht. Bekannt: ${KNOWN_SOURCE_REFS.join(', ')}.` });
        }
        if ('fact' in operand && !ctx.knownFactKeys.has(operand.fact) && !ctx.collectableFactKeys.has(operand.fact) && !producedFacts.has(operand.fact)) {
          add({ code: 'FACT_UNKNOWN', check: 5, nodeId: node.id, message: `Eingabe "${name}": der Fakt "${operand.fact}" existiert nicht und wird von keinem Schritt angelegt. Vorhandene Fakten stehen im Auftrag.` });
        }
        if ('stepOutput' in operand) {
          const source = nodeById.get(operand.stepOutput.node);
          const sourceCap = source?.capability ? ctx.capabilities.get(source.capability.key) : undefined;
          const first = operand.stepOutput.path.split('.')[0] ?? '';
          if (source && !source.capability) {
            add({ code: 'STEP_OUTPUT_UNKNOWN', check: 5, nodeId: node.id, message: `Eingabe "${name}": der Schritt "${source.id}" hat keine Fähigkeit und liefert nichts, das gelesen werden könnte.` });
          } else if (sourceCap?.contract && !sourceCap.contract.outputs.includes(first)) {
            add({ code: 'STEP_OUTPUT_UNKNOWN', check: 5, nodeId: node.id, message: `Eingabe "${name}": "${sourceCap.key}" liefert kein Feld "${first}". Es liefert: ${sourceCap.contract.outputs.join(', ')}.` });
          }
        }
      }
    }
  }

  // ── 6. Connectors, scopes, permissions and policy mapping ─────────────────
  for (const node of nodes) {
    if (!node.capability) continue;
    const cap = ctx.capabilities.get(node.capability.key);
    if (!cap) continue;
    const exec = ctx.executability.get(cap.key);
    const guarded = guardedByAvailability(node, cap.key);
    if ((!exec || !exec.executable) && !guarded) {
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
    if (!blueprint && cap.contract?.purposes && (!purpose || !cap.contract.purposes.includes(purpose))) {
      add({ code: 'PURPOSE_MISSING', check: 6, nodeId: node.id, message: `"${cap.key}" braucht in config.purpose einen der Zwecke ${cap.contract.purposes.join(', ')} (derselbe Zweck wie der anschließende Versand).` });
    }
    const action = purpose && cap.policyActionByPurpose?.[purpose] ? cap.policyActionByPurpose[purpose] : cap.policyAction;
    const mode = ctx.policyModes.get(action);
    if (mode === undefined) add({ code: 'POLICY_UNMAPPED', check: 6, nodeId: node.id, message: `Für die Policy-Aktion "${action}" gibt es keine Konfiguration.` });
    else if (mode === 'DISABLED' && !guarded) add({ code: 'POLICY_DISABLED', check: 6, nodeId: node.id, message: `Die Policy-Aktion "${action}" ist deaktiviert.` });
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
      // Eine bereits bestätigte (und im Plan unverändert erhaltene) Rückfrage zählt über `priorClarifications`, nicht ein zweites Mal als neue.
      if (node.config.purpose === 'CLARIFICATION' && !(ctx.confirmedEffects ?? []).some((effect) => effect.nodeId === node.id)) clarifications += 1;
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

  // ── 9b. Planvertrag: Ziele werden nie gestrichen oder abgeschwächt ────────
  if (!blueprint && ctx.contractGoalKeys && ctx.contractGoalKeys.length > 0) {
    const missing = ctx.contractGoalKeys.filter((goal) => !plan.goalKeys.includes(goal));
    if (missing.length > 0) add({ code: 'GOAL_CONTRACT_VIOLATION', check: 9, message: `Die Ziele der ersten Planung gelten weiter und dürfen nicht gestrichen werden: ${missing.join(', ')}.` });
  }

  // ── 10. Checkable completion criteria, valid wait / timeout handling ──────
  if (blueprint) {
    const refs = collectReferences(blueprint.completionCriteria);
    for (const capKey of refs.capabilities) if (!ctx.capabilities.has(capKey)) add({ code: 'COMPLETION_UNKNOWN_CAPABILITY', check: 10, message: `Abschlusskriterium verweist auf unbekannte Fähigkeit "${capKey}".` });
  }
  for (const node of nodes) {
    if (node.type !== 'WAIT_EVENT') continue;
    const eventType = node.config.eventType;
    if (eventType === TIME_REACHED_EVENT) {
      // Zeitgesteuertes Ereignis (FX-03): die Zeit ist selbst die Frist; sie muss ein gültiger Zeitpunkt in überschaubarer Zukunft sein.
      const until = typeof node.config.until === 'string' ? Date.parse(node.config.until) : Number.NaN;
      if (Number.isNaN(until)) add({ code: 'WAIT_TIME_INVALID', check: 10, nodeId: node.id, message: `Der Warteknoten "${node.id}" braucht einen gültigen Zeitpunkt (config.until, ISO 8601).` });
      else if (until > Date.now() + MAX_TIME_WAIT_DAYS * 24 * 3600 * 1000) add({ code: 'WAIT_TIME_TOO_FAR', check: 10, nodeId: node.id, message: `Der Zeitpunkt liegt mehr als ${MAX_TIME_WAIT_DAYS} Tage in der Zukunft.` });
      continue;
    }
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
  const priorQuestions = blueprint ? 0 : (ctx.priorClarifications ?? 0);
  if (clarifications + priorQuestions > maxQuestions) add({ code: 'LIMIT_QUESTIONS', check: 11, message: `Der Plan enthält ${clarifications} Rückfragen${priorQuestions > 0 ? ` (bereits gestellt: ${priorQuestions})` : ''}, erlaubt sind ${maxQuestions} je Vorgang.` });

  // ── 12. Zielarbeit: fehlt der Kundschaft bekanntes Wissen, wird gefragt, bevor übergeben wird ─────────
  const askedAlready = (ctx.priorClarifications ?? 0) > 0 || clarifications > 0;
  const onlyUnderstanding = nodes.some(isReplanNode);
  if (!blueprint && (ctx.customerQuestionsOpen ?? 0) > 0 && !askedAlready && !onlyUnderstanding) {
    add({ code: 'CLARIFICATION_EXPECTED', check: 12, message: `Die Anforderungsprüfung hat ${ctx.customerQuestionsOpen} fehlende Angaben ergeben, die nur die Kundschaft kennt, und es wurde noch nicht gefragt. Plane eine gebündelte Rückfrage (communication.draft mit missing = Ergebnis "missing" von requirements.resolve, dann email.send, purpose CLARIFICATION) und danach einen WAIT_EVENT, bevor du an eine Person übergibst.` });
  }

  // Wer die Anforderungsprüfung erst im Plan ausführt, kennt ihr Ergebnis beim Planen nicht: Übergabe oder Rückfrage lassen sich erst danach sinnvoll festlegen.
  const runsRequirements = nodes.some((n) => n.capability?.key === 'requirements.resolve');
  if (!blueprint && ctx.requirementsAnalyzed === false && runsRequirements && !askedAlready && !onlyUnderstanding) {
    add({ code: 'REPLAN_AFTER_UNDERSTANDING', check: 12, message: 'Das Ergebnis der Anforderungsprüfung ist beim Planen noch unbekannt. Plane in dieser Revision nur das Verstehen (context.lookup, requirements.resolve) und beende sie mit einem REASSESS-Knoten ohne ausgehende Kante, z. B. {"id":"weiter","type":"REASSESS","title":"Mit dem Ergebnis weiter planen","config":{"replan":true}}; die Rückfrage oder Übergabe planst du danach mit dem Ergebnis.' });
  }

  const valid = !issues.some((i) => i.severity === 'ERROR');
  return { valid, issues, proposal: plan, stats: { nodes: nodes.length, edges: edges.length, externalActions, clarifications } };
}
