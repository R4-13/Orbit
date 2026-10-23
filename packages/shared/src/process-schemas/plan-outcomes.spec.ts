import { describe, expect, it } from 'vitest';
import { DEFAULT_CAPABILITIES } from './capability';
import { validatePlan, type PlanValidationContext } from './plan-validator';

/**
 * Zielabdeckung (Funktionsnachweis 23.10.): Ein Anliegen der Kundschaft darf nicht durch ein leichteres Ziel ersetzt werden. Beispiel Schlüsselbund: „Bitte sagen Sie dem Monteur Bescheid“ ist erst erfüllt,
 * wenn der Monteur Bescheid weiß – die Meldung an das Büro erreicht das nur über eine dokumentierte Weitergabe.
 */
const capabilities = new Map(DEFAULT_CAPABILITIES.map((c) => [c.key, c]));
const executability = new Map(DEFAULT_CAPABILITIES.map((c) => [c.key, { executable: true, reasons: [] as string[] }]));

const ctx = (over: Partial<PlanValidationContext> = {}): PlanValidationContext => ({
  capabilities,
  executability,
  knownFactKeys: new Set(['sender.email']),
  collectableFactKeys: new Set(),
  policyModes: new Map([
    ['email.draft', 'AUTONOMOUS'],
    ['email.send.acknowledgement', 'AUTONOMOUS'],
    ['staff.notify', 'AUTONOMOUS'],
  ]),
  limits: { maxSteps: 30, maxExternalActions: 6, maxAutoQuestions: 2 },
  requireRequestedOutcomes: true,
  ...over,
});

const node = (id: string, type: string, extra: Record<string, unknown> = {}) => ({ id, type, title: id, ...extra });
const edge = (id: string, source: string, target: string) => ({ id, source, target });

const ack = [
  node('ack_draft', 'PREPARE', { capability: { key: 'communication.draft' }, inputs: { to: { fact: 'sender.email' } } }),
  node('ack', 'ACTION', { capability: { key: 'email.send' }, config: { purpose: 'ACKNOWLEDGEMENT' }, inputs: { to: { fact: 'sender.email' }, draft: { stepOutput: { node: 'ack_draft', path: 'draftId' } } } }),
];

function plan(over: Record<string, unknown>) {
  return {
    goalKeys: ['receipt.acknowledged', 'staff.informed'],
    nodes: [...ack, node('notify', 'ACTION', { capability: { key: 'staff.notify' }, inputs: { message: { literal: 'Schlüsselbund liegt bei uns.' } } })],
    edges: [edge('e1', 'ack_draft', 'ack'), edge('e2', 'ack', 'notify')],
    conciseExplanation: 'Eingang bestätigen und melden.',
    ...over,
  };
}
const codes = (p: unknown, c = ctx()) => validatePlan(p, c).issues.filter((i) => i.severity === 'ERROR').map((i) => i.code);

describe('Zielabdeckung (requestedOutcomes)', () => {
  const ackOutcome = { text: 'Eingang bestätigen', goalKey: 'receipt.acknowledged' };

  it('ein Plan ohne Anliegenliste wird abgewiesen', () => {
    expect(codes(plan({}))).toContain('OUTCOMES_MISSING');
  });

  it('gilt nur, wenn verlangt (feste Verfahren und Blueprint-Instanzen kennen keine Anliegenliste)', () => {
    expect(codes(plan({}), ctx({ requireRequestedOutcomes: false }))).not.toContain('OUTCOMES_MISSING');
  });

  it('die Revision, die nur das Verstehen plant, braucht noch keine Anliegenliste', () => {
    const understanding = plan({ nodes: [node('again', 'REASSESS', { config: { replan: true } })], edges: [] });
    expect(codes(understanding)).not.toContain('OUTCOMES_MISSING');
  });

  it('Schlüsselbund ohne dokumentierte Weitergabe: „Monteur informieren“ über das Büro erfüllt das Anliegen NICHT', () => {
    const p = plan({ requestedOutcomes: [ackOutcome, { text: 'Der Monteur soll Bescheid wissen und den Schlüsselbund abholen', goalKey: 'staff.informed', intermediary: true }] });
    expect(codes(p, ctx({ dispatchAvailable: false }))).toContain('OUTCOME_INTERMEDIARY_UNDOCUMENTED');
  });

  it('mit dokumentierter Weitergabe (Zuständigkeit DISPATCH) gilt die Meldung an die dafür zuständige Person als Weg zum Ziel – aber nur, wenn sie ausdrücklich dorthin geht', () => {
    const outcomes = [ackOutcome, { text: 'Der Monteur soll Bescheid wissen und den Schlüsselbund abholen', goalKey: 'staff.informed', intermediary: true }];
    expect(codes(plan({ requestedOutcomes: outcomes }), ctx({ dispatchAvailable: true }))).toContain('OUTCOME_RELAY_MISSING'); // Meldung an die allgemein Zuständigen erreicht den Monteur nicht
    const relayed = plan({
      requestedOutcomes: outcomes,
      nodes: [...ack, node('notify', 'ACTION', { capability: { key: 'staff.notify' }, inputs: { message: { literal: 'Schlüsselbund liegt bei uns.' }, relayTo: { literal: 'DISPATCH' } } })],
    });
    expect(codes(relayed, ctx({ dispatchAvailable: true })).filter((c) => c.startsWith('OUTCOME'))).toEqual([]);
  });

  it('Übergabe mit Restziel: human.review unter den Zielen; die Aufgabe für die Person legt der Abschluss an', () => {
    const handover = { text: 'Der Monteur soll Bescheid wissen und den Schlüsselbund abholen', handover: true };
    const noTask = plan({ goalKeys: ['receipt.acknowledged', 'human.review'], requestedOutcomes: [ackOutcome, handover] });
    expect(codes(noTask).filter((c) => c.startsWith('OUTCOME'))).toEqual([]);
    const noGoal = plan({ requestedOutcomes: [ackOutcome, handover], nodes: [...plan({}).nodes, node('task', 'MANUAL_TASK', { purpose: 'Monteur informieren: Schlüsselbund abholen' })], edges: [edge('e1', 'ack_draft', 'ack'), edge('e2', 'ack', 'notify'), edge('e3', 'notify', 'task')] });
    expect(codes(noGoal)).toContain('OUTCOME_HANDOVER_NEEDS_GOAL');
    const good = plan({
      goalKeys: ['receipt.acknowledged', 'human.review'],
      requestedOutcomes: [ackOutcome, handover],
      nodes: [...ack, node('task', 'MANUAL_TASK', { title: 'Monteur informieren', purpose: 'Restziel: Monteur über den Schlüsselbund informieren, damit er ihn abholt.' })],
      edges: [edge('e1', 'ack_draft', 'ack'), edge('e2', 'ack', 'task')],
    });
    expect(codes(good).filter((c) => c.startsWith('OUTCOME'))).toEqual([]);
  });

  it('jedes Anliegen braucht ein Ziel oder eine Übergabe; das Ziel muss im Katalog stehen, bei den Zielen des Plans und darf kein Personenziel sein', () => {
    expect(codes(plan({ requestedOutcomes: [{ text: 'Irgendetwas' }] }))).toContain('OUTCOME_UNCOVERED');
    expect(codes(plan({ requestedOutcomes: [{ text: 'X', goalKey: 'gibt.es.nicht' }] }))).toContain('OUTCOME_UNKNOWN_GOAL');
    expect(codes(plan({ requestedOutcomes: [{ text: 'Termin buchen', goalKey: 'appointment.booked' }] }))).toContain('OUTCOME_GOAL_NOT_PLANNED');
    expect(codes(plan({ requestedOutcomes: [{ text: 'Notfall', goalKey: 'emergency.handled' }] }))).toContain('OUTCOME_HUMAN_GOAL_AS_COVERAGE');
  });
});

describe('Zielabdeckung: Netz gegen ein falsch gekennzeichnetes Anliegen', () => {
  const ack = { text: 'Eingang bestätigen', goalKey: 'receipt.acknowledged' };
  it.each([
    'Der Monteur soll Bescheid wissen',
    'Bitte dem Techniker Bescheid geben, dass der Schlüsselbund hier liegt',
    'Unser Handwerker möchte den Schlüssel abholen – bitte informieren Sie ihn',
    'Außendienst informieren',
  ])('„%s“ als staff.informed ohne Kennzeichnung „Zwischenperson“ wird trotzdem nicht als erreicht gewertet', (text) => {
    const outcomes = [ack, { text, goalKey: 'staff.informed' }];
    const nodes = [...plan({}).nodes];
    expect(codes(plan({ requestedOutcomes: outcomes, nodes }), ctx({ dispatchAvailable: false }))).toContain('OUTCOME_INTERMEDIARY_UNDOCUMENTED');
  });

  it('eine allgemeine Meldung an die zuständige Person bleibt ein erreichbares Ziel', () => {
    const outcomes = [ack, { text: 'Die zuständige Person soll sich den Vorgang ansehen', goalKey: 'staff.informed' }];
    expect(codes(plan({ requestedOutcomes: outcomes }), ctx({ dispatchAvailable: false })).filter((c) => c.startsWith('OUTCOME'))).toEqual([]);
  });
});

describe('Rückfrage wird abgewartet (Funktionsnachweis 23.10., Ablauf B2)', () => {
  const ask = [
    node('resolve', 'EVALUATE_REQUIREMENTS', { capability: { key: 'requirements.resolve' } }),
    node('q_draft', 'PREPARE', { capability: { key: 'communication.draft' }, config: { purpose: 'CLARIFICATION' }, inputs: { to: { fact: 'sender.email' }, missing: { stepOutput: { node: 'resolve', path: 'missing' } } } }),
    node('q_send', 'ACTION', { capability: { key: 'email.send' }, config: { purpose: 'CLARIFICATION' }, inputs: { to: { fact: 'sender.email' }, draft: { stepOutput: { node: 'q_draft', path: 'draftId' } } } }),
  ];
  const base = { goalKeys: ['inquiry.answered'], conciseExplanation: 'Rückfrage.' };
  const askEdges = [edge('e1', 'resolve', 'q_draft'), edge('e2', 'q_draft', 'q_send')];
  const noOutcomes = ctx({ requireRequestedOutcomes: false });
  const wait = node('wait', 'WAIT_EVENT', { config: { eventType: 'communication.received' }, timeout: { hours: 72 } });

  it('Rückfrage, dann Aufgabe für eine Person ohne Warten: die Antwort ginge verloren', () => {
    const p = { ...base, nodes: [...ask, node('task', 'MANUAL_TASK', { title: 'Angebot nach Eingang der Angaben prüfen', purpose: 'Angebot prüfen' })], edges: [...askEdges, edge('e3', 'q_send', 'task')] };
    expect(codes(p, noOutcomes)).toContain('CLARIFICATION_NOT_AWAITED');
  });

  it('Rückfrage, Meldung, Aufgabe – mit Warten daneben: die Aufgabe käme vor der Antwort', () => {
    const p = {
      ...base,
      nodes: [...ask, wait, node('notify', 'ACTION', { capability: { key: 'staff.notify' }, inputs: { message: { literal: 'Rückfrage gesendet.' } } }), node('task', 'MANUAL_TASK', { title: 'Prüfen', purpose: 'Prüfen' })],
      edges: [...askEdges, edge('e3', 'q_send', 'wait'), edge('e4', 'q_send', 'notify'), edge('e5', 'notify', 'task')],
    };
    expect(codes(p, noOutcomes)).toContain('CLARIFICATION_NOT_AWAITED');
  });

  it('Rückfrage, dann Warten als letzter Schritt: gültig', () => {
    const p = { ...base, nodes: [...ask, wait], edges: [...askEdges, edge('e3', 'q_send', 'wait')] };
    expect(codes(p, noOutcomes)).not.toContain('CLARIFICATION_NOT_AWAITED');
  });
});

describe('Ziel ohne erzeugenden Schritt (Funktionsnachweis 23.10., Musterwerk B2)', () => {
  it('„Angebot zugestellt“ ohne Schritt, der ein Angebot zustellt, wird abgewiesen – das Anliegen gehört in eine Übergabe', () => {
    const p = { goalKeys: ['receipt.acknowledged', 'quote.delivered'], nodes: [...ack], edges: [edge('e1', 'ack_draft', 'ack')], conciseExplanation: 'Eingang bestätigen und Angebot.', requestedOutcomes: [{ text: 'Eingang bestätigen', goalKey: 'receipt.acknowledged' }, { text: 'Ein Angebot erhalten', goalKey: 'quote.delivered' }] };
    expect(codes(p)).toContain('OUTCOME_GOAL_UNREACHABLE');
  });

  it('erreichbare Ziele bleiben zulässig; bereits bestätigte Wirkungen zählen', () => {
    const p = { goalKeys: ['receipt.acknowledged'], nodes: [...ack], edges: [edge('e1', 'ack_draft', 'ack')], conciseExplanation: 'Eingang bestätigen.', requestedOutcomes: [{ text: 'Eingang bestätigen', goalKey: 'receipt.acknowledged' }] };
    expect(codes(p).filter((c) => c.startsWith('OUTCOME'))).toEqual([]);
    const later = { goalKeys: ['receipt.acknowledged'], nodes: [node('wait', 'WAIT_EVENT', { config: { eventType: 'communication.received' }, timeout: { hours: 72 } })], edges: [], conciseExplanation: 'Warten.', requestedOutcomes: [{ text: 'Eingang bestätigen', goalKey: 'receipt.acknowledged' }] };
    expect(codes(later, ctx({ confirmedEffects: [{ nodeId: 'ack', capability: 'email.send', purpose: 'ACKNOWLEDGEMENT' }] })).filter((c) => c.startsWith('OUTCOME'))).toEqual([]);
  });
});
