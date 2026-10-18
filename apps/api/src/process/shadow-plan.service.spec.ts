import { DEFAULT_CAPABILITIES } from '@orbit/shared';
import { CASE_EVENT_TYPES } from './case-events.service';
import { ShadowPlanService } from './shadow-plan.service';

const catalogue = new Map(DEFAULT_CAPABILITIES.map((c) => [c.key, c]));

function build(options: { flag?: boolean; propose?: unknown }) {
  const platformControl = { flagEnabled: jest.fn(async () => options.flag === true) };
  const planner = { shadowPropose: jest.fn(async () => options.propose) };
  const capabilities = { catalogue: () => catalogue, policyModesFor: jest.fn(async () => new Map([['email.send.information', 'AUTONOMOUS']])) };
  const events = { append: jest.fn(async () => ({ event: {}, duplicate: false })) };
  const service = new ShadowPlanService(platformControl as never, planner as never, capabilities as never, events as never);
  return { service, platformControl, planner, events };
}

const node = (id: string, type: string, extra: Record<string, unknown> = {}) => ({ id, type, title: id, inputs: {}, preconditions: [], optional: false, onFailure: 'REVIEW', config: {}, evidenceRefs: [], ...extra });
const goodProposal = {
  goalKeys: ['inquiry.answered'],
  nodes: [node('send', 'ACTION', { capability: { key: 'email.send' }, config: { purpose: 'INFORMATION' } }), node('done', 'COMPLETE')],
  edges: [{ id: 'e1', source: 'send', target: 'done' }],
  unresolvedRequirements: [],
  assumptions: [],
  conciseExplanation: 'Antwort senden.',
};

describe('ShadowPlanService – der Plan wird bewertet, nichts wird ausgeführt oder gespeichert', () => {
  it('ohne Plattform-Flag passiert nichts: weder ein Planeraufruf noch ein Ereignis (Standard AUS)', async () => {
    const { service, planner, events } = build({ flag: false });
    expect(await service.record('t1', 'c1')).toBe('DISABLED');
    expect(planner.shadowPropose).not.toHaveBeenCalled();
    expect(events.append).not.toHaveBeenCalled();
  });

  it('mit Flag: genau ein Ereignis shadow.plan_proposed mit der deterministischen Bewertung, einmalig je Vorgang (dedupeKey)', async () => {
    const { service, events } = build({ flag: true, propose: { status: 'PROPOSED', proposal: goodProposal, validation: { valid: true, issues: [] } } });
    expect(await service.record('t1', 'c1', 'Frage')).toBe('RECORDED');
    expect(events.append).toHaveBeenCalledTimes(1);
    const [tenant, caseId, input] = events.append.mock.calls[0] as unknown as [string, string, { type: string; dedupeKey: string; payload: Record<string, unknown> }];
    expect([tenant, caseId, input.type, input.dedupeKey]).toEqual(['t1', 'c1', CASE_EVENT_TYPES.SHADOW_PLAN_PROPOSED, 'shadow:c1']);
    expect(input.payload).toMatchObject({ available: true, valid: true, rating: { passed: true, plannedEffects: ['email.send/INFORMATION'], plansClosingProof: true } });
  });

  it('ein Plan mit Verletzung wird nicht verworfen, sondern mit Befund festgehalten (Schattenbetrieb zeigt Schwächen, er versteckt sie nicht)', async () => {
    const weak = { ...goodProposal, nodes: [node('sum', 'INTERPRET'), node('done', 'COMPLETE')], edges: [{ id: 'e1', source: 'sum', target: 'done' }] };
    const { service, events } = build({ flag: true, propose: { status: 'PROPOSED', proposal: weak, validation: { valid: true, issues: [] } } });
    await service.record('t1', 'c1');
    const payload = (events.append.mock.calls[0] as unknown as [string, string, { payload: { rating: { passed: boolean; violations: Array<{ code: string }> } } }])[2].payload;
    expect(payload.rating.passed).toBe(false);
    expect(payload.rating.violations.map((v) => v.code)).toContain('COMPLETE_WITHOUT_CLOSING_PROOF');
  });

  it('ist die Planung nicht verfügbar (z. B. Kill Switch, kein Modell), wird das ehrlich festgehalten, nicht verschwiegen', async () => {
    const { service, events } = build({ flag: true, propose: { status: 'UNAVAILABLE', reason: 'Der KI-Planer ist plattformweit vorübergehend gestoppt (Kill Switch).' } });
    expect(await service.record('t1', 'c1')).toBe('UNAVAILABLE');
    expect((events.append.mock.calls[0] as unknown as [string, string, { payload: Record<string, unknown> }])[2].payload).toMatchObject({ available: false });
  });

  it('recordSafely wirft nie – ein Fehler im Schattenbetrieb darf den Vorgang nicht beeinträchtigen', async () => {
    const { service, planner } = build({ flag: true });
    planner.shadowPropose.mockRejectedValueOnce(new Error('boom'));
    await expect(service.recordSafely('t1', 'c1')).resolves.toBeUndefined();
  });
});
