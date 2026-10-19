import type { CapabilityDefinition } from './capability';
import type { Operand } from './expressions';
import type { PlanNode, PlanProposal } from './plan';

/**
 * Konzept Flexible Autonomie Entscheidung D4 / Addendum ADD-2.1: **schreibende Wirkungen eines unbekannten Vorgangs (frei geplanter Ablauf ohne hinterlegten Prozess) brauchen
 * die Planfreigabe – unabhängig vom Autonomiegrad.** Verstehende und vorbereitende Schritte (Kontext lesen, Angaben auslesen, Anforderungen ermitteln, Entwürfe vorbereiten)
 * laufen vorher weiter. Die Einzelaktionsregeln gelten zusätzlich: auch nach der Planfreigabe wartet z. B. ein Versand auf seine eigene Freigabe, wenn die Regel das verlangt.
 *
 * Als **Wirkung** gilt, was nach außen geht oder ein Fremdsystem verändert: jede Fähigkeit mit externer Schreibwirkung sowie die Übergabe an das CRM (im Katalog als interne
 * Schreibwirkung geführt, schreibt aber – sobald verbunden – in HubSpot). Interne Meldungen an Mitarbeitende, Aufgaben und die Übergabe an eine Person sind der sichere
 * Rückfallweg und brauchen keine Planfreigabe.
 */
const EFFECT_CAPABILITIES_BEYOND_CATALOGUE: readonly string[] = ['crm.lead.create'];

/** Wirkt die Fähigkeit nach außen? Eine unbekannte Fähigkeit gilt vorsichtshalber als Wirkung. */
export function isEffectCapability(capability: CapabilityDefinition | undefined): boolean {
  if (!capability) return true;
  return capability.sideEffect === 'EXTERNAL_WRITE' || EFFECT_CAPABILITIES_BEYOND_CATALOGUE.includes(capability.key);
}

export function planNeedsWriteApproval(proposal: PlanProposal, capabilities: ReadonlyMap<string, CapabilityDefinition>): boolean {
  return proposal.nodes.some((node) => node.type === 'ACTION' && node.capability !== undefined && isEffectCapability(capabilities.get(node.capability.key)));
}

/** Wie lange eine Planfreigabe für spätere Neuplanungen desselben Vorgangs gilt. Danach braucht eine neue Wirkung wieder eine Freigabe. */
export const PLAN_SCOPE_VALIDITY_DAYS = 14;

/** Eingaben, die **bestimmen, worauf oder an wen** eine Wirkung geht (Empfänger, Kalender, Kontakt, Person). Inhalte (Text, Betreff) gehören nicht dazu. */
const TARGET_INPUT_KEYS: readonly string[] = ['to', 'recipient', 'recipients', 'cc', 'bcc', 'calendarId', 'attendee', 'attendees', 'contactId', 'staffId', 'assignee'];

function describeOperand(operand: Operand): string {
  if ('fact' in operand) return `fact:${operand.fact}`;
  if ('literal' in operand) return `literal:${String(operand.literal).trim().toLowerCase()}`;
  if ('config' in operand) return `config:${operand.config}`;
  if ('sourceRef' in operand) return `source:${operand.sourceRef}`;
  return 'derived'; // Ergebnis eines früheren Schritts – kein frei gewähltes Ziel
}

/**
 * Das Ziel einer Wirkung: an wen bzw. worauf sie geht. Ein Versand trägt den Empfänger nicht selbst, sondern der Entwurf, auf den er verweist (`draftId`) – dessen Empfänger gilt. Die Ausführung
 * prüft zusätzlich, dass der Empfänger die bestätigte Antwortadresse ist; hier geht es darum, dass eine Neuplanung das Ziel nicht still ändert.
 */
function effectTarget(node: PlanNode, byId: ReadonlyMap<string, PlanNode>): string {
  const inputs: Array<[string, Operand]> = Object.entries(node.inputs ?? {});
  const draftRef = node.inputs?.draftId;
  if (draftRef && 'stepOutput' in draftRef) {
    const draft = byId.get(draftRef.stepOutput.node);
    if (draft) inputs.push(...Object.entries(draft.inputs ?? {}));
  }
  const parts = inputs
    .filter(([key]) => TARGET_INPUT_KEYS.includes(key))
    .map(([key, operand]) => `${key}=${describeOperand(operand)}`)
    .sort();
  return parts.length > 0 ? parts.join(',') : '*';
}

/**
 * Die Wirkungen eines Plans als `capability/purpose>Ziel` (sortiert, eindeutig) – der Umfang, den eine Planfreigabe abdeckt. Fähigkeit und Zweck allein sind keine Vollmacht: ein anderer
 * Empfänger oder ein anderes Objekt ist eine andere Wirkung.
 */
export function planEffectKeys(proposal: Pick<PlanProposal, 'nodes'>, capabilities: ReadonlyMap<string, CapabilityDefinition>): string[] {
  const byId = new Map(proposal.nodes.map((n) => [n.id, n] as const));
  const keys = proposal.nodes
    .filter((node) => node.type === 'ACTION' && node.capability !== undefined && isEffectCapability(capabilities.get(node.capability.key)))
    .map((node) => `${node.capability!.key}${typeof node.config.purpose === 'string' ? `/${node.config.purpose}` : ''}>${effectTarget(node, byId)}`);
  return [...new Set(keys)].sort();
}

/** Zielangaben, die ohne ausdrückliche Wahl entstehen (Antwortadresse des Vorgangs, abgeleitete Ergebnisse): ältere Freigaben ohne Zielangabe decken genau diese ab. */
const DEFAULT_TARGETS: ReadonlySet<string> = new Set(['*', 'to=fact:contact.email', 'recipient=fact:contact.email']);

function isCovered(effectKey: string, approved: ReadonlySet<string>): boolean {
  if (approved.has(effectKey)) return true;
  const [base, target = '*'] = effectKey.split('>');
  return approved.has(base as string) && DEFAULT_TARGETS.has(target); // Freigabe im früheren Format (nur Fähigkeit/Zweck)
}

/**
 * Braucht dieser Plan eine (erneute) Planfreigabe? Nur, wenn er Wirkungen enthält, die der bereits freigegebene Umfang des Vorgangs nicht abdeckt. Eine Neuplanung nach einer Antwort der Kundschaft
 * (z. B. die nächste Rückfrage derselben Art) wiederholt die Freigabe nicht; jede **neue Art** von Wirkung verlangt sie wieder (Entscheidung D4: begrenzt und ausdrücklich).
 */
export function planNeedsNewApproval(proposal: PlanProposal, capabilities: ReadonlyMap<string, CapabilityDefinition>, approvedEffects: ReadonlySet<string>): boolean {
  return planEffectKeys(proposal, capabilities).some((key) => !isCovered(key, approvedEffects));
}

/** Eine „Weiterplanen“-Stelle: ein REASSESS-Knoten mit `config.replan` (Modelle schreiben den Wert gelegentlich als Text „true“; das gilt ebenso). */
export function isReplanPoint(node: Pick<PlanNode, 'type' | 'config'>): boolean {
  return node.type === 'REASSESS' && (node.config?.replan === true || node.config?.replan === 'true');
}

/**
 * Reduziert einen Plan auf das Verstehen: die verstehenden Schritte (die vor der Planfreigabe laufen dürfen) und bereits ausgeführte Schritte bleiben, alles Weitere entfällt, und eine
 * Weiterplanen-Stelle schließt die Revision ab. So wird nach der Anforderungsprüfung mit deren Ergebnis weitergeplant. `undefined`, wenn es nichts zu verstehen gibt.
 */
export function reduceToUnderstanding(
  proposal: PlanProposal,
  capabilities: ReadonlyMap<string, CapabilityDefinition>,
  executedNodeIds: ReadonlySet<string>,
): PlanProposal | undefined {
  const keep = proposal.nodes.filter((n) => executedNodeIds.has(n.id) || (runsBeforePlanApproval(n, capabilities) && n.type !== 'REASSESS' && n.type !== 'PREPARE' && n.type !== 'DECISION'));
  if (!keep.some((n) => !executedNodeIds.has(n.id))) return undefined;
  const ids = new Set(keep.map((n) => n.id));
  const edges = proposal.edges.filter((e) => ids.has(e.source) && ids.has(e.target));
  const sinks = keep.filter((n) => !executedNodeIds.has(n.id) && !edges.some((e) => e.source === n.id && !executedNodeIds.has(e.target)));
  const replanId = 'weiter_planen';
  const replan: PlanNode = { id: replanId, type: 'REASSESS', title: 'Mit dem Ergebnis weiter planen', inputs: {}, preconditions: [], optional: false, onFailure: 'REVIEW', config: { replan: true }, evidenceRefs: [] };
  return {
    ...proposal,
    nodes: [...keep, replan],
    edges: [...edges, ...sinks.map((n) => ({ id: `e_${n.id}_${replanId}`, source: n.id, target: replanId }))],
    conciseExplanation: 'Zuerst verstehen (Absender, Anforderungen); danach wird mit dem Ergebnis weitergeplant (Rückfrage oder Übergabe).',
  };
}

/** Knotentypen, die auch vor der Planfreigabe laufen dürfen: verstehen, vorbereiten, entscheiden – nie warten, übergeben, abschließen oder wirken. */
const PRE_APPROVAL_TYPES: ReadonlySet<string> = new Set(['INTERPRET', 'RESOLVE_CONTEXT', 'EVALUATE_REQUIREMENTS', 'DECISION', 'REASSESS', 'PREPARE']);

export function runsBeforePlanApproval(node: PlanNode, capabilities: ReadonlyMap<string, CapabilityDefinition>): boolean {
  if (!PRE_APPROVAL_TYPES.has(node.type)) return false;
  if (!node.capability) return true;
  return !isEffectCapability(capabilities.get(node.capability.key));
}
