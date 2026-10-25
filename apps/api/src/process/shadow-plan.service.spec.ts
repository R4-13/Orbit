import { DEFAULT_CAPABILITIES, SHADOW_PLAN_LIMIT_PER_TENANT } from '@orbit/shared';
import { CASE_EVENT_TYPES } from './case-events.service';
import { ShadowPlanService } from './shadow-plan.service';

const catalogue = new Map(DEFAULT_CAPABILITIES.map((c) => [c.key, c]));

function build(options: { flag?: boolean; propose?: unknown; duplicate?: boolean; used?: number; audited?: number }) {
  const platformControl = { flagEnabled: jest.fn(async () => options.flag === true) };
  const planner = { shadowPropose: jest.fn(async () => options.propose) };
  const capabilities = { catalogue: () => catalogue, policyModesFor: jest.fn(async () => new Map([['email.send.information', 'AUTONOMOUS']])) };
  // `used` = bereits verbrauchte Planungen VOR diesem Versuch.
  const events = { appendInTx: jest.fn(async () => ({ event: { id: 'ev1' }, duplicate: false })) };
  const update = jest.fn(async () => ({}));
  const audit = { create: jest.fn(async (_args?: unknown) => ({})) };
  const lock = jest.fn(async () => 0);
  const tx = {
    $executeRaw: lock,
    caseEvent: { findFirst: async () => (options.duplicate ? { id: 'vorhanden' } : null), count: async () => options.used ?? 0 },
    auditLog: { count: async () => options.audited ?? 0, create: audit.create },
  };
  const prisma = {
    inTenantTransaction: async (_tenant: string, fn: (t: typeof tx) => unknown) => fn(tx),
    forTenantId: () => ({
      intakeEvent: { findFirst: async () => ({ decision: { result: { category: 'GENERAL_INQUIRY' } } }) },
      caseEvent: { update },
    }),
  };
  const service = new ShadowPlanService(platformControl as never, planner as never, capabilities as never, events as never, prisma as never);
  return { service, platformControl, planner, events, update, audit, lock };
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
    expect(events.appendInTx).not.toHaveBeenCalled();
  });

  it('mit Flag: erst reserviert (ein Ereignis je Vorgang), dann bewertet und im selben Ereignis festgehalten – Regeln, Aktionsklassen, Dienst am Ziel', async () => {
    const { service, events, update } = build({ flag: true, propose: proposed(goodProposal) });
    expect(await service.record('t1', 'c1', 'Frage')).toBe('RECORDED');
    expect(events.appendInTx).toHaveBeenCalledTimes(1);
    const [, tenant, caseId, input] = events.appendInTx.mock.calls[0] as unknown as [unknown, string, string, { type: string; dedupeKey: string }];
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

  it(`an der Obergrenze von ${SHADOW_PLAN_LIMIT_PER_TENANT} wird nicht mehr geplant; der Grund steht im Protokoll – der abgelehnte Versuch verbraucht NICHTS`, async () => {
    const { service, planner, events, audit } = build({ flag: true, used: SHADOW_PLAN_LIMIT_PER_TENANT, propose: proposed(goodProposal) });
    expect(await service.record('t1', 'c1')).toBe('LIMIT_REACHED');
    expect(planner.shadowPropose).not.toHaveBeenCalled();
    const [, , , input] = events.appendInTx.mock.calls[0] as unknown as [unknown, string, string, { type: string; payload: Record<string, unknown> }];
    expect(input.type).toBe(CASE_EVENT_TYPES.SHADOW_PLAN_REFUSED); // eigener Ereignistyp: zählt nicht als Planung
    expect(input.payload).toMatchObject({ available: false, limit: SHADOW_PLAN_LIMIT_PER_TENANT });
    expect(audit.create).not.toHaveBeenCalled(); // kein Verbrauchs-Eintrag (früher: Zähler 61 von 60)
  });

  it('verbrauchte Planungen zählen dauerhaft: auch wenn die Vorgänge (und ihre Ereignisse) gelöscht wurden, hält der Audit-Zähler die Obergrenze', async () => {
    const { service, planner, audit } = build({ flag: true, used: 3, audited: SHADOW_PLAN_LIMIT_PER_TENANT, propose: proposed(goodProposal) });
    expect(await service.record('t1', 'c1')).toBe('LIMIT_REACHED');
    expect(planner.shadowPropose).not.toHaveBeenCalled();
    expect(audit.create).not.toHaveBeenCalled();
  });

  it('die 60. Planung (59 verbraucht) wird noch geplant und genau einmal gezählt (Audit-Eintrag)', async () => {
    const { service, audit, lock } = build({ flag: true, used: SHADOW_PLAN_LIMIT_PER_TENANT - 1, propose: proposed(goodProposal) });
    expect(await service.record('t1', 'c1')).toBe('RECORDED');
    expect(audit.create).toHaveBeenCalledTimes(1);
    expect(audit.create.mock.calls[0]![0]).toMatchObject({ data: expect.objectContaining({ tenantId: 't1', eventType: 'SHADOW_PLAN_CONSUMED', entityId: 'c1' }) });
    expect(lock).toHaveBeenCalledTimes(1); // Zählen und Reservieren unter der Sperre je Mandant
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
