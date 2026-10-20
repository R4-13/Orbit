import { PlanStoreService } from './plan-store.service';

const node = (type: string, config: Record<string, unknown> = {}) => ({ type, definition: { id: 'x', type, title: 'x', inputs: {}, config } });
const build = (plans: unknown[]) => new PlanStoreService({ forTenantId: () => ({ processPlan: { findMany: async () => plans } }) } as never, {} as never);

describe('Planvertrag: Ziele der ersten Planung', () => {
  it('eine freie Revision, die nur das Verstehen plant (endet an einer Weiterplanen-Stelle), wählt vorläufige Ziele – der Vertrag beginnt erst mit der nächsten Revision', async () => {
    const understanding = { goalKeys: ['inquiry.answered', 'staff.informed'], source: 'LLM_PLANNER', nodes: [node('RESOLVE_CONTEXT'), node('REASSESS', { replan: true })] };
    const substantive = { goalKeys: ['receipt.acknowledged', 'staff.informed'], source: 'LLM_PLANNER', nodes: [node('ACTION')] };
    expect(await build([understanding]).rootGoalKeys('t', 'c')).toEqual([]); // noch keine bindenden Ziele
    expect(await build([understanding, substantive]).rootGoalKeys('t', 'c')).toEqual(['receipt.acknowledged', 'staff.informed']);
  });

  it('ein festes Verfahren (Auskunft) behält seine Ziele auch mit Weiterplanen-Stelle; ohne Verstehensrevision gilt die erste Revision', async () => {
    const procedure = { goalKeys: ['inquiry.answered'], source: 'BLUEPRINT_INSTANTIATION', nodes: [node('ACTION'), node('REASSESS', { replan: true })] };
    expect(await build([procedure]).rootGoalKeys('t', 'c')).toEqual(['inquiry.answered']);
    const direct = { goalKeys: ['human.review'], source: 'LLM_PLANNER', nodes: [node('MANUAL_TASK')] };
    expect(await build([direct]).rootGoalKeys('t', 'c')).toEqual(['human.review']);
  });
});
