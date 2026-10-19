import { describe, expect, it } from 'vitest';
import { DEFAULT_CAPABILITIES } from './capability';
import { compareShadowToActual, rateShadowPlan } from './shadow-rating';
import type { PlanProposal } from './plan';

const capabilities = new Map(DEFAULT_CAPABILITIES.map((c) => [c.key, c]));
const node = (id: string, type: PlanProposal['nodes'][number]['type'], extra: Partial<PlanProposal['nodes'][number]> = {}): PlanProposal['nodes'][number] => ({
  id,
  type,
  title: id,
  inputs: {},
  preconditions: [],
  optional: false,
  onFailure: 'REVIEW',
  config: {},
  evidenceRefs: [],
  ...extra,
});
const edge = (source: string, target: string) => ({ id: `e_${source}_${target}`, source, target });
const plan = (nodes: PlanProposal['nodes'], edges: PlanProposal['edges'], goalKeys = ['inquiry.answered']): PlanProposal => ({ goalKeys, nodes, edges, unresolvedRequirements: [], assumptions: [], conciseExplanation: 'x' });
const modes = { 'email.send.information': 'AUTONOMOUS', 'staff.notify': 'AUTONOMOUS' } as const;
const reply = () =>
  plan(
    [node('draft', 'PREPARE', { capability: { key: 'communication.draft' }, config: { purpose: 'INFORMATION' } }), node('send', 'ACTION', { capability: { key: 'email.send' }, config: { purpose: 'INFORMATION' } }), node('done', 'COMPLETE')],
    [edge('draft', 'send'), edge('send', 'done')],
  );

describe('Schattenbewertung: der Plan wird bewertet, nicht ausgeführt – und danach, ob er dem Geschäftsziel dient', () => {
  it('ein Plan mit inhaltlicher Antwort und passendem Ziel besteht, weist Aktionsklassen aus und passt zum Anliegen', () => {
    const rated = rateShadowPlan(reply(), { capabilities, policyModes: modes, category: 'GENERAL_INQUIRY' });
    expect(rated.passed).toBe(true);
    expect(rated.actions).toEqual([expect.objectContaining({ nodeId: 'send', capability: 'email.send', purpose: 'INFORMATION', actionClass: 'AUTONOMOUS' })]);
    expect(rated.goals).toEqual([{ goal: 'inquiry.answered', label: 'Anfrage beantwortet', known: true, served: true }]);
    expect(rated.goalFit.verdict).toBe('FITS');
    expect(rated.needsPlanApproval).toBe(true); // Versand eines unbekannten Vorgangs (D4)
    expect(rated.endStates).toEqual(['COMPLETE']);
  });

  it('ein technisch gültiger Plan, der sein Ziel nicht bedient, besteht NICHT (Zusammenfassung → Abschluss)', () => {
    const rated = rateShadowPlan(plan([node('sum', 'INTERPRET'), node('done', 'COMPLETE')], [edge('sum', 'done')]), { capabilities, policyModes: modes, planValid: true, category: 'GENERAL_INQUIRY' });
    expect(rated.passed).toBe(false);
    expect(rated.violations.map((v) => v.code)).toEqual(expect.arrayContaining(['GOAL_NOT_SERVED', 'COMPLETE_WITHOUT_GOAL_PROOF']));
    expect(rated.goalFit.verdict).toBe('MISSES');
  });

  it('ein unbekanntes Ziel hat keine überprüfbaren Kriterien: Beanstandung und „ein Mensch urteilt“ – kein stilles FITS', () => {
    const rated = rateShadowPlan(plan([node('notify', 'ACTION', { capability: { key: 'staff.notify' } }), node('human', 'MANUAL_TASK')], [edge('notify', 'human')], ['topic.reviewed']), { capabilities, policyModes: modes, category: 'GENERAL_INQUIRY' });
    expect(rated.violations.map((v) => v.code)).toContain('GOAL_UNKNOWN');
    expect(rated.goalFit.verdict).toBe('NEEDS_REVIEW');
  });

  it('Übergabe an eine Person ist für ein Ziel „liegt bei einer Person“ bedient und ein zulässiger Endzustand; Beschwerde ohne Übergabe verfehlt das Ziel', () => {
    const handover = rateShadowPlan(plan([node('notify', 'ACTION', { capability: { key: 'staff.notify' } }), node('human', 'MANUAL_TASK')], [edge('notify', 'human')], ['human.review']), { capabilities, policyModes: modes, category: 'COMPLAINT_OR_SERVICE' });
    expect(handover.passed).toBe(true);
    expect(handover.plansHandover).toBe(true);
    expect(handover.goalFit.verdict).toBe('FITS');
    expect(handover.needsPlanApproval).toBe(false); // der sichere Rückfallweg braucht keine Planbestätigung

    const noHandover = rateShadowPlan(reply(), { capabilities, policyModes: modes, category: 'COMPLAINT_OR_SERVICE' });
    expect(noHandover.goalFit.verdict).toBe('MISSES');
  });

  it('eine unbekannte Art des Anliegens bleibt immer „ein Mensch urteilt“', () => {
    expect(rateShadowPlan(reply(), { capabilities, policyModes: modes, category: 'UNKNOWN' }).goalFit.verdict).toBe('NEEDS_REVIEW');
    expect(rateShadowPlan(reply(), { capabilities, policyModes: modes }).goalFit.verdict).toBe('NEEDS_REVIEW');
  });

  it('ein Plan, der mit einem normalen Schritt endet („hört einfach auf“), wird beanstandet', () => {
    const rated = rateShadowPlan(plan([node('sum', 'INTERPRET'), node('prep', 'PREPARE', { capability: { key: 'communication.draft' }, config: { purpose: 'INFORMATION' } })], [edge('sum', 'prep')]), { capabilities, policyModes: modes });
    expect(rated.violations.map((v) => v.code)).toContain('NO_TERMINAL_END_STATE');
  });

  it('eine geplante Zahlung (gesperrt) wird beanstandet – auch wenn eine Policy sie erlauben würde', () => {
    const fakeCapabilities = new Map(capabilities);
    fakeCapabilities.set('payment.run', { ...capabilities.get('email.send')!, key: 'payment.run', policyAction: 'payment.execute', policyActionByPurpose: undefined });
    const rated = rateShadowPlan(plan([node('pay', 'ACTION', { capability: { key: 'payment.run' } }), node('human', 'MANUAL_TASK')], [edge('pay', 'human')], ['human.review']), {
      capabilities: fakeCapabilities,
      policyModes: { 'payment.execute': 'AUTONOMOUS' },
    });
    expect(rated.violations.map((v) => v.code)).toContain('BLOCKED_ACTION_PLANNED');
  });

  it('dieselbe Wirkung doppelt geplant wird beanstandet; eine unbekannte Fähigkeit und ein ungültiger Plan ebenso', () => {
    const doubled = rateShadowPlan(
      plan(
        [node('s1', 'ACTION', { capability: { key: 'email.send' }, config: { purpose: 'INFORMATION' } }), node('s2', 'ACTION', { capability: { key: 'email.send' }, config: { purpose: 'INFORMATION' } }), node('done', 'COMPLETE')],
        [edge('s1', 's2'), edge('s2', 'done')],
      ),
      { capabilities, policyModes: modes },
    );
    expect(doubled.violations.map((v) => v.code)).toContain('DUPLICATE_EFFECT_PLANNED');

    const invalid = rateShadowPlan(plan([node('x', 'ACTION', { capability: { key: 'does.not_exist' } }), node('human', 'MANUAL_TASK')], [edge('x', 'human')], ['human.review']), { capabilities, policyModes: modes, planValid: false });
    expect(invalid.violations.map((v) => v.code).sort()).toEqual(['PLAN_INVALID', 'UNKNOWN_CAPABILITY']);
  });
});

describe('Vergleich Schattenplan ↔ tatsächlicher Weg', () => {
  it('trennt abgedeckte, fehlende und zusätzlich geplante Wirkungen', () => {
    expect(compareShadowToActual(['email.send/CLARIFICATION', 'crm.lead.create', 'staff.notify'], ['email.send/CLARIFICATION', 'calendar.book'])).toEqual({
      covered: ['email.send/CLARIFICATION'],
      missing: ['calendar.book'],
      extra: ['crm.lead.create', 'staff.notify'],
    });
  });
});
