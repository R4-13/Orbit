import type { PlanNode } from '@orbit/shared';
import { PlannerService } from './planner.service';

type Proposal = { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> };
const carry = (output: Proposal, originals: PlanNode[]): Proposal =>
  (PlannerService.prototype as unknown as { carryForwardConfirmed(o: unknown, originals: PlanNode[]): Proposal }).carryForwardConfirmed.call({}, output, originals);

const node = (id: string, type: string, extra: Record<string, unknown> = {}) => ({ id, type, title: id, inputs: {}, preconditions: [], optional: false, onFailure: 'REVIEW', config: {}, evidenceRefs: [], ...extra });
const edge = (id: string, source: string, target: string) => ({ id, source, target });

/** Funktionsnachweis 23.10.: Neuplanungen scheiterten wiederholt daran, dass das Modell bestätigte Schritte nicht fehlerfrei wiederholte. ORBIT übernimmt sie selbst. */
describe('Bestätigte Schritte werden vom Planer-Dienst übernommen', () => {
  const askSend = node('send_question', 'ACTION', { capability: { key: 'email.send' }, config: { purpose: 'CLARIFICATION' } }) as unknown as PlanNode;
  const askDraft = node('ask_draft', 'PREPARE', { capability: { key: 'communication.draft' }, config: { purpose: 'CLARIFICATION' } }) as unknown as PlanNode;

  it('fehlende bestätigte Schritte werden aus dem Verlauf ergänzt, abweichende durch das Original ersetzt', () => {
    const out = carry({ nodes: [node('send_question', 'ACTION', { capability: { key: 'email.send' }, config: { purpose: 'ACKNOWLEDGEMENT' } }), node('wait', 'WAIT_EVENT')], edges: [edge('e1', 'send_question', 'wait')] }, [askSend, askDraft]);
    expect(out.nodes.find((n) => n.id === 'send_question')).toMatchObject({ config: { purpose: 'CLARIFICATION' } });
    expect(out.nodes.map((n) => n.id)).toEqual(expect.arrayContaining(['ask_draft', 'send_question', 'wait']));
  });

  it('dieselbe Wirkung unter anderer Kennung wird entfernt; Kanten und Verweise zeigen auf den bestätigten Schritt', () => {
    const out = carry(
      {
        nodes: [
          node('draft2', 'PREPARE', { capability: { key: 'communication.draft' } }),
          node('send2', 'ACTION', { capability: { key: 'email.send' }, config: { purpose: 'CLARIFICATION' }, inputs: { draft: { stepOutput: { node: 'draft2', path: 'draftId' } } } }),
          node('wait', 'WAIT_EVENT'),
          node('later', 'ACTION', { capability: { key: 'staff.notify' }, inputs: { message: { stepOutput: { node: 'send2', path: 'x' } } } }),
        ],
        edges: [edge('e1', 'draft2', 'send2'), edge('e2', 'send2', 'wait'), edge('e3', 'send2', 'later')],
      },
      [askSend],
    );
    expect(out.nodes.map((n) => n.id)).not.toContain('send2');
    expect(out.edges.map((e) => `${e.source}>${e.target}`)).toEqual(['draft2>send_question', 'send_question>wait', 'send_question>later']);
    expect((out.nodes.find((n) => n.id === 'later') as { inputs: { message: { stepOutput: { node: string } } } }).inputs.message.stepOutput.node).toBe('send_question');
  });

  it('eine weitere interne Meldung ist keine Wiederholung und bleibt', () => {
    const notify = node('notify', 'ACTION', { capability: { key: 'staff.notify' } }) as unknown as PlanNode;
    const out = carry({ nodes: [node('notify2', 'ACTION', { capability: { key: 'staff.notify' } })], edges: [] }, [notify]);
    expect(out.nodes.map((n) => n.id).sort()).toEqual(['notify', 'notify2']);
  });

  it('ohne bestätigte Schritte bleibt der Vorschlag unverändert', () => {
    const input = { nodes: [node('a', 'INTERPRET')], edges: [] };
    expect(carry(input, [])).toBe(input);
  });
});

describe('Bindungsfehler der Neuplanung werden ohne Spielraum behoben (Funktionsnachweis 23.10.)', () => {
  const { DEFAULT_CAPABILITIES } = jest.requireActual('@orbit/shared') as typeof import('@orbit/shared');
  const context = { capabilities: new Map(DEFAULT_CAPABILITIES.map((c) => [c.key, c])) } as never;
  const repair = (output: Proposal): Proposal => (PlannerService.prototype as unknown as { repairBindings(o: unknown, c: unknown): Proposal }).repairBindings.call({}, output, context);

  it('eine Bindung auf einen Schritt, den es im Plan nicht gibt (Kennung aus früherer Revision), zeigt auf den einzigen Schritt, der das Ausgabefeld liefert', () => {
    const out = repair({
      nodes: [node('reqs_2', 'EVALUATE_REQUIREMENTS', { capability: { key: 'requirements.resolve' } }), node('draft', 'PREPARE', { capability: { key: 'communication.draft' }, inputs: { missing: { stepOutput: { node: 'reqs', path: 'missing' } } } })],
      edges: [edge('e1', 'reqs_2', 'draft')],
    });
    expect((out.nodes[1] as { inputs: { missing: { stepOutput: { node: string } } } }).inputs.missing.stepOutput.node).toBe('reqs_2');
  });

  it('eine Bindung auf einen Schritt, der nicht vor dem lesenden liegt (Kante vergessen), bekommt die Kante – sofern kein Kreis entsteht', () => {
    const out = repair({
      nodes: [node('draft', 'PREPARE', { capability: { key: 'communication.draft' } }), node('send', 'ACTION', { capability: { key: 'email.send' }, inputs: { draft: { stepOutput: { node: 'draft', path: 'draftId' } } } })],
      edges: [],
    });
    expect(out.edges.map((e) => `${e.source}>${e.target}`)).toEqual(['draft>send']);
    const cyclic = repair({
      nodes: [node('a', 'PREPARE', { capability: { key: 'communication.draft' }, inputs: { x: { stepOutput: { node: 'b', path: 'draftId' } } } }), node('b', 'PREPARE', { capability: { key: 'communication.draft' } })],
      edges: [edge('e1', 'a', 'b')],
    });
    expect(cyclic.edges).toHaveLength(1); // b liegt hinter a: keine Kante, die einen Kreis erzeugt
  });

  it('mehrdeutige Bindungen bleiben unberührt (der Validator weist sie ab)', () => {
    const out = repair({
      nodes: [node('r1', 'EVALUATE_REQUIREMENTS', { capability: { key: 'requirements.resolve' } }), node('r2', 'EVALUATE_REQUIREMENTS', { capability: { key: 'requirements.resolve' } }), node('draft', 'PREPARE', { capability: { key: 'communication.draft' }, inputs: { missing: { stepOutput: { node: 'reqs', path: 'missing' } } } })],
      edges: [edge('e1', 'r1', 'draft'), edge('e2', 'r2', 'draft')],
    });
    expect((out.nodes[2] as { inputs: { missing: { stepOutput: { node: string } } } }).inputs.missing.stepOutput.node).toBe('reqs');
  });
});
