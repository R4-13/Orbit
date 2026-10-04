import { describe, expect, it } from 'vitest';
import { BlueprintDefinitionSchema } from './blueprint';
import { DEFAULT_CAPABILITIES } from './capability';
import { validatePlan, type PlanValidationContext } from './plan-validator';

const capabilities = new Map(DEFAULT_CAPABILITIES.map((c) => [c.key, c]));
const executability = new Map(DEFAULT_CAPABILITIES.map((c) => [c.key, { executable: true, reasons: [] as string[] }]));

const blueprint = BlueprintDefinitionSchema.parse({
  schemaVersion: '1.0',
  key: 'REQUEST_FOR_QUOTE',
  version: '1.0.0',
  title: 'Angebotsanfrage',
  goals: ['quote.delivered'],
  triggers: [{ type: 'communication.received' }],
  allowedCapabilities: ['requirements.resolve', 'communication.draft', 'email.send', 'pricing.resolve', 'quote.create'],
  planMode: 'CONSTRAINED_ADAPTIVE',
  waitRules: [{ eventType: 'communication.received', correlation: 'SAME_CASE', timeoutPolicyRef: 'default-wait' }],
  completionCriteria: { receiptConfirmed: { purpose: 'QUOTE_DELIVERY' } },
});

const ctx = (over: Partial<PlanValidationContext> = {}): PlanValidationContext => ({
  blueprint,
  capabilities,
  executability,
  knownFactKeys: new Set(['sender.email']),
  collectableFactKeys: new Set(['request.quantity']),
  policyModes: new Map([
    ['requirements.resolve', 'AUTONOMOUS'],
    ['email.draft', 'AUTONOMOUS'],
    ['email.send.clarification', 'REQUIRE_APPROVAL'],
    ['email.send.quote_delivery', 'REQUIRE_APPROVAL'],
    ['pricing.resolve', 'AUTONOMOUS'],
    ['quote.create', 'AUTONOMOUS'],
  ]),
  limits: { maxSteps: 30, maxExternalActions: 4, maxAutoQuestions: 2 },
  ...over,
});

const node = (id: string, type: string, extra: Record<string, unknown> = {}) => ({ id, type, title: id, ...extra });
const edge = (id: string, source: string, target: string) => ({ id, source, target });

/** A valid clarification plan: resolve → draft → send(clarification) → wait → end of this revision. */
function clarificationPlan(over: Record<string, unknown> = {}) {
  return {
    goalKeys: ['quote.delivered'],
    nodes: [
      node('resolve', 'EVALUATE_REQUIREMENTS', { capability: { key: 'requirements.resolve' } }),
      node('draft', 'PREPARE', { capability: { key: 'communication.draft' }, inputs: { to: { fact: 'sender.email' } } }),
      node('ask', 'ACTION', { capability: { key: 'email.send' }, config: { purpose: 'CLARIFICATION' }, inputs: { to: { fact: 'sender.email' }, draft: { stepOutput: { node: 'draft', path: 'draftId' } } } }),
      node('wait', 'WAIT_EVENT', { config: { eventType: 'communication.received' }, timeout: { hours: 72 } }),
    ],
    edges: [edge('e1', 'resolve', 'draft'), edge('e2', 'draft', 'ask'), edge('e3', 'ask', 'wait')],
    conciseExplanation: 'Fehlende Angaben per Rückfrage klären.',
    ...over,
  };
}

const codes = (result: ReturnType<typeof validatePlan>) => result.issues.filter((i) => i.severity === 'ERROR').map((i) => i.code);

describe('validatePlan (§11.3)', () => {
  it('accepts a valid plan that ends its revision in a wait', () => {
    const result = validatePlan(clarificationPlan(), ctx());
    expect(codes(result)).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.stats).toMatchObject({ nodes: 4, externalActions: 1, clarifications: 1 });
  });

  it('1: rejects unknown node types, extra keys and unknown operators', () => {
    expect(validatePlan(clarificationPlan({ nodes: [node('x', 'RUN_SHELL')] }), ctx()).valid).toBe(false);
    expect(validatePlan({ ...clarificationPlan(), tenantId: 'other' }, ctx()).valid).toBe(false);
    const withBadCondition = clarificationPlan({ edges: [{ ...edge('e1', 'resolve', 'draft'), condition: { javascript: '1' } }, edge('e2', 'draft', 'ask'), edge('e3', 'ask', 'wait')] });
    expect(codes(validatePlan(withBadCondition, ctx()))).toContain('SCHEMA_INVALID');
  });

  it('1: rejects duplicate node ids', () => {
    const plan = clarificationPlan();
    plan.nodes.push(node('draft', 'PREPARE'));
    expect(codes(validatePlan(plan, ctx()))).toContain('DUPLICATE_NODE_ID');
  });

  it('2: rejects invented capabilities and capabilities outside the blueprint', () => {
    const invented = clarificationPlan();
    invented.nodes[0] = node('resolve', 'EVALUATE_REQUIREMENTS', { capability: { key: 'payment.execute' } });
    expect(codes(validatePlan(invented, ctx()))).toContain('CAPABILITY_UNKNOWN');
    const outside = clarificationPlan();
    outside.nodes[0] = node('resolve', 'EVALUATE_REQUIREMENTS', { capability: { key: 'task.create' } });
    expect(codes(validatePlan(outside, ctx()))).toContain('CAPABILITY_NOT_ALLOWED');
    expect(codes(validatePlan(clarificationPlan({ goalKeys: ['world.domination'] }), ctx()))).toContain('GOAL_NOT_IN_BLUEPRINT');
  });

  it('3/4: rejects dangling edges, cycles, unreachable nodes, dead ends and missing upstream bindings', () => {
    expect(codes(validatePlan(clarificationPlan({ edges: [edge('e1', 'resolve', 'ghost')] }), ctx()))).toContain('EDGE_DANGLING');
    const cyclic = clarificationPlan({ edges: [edge('e1', 'resolve', 'draft'), edge('e2', 'draft', 'ask'), edge('e3', 'ask', 'draft')] });
    expect(codes(validatePlan(cyclic, ctx()))).toContain('CYCLE');
    const deadEnd = clarificationPlan({ edges: [edge('e1', 'resolve', 'draft'), edge('e3', 'ask', 'wait')] });
    const deadEndCodes = codes(validatePlan(deadEnd, ctx()));
    expect(deadEndCodes).toContain('DEAD_END');
    const downstream = clarificationPlan();
    downstream.nodes[1] = node('draft', 'PREPARE', { capability: { key: 'communication.draft' }, inputs: { x: { stepOutput: { node: 'ask', path: 'id' } } } });
    expect(codes(validatePlan(downstream, ctx()))).toContain('BINDING_NOT_UPSTREAM');
  });

  it('5: an external write bound to an unknown fact is an error, a read only a warning', () => {
    const plan = clarificationPlan();
    plan.nodes[2] = node('ask', 'ACTION', { capability: { key: 'email.send' }, config: { purpose: 'CLARIFICATION' }, inputs: { to: { fact: 'made.up' } } });
    expect(codes(validatePlan(plan, ctx()))).toContain('BINDING_UNKNOWN_FACT');
    const read = clarificationPlan();
    read.nodes[0] = node('resolve', 'EVALUATE_REQUIREMENTS', { capability: { key: 'requirements.resolve' }, inputs: { q: { fact: 'made.up' } } });
    const result = validatePlan(read, ctx());
    expect(result.valid).toBe(true);
    expect(result.issues.some((i) => i.code === 'BINDING_UNKNOWN_FACT' && i.severity === 'WARNING')).toBe(true);
  });

  it('6: reports non-executable capabilities, missing purpose and disabled policies', () => {
    const notExecutable = ctx({ executability: new Map([...executability, ['email.send', { executable: false, reasons: ['Keine Gmail-Verbindung mit Sendeberechtigung'] }]]) });
    const result = validatePlan(clarificationPlan(), notExecutable);
    expect(codes(result)).toContain('CAPABILITY_NOT_EXECUTABLE');
    expect(result.issues.find((i) => i.code === 'CAPABILITY_NOT_EXECUTABLE')?.message).toContain('Gmail');

    const noPurpose = clarificationPlan();
    noPurpose.nodes[2] = node('ask', 'ACTION', { capability: { key: 'email.send' }, inputs: { to: { fact: 'sender.email' } } });
    expect(codes(validatePlan(noPurpose, ctx()))).toContain('PURPOSE_MISSING');

    const disabled = ctx({ policyModes: new Map([['email.send.clarification', 'DISABLED']]) });
    expect(codes(validatePlan(clarificationPlan(), disabled))).toContain('POLICY_DISABLED');
  });

  it('7: rejects literal recipients, prices and identities supplied by the plan', () => {
    const plan = clarificationPlan();
    plan.nodes[2] = node('ask', 'ACTION', { capability: { key: 'email.send' }, config: { purpose: 'CLARIFICATION' }, inputs: { to: { literal: 'attacker@evil.example' } } });
    expect(codes(validatePlan(plan, ctx()))).toContain('INVENTED_PARAMETER');
    const price = clarificationPlan();
    price.nodes[1] = node('draft', 'PREPARE', { capability: { key: 'communication.draft' }, inputs: { unit_price: { literal: 1 } }, config: { amount: '99' } });
    const priceCodes = validatePlan(price, ctx()).issues.filter((i) => i.code === 'INVENTED_PARAMETER');
    expect(priceCodes.length).toBe(2);
  });

  it('9: a replan must keep confirmed effects and must not repeat them', () => {
    const confirmed = [{ nodeId: 'ask', capability: 'email.send', purpose: 'CLARIFICATION' }];
    expect(codes(validatePlan(clarificationPlan(), ctx({ confirmedEffects: confirmed })))).toEqual([]);

    const dropped = clarificationPlan();
    dropped.nodes = dropped.nodes.filter((n) => n.id !== 'ask');
    dropped.edges = [edge('e1', 'resolve', 'draft'), edge('e2', 'draft', 'wait')];
    expect(codes(validatePlan(dropped, ctx({ confirmedEffects: confirmed })))).toContain('REPLAN_DROPS_CONFIRMED_EFFECT');

    const repeated = clarificationPlan();
    repeated.nodes.push(node('ask2', 'ACTION', { capability: { key: 'email.send' }, config: { purpose: 'CLARIFICATION' }, inputs: { to: { fact: 'sender.email' } } }));
    repeated.edges.push(edge('e4', 'resolve', 'ask2'));
    expect(codes(validatePlan(repeated, ctx({ confirmedEffects: confirmed })))).toContain('REPLAN_REPEATS_CONFIRMED_EFFECT');
  });

  it('10: a wait needs a known event and a deadline (own or blueprint rule)', () => {
    const noTimeout = clarificationPlan();
    noTimeout.nodes[3] = node('wait', 'WAIT_EVENT', { config: { eventType: 'communication.received' } });
    // The blueprint's wait rule carries a timeout policy, so this is accepted ...
    expect(codes(validatePlan(noTimeout, ctx()))).not.toContain('WAIT_WITHOUT_TIMEOUT');
    // ... but an ad-hoc plan without blueprint must bring its own deadline.
    expect(codes(validatePlan(noTimeout, ctx({ blueprint: undefined })))).toContain('WAIT_WITHOUT_TIMEOUT');
    const unknownEvent = clarificationPlan();
    unknownEvent.nodes[3] = node('wait', 'WAIT_EVENT', { config: { eventType: 'cron.tick' }, timeout: { hours: 1 } });
    expect(codes(validatePlan(unknownEvent, ctx()))).toContain('WAIT_UNKNOWN_EVENT');
  });

  it('11: enforces step, external action and question limits', () => {
    expect(codes(validatePlan(clarificationPlan(), ctx({ limits: { maxSteps: 3, maxExternalActions: 4, maxAutoQuestions: 2 } })))).toContain('LIMIT_STEPS');
    expect(codes(validatePlan(clarificationPlan(), ctx({ limits: { maxSteps: 30, maxExternalActions: 0, maxAutoQuestions: 2 } })))).toContain('LIMIT_EXTERNAL_ACTIONS');
    expect(codes(validatePlan(clarificationPlan(), ctx({ limits: { maxSteps: 30, maxExternalActions: 4, maxAutoQuestions: 0 } })))).toContain('LIMIT_QUESTIONS');
  });

  it('a complete plan with a terminal node is valid, and a plan without one is not', () => {
    const complete = clarificationPlan();
    complete.nodes.push(node('done', 'COMPLETE'));
    complete.edges.push(edge('e4', 'wait', 'done'));
    expect(validatePlan(complete, ctx()).valid).toBe(true);
    const noTerminalAndNoWait = clarificationPlan({ nodes: [node('resolve', 'EVALUATE_REQUIREMENTS'), node('draft', 'PREPARE')], edges: [edge('e1', 'resolve', 'draft')] });
    expect(codes(validatePlan(noTerminalAndNoWait, ctx()))).toContain('NO_TERMINAL');
  });
});
