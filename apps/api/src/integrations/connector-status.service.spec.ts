import { Test } from '@nestjs/testing';
import { ConnectorStatusService } from './connector-status.service';
import { PrismaService } from '../prisma/prisma.service';

describe('ConnectorStatusService', () => {
  let service: ConnectorStatusService;
  let scoped: {
    integration: { findUnique: jest.Mock };
    connectorSync: { findUnique: jest.Mock };
    intakeEvent: { findFirst: jest.Mock };
  };
  let prisma: { forTenantId: jest.Mock };

  beforeEach(async () => {
    scoped = {
      integration: { findUnique: jest.fn().mockResolvedValue(null) },
      connectorSync: { findUnique: jest.fn().mockResolvedValue(null) },
      intakeEvent: { findFirst: jest.fn().mockResolvedValue(null) },
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
  });

  it('falls back to the current CONNECTED status for a non-OAuth, API-key connector that has no lastSuccessAt at all', async () => {
    scoped.integration.findUnique.mockResolvedValue({
      id: 'int_1',
      status: 'CONNECTED',
      lastSuccessAt: null,
      updatedAt: new Date('2026-01-03T00:00:00Z'),
    });

    const result = await service.getStatus('tenant_1', 'DATEV');

    expect(result.highestLevelReached).toBe('AUTHENTICATION_CONNECTED');
    expect(result.levels.AUTHENTICATION_CONNECTED).toEqual({ reached: true, at: '2026-01-03T00:00:00.000Z' });
  });

  it('reaches only AUTHENTICATION_CONNECTED when OAuth succeeded but the scheduler never polled successfully — never presents it as more advanced', async () => {
    scoped.integration.findUnique.mockResolvedValue({
      id: 'int_1',
      status: 'CONNECTED',
      lastSuccessAt: new Date('2026-01-01T00:00:00Z'),
    });
    scoped.connectorSync.findUnique.mockResolvedValue({ lastSuccessAt: null });

    const result = await service.getStatus('tenant_1', 'GMAIL');

    expect(result.highestLevelReached).toBe('AUTHENTICATION_CONNECTED');
    expect(result.currentlyConnected).toBe(true);
    expect(result.levels.AUTHENTICATION_CONNECTED).toEqual({ reached: true, at: '2026-01-01T00:00:00.000Z' });
    expect(result.levels.INPUT_TRIGGER_ACTIVE.reached).toBe(false);
    expect(result.levels.INTAKE_PIPELINE_ACTIVE.reached).toBe(false);
  });

  it('stops at the longest reached prefix when a later stage has evidence but an earlier one is missing (gap must not look more advanced)', async () => {
    scoped.integration.findUnique.mockResolvedValue({
      id: 'int_1',
      status: 'CONNECTED',
      lastSuccessAt: new Date('2026-01-01T00:00:00Z'),
    });
    // No ConnectorSync row at all (scheduler never even attempted a poll for this connection) —
    // yet a real IntakeEvent somehow exists (e.g. manually inserted, or from a since-removed sync row).
    scoped.connectorSync.findUnique.mockResolvedValue(null);
    scoped.intakeEvent.findFirst.mockResolvedValue({ occurredAt: new Date('2026-01-02T00:00:00Z') });

    const result = await service.getStatus('tenant_1', 'GMAIL');

    expect(result.highestLevelReached).toBe('AUTHENTICATION_CONNECTED');
    expect(result.levels.INTAKE_PIPELINE_ACTIVE.reached).toBe(true);
  });

  it('reaches LIVE_END_TO_END_TESTED only when every preceding stage has evidence', async () => {
    scoped.integration.findUnique.mockResolvedValue({
      id: 'int_1',
      status: 'CONNECTED',
      lastSuccessAt: new Date('2026-01-01T00:00:00Z'),
    });
    scoped.connectorSync.findUnique.mockResolvedValue({ lastSuccessAt: new Date('2026-01-01T01:00:00Z') });
    scoped.intakeEvent.findFirst
      .mockResolvedValueOnce({ occurredAt: new Date('2026-01-02T00:00:00Z') }) // INTAKE_PIPELINE_ACTIVE
      .mockResolvedValueOnce({ occurredAt: new Date('2026-01-02T01:00:00Z') }) // DOMAIN_WORKFLOW_ACTIVE
      .mockResolvedValueOnce({ occurredAt: new Date('2026-01-02T02:00:00Z') }); // LIVE_END_TO_END_TESTED

    const result = await service.getStatus('tenant_1', 'GMAIL');

    expect(result.highestLevelReached).toBe('LIVE_END_TO_END_TESTED');
    expect(Object.values(result.levels).every((level) => level.reached)).toBe(true);
  });

  it('reports currentlyConnected: false alongside a previously-reached high level when the integration was later disconnected', async () => {
    scoped.integration.findUnique.mockResolvedValue({
      id: 'int_1',
      status: 'DISCONNECTED',
      lastSuccessAt: new Date('2026-01-01T00:00:00Z'),
    });
    scoped.connectorSync.findUnique.mockResolvedValue({ lastSuccessAt: new Date('2026-01-01T01:00:00Z') });
    scoped.intakeEvent.findFirst.mockResolvedValue({ occurredAt: new Date('2026-01-02T00:00:00Z') });

    const result = await service.getStatus('tenant_1', 'GMAIL');

    expect(result.currentlyConnected).toBe(false);
    expect(result.highestLevelReached).toBe('LIVE_END_TO_END_TESTED');
  });
});
