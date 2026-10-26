import { describe, expect, it } from 'vitest';
import { DEFAULT_CAPABILITIES } from './capability';
import { closeDeadEnds, isEffectCapability, isReplanPoint, planEffectKeys, planNeedsNewApproval, planNeedsWriteApproval, reduceToUnderstanding, runsBeforePlanApproval, stripBehindWait } from './plan-approval';
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

describe('Reduktion auf das Verstehen (Zielarbeit)', () => {
  it('behält verstehende und bereits ausgeführte Schritte, streicht den Rest und schließt mit einer Weiterplanen-Stelle ab', () => {
    const nodes = [node('ctx', 'RESOLVE_CONTEXT', 'context.lookup'), node('reqs', 'EVALUATE_REQUIREMENTS', 'requirements.resolve'), node('notify', 'ACTION', 'staff.notify'), node('human', 'MANUAL_TASK')];
    const edges = [
      { id: 'e1', source: 'ctx', target: 'reqs' },
      { id: 'e2', source: 'reqs', target: 'notify' },
      { id: 'e3', source: 'notify', target: 'human' },
    ];
    const reduced = reduceToUnderstanding({ ...plan(nodes), edges }, catalogue, new Set(['notify']))!;
    expect(reduced.nodes.map((n) => n.id)).toEqual(['ctx', 'reqs', 'notify', 'weiter_planen']);
    expect(reduced.nodes.at(-1)).toMatchObject({ type: 'REASSESS', config: { replan: true } });
    expect(reduced.edges.map((e) => `${e.source}>${e.target}`)).toEqual(['ctx>reqs', 'reqs>notify', 'reqs>weiter_planen']); // der ausgeführte Schritt bleibt als Verlauf stehen, die Revision endet an der Weiterplanen-Stelle
    expect(isReplanPoint(reduced.nodes.at(-1)!)).toBe(true);
    expect(isReplanPoint({ type: 'REASSESS', config: { replan: 'true' } })).toBe(true);
    expect(isReplanPoint({ type: 'REASSESS', config: {} })).toBe(false);
  });

  it('gibt es nichts zu verstehen, bleibt der Plan unverändert (undefined)', () => {
    expect(reduceToUnderstanding(plan([node('notify', 'ACTION', 'staff.notify'), node('human', 'MANUAL_TASK')]), catalogue, new Set())).toBeUndefined();
  });
});

describe('Nichts hinter dem Warten auf eine Antwort', () => {
  const wait = (): PlanNode => ({ ...node('wait', 'WAIT_EVENT'), config: { eventType: 'communication.received' } });
  it('schneidet ab, was hinter dem Warten auf eine Antwort geplant wurde – außer bereits Ausgeführtem', () => {
    const nodes = [node('ask', 'ACTION', 'email.send'), wait(), node('notify', 'ACTION', 'staff.notify'), node('human', 'MANUAL_TASK')];
    const edges = [
      { id: 'e1', source: 'ask', target: 'wait' },
      { id: 'e2', source: 'wait', target: 'notify' },
      { id: 'e3', source: 'notify', target: 'human' },
    ];
    const stripped = stripBehindWait({ ...plan(nodes), edges }, new Set())!;
    expect(stripped.nodes.map((n) => n.id)).toEqual(['ask', 'wait']);
    expect(stripped.edges.map((e) => e.id)).toEqual(['e1']);
    expect(stripBehindWait({ ...plan(nodes), edges }, new Set(['notify', 'human']))).toBeUndefined(); // nur Ausgeführtes dahinter
    expect(stripBehindWait(plan([node('ask', 'ACTION', 'email.send'), wait()]), new Set())).toBeUndefined(); // nichts dahinter
  });
});

describe('stripBehindWait mit erfülltem Warten', () => {
  it('schneidet hinter einem erfüllten Warten nichts ab', () => {
    const proposal = {
      goalKeys: ['human.review'],
      nodes: [
        { id: 'wait', type: 'WAIT_EVENT', title: 'w', inputs: {}, preconditions: [], optional: false, onFailure: 'REVIEW', config: { eventType: 'communication.received' }, evidenceRefs: [] },
        { id: 'human', type: 'MANUAL_TASK', title: 'h', inputs: {}, preconditions: [], optional: false, onFailure: 'REVIEW', config: {}, evidenceRefs: [] },
      ],
      edges: [{ id: 'e', source: 'wait', target: 'human' }],
      unresolvedRequirements: [],
      assumptions: [],
      conciseExplanation: 'x',
    } as unknown as Parameters<typeof stripBehindWait>[0];
    expect(stripBehindWait(proposal, new Set())?.nodes.map((n) => n.id)).toEqual(['wait']);
    expect(stripBehindWait(proposal, new Set(), new Set(['wait']))).toBeUndefined();
  });
});

describe('closeDeadEnds (Meilenstein C)', () => {
  const node = (id: string, type: string, extra: Record<string, unknown> = {}) => ({ id, type, title: id, inputs: {}, preconditions: [], optional: false, onFailure: 'REVIEW', config: {}, evidenceRefs: [], ...extra }) as never;
  const edge = (source: string, target: string) => ({ id: `e_${source}_${target}`, source, target });

  it('verbindet eine Sackgasse mit dem vorhandenen Abschlussknoten', () => {
    const proposal = { goalKeys: [], nodes: [node('a', 'INTERPRET'), node('notify', 'ACTION'), node('done', 'COMPLETE')], edges: [edge('a', 'notify')], unresolvedRequirements: [], assumptions: [], conciseExplanation: '' } as never;
    const closed = closeDeadEnds(proposal);
    expect(closed?.edges.map((e) => `${e.source}>${e.target}`)).toEqual(['a>notify', 'notify>done']);
  });

  it('legt bei Bedarf einen Abschlussknoten an; Wartestellen, Aufgaben und Weiterplanen bleiben unberührt', () => {
    const proposal = { goalKeys: [], nodes: [node('a', 'ACTION'), node('w', 'WAIT_EVENT'), node('m', 'MANUAL_TASK'), node('r', 'REASSESS', { config: { replan: true } })], edges: [edge('a', 'w')], unresolvedRequirements: [], assumptions: [], conciseExplanation: '' } as never;
    expect(closeDeadEnds(proposal)).toBeUndefined(); // Warten, Aufgabe und Weiterplanen sind gewollte Enden
    const withDead = closeDeadEnds({ ...(proposal as object), edges: [edge('a', 'w')], nodes: [node('a', 'ACTION'), node('n', 'ACTION'), node('w', 'WAIT_EVENT')] } as never);
    expect(withDead?.nodes.some((n) => n.type === 'COMPLETE')).toBe(true);
    expect(withDead?.edges.filter((e) => e.target === 'abschluss').map((e) => e.source)).toEqual(['n']);
  });

  it('ohne Sackgasse oder bei bereits ausgeführtem Schritt: nichts zu tun', () => {
    const proposal = { goalKeys: [], nodes: [node('a', 'ACTION'), node('done', 'COMPLETE')], edges: [edge('a', 'done')], unresolvedRequirements: [], assumptions: [], conciseExplanation: '' } as never;
    expect(closeDeadEnds(proposal)).toBeUndefined();
    const executed = { goalKeys: [], nodes: [node('a', 'ACTION'), node('done', 'COMPLETE')], edges: [], unresolvedRequirements: [], assumptions: [], conciseExplanation: '' } as never;
    expect(closeDeadEnds(executed, new Set(['a']))).toBeUndefined();
  });
});

describe('closeDeadEnds: Fortsetzungspunkt vor Abschluss (Meilenstein C)', () => {
  const node = (id: string, type: string, extra: Record<string, unknown> = {}) => ({ id, type, title: id, inputs: {}, preconditions: [], optional: false, onFailure: 'REVIEW', config: {}, evidenceRefs: [], ...extra }) as never;
  it('führt die Sackgasse zum vorgesehenen Weiterplanen, wenn der Plan eines hat', () => {
    const proposal = { goalKeys: [], nodes: [node('ctx', 'RESOLVE_CONTEXT'), node('reqs', 'EVALUATE_REQUIREMENTS'), node('reassess', 'REASSESS', { config: { replan: true } })], edges: [{ id: 'e1', source: 'ctx', target: 'reqs' }], unresolvedRequirements: [], assumptions: [], conciseExplanation: '' } as never;
    const closed = closeDeadEnds(proposal);
    expect(closed?.edges.map((e) => `${e.source}>${e.target}`)).toEqual(['ctx>reqs', 'reqs>reassess']);
    expect(closed?.nodes.some((n) => n.type === 'COMPLETE')).toBe(false);
  });
});
