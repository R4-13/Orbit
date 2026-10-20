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

  it('6: ein Schritt, der seine eigene Verfügbarkeit voraussetzt, ist für Betriebe ohne die Fähigkeit kein Fehler (er entfällt dort)', () => {
    const without = (ask: Record<string, unknown>) => {
      const plan = clarificationPlan();
      plan.nodes[2] = node('ask', 'ACTION', { capability: { key: 'email.send' }, config: { purpose: 'CLARIFICATION' }, inputs: { to: { fact: 'sender.email' }, draft: { stepOutput: { node: 'draft', path: 'draftId' } } }, ...ask });
      return validatePlan(plan, ctx({ executability: new Map([...executability, ['email.send', { executable: false, reasons: ['nicht angebunden'] }]]) }));
    };
    expect(codes(without({ preconditions: [{ capabilityAvailable: 'email.send' }] }))).not.toContain('CAPABILITY_NOT_EXECUTABLE');
    expect(codes(without({ preconditions: [{ all: [{ exists: { fact: 'sender.email' } }, { capabilityAvailable: 'email.send' }] }] }))).not.toContain('CAPABILITY_NOT_EXECUTABLE');
    // Eine Bedingung, die die Fähigkeit nicht zwingend verlangt, befreit nicht.
    expect(codes(without({ preconditions: [{ any: [{ capabilityAvailable: 'email.send' }, { exists: { fact: 'sender.email' } }] }] }))).toContain('CAPABILITY_NOT_EXECUTABLE');
    expect(codes(without({ preconditions: [{ capabilityAvailable: 'calendar.book' }] }))).toContain('CAPABILITY_NOT_EXECUTABLE');
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

  it('10: ein zeitgesteuertes Ereignis (time.reached) braucht einen gültigen Zeitpunkt in überschaubarer Zukunft, aber keine eigene Frist', () => {
    const timed = (until: unknown) => {
      const plan = clarificationPlan();
      plan.nodes[3] = node('wait', 'WAIT_EVENT', { config: { eventType: 'time.reached', ...(until === undefined ? {} : { until }) } });
      return codes(validatePlan(plan, ctx({ blueprint: undefined })));
    };
    const inOneHour = new Date(Date.now() + 3600_000).toISOString();
    expect(timed(inOneHour)).not.toContain('WAIT_WITHOUT_TIMEOUT');
    expect(timed(inOneHour)).not.toContain('WAIT_UNKNOWN_EVENT');
    expect(timed(inOneHour)).not.toContain('WAIT_TIME_INVALID');
    expect(timed(undefined)).toContain('WAIT_TIME_INVALID');
    expect(timed('morgen')).toContain('WAIT_TIME_INVALID');
    expect(timed(new Date(Date.now() + 200 * 24 * 3600_000).toISOString())).toContain('WAIT_TIME_TOO_FAR');
  });

  it('11: enforces step, external action and question limits', () => {
    expect(codes(validatePlan(clarificationPlan(), ctx({ limits: { maxSteps: 3, maxExternalActions: 4, maxAutoQuestions: 2 } })))).toContain('LIMIT_STEPS');
    expect(codes(validatePlan(clarificationPlan(), ctx({ limits: { maxSteps: 30, maxExternalActions: 0, maxAutoQuestions: 2 } })))).toContain('LIMIT_EXTERNAL_ACTIONS');
    expect(codes(validatePlan(clarificationPlan(), ctx({ limits: { maxSteps: 30, maxExternalActions: 4, maxAutoQuestions: 0 } })))).toContain('LIMIT_QUESTIONS');
  });

  it('eine Revision darf mit einer „Weiterplanen“-Stelle enden (REASSESS, replan) – ein gewöhnlicher REASSESS ohne Fortsetzung ist weiter eine Sackgasse', () => {
    const understanding = clarificationPlan({ nodes: [node('resolve', 'EVALUATE_REQUIREMENTS'), node('again', 'REASSESS', { config: { replan: true } })], edges: [edge('e1', 'resolve', 'again')] });
    expect(validatePlan(understanding, ctx()).valid).toBe(true);
    const plain = clarificationPlan({ nodes: [node('resolve', 'EVALUATE_REQUIREMENTS'), node('again', 'REASSESS')], edges: [edge('e1', 'resolve', 'again')] });
    expect(codes(validatePlan(plain, ctx()))).toEqual(expect.arrayContaining(['NO_TERMINAL', 'DEAD_END']));
  });

  it('der Entwurf einer Nachricht braucht seinen Zweck (config.purpose) – sonst scheitert er erst bei der Ausführung', () => {
    const plan = clarificationPlan();
    const draft = plan.nodes.find((n) => (n as { capability?: { key?: string } }).capability?.key === 'communication.draft') as { config?: Record<string, unknown> };
    draft.config = {};
    expect(codes(validatePlan(plan, ctx({ blueprint: undefined })))).toContain('PURPOSE_MISSING');
    draft.config = { purpose: 'NICHT_VORHANDEN' };
    expect(codes(validatePlan(plan, ctx({ blueprint: undefined })))).toContain('PURPOSE_MISSING');
    draft.config = { purpose: 'CLARIFICATION' };
    expect(codes(validatePlan(plan, ctx({ blueprint: undefined })))).not.toContain('PURPOSE_MISSING');
  });

  it('Zielarbeit: wer weiß, was nur die Kundschaft beantworten kann, übergibt nicht stumm – ohne Rückfrage ist der Plan unzulässig, mit Rückfrage (oder als reines Verstehen mit Weiterplanen) zulässig', () => {
    const base = { blueprint: undefined, strictBindings: true, knownFactKeys: new Set(['contact.email']), customerQuestionsOpen: 3 };
    const handover = clarificationPlan({ nodes: [node('notify', 'ACTION', { capability: { key: 'staff.notify' }, inputs: { message: { literal: 'Bitte prüfen.' } } }), node('human', 'MANUAL_TASK')], edges: [edge('e1', 'notify', 'human')] });
    expect(codes(validatePlan(handover, ctx(base)))).toContain('CLARIFICATION_EXPECTED');
    expect(codes(validatePlan(handover, ctx({ ...base, customerQuestionsOpen: 0 })))).not.toContain('CLARIFICATION_EXPECTED'); // nichts offen
    expect(codes(validatePlan(handover, ctx({ ...base, priorClarifications: 1 })))).not.toContain('CLARIFICATION_EXPECTED'); // schon gefragt
    const understanding = clarificationPlan({ nodes: [node('resolve', 'EVALUATE_REQUIREMENTS'), node('again', 'REASSESS', { config: { replan: true } })], edges: [edge('e1', 'resolve', 'again')] });
    expect(codes(validatePlan(understanding, ctx(base)))).not.toContain('CLARIFICATION_EXPECTED');
    expect(codes(validatePlan(clarificationPlan(), ctx(base)))).not.toContain('CLARIFICATION_EXPECTED'); // enthält eine Rückfrage
    expect(codes(validatePlan(handover, ctx({ ...base, blueprint })))).not.toContain('CLARIFICATION_EXPECTED'); // hinterlegter Prozess: dort regelt der Prozess die Rückfragen
  });

  it('Zielarbeit: wer die Anforderungsprüfung erst im Plan ausführt, plant danach weiter, statt vorher zu übergeben', () => {
    const base = { blueprint: undefined, strictBindings: true, knownFactKeys: new Set(['contact.email']), requirementsAnalyzed: false };
    const guess = clarificationPlan({ nodes: [node('resolve', 'EVALUATE_REQUIREMENTS', { capability: { key: 'requirements.resolve' } }), node('notify', 'ACTION', { capability: { key: 'staff.notify' }, inputs: { message: { literal: 'Bitte prüfen.' } } }), node('human', 'MANUAL_TASK')], edges: [edge('e1', 'resolve', 'notify'), edge('e2', 'notify', 'human')] });
    expect(codes(validatePlan(guess, ctx(base)))).toContain('REPLAN_AFTER_UNDERSTANDING');
    const understanding = clarificationPlan({ nodes: [node('resolve', 'EVALUATE_REQUIREMENTS', { capability: { key: 'requirements.resolve' } }), node('again', 'REASSESS', { config: { replan: true } })], edges: [edge('e1', 'resolve', 'again')] });
    expect(codes(validatePlan(understanding, ctx(base)))).not.toContain('REPLAN_AFTER_UNDERSTANDING');
    expect(codes(validatePlan(clarificationPlan(), ctx(base)))).not.toContain('REPLAN_AFTER_UNDERSTANDING'); // fragt bereits
    expect(codes(validatePlan(guess, ctx({ ...base, requirementsAnalyzed: true })))).not.toContain('REPLAN_AFTER_UNDERSTANDING'); // Ergebnis bekannt
  });

  it('ein bereits ausgeführter Schritt darf in einer Neuplanung ohne Fortsetzung stehen bleiben (Verlauf), ein neuer nicht', () => {
    const plan = clarificationPlan({ nodes: [node('notify', 'ACTION', { capability: { key: 'staff.notify' }, inputs: { message: { literal: 'Bitte prüfen.' } } }), node('again', 'REASSESS', { config: { replan: true } })], edges: [] });
    expect(codes(validatePlan(plan, ctx({ blueprint: undefined })))).toContain('DEAD_END');
    expect(codes(validatePlan(plan, ctx({ blueprint: undefined, confirmedEffects: [{ nodeId: 'notify', capability: 'staff.notify' }] })))).not.toContain('DEAD_END');
  });

  it('hinter dem Warten auf eine Antwort wird im freien Plan nichts geplant (die Antwort bestimmt, was folgt); ein hinterlegter Prozess darf es', () => {
    const behind = clarificationPlan();
    behind.nodes.push(node('after', 'MANUAL_TASK'));
    behind.edges.push(edge('e9', 'wait', 'after'));
    expect(codes(validatePlan(behind, ctx({ blueprint: undefined })))).toContain('PLAN_BEHIND_WAIT');
    expect(codes(validatePlan(behind, ctx()))).not.toContain('PLAN_BEHIND_WAIT');
    expect(codes(validatePlan(clarificationPlan(), ctx({ blueprint: undefined })))).not.toContain('PLAN_BEHIND_WAIT');
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

describe('strenge Bindungen für frei geplante Abläufe (Steckbriefe der Fähigkeiten)', () => {
  const strict = (over: Partial<PlanValidationContext> = {}) =>
    ctx({
      blueprint: undefined,
      strictBindings: true,
      knownFactKeys: new Set(['case.reference']),
      policyModes: new Map([
        ['context.lookup', 'AUTONOMOUS'],
        ['staff.notify', 'AUTONOMOUS'],
        ['email.draft', 'AUTONOMOUS'],
        ['email.send.acknowledgement', 'REQUIRE_APPROVAL'],
        ['knowledge.answer', 'AUTONOMOUS'],
        ['task.create', 'AUTONOMOUS'],
      ]),
      ...over,
    });
  const wait = node('wait', 'WAIT_EVENT', { config: { eventType: 'communication.received' }, timeout: { hours: 72 } });

  it('ein Plan nach Steckbrief ist zulässig', () => {
    const plan = {
      goalKeys: ['x'],
      nodes: [
        node('ctx', 'RESOLVE_CONTEXT', { capability: { key: 'context.lookup' } }),
        node('draft', 'PREPARE', { capability: { key: 'communication.draft' }, inputs: { to: { fact: 'contact.email' } }, config: { purpose: 'ACKNOWLEDGEMENT' } }),
        node('send', 'ACTION', { capability: { key: 'email.send' }, inputs: { draftId: { stepOutput: { node: 'draft', path: 'draftId' } } }, config: { purpose: 'ACKNOWLEDGEMENT' } }),
        node('notify', 'ACTION', { capability: { key: 'staff.notify' }, inputs: { message: { literal: 'Bitte prüfen' } } }),
        wait,
      ],
      edges: [edge('e1', 'ctx', 'draft'), edge('e2', 'draft', 'send'), edge('e3', 'send', 'notify'), edge('e4', 'notify', 'wait')],
      conciseExplanation: 'Bestätigen und melden.',
    };
    expect(codes(validatePlan(plan, strict()))).toEqual([]);
  });

  it('erfundene Eingaben, fehlende Pflichteingaben, unbekannte Quellen/Fakten und Ausgabefelder machen den Plan unzulässig', () => {
    const plan = {
      goalKeys: ['x'],
      nodes: [
        node('ctx', 'RESOLVE_CONTEXT', { capability: { key: 'context.lookup' }, inputs: { sender: { fact: 'sender' } } }),
        node('notify', 'ACTION', { capability: { key: 'staff.notify' }, inputs: { context: { stepOutput: { node: 'ctx', path: 'verifiedContext' } } } }),
        node('interpret', 'INTERPRET'),
        node('task', 'ACTION', { capability: { key: 'task.create' }, inputs: { title: { stepOutput: { node: 'interpret', path: 'summary' } }, assignee: { fact: 'staff.person' }, ref: { sourceRef: 'inbound.message' } } }),
        wait,
      ],
      edges: [edge('e1', 'ctx', 'notify'), edge('e2', 'notify', 'interpret'), edge('e3', 'interpret', 'task'), edge('e4', 'task', 'wait')],
      conciseExplanation: 'Erfunden.',
    };
    const found = codes(validatePlan(plan, strict()));
    expect(found).toEqual(expect.arrayContaining(['INPUT_UNKNOWN', 'INPUT_MISSING', 'STEP_OUTPUT_UNKNOWN', 'FACT_UNKNOWN', 'SOURCE_REF_UNKNOWN']));
  });

  it('Fähigkeiten nur für hinterlegte Prozesse sind in einem frei geplanten Ablauf unzulässig', () => {
    const plan = {
      goalKeys: ['x'],
      nodes: [node('price', 'PREPARE', { capability: { key: 'pricing.resolve' }, inputs: { sku: { literal: 'A' }, quantity: { literal: 1 } } }), wait],
      edges: [edge('e1', 'price', 'wait')],
      conciseExplanation: 'Preis.',
    };
    expect(codes(validatePlan(plan, strict()))).toContain('CAPABILITY_BLUEPRINT_ONLY');
  });

  it('Rückfragen werden je Vorgang gezählt, nicht je Plan: bereits gestellte zählen bei einer Neuplanung mit (frei geplant)', () => {
    const ask = (id: string) => [
      node(id + '_draft', 'PREPARE', { capability: { key: 'communication.draft' }, inputs: { to: { fact: 'contact.email' } }, config: { purpose: 'CLARIFICATION' } }),
      node(id + '_send', 'ACTION', { capability: { key: 'email.send' }, inputs: { draftId: { stepOutput: { node: id + '_draft', path: 'draftId' } } }, config: { purpose: 'CLARIFICATION' } }),
    ];
    const plan = { goalKeys: ['x'], nodes: [...ask('a'), wait], edges: [edge('e1', 'a_draft', 'a_send'), edge('e2', 'a_send', 'wait')], conciseExplanation: 'Eine Rückfrage.' };
    const base = { knownFactKeys: new Set(['contact.email']), limits: { maxSteps: 30, maxExternalActions: 4, maxAutoQuestions: 3 } };
    expect(codes(validatePlan(plan, strict({ ...base, priorClarifications: 0 })))).not.toContain('LIMIT_QUESTIONS');
    expect(codes(validatePlan(plan, strict({ ...base, priorClarifications: 2 })))).not.toContain('LIMIT_QUESTIONS');
    expect(codes(validatePlan(plan, strict({ ...base, priorClarifications: 3 })))).toContain('LIMIT_QUESTIONS');
  });

  it('Planvertrag (FA-09): eine Revision darf die Ziele der ersten Planung ergänzen, aber nicht streichen oder durch leichtere ersetzen', () => {
    const revision = (goalKeys: string[]) => ({
      goalKeys,
      nodes: [node('notify', 'ACTION', { capability: { key: 'staff.notify' }, inputs: { message: { literal: 'Bitte prüfen' } } }), wait],
      edges: [edge('e1', 'notify', 'wait')],
      conciseExplanation: 'Revision.',
    });
    const contract = { contractGoalKeys: ['inquiry.answered'] };
    expect(codes(validatePlan(revision(['staff.informed']), strict(contract)))).toContain('GOAL_CONTRACT_VIOLATION');
    expect(codes(validatePlan(revision(['inquiry.answered']), strict(contract)))).not.toContain('GOAL_CONTRACT_VIOLATION');
    expect(codes(validatePlan(revision(['inquiry.answered', 'staff.informed']), strict(contract)))).not.toContain('GOAL_CONTRACT_VIOLATION');
    // Die erste Planung hat keinen Vertrag; ein hinterlegter Prozess ebenfalls nicht.
    expect(codes(validatePlan(revision(['staff.informed']), strict()))).not.toContain('GOAL_CONTRACT_VIOLATION');
  });

  it('ohne strenge Bindung (hinterlegter Prozess) bleibt das Verhalten unverändert', () => {
    expect(validatePlan(clarificationPlan(), ctx()).valid).toBe(true);
  });
});

describe('veraltete Ergebnisse nach einer Antwort (Live-Fund: zweite Rückfrage fragte erneut nach der genannten Adresse)', () => {
  const freeCtx = (over: Partial<PlanValidationContext> = {}) => ctx({ blueprint: undefined, strictBindings: true, policyModes: new Map([['requirements.resolve', 'AUTONOMOUS'], ['email.draft', 'AUTONOMOUS'], ['email.send.clarification', 'AUTONOMOUS']]), ...over });
  const plan = (reqsId: string) => ({
    goalKeys: ['human.review'],
    nodes: [
      node('reqs', 'EVALUATE_REQUIREMENTS', { capability: { key: 'requirements.resolve' } }),
      ...(reqsId === 'reqs' ? [] : [node(reqsId, 'EVALUATE_REQUIREMENTS', { capability: { key: 'requirements.resolve' } })]),
      node('draft', 'PREPARE', { capability: { key: 'communication.draft' }, inputs: { to: { fact: 'sender.email' }, missing: { stepOutput: { node: reqsId, path: 'missing' } } }, config: { purpose: 'CLARIFICATION' } }),
      node('wait', 'WAIT_EVENT', { config: { eventType: 'communication.received' }, timeout: { hours: 72 } }),
    ],
    edges: reqsId === 'reqs' ? [edge('e1', 'reqs', 'draft'), edge('e2', 'draft', 'wait')] : [edge('e0', 'reqs', reqsId), edge('e1', reqsId, 'draft'), edge('e2', 'draft', 'wait')],
    conciseExplanation: 'Neu prüfen und gezielt nachfragen.',
  });

  it('ein Entwurf, der das Ergebnis eines vor der Antwort ausgeführten Prüfknotens liest, wird abgewiesen – ein neuer Prüfknoten ist zulässig', () => {
    expect(codes(validatePlan(plan('reqs'), freeCtx({ staleStepNodes: ['reqs'] })))).toContain('STALE_STEP_OUTPUT');
    expect(codes(validatePlan(plan('reqs_2'), freeCtx({ staleStepNodes: ['reqs'] })))).not.toContain('STALE_STEP_OUTPUT');
    expect(codes(validatePlan(plan('reqs'), freeCtx()))).not.toContain('STALE_STEP_OUTPUT'); // ohne Antwort ist nichts veraltet
  });

  it('der Verweis auf einen unbekannten Knoten nennt die vorhandenen Knoten', () => {
    const result = validatePlan({ ...plan('reqs'), nodes: plan('reqs').nodes.map((n) => (n.id === 'draft' ? { ...n, inputs: { to: { fact: 'sender.email' }, missing: { stepOutput: { node: 'requirement', path: 'missing' } } } } : n)) }, freeCtx());
    expect(result.issues.find((i) => i.code === 'BINDING_UNKNOWN_NODE')?.message).toMatch(/Vorhandene Knoten: reqs, draft, wait/);
  });
});
