import { actionClassOf, type ActionClass } from '../policy-groups';
import { DEFAULT_POLICY_CONFIG, type PolicyActionKey, type PolicyMode } from '../policy';
import { ADHOC_CLOSING_PROOFS } from './adhoc-completion';
import type { CapabilityDefinition } from './capability';
import type { PlanProposal } from './plan';

/**
 * Konzept Flexible Autonomie §9 Schritt 1 (Schattenbetrieb) und §13: **der Schattenbetrieb bewertet die Planung, nicht die Ausführung.** Der Vorgangs-Agent plant mit,
 * führt aber nichts aus; dieser reine, deterministische Prüfer beurteilt den Plan an den Regeln, die ein ausgeführter Plan einhalten müsste. Er ruft keine KI auf und
 * liest keine Daten: dieselbe Eingabe ergibt immer dasselbe Urteil (und lässt sich deshalb testen und wiederholen).
 */
export type ShadowViolationCode =
  /** Eine Aktion der Klasse „gesperrt“ (z. B. Zahlung ausführen) ist geplant. */
  | 'BLOCKED_ACTION_PLANNED'
  /** Eine Fähigkeit steht nicht im Katalog (die deterministische Planprüfung hätte sie schon abgelehnt). */
  | 'UNKNOWN_CAPABILITY'
  /** Mindestens ein Schritt ohne Nachfolger ist weder Abschluss, Wartepunkt, Freigabe noch Übergabe: der Plan „hört einfach auf“. */
  | 'NO_TERMINAL_END_STATE'
  /** Der Plan endet an `COMPLETE`, plant aber keinen Wirkungsnachweis, der das Anliegen abschließt (zur Laufzeit würde der Abschluss verweigert). */
  | 'COMPLETE_WITHOUT_CLOSING_PROOF'
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

export interface ShadowRating {
  /** Keine Verletzung. */
  passed: boolean;
  violations: Array<{ code: ShadowViolationCode; nodeId?: string; message: string }>;
  actions: ShadowActionClassEntry[];
  /** Endzustände des Plans (Knotentypen der Schritte ohne Nachfolger). */
  endStates: string[];
  plansClosingProof: boolean;
  plansHandover: boolean;
  /** Geplante Wirkungen als `capability/purpose`, für den späteren Vergleich mit den tatsächlich ausgeführten. */
  plannedEffects: string[];
}

const TERMINAL_TYPES: ReadonlySet<string> = new Set(['COMPLETE', 'WAIT_EVENT', 'APPROVAL', 'MANUAL_TASK']);

export function rateShadowPlan(
  proposal: PlanProposal,
  context: { capabilities: ReadonlyMap<string, CapabilityDefinition>; policyModes: Readonly<Record<string, PolicyMode>>; planValid?: boolean },
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

  const plansClosingProof = proposal.nodes.some((node) => {
    if (node.type !== 'ACTION' || node.capability?.key === undefined) return false;
    const purpose = typeof node.config.purpose === 'string' ? node.config.purpose : '';
    return ADHOC_CLOSING_PROOFS.some((proof) => proof.capability === node.capability?.key && proof.purposes.includes(purpose));
  });
  const plansHandover = proposal.nodes.some((node) => node.type === 'MANUAL_TASK' || (node.type === 'ACTION' && node.capability?.key === 'staff.notify'));
  const completeNodes = proposal.nodes.filter((node) => node.type === 'COMPLETE');
  if (completeNodes.length > 0 && !plansClosingProof) {
    violations.push({ code: 'COMPLETE_WITHOUT_CLOSING_PROOF', nodeId: completeNodes[0]!.id, message: 'Der Plan endet an "Abschluss", plant aber keine inhaltliche Antwort als Nachweis.' });
  }

  return { passed: violations.length === 0, violations, actions, endStates, plansClosingProof, plansHandover, plannedEffects };
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
