import { describe, expect, it } from 'vitest';
import { DEFAULT_CAPABILITIES } from './capability';
import { isEffectCapability, planEffectKeys, planNeedsNewApproval, planNeedsWriteApproval, runsBeforePlanApproval } from './plan-approval';
import type { PlanNode, PlanProposal } from './plan';

const catalogue = new Map(DEFAULT_CAPABILITIES.map((c) => [c.key, c]));
const node = (id: string, type: PlanNode['type'], capability?: string): PlanNode => ({ id, type, title: id, inputs: {}, preconditions: [], optional: false, onFailure: 'REVIEW', config: {}, evidenceRefs: [], ...(capability ? { capability: { key: capability } } : {}) });
const plan = (nodes: PlanNode[]): PlanProposal => ({ goalKeys: ['x'], nodes, edges: [], unresolvedRequirements: [], assumptions: [], conciseExplanation: 'x' });

describe('Planfreigabe für schreibende Wirkungen unbekannter Vorgänge (D4)', () => {
  it('Versand, Terminbuchung und CRM-Übergabe sind Wirkungen; Lesen, Verstehen und Entwürfe nicht', () => {
    for (const key of ['email.send', 'calendar.book', 'crm.lead.create']) expect(isEffectCapability(catalogue.get(key))).toBe(true);
    for (const key of ['context.lookup', 'facts.extract_from_message', 'requirements.resolve', 'communication.draft', 'knowledge.answer', 'pricing.resolve', 'quote.create']) {
      expect(isEffectCapability(catalogue.get(key))).toBe(false);
    }
  });

  it('interne Meldung und Aufgabe (Übergabe an eine Person) sind der sichere Rückfallweg und brauchen keine Planfreigabe', () => {
    expect(isEffectCapability(catalogue.get('staff.notify'))).toBe(false);
    expect(isEffectCapability(catalogue.get('task.create'))).toBe(false);
    expect(planNeedsWriteApproval(plan([node('n', 'ACTION', 'staff.notify'), node('m', 'MANUAL_TASK')]), catalogue)).toBe(false);
  });

  it('ein Plan mit Versand braucht die Planfreigabe, ein rein verstehender Plan nicht', () => {
    expect(planNeedsWriteApproval(plan([node('ctx', 'RESOLVE_CONTEXT', 'context.lookup'), node('send', 'ACTION', 'email.send')]), catalogue)).toBe(true);
    expect(planNeedsWriteApproval(plan([node('ctx', 'RESOLVE_CONTEXT', 'context.lookup'), node('know', 'PREPARE', 'knowledge.answer')]), catalogue)).toBe(false);
  });

  it('eine unbekannte Fähigkeit gilt vorsichtshalber als Wirkung', () => {
    expect(isEffectCapability(undefined)).toBe(true);
    expect(planNeedsWriteApproval(plan([node('x', 'ACTION', 'neu.faehigkeit')]), catalogue)).toBe(true);
  });

  it('Planumfang: eine Neuplanung mit bereits freigegebenen Wirkungen braucht keine neue Freigabe – eine neue Art von Wirkung schon', () => {
    const withPurpose = (id: string, purpose: string): PlanNode => ({ ...node(id, 'ACTION', 'email.send'), config: { purpose } });
    const first = plan([withPurpose('ask', 'CLARIFICATION')]);
    expect(planEffectKeys(first, catalogue)).toEqual(['email.send/CLARIFICATION>*']);
    const approved = new Set(planEffectKeys(first, catalogue));

    expect(planNeedsNewApproval(plan([withPurpose('ask2', 'CLARIFICATION')]), catalogue, approved)).toBe(false); // nächste Rückfrage derselben Art
    expect(planNeedsNewApproval(plan([withPurpose('answer', 'INFORMATION')]), catalogue, approved)).toBe(true); // neue Art von Wirkung
    expect(planNeedsNewApproval(plan([node('book', 'ACTION', 'calendar.book')]), catalogue, approved)).toBe(true);
    expect(planNeedsNewApproval(plan([node('ctx', 'RESOLVE_CONTEXT', 'context.lookup')]), catalogue, new Set())).toBe(false);
  });

  it('Grenzen der Freigabe: gleiche Fähigkeit und gleicher Zweck sind keine Vollmacht – ein anderer Empfänger ist eine neue Wirkung, die Antwortadresse des Vorgangs bleibt im Umfang', () => {
    const send = (to: Record<string, unknown>): PlanProposal => {
      const draft: PlanNode = { ...node('draft', 'PREPARE', 'communication.draft'), inputs: { to: to as never }, config: { purpose: 'CLARIFICATION' } };
      const mail: PlanNode = { ...node('send', 'ACTION', 'email.send'), inputs: { draftId: { stepOutput: { node: 'draft', path: 'draftId' } } }, config: { purpose: 'CLARIFICATION' } };
      return plan([draft, mail]);
    };
    const approvedPlan = send({ fact: 'contact.email' });
    expect(planEffectKeys(approvedPlan, catalogue)).toEqual(['email.send/CLARIFICATION>to=fact:contact.email']);
    const approved = new Set(planEffectKeys(approvedPlan, catalogue));

    expect(planNeedsNewApproval(send({ fact: 'contact.email' }), catalogue, approved)).toBe(false); // nächste Rückfrage an dieselbe Adresse
    expect(planNeedsNewApproval(send({ literal: 'fremd@beispiel.de' }), catalogue, approved)).toBe(true); // anderer Empfänger
    expect(planNeedsNewApproval(send({ fact: 'other.email' }), catalogue, approved)).toBe(true); // anderes Ziel
    // Eine ältere Freigabe ohne Zielangabe deckt nur die Antwortadresse des Vorgangs ab, keinen frei gewählten Empfänger.
    const legacy = new Set(['email.send/CLARIFICATION']);
    expect(planNeedsNewApproval(send({ fact: 'contact.email' }), catalogue, legacy)).toBe(false);
    expect(planNeedsNewApproval(send({ literal: 'fremd@beispiel.de' }), catalogue, legacy)).toBe(true);
  });

  it('vor der Planfreigabe laufen nur verstehende/vorbereitende Schritte – nie Wirkung, Warten, Übergabe oder Abschluss', () => {
    expect(runsBeforePlanApproval(node('c', 'RESOLVE_CONTEXT', 'context.lookup'), catalogue)).toBe(true);
    expect(runsBeforePlanApproval(node('i', 'INTERPRET'), catalogue)).toBe(true);
    expect(runsBeforePlanApproval(node('d', 'PREPARE', 'communication.draft'), catalogue)).toBe(true);
    expect(runsBeforePlanApproval(node('s', 'ACTION', 'email.send'), catalogue)).toBe(false);
    expect(runsBeforePlanApproval(node('n', 'ACTION', 'staff.notify'), catalogue)).toBe(false);
    expect(runsBeforePlanApproval(node('w', 'WAIT_EVENT'), catalogue)).toBe(false);
    expect(runsBeforePlanApproval(node('m', 'MANUAL_TASK'), catalogue)).toBe(false);
    expect(runsBeforePlanApproval(node('k', 'COMPLETE'), catalogue)).toBe(false);
    expect(runsBeforePlanApproval(node('p', 'PREPARE', 'unbekannt.x'), catalogue)).toBe(false);
  });
});
