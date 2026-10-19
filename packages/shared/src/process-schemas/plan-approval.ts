import type { CapabilityDefinition } from './capability';
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

/** Knotentypen, die auch vor der Planfreigabe laufen dürfen: verstehen, vorbereiten, entscheiden – nie warten, übergeben, abschließen oder wirken. */
const PRE_APPROVAL_TYPES: ReadonlySet<string> = new Set(['INTERPRET', 'RESOLVE_CONTEXT', 'EVALUATE_REQUIREMENTS', 'DECISION', 'REASSESS', 'PREPARE']);

export function runsBeforePlanApproval(node: PlanNode, capabilities: ReadonlyMap<string, CapabilityDefinition>): boolean {
  if (!PRE_APPROVAL_TYPES.has(node.type)) return false;
  if (!node.capability) return true;
  return !isEffectCapability(capabilities.get(node.capability.key));
}
