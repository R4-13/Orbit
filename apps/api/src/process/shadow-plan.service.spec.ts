import { DEFAULT_CAPABILITIES, SHADOW_PLAN_LIMIT_PER_TENANT } from '@orbit/shared';
import { CASE_EVENT_TYPES } from './case-events.service';
import { ShadowPlanService } from './shadow-plan.service';

const catalogue = new Map(DEFAULT_CAPABILITIES.map((c) => [c.key, c]));

function build(options: { flag?: boolean; propose?: unknown; duplicate?: boolean; used?: number }) {
  const platformControl = { flagEnabled: jest.fn(async () => options.flag === true) };
  const planner = { shadowPropose: jest.fn(async () => options.propose) };
  const capabilities = { catalogue: () => catalogue, policyModesFor: jest.fn(async () => new Map([['email.send.information', 'AUTONOMOUS']])) };
  const events = { append: jest.fn(async () => ({ event: { id: 'ev1' }, duplicate: options.duplicate === true })) };
  const update = jest.fn(async () => ({}));
  const prisma = {
    forTenantId: () => ({
      intakeEvent: { findFirst: async () => ({ decision: { result: { category: 'GENERAL_INQUIRY' } } }) },
      caseEvent: { update, count: async () => options.used ?? 1 },
    }),
  };
  const service = new ShadowPlanService(platformControl as never, planner as never, capabilities as never, events as never, prisma as never);
  return { service, platformControl, planner, events, update };
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
const proposed = (proposal: unknown) => ({ status: 'PROPOSED', proposal, validation: { valid: true, issues: [] } });
const finalPayload = (update: jest.Mock) => (update.mock.calls.at(-1) as unknown as [{ data: { payload: Record<string, unknown> } }])[0].data.payload;

describe('ShadowPlanService – der Plan wird bewertet, nichts wird ausgeführt oder gespeichert', () => {
  it('ohne Plattform-Flag passiert nichts: weder ein Planeraufruf noch ein Ereignis (Standard AUS)', async () => {
    const { service, planner, events } = build({ flag: false });
    expect(await service.record('t1', 'c1')).toBe('DISABLED');
    expect(planner.shadowPropose).not.toHaveBeenCalled();
    expect(events.append).not.toHaveBeenCalled();
  });

  it('mit Flag: erst reserviert (ein Ereignis je Vorgang), dann bewertet und im selben Ereignis festgehalten – Regeln, Aktionsklassen, Dienst am Ziel', async () => {
    const { service, events, update } = build({ flag: true, propose: proposed(goodProposal) });
    expect(await service.record('t1', 'c1', 'Frage')).toBe('RECORDED');
    expect(events.append).toHaveBeenCalledTimes(1);
    const [tenant, caseId, input] = events.append.mock.calls[0] as unknown as [string, string, { type: string; dedupeKey: string }];
    expect([tenant, caseId, input.type, input.dedupeKey]).toEqual(['t1', 'c1', CASE_EVENT_TYPES.SHADOW_PLAN_PROPOSED, 'shadow:c1']);
    expect(finalPayload(update)).toMatchObject({ stage: 'DONE', available: true, valid: true, category: 'GENERAL_INQUIRY', rating: { passed: true, plannedEffects: ['email.send/INFORMATION'], goalFit: { verdict: 'FITS' }, needsPlanApproval: true } });
  });

  it('ein Plan mit Verletzung wird nicht verworfen, sondern mit Befund festgehalten (Schattenbetrieb zeigt Schwächen, er versteckt sie nicht)', async () => {
    const weak = { ...goodProposal, nodes: [node('sum', 'INTERPRET'), node('done', 'COMPLETE')], edges: [{ id: 'e1', source: 'sum', target: 'done' }] };
    const { service, update } = build({ flag: true, propose: proposed(weak) });
    await service.record('t1', 'c1');
    const rating = finalPayload(update).rating as { passed: boolean; violations: Array<{ code: string }>; goalFit: { verdict: string } };
    expect(rating.passed).toBe(false);
    expect(rating.violations.map((v) => v.code)).toEqual(expect.arrayContaining(['GOAL_NOT_SERVED', 'COMPLETE_WITHOUT_GOAL_PROOF']));
    expect(rating.goalFit.verdict).toBe('MISSES');
  });

  it('ein zweiter Aufruf für denselben Vorgang plant nicht noch einmal', async () => {
    const { service, planner } = build({ flag: true, duplicate: true, propose: proposed(goodProposal) });
    expect(await service.record('t1', 'c1')).toBe('ALREADY_DONE');
    expect(planner.shadowPropose).not.toHaveBeenCalled();
  });

  it(`über der Obergrenze von ${SHADOW_PLAN_LIMIT_PER_TENANT} wird nicht geplant; der Grund steht im Protokoll`, async () => {
    const { service, planner, update } = build({ flag: true, used: SHADOW_PLAN_LIMIT_PER_TENANT + 1, propose: proposed(goodProposal) });
    expect(await service.record('t1', 'c1')).toBe('LIMIT_REACHED');
    expect(planner.shadowPropose).not.toHaveBeenCalled();
    expect(finalPayload(update)).toMatchObject({ available: false, limit: SHADOW_PLAN_LIMIT_PER_TENANT });
  });

  it('genau auf der Grenze (60. Planung) wird noch geplant', async () => {
    const { service } = build({ flag: true, used: SHADOW_PLAN_LIMIT_PER_TENANT, propose: proposed(goodProposal) });
    expect(await service.record('t1', 'c1')).toBe('RECORDED');
  });

  it('ist die Planung nicht verfügbar (z. B. Kill Switch, kein Modell), wird das ehrlich festgehalten, nicht verschwiegen', async () => {
    const { service, update } = build({ flag: true, propose: { status: 'UNAVAILABLE', reason: 'Der KI-Planer ist plattformweit vorübergehend gestoppt (Kill Switch).' } });
    expect(await service.record('t1', 'c1')).toBe('UNAVAILABLE');
    expect(finalPayload(update)).toMatchObject({ available: false });
  });

  it('recordSafely wirft nie – ein Fehler im Schattenbetrieb darf den Vorgang nicht beeinträchtigen', async () => {
    const { service, planner } = build({ flag: true });
    planner.shadowPropose.mockRejectedValueOnce(new Error('boom'));
    await expect(service.recordSafely('t1', 'c1')).resolves.toBeUndefined();
  });
});
