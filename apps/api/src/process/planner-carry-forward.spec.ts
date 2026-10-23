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
