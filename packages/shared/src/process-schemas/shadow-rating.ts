import { actionClassOf, type ActionClass } from '../policy-groups';
import { DEFAULT_POLICY_CONFIG, type PolicyActionKey, type PolicyMode } from '../policy';
import type { CapabilityDefinition } from './capability';
import { GOAL_CATALOGUE } from './goal-catalogue';
import type { PlanProposal } from './plan';
import { planNeedsWriteApproval } from './plan-approval';

/**
 * Konzept Flexible Autonomie §9 Schritt 1 (Schattenbetrieb) und §13: **der Schattenbetrieb bewertet die Planung, nicht die Ausführung.** Der Vorgangs-Agent plant mit, führt aber nichts aus; dieser
 * reine, deterministische Prüfer beurteilt den Plan an den Regeln, die ein ausgeführter Plan einhalten müsste, **und daran, ob er dem Geschäftsziel dient** (Ziele aus dem Katalog, die der Plan mit
 * seinen Schritten tatsächlich belegen kann; Erwartung nach Art des Anliegens). Er ruft keine KI auf und liest keine Daten: dieselbe Eingabe ergibt immer dasselbe Urteil.
 *
 * Ein technisch zulässiger Plan ist nicht automatisch ein guter: `goalFit` hält fest, ob er dem Ziel dient, und kennzeichnet, wo ein Mensch urteilen muss (`NEEDS_REVIEW`).
 */
export type ShadowViolationCode =
  /** Eine Aktion der Klasse „gesperrt“ (z. B. Zahlung ausführen) ist geplant. */
  | 'BLOCKED_ACTION_PLANNED'
  /** Eine Fähigkeit steht nicht im Katalog (die deterministische Planprüfung hätte sie schon abgelehnt). */
  | 'UNKNOWN_CAPABILITY'
  /** Mindestens ein Schritt ohne Nachfolger ist weder Abschluss, Wartepunkt, Freigabe noch Übergabe: der Plan „hört einfach auf“. */
  | 'NO_TERMINAL_END_STATE'
  /** Ein Ziel des Plans steht nicht im Zielkatalog: es hat keine überprüfbaren Abschlusskriterien. */
  | 'GOAL_UNKNOWN'
  /** Der Plan nennt ein Ziel, plant aber keinen Schritt, der es belegen könnte. */
  | 'GOAL_NOT_SERVED'
  /** Der Plan endet an „Abschluss“, obwohl ein Ziel nicht belegbar ist (zur Laufzeit würde der Abschluss verweigert). */
  | 'COMPLETE_WITHOUT_GOAL_PROOF'
  /** Dieselbe Wirkung (Fähigkeit/Zweck) ist mehrfach geplant. */
  | 'DUPLICATE_EFFECT_PLANNED'
  /** Die deterministische Planprüfung hat den Plan abgelehnt. */
  | 'PLAN_INVALID';

export interface ShadowActionClassEntry {
  nodeId: string;
  capability: string;
  purpose?: string;
  policyAction: string;
  mode: PolicyMode;
  actionClass: ActionClass;
}

export type GoalFitVerdict = 'FITS' | 'PARTIAL' | 'MISSES' | 'NEEDS_REVIEW';

export interface ShadowGoalEntry {
  goal: string;
  label: string;
  known: boolean;
  served: boolean;
}

export interface ShadowRating {
  /** Keine Verletzung. */
  passed: boolean;
  violations: Array<{ code: ShadowViolationCode; nodeId?: string; message: string }>;
  actions: ShadowActionClassEntry[];
  /** Endzustände des Plans (Knotentypen der Schritte ohne Nachfolger). */
  endStates: string[];
  goals: ShadowGoalEntry[];
  /** Dient der Plan dem Geschäftsziel? `NEEDS_REVIEW` = ein Mensch muss urteilen (unbekannte Art des Anliegens, unbekanntes Ziel). */
  goalFit: { verdict: GoalFitVerdict; reasons: string[] };
  /** Würde dieser Plan nach D4 auf die Planfreigabe warten? */
  needsPlanApproval: boolean;
  plansHandover: boolean;
  /** Geplante Wirkungen als `capability/purpose`, für den späteren Vergleich mit den tatsächlich ausgeführten. */
  plannedEffects: string[];
}

const TERMINAL_TYPES: ReadonlySet<string> = new Set(['COMPLETE', 'WAIT_EVENT', 'APPROVAL', 'MANUAL_TASK']);

type Planned = { capability: string; purpose?: string };

function plannedActions(proposal: PlanProposal): Planned[] {
  return proposal.nodes
    .filter((node) => node.type === 'ACTION' && node.capability !== undefined)
    .map((node) => ({ capability: node.capability!.key, ...(typeof node.config.purpose === 'string' ? { purpose: node.config.purpose } : {}) }));
}

/** Kann der Plan das Ziel mit seinen Schritten belegen? Ziele, die bei einer Person liegen, sind bedient, wenn der Plan an eine Person übergibt. */
function goalServed(goalKey: string, planned: readonly Planned[], proposal: PlanProposal): boolean {
  const definition = GOAL_CATALOGUE[goalKey];
  if (!definition) return false;
  const handover = proposal.nodes.some((node) => node.type === 'MANUAL_TASK') || planned.some((p) => p.capability === 'staff.notify');
  if (definition.humanOnly) return handover;
  return definition.requires.every((criterion) => {
    if (criterion.kind === 'TASK') return proposal.nodes.some((node) => node.type === 'MANUAL_TASK') || planned.some((p) => p.capability === 'task.create');
    return planned.some((p) => p.capability === criterion.capability && (!criterion.purposes || criterion.purposes.includes(p.purpose ?? '')));
  });
}

/** Was erwartet das Geschäft von einem Plan zu dieser Art des Anliegens? (Erwartung, kein Zwang: unbekannte Arten bleiben `NEEDS_REVIEW`.) */
function expectedFit(category: string | undefined, planned: readonly Planned[], proposal: PlanProposal): { verdict: GoalFitVerdict; reason: string } | undefined {
  const handover = proposal.nodes.some((node) => node.type === 'MANUAL_TASK') || planned.some((p) => p.capability === 'staff.notify');
  const customerFacing = planned.some((p) => p.capability === 'email.send' && ['INFORMATION', 'STATUS_UPDATE', 'QUOTE_DELIVERY', 'APPOINTMENT_CONFIRMATION', 'CLARIFICATION', 'ACKNOWLEDGEMENT', 'ATTACHMENT_REQUEST'].includes(p.purpose ?? ''));
  switch (category) {
    case 'GENERAL_INQUIRY':
      return customerFacing || handover ? { verdict: 'FITS', reason: 'Eine Auskunft oder die Übergabe an eine Person ist vorgesehen.' } : { verdict: 'MISSES', reason: 'Weder eine Antwort an die Anfrage noch eine Übergabe ist geplant.' };
    case 'REQUEST_FOR_QUOTE':
    case 'SALES_INQUIRY':
      return customerFacing || planned.some((p) => p.capability === 'crm.lead.create') || handover
        ? { verdict: 'FITS', reason: 'Rückfrage, Angebot, Termin oder Übergabe an den Vertrieb ist vorgesehen.' }
        : { verdict: 'MISSES', reason: 'Für eine Angebotsanfrage ist weder Kundenkontakt noch Übergabe an den Vertrieb geplant.' };
    case 'COMPLAINT_OR_SERVICE':
    case 'APPLICATION':
      return handover ? { verdict: 'FITS', reason: 'Die zuständige Person wird informiert bzw. übernimmt.' } : { verdict: 'MISSES', reason: 'Dieses Anliegen gehört zu einer Person, die Übergabe ist nicht geplant.' };
    default:
      return undefined;
  }
}

export function rateShadowPlan(
  proposal: PlanProposal,
  context: {
    capabilities: ReadonlyMap<string, CapabilityDefinition>;
    policyModes: Readonly<Record<string, PolicyMode>>;
    planValid?: boolean;
    /** Art des Anliegens laut Einstufung (z. B. `GENERAL_INQUIRY`); ohne Angabe oder unbekannt bleibt das Urteil bei `NEEDS_REVIEW`. */
    category?: string;
  },
): ShadowRating {
  const violations: ShadowRating['violations'] = [];
  const actions: ShadowActionClassEntry[] = [];
  const plannedEffects: string[] = [];

  if (context.planValid === false) violations.push({ code: 'PLAN_INVALID', message: 'Der Plan besteht die deterministische Prüfung nicht.' });

  for (const node of proposal.nodes) {
    if (node.type !== 'ACTION' || !node.capability) continue;
    const capability = context.capabilities.get(node.capability.key);
    if (!capability) {
      violations.push({ code: 'UNKNOWN_CAPABILITY', nodeId: node.id, message: `Die Fähigkeit "${node.capability.key}" ist nicht im Katalog.` });
      continue;
    }
    const purpose = typeof node.config.purpose === 'string' ? node.config.purpose : undefined;
    const policyAction = (purpose ? capability.policyActionByPurpose?.[purpose] : undefined) ?? capability.policyAction;
    const known = DEFAULT_POLICY_CONFIG[policyAction as PolicyActionKey];
    const mode: PolicyMode = context.policyModes[policyAction] ?? known?.mode ?? 'REQUIRE_APPROVAL';
    // Eine unbekannte Policy-Aktion ist nie „erlaubt“, sondern fällt auf die Standardregel Freigabe (Konzept §8.2).
    const actionClass: ActionClass = known ? actionClassOf(policyAction as PolicyActionKey, mode) : mode === 'DISABLED' ? 'BLOCKED' : 'AFTER_APPROVAL';
    actions.push({ nodeId: node.id, capability: capability.key, ...(purpose ? { purpose } : {}), policyAction, mode, actionClass });
    if (actionClass === 'BLOCKED') violations.push({ code: 'BLOCKED_ACTION_PLANNED', nodeId: node.id, message: `"${capability.key}" ist gesperrt und darf nicht geplant werden.` });
    if (capability.sideEffect !== 'NONE') plannedEffects.push(`${capability.key}${purpose ? `/${purpose}` : ''}`);
  }

  const seen = new Set<string>();
  for (const effect of plannedEffects) {
    if (seen.has(effect)) violations.push({ code: 'DUPLICATE_EFFECT_PLANNED', message: `Die Wirkung "${effect}" ist mehrfach geplant.` });
    seen.add(effect);
  }

  const hasOutgoing = new Set(proposal.edges.map((edge) => edge.source));
  const sinks = proposal.nodes.filter((node) => !hasOutgoing.has(node.id));
  const endStates = [...new Set(sinks.map((node) => node.type))];
  for (const sink of sinks) {
    if (!TERMINAL_TYPES.has(sink.type)) {
      violations.push({ code: 'NO_TERMINAL_END_STATE', nodeId: sink.id, message: `Der Schritt "${sink.id}" (${sink.type}) beendet den Plan, ohne Abschluss, Wartepunkt, Freigabe oder Übergabe zu sein.` });
    }
  }

  const planned = plannedActions(proposal);
  const goals: ShadowGoalEntry[] = [...new Set(proposal.goalKeys)].map((goal) => ({
    goal,
    label: GOAL_CATALOGUE[goal]?.label ?? goal,
    known: GOAL_CATALOGUE[goal] !== undefined,
    served: goalServed(goal, planned, proposal),
  }));
  for (const goal of goals) {
    if (!goal.known) violations.push({ code: 'GOAL_UNKNOWN', message: `Das Ziel "${goal.goal}" steht nicht im Zielkatalog; es hat keine überprüfbaren Abschlusskriterien.` });
    else if (!goal.served) violations.push({ code: 'GOAL_NOT_SERVED', message: `Der Plan nennt das Ziel „${goal.label}“, plant aber keinen Schritt, der es belegen könnte.` });
  }
  const completeNodes = proposal.nodes.filter((node) => node.type === 'COMPLETE');
  if (completeNodes.length > 0 && goals.some((g) => !g.known || !g.served || GOAL_CATALOGUE[g.goal]?.humanOnly)) {
    violations.push({ code: 'COMPLETE_WITHOUT_GOAL_PROOF', nodeId: completeNodes[0]!.id, message: 'Der Plan endet an „Abschluss“, obwohl mindestens ein Ziel nicht belegbar ist bzw. bei einer Person liegt.' });
  }

  // Dient der Plan dem Geschäftsziel? Ein Plan, der seine eigenen Ziele nicht bedient, verfehlt es; sonst entscheidet die Erwartung an die Art des Anliegens.
  const reasons: string[] = [];
  let verdict: GoalFitVerdict;
  const unserved = goals.filter((g) => g.known && !g.served);
  const unknown = goals.filter((g) => !g.known);
  const expectation = expectedFit(context.category, planned, proposal);
  if (unserved.length > 0) {
    verdict = unserved.length === goals.length ? 'MISSES' : 'PARTIAL';
    reasons.push(...unserved.map((g) => `Ziel „${g.label}“ wird vom Plan nicht bedient.`));
  } else if (expectation?.verdict === 'MISSES') {
    verdict = 'MISSES';
    reasons.push(expectation.reason);
  } else if (unknown.length > 0 || expectation === undefined) {
    verdict = 'NEEDS_REVIEW';
    reasons.push(unknown.length > 0 ? `Unbekanntes Ziel (${unknown.map((g) => g.goal).join(', ')}): ein Mensch urteilt.` : 'Art des Anliegens ohne feste Erwartung: ein Mensch urteilt.');
  } else {
    verdict = 'FITS';
    reasons.push(expectation.reason);
  }

  const plansHandover = proposal.nodes.some((node) => node.type === 'MANUAL_TASK' || (node.type === 'ACTION' && node.capability?.key === 'staff.notify'));
  return {
    passed: violations.length === 0,
    violations,
    actions,
    endStates,
    goals,
    goalFit: { verdict, reasons },
    needsPlanApproval: planNeedsWriteApproval(proposal, context.capabilities),
    plansHandover,
    plannedEffects,
  };
}

/**
 * Vergleich mit dem tatsächlich gewählten Weg desselben Vorgangs (Schritt 1 des Konzepts): welche Wirkungen hat der alte Weg ausgeführt, die der Schattenplan nicht
 * vorgesehen hat (Lücke), und welche plant der Schattenplan zusätzlich (Abweichung, die geprüft werden muss)? Ein Plan ist nicht „besser“, weil er mehr tut.
 */
export function compareShadowToActual(plannedEffects: readonly string[], actualEffects: readonly string[]): { covered: string[]; missing: string[]; extra: string[] } {
  const planned = new Set(plannedEffects);
  const actual = new Set(actualEffects);
  return {
    covered: [...actual].filter((effect) => planned.has(effect)),
    missing: [...actual].filter((effect) => !planned.has(effect)),
    extra: [...planned].filter((effect) => !actual.has(effect)),
  };
}
