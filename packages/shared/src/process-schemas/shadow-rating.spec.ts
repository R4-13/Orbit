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
const plan = (nodes: PlanProposal['nodes'], edges: PlanProposal['edges']): PlanProposal => ({ goalKeys: ['x'], nodes, edges, unresolvedRequirements: [], assumptions: [], conciseExplanation: 'x' });
const modes = { 'email.send.information': 'AUTONOMOUS', 'staff.notify': 'AUTONOMOUS' } as const;

describe('Schattenbewertung: der Plan wird bewertet, nicht ausgeführt', () => {
  it('ein Plan mit inhaltlicher Antwort und Abschluss besteht und weist Aktionsklassen aus', () => {
    const rated = rateShadowPlan(
      plan(
        [node('draft', 'PREPARE', { capability: { key: 'communication.draft' }, config: { purpose: 'INFORMATION' } }), node('send', 'ACTION', { capability: { key: 'email.send' }, config: { purpose: 'INFORMATION' } }), node('done', 'COMPLETE')],
        [edge('draft', 'send'), edge('send', 'done')],
      ),
      { capabilities, policyModes: modes },
    );
    expect(rated.passed).toBe(true);
    expect(rated.actions).toEqual([expect.objectContaining({ nodeId: 'send', capability: 'email.send', purpose: 'INFORMATION', actionClass: 'AUTONOMOUS' })]);
    expect(rated.plansClosingProof).toBe(true);
    expect(rated.endStates).toEqual(['COMPLETE']);
  });

  it('ein Plan, der nur zusammenfasst und an COMPLETE endet, wird beanstandet (kein Abschlussnachweis)', () => {
    const rated = rateShadowPlan(plan([node('sum', 'INTERPRET'), node('done', 'COMPLETE')], [edge('sum', 'done')]), { capabilities, policyModes: modes });
    expect(rated.passed).toBe(false);
    expect(rated.violations.map((v) => v.code)).toContain('COMPLETE_WITHOUT_CLOSING_PROOF');
  });

  it('ein Plan, der mit einem normalen Schritt endet („hört einfach auf“), wird beanstandet', () => {
    const rated = rateShadowPlan(plan([node('sum', 'INTERPRET'), node('prep', 'PREPARE', { capability: { key: 'communication.draft' }, config: { purpose: 'INFORMATION' } })], [edge('sum', 'prep')]), { capabilities, policyModes: modes });
    expect(rated.violations.map((v) => v.code)).toContain('NO_TERMINAL_END_STATE');
  });

  it('Übergabe (Mitarbeitende informieren + Aufgabe) ist ein zulässiger Endzustand ohne Abschlussnachweis', () => {
    const rated = rateShadowPlan(
      plan([node('notify', 'ACTION', { capability: { key: 'staff.notify' } }), node('human', 'MANUAL_TASK')], [edge('notify', 'human')]),
      { capabilities, policyModes: modes },
    );
    expect(rated.passed).toBe(true);
    expect(rated.plansHandover).toBe(true);
    expect(rated.endStates).toEqual(['MANUAL_TASK']);
  });

  it('eine geplante Zahlung (gesperrt) wird beanstandet – auch wenn eine Policy sie erlauben würde', () => {
    const fakeCapabilities = new Map(capabilities);
    fakeCapabilities.set('payment.run', { ...capabilities.get('email.send')!, key: 'payment.run', policyAction: 'payment.execute', policyActionByPurpose: undefined });
    const rated = rateShadowPlan(plan([node('pay', 'ACTION', { capability: { key: 'payment.run' } }), node('human', 'MANUAL_TASK')], [edge('pay', 'human')]), {
      capabilities: fakeCapabilities,
      policyModes: { 'payment.execute': 'AUTONOMOUS' },
    });
    expect(rated.violations.map((v) => v.code)).toContain('BLOCKED_ACTION_PLANNED');
  });

  it('dieselbe Wirkung doppelt geplant wird beanstandet', () => {
    const rated = rateShadowPlan(
      plan(
        [node('s1', 'ACTION', { capability: { key: 'email.send' }, config: { purpose: 'INFORMATION' } }), node('s2', 'ACTION', { capability: { key: 'email.send' }, config: { purpose: 'INFORMATION' } }), node('done', 'COMPLETE')],
        [edge('s1', 's2'), edge('s2', 'done')],
      ),
      { capabilities, policyModes: modes },
    );
    expect(rated.violations.map((v) => v.code)).toContain('DUPLICATE_EFFECT_PLANNED');
  });

  it('eine unbekannte Fähigkeit wird beanstandet, ein ungültiger Plan ebenso', () => {
    const rated = rateShadowPlan(plan([node('x', 'ACTION', { capability: { key: 'does.not_exist' } }), node('human', 'MANUAL_TASK')], [edge('x', 'human')]), { capabilities, policyModes: modes, planValid: false });
    expect(rated.violations.map((v) => v.code).sort()).toEqual(['PLAN_INVALID', 'UNKNOWN_CAPABILITY']);
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
