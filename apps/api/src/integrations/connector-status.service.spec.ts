import { Test } from '@nestjs/testing';
import { ConnectorStatusService } from './connector-status.service';
import { PrismaService } from '../prisma/prisma.service';

const AT = (iso: string) => new Date(iso);

function verifiedCandidate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ie_ok',
    updatedAt: AT('2026-01-02T03:00:00Z'),
    metadata: {
      execution: {
        capturedAt: '2026-01-02T02:00:00.000Z',
        buildCommit: 'abc1234',
        channel: { mode: 'LIVE', provider: 'gmail' },
        ai: { mode: 'SIMULATED', provider: 'mock' },
        crm: { mode: 'SIMULATED', provider: 'mock-persistent' },
        ocr: { mode: 'SIMULATED', provider: 'mock' },
      },
    },
    workflowRun: {
      id: 'wr_ok',
      completedAt: AT('2026-01-02T02:30:00Z'),
      workflowDefinition: { key: 'sales-lead-intake' },
      stepRuns: [{ status: 'SUCCEEDED', agentRun: { status: 'COMPLETED', toolInvocations: [{ status: 'SUCCESS' }, { status: 'SUCCESS' }] } }],
    },
    ...overrides,
  };
}

describe('ConnectorStatusService', () => {
  let service: ConnectorStatusService;
  let scoped: {
    integration: { findUnique: jest.Mock };
    connectorSync: { findUnique: jest.Mock };
    intakeEvent: { findFirst: jest.Mock; findMany: jest.Mock };
  };
  let prisma: { forTenantId: jest.Mock };

  const connected = {
    id: 'int_1',
    status: 'CONNECTED',
    lastSuccessAt: AT('2026-01-01T00:00:00Z'),
    updatedAt: AT('2026-01-03T00:00:00Z'),
    lastErrorAt: null,
    lastErrorCode: null,
  };

  beforeEach(async () => {
    scoped = {
      integration: { findUnique: jest.fn().mockResolvedValue(null) },
      connectorSync: { findUnique: jest.fn().mockResolvedValue(null) },
      intakeEvent: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    };
    prisma = { forTenantId: jest.fn().mockReturnValue(scoped) };

    const moduleRef = await Test.createTestingModule({
      providers: [ConnectorStatusService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(ConnectorStatusService);
  });

  it('returns null / all-unreached when the connector was never configured', async () => {
    const result = await service.getStatus('tenant_1', 'GMAIL');

    expect(result.highestLevelReached).toBeNull();
    expect(result.currentlyConnected).toBe(false);
    expect(result.levels.AUTHENTICATION_CONNECTED.reached).toBe(false);
    expect(result.verifiedRun).toBeNull();
    expect(result.health).toBeNull();
  });

  it('falls back to the current CONNECTED status for a non-OAuth, API-key connector that has no lastSuccessAt at all', async () => {
    scoped.integration.findUnique.mockResolvedValue({ ...connected, lastSuccessAt: null, updatedAt: AT('2026-01-03T00:00:00Z') });

    const result = await service.getStatus('tenant_1', 'DATEV');

    expect(result.highestLevelReached).toBe('AUTHENTICATION_CONNECTED');
    expect(result.levels.AUTHENTICATION_CONNECTED).toEqual({ reached: true, at: '2026-01-03T00:00:00.000Z' });
  });

  it('reaches only AUTHENTICATION_CONNECTED when OAuth succeeded but the scheduler never polled successfully', async () => {
    scoped.integration.findUnique.mockResolvedValue(connected);
    scoped.connectorSync.findUnique.mockResolvedValue({ lastSuccessAt: null });

    const result = await service.getStatus('tenant_1', 'GMAIL');

    expect(result.highestLevelReached).toBe('AUTHENTICATION_CONNECTED');
    expect(result.levels.INPUT_TRIGGER_ACTIVE.reached).toBe(false);
  });

  it('stops at the longest reached prefix when a later stage has evidence but an earlier one is missing', async () => {
    scoped.integration.findUnique.mockResolvedValue(connected);
    scoped.connectorSync.findUnique.mockResolvedValue(null);
    scoped.intakeEvent.findFirst.mockResolvedValue({ occurredAt: AT('2026-01-02T00:00:00Z'), status: 'COMPLETED' });

    const result = await service.getStatus('tenant_1', 'GMAIL');

    expect(result.highestLevelReached).toBe('AUTHENTICATION_CONNECTED');
    expect(result.levels.INTAKE_PIPELINE_ACTIVE.reached).toBe(true);
  });

  it('reaches LIVE_END_TO_END_TESTED only with a run whose every step, agent run and tool invocation succeeded — and reports the live/simulated breakdown', async () => {
    scoped.integration.findUnique.mockResolvedValue(connected);
    scoped.connectorSync.findUnique.mockResolvedValue({ lastSuccessAt: AT('2026-01-01T01:00:00Z'), status: 'SUCCEEDED' });
    scoped.intakeEvent.findFirst.mockResolvedValue({ occurredAt: AT('2026-01-02T00:00:00Z'), status: 'COMPLETED' });
    scoped.intakeEvent.findMany.mockResolvedValue([verifiedCandidate()]);

    const result = await service.getStatus('tenant_1', 'GMAIL');

    expect(result.highestLevelReached).toBe('LIVE_END_TO_END_TESTED');
    expect(result.verifiedRun).toMatchObject({
      intakeEventId: 'ie_ok',
      workflowRunId: 'wr_ok',
      workflowKey: 'sales-lead-intake',
      executionSummary: 'Eingang live; KI simuliert; CRM simuliert; OCR simuliert',
    });
    expect(result.verifiedRun?.execution?.buildCommit).toBe('abc1234');
  });

  it.each([
    ['a FAILED step', { stepRuns: [{ status: 'FAILED', agentRun: { status: 'FAILED', toolInvocations: [{ status: 'FAILED' }] } }] }],
    ['a step marked SUCCEEDED whose AgentRun FAILED (the reported false-success shape)', { stepRuns: [{ status: 'SUCCEEDED', agentRun: { status: 'FAILED', toolInvocations: [{ status: 'SUCCESS' }] } }] }],
    ['a succeeded step with a failed tool invocation', { stepRuns: [{ status: 'SUCCEEDED', agentRun: { status: 'COMPLETED', toolInvocations: [{ status: 'SUCCESS' }, { status: 'FAILED' }] } }] }],
    ['an uncertain tool outcome', { stepRuns: [{ status: 'SUCCEEDED', agentRun: { status: 'COMPLETED', toolInvocations: [{ status: 'OUTCOME_UNKNOWN' }] } }] }],
    ['a run without any step', { stepRuns: [] }],
  ])('a COMPLETED run with %s is never a verifying run', async (_label, runOverrides) => {
    scoped.integration.findUnique.mockResolvedValue(connected);
    scoped.connectorSync.findUnique.mockResolvedValue({ lastSuccessAt: AT('2026-01-01T01:00:00Z'), status: 'SUCCEEDED' });
    scoped.intakeEvent.findFirst.mockResolvedValue({ occurredAt: AT('2026-01-02T00:00:00Z'), status: 'COMPLETED' });
    const candidate = verifiedCandidate();
    scoped.intakeEvent.findMany.mockResolvedValue([{ ...candidate, workflowRun: { ...candidate.workflowRun, ...runOverrides } }]);

    const result = await service.getStatus('tenant_1', 'GMAIL');

    expect(result.levels.LIVE_END_TO_END_TESTED.reached).toBe(false);
    expect(result.verifiedRun).toBeNull();
  });

  it('a later success does not heal an earlier wrongly-completed run: it is skipped and the genuine run is the one verified', async () => {
    scoped.integration.findUnique.mockResolvedValue(connected);
    scoped.connectorSync.findUnique.mockResolvedValue({ lastSuccessAt: AT('2026-01-01T01:00:00Z'), status: 'SUCCEEDED' });
    scoped.intakeEvent.findFirst.mockResolvedValue({ occurredAt: AT('2026-01-02T00:00:00Z'), status: 'COMPLETED' });
    const bad = verifiedCandidate({
      id: 'ie_bad',
      workflowRun: {
        id: 'wr_bad',
        completedAt: AT('2026-01-04T00:00:00Z'),
        workflowDefinition: { key: 'sales-lead-intake' },
        stepRuns: [{ status: 'SUCCEEDED', agentRun: { status: 'FAILED', toolInvocations: [{ status: 'FAILED' }] } }],
      },
    });
    scoped.intakeEvent.findMany.mockResolvedValue([bad, verifiedCandidate()]);

    const result = await service.getStatus('tenant_1', 'GMAIL');

    expect(result.verifiedRun?.intakeEventId).toBe('ie_ok');
  });

  it('says so explicitly when a verifying run predates execution-evidence capture', async () => {
    scoped.integration.findUnique.mockResolvedValue(connected);
    scoped.connectorSync.findUnique.mockResolvedValue({ lastSuccessAt: AT('2026-01-01T01:00:00Z'), status: 'SUCCEEDED' });
    scoped.intakeEvent.findFirst.mockResolvedValue({ occurredAt: AT('2026-01-02T00:00:00Z'), status: 'COMPLETED' });
    scoped.intakeEvent.findMany.mockResolvedValue([verifiedCandidate({ metadata: null })]);

    const result = await service.getStatus('tenant_1', 'GMAIL');

    expect(result.verifiedRun?.execution).toBeNull();
    expect(result.verifiedRun?.executionSummary).toBe('Ausführungsmodus nicht erfasst');
  });

  it('keeps current health apart from the historical proof (a newer failed run is reported, not hidden by an older success)', async () => {
    scoped.integration.findUnique.mockResolvedValue({ ...connected, lastErrorAt: AT('2026-01-05T00:00:00Z'), lastErrorCode: 'RATE_LIMIT' });
    scoped.connectorSync.findUnique.mockResolvedValue({ lastSuccessAt: AT('2026-01-01T01:00:00Z'), status: 'FAILED', lastErrorCode: 'AUTH' });
    scoped.intakeEvent.findFirst.mockResolvedValue({ occurredAt: AT('2026-01-06T00:00:00Z'), status: 'FAILED' });
    scoped.intakeEvent.findMany.mockResolvedValue([verifiedCandidate()]);

    const result = await service.getStatus('tenant_1', 'GMAIL');

    expect(result.highestLevelReached).toBe('LIVE_END_TO_END_TESTED'); // historical proof preserved…
    expect(result.health).toMatchObject({ latestRunFailed: true, lastErrorCode: 'RATE_LIMIT', syncStatus: 'FAILED', syncLastErrorCode: 'AUTH' }); // …but today's problems are visible too
  });

  it('reports currentlyConnected: false alongside a previously-reached high level when the integration was later disconnected', async () => {
    scoped.integration.findUnique.mockResolvedValue({ ...connected, status: 'DISCONNECTED' });
    scoped.connectorSync.findUnique.mockResolvedValue({ lastSuccessAt: AT('2026-01-01T01:00:00Z') });
    scoped.intakeEvent.findFirst.mockResolvedValue({ occurredAt: AT('2026-01-02T00:00:00Z'), status: 'COMPLETED' });

    const result = await service.getStatus('tenant_1', 'GMAIL');

    expect(result.currentlyConnected).toBe(false);
    expect(result.highestLevelReached).toBe('DOMAIN_WORKFLOW_ACTIVE');
  });
});
