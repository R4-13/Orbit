import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import type { Job } from 'bullmq';
import type { OrbitEnv } from '@orbit/config';
import type { ChannelPollAdapter } from '../src/channel-sync/channel-poll-adapter';
import { CHANNEL_POLL_ADAPTERS } from '../src/channel-sync/channel-sync.tokens';
import { ORBIT_ENV } from '../src/config/env.token';
import { IntakeService } from '../src/intake/intake.service';
import { ProcessSweepService } from '../src/process/process-sweep.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { CHANNEL_SYNC_QUEUE } from '../src/queue/queue.tokens';
import { TenantConcurrencyService } from '../src/queue/tenant-concurrency.service';
import { WebhookIdempotencyService } from '../src/webhooks/webhook-idempotency.service';
import { ChannelSyncProcessor } from './channel-sync.processor';

describe('ChannelSyncProcessor', () => {
  let processor: ChannelSyncProcessor;
  let concurrency: { acquireSlot: jest.Mock; releaseSlot: jest.Mock };
  let idempotency: { recordIfNew: jest.Mock };
  let intake: { handleIntakeEvent: jest.Mock; retryPendingTriage: jest.Mock };
  let adapter: { connectorType: string; poll: jest.Mock };
  let connectorSync: { findUnique: jest.Mock; update: jest.Mock };
  let prisma: { forTenantId: jest.Mock; withRlsBypass: jest.Mock };
  let queue: { add: jest.Mock };

  const pollData: { tenantId: string; connectionId: string; connectorType: 'GMAIL' | 'GOOGLE_CALENDAR' } = {
    tenantId: 'tenant_1',
    connectionId: 'conn_1',
    connectorType: 'GMAIL',
  };

  beforeEach(async () => {
    concurrency = { acquireSlot: jest.fn().mockResolvedValue(true), releaseSlot: jest.fn().mockResolvedValue(undefined) };
    idempotency = { recordIfNew: jest.fn().mockResolvedValue(true) };
    intake = {
      handleIntakeEvent: jest.fn().mockResolvedValue({ category: 'OTHER', agentRunIds: [], intakeEventId: 'ie_1' }),
      retryPendingTriage: jest.fn().mockResolvedValue(undefined),
    };
    adapter = { connectorType: 'GMAIL', poll: jest.fn().mockResolvedValue({ events: [], nextCursor: null }) };
    connectorSync = { findUnique: jest.fn().mockResolvedValue({ cursor: null }), update: jest.fn().mockResolvedValue(undefined) };
    prisma = {
      forTenantId: jest.fn().mockReturnValue({ connectorSync }),
      withRlsBypass: jest.fn(),
    };
    queue = { add: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ChannelSyncProcessor,
        { provide: PrismaService, useValue: prisma },
        { provide: TenantConcurrencyService, useValue: concurrency },
        { provide: WebhookIdempotencyService, useValue: idempotency },
        { provide: IntakeService, useValue: intake },
        { provide: ProcessSweepService, useValue: { sweep: jest.fn().mockResolvedValue({ advanced: 0, failed: 0 }) } },
        { provide: CHANNEL_POLL_ADAPTERS, useValue: [adapter] as unknown as ChannelPollAdapter[] },
        { provide: getQueueToken(CHANNEL_SYNC_QUEUE), useValue: queue },
        {
          provide: ORBIT_ENV,
          useValue: { CHANNEL_SYNC_POLL_INTERVAL_MS: 60000, TENANT_MAX_CONCURRENT_CHANNEL_SYNCS: 2 } as OrbitEnv,
        },
      ],
    }).compile();

    processor = moduleRef.get(ChannelSyncProcessor);
  });

  it('registers the repeatable scan job on module init', async () => {
    await processor.onModuleInit();
    expect(queue.add).toHaveBeenCalledWith('scan', {}, { repeat: { every: 60000 }, jobId: 'channel-sync-scan' });
  });

  it('also registers the repeatable triage-retry job (parked PENDING_TRIAGE inputs are retried, not lost)', async () => {
    await processor.onModuleInit();
    expect(queue.add).toHaveBeenCalledWith('triage-retry', {}, { repeat: { every: 60000 }, jobId: 'channel-sync-triage-retry' });
  });

  describe("'triage-retry' job", () => {
    it('retries every due PENDING_TRIAGE decision through IntakeService, tenant by tenant', async () => {
      prisma.withRlsBypass.mockResolvedValueOnce([
        { tenantId: 'tenant_a', intakeEventId: 'ie_a' },
        { tenantId: 'tenant_b', intakeEventId: 'ie_b' },
      ]);

      await processor.process({ name: 'triage-retry', data: {} } as Job<Record<string, never>>);

      expect(intake.retryPendingTriage).toHaveBeenCalledWith('tenant_a', 'ie_a');
      expect(intake.retryPendingTriage).toHaveBeenCalledWith('tenant_b', 'ie_b');
    });

    it('one failing retry neither stops the others nor hot-loops: its next attempt is pushed back', async () => {
      prisma.withRlsBypass
        .mockResolvedValueOnce([
          { tenantId: 'tenant_a', intakeEventId: 'ie_a' },
          { tenantId: 'tenant_b', intakeEventId: 'ie_b' },
        ])
        .mockResolvedValue(undefined);
      intake.retryPendingTriage.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(undefined);

      await processor.process({ name: 'triage-retry', data: {} } as Job<Record<string, never>>);

      expect(intake.retryPendingTriage).toHaveBeenCalledTimes(2);
      expect(prisma.withRlsBypass).toHaveBeenCalledTimes(2); // the due-list lookup + the back-off update for the failed one
    });
  });

  it("dispatches a 'poll' job to the adapter, dedupes new events via WebhookIdempotencyService, and feeds each new event into IntakeService", async () => {
    const event = {
      tenantId: 'tenant_1',
      connectionId: 'conn_1',
      channel: 'EMAIL' as const,
      provider: 'gmail',
      externalEventId: 'msg-1',
      occurredAt: new Date(),
      subject: 's',
      content: 'c',
    };
    adapter.poll.mockResolvedValue({ events: [event], nextCursor: 'msg-1' });

    const job = { name: 'poll', data: pollData } as Job<typeof pollData>;
    await processor.process(job);

    expect(concurrency.acquireSlot).toHaveBeenCalledWith('channel-sync', 'tenant_1', 'conn_1', 2);
    expect(adapter.poll).toHaveBeenCalledWith('tenant_1', 'conn_1', null);
    expect(idempotency.recordIfNew).toHaveBeenCalledWith('tenant_1', 'gmail', 'msg-1', 'CHANNEL_EVENT_RECEIVED');
    expect(intake.handleIntakeEvent).toHaveBeenCalledWith('tenant_1', undefined, event);
    expect(connectorSync.update).toHaveBeenCalledWith({
      where: { connectionId: 'conn_1' },
      data: expect.objectContaining({ status: 'SUCCEEDED', cursor: 'msg-1', retryCount: 0 }),
    });
    expect(concurrency.releaseSlot).toHaveBeenCalledWith('channel-sync', 'tenant_1', 'conn_1');
  });

  it('skips IntakeService for an event WebhookIdempotencyService reports as already processed (a duplicate poll result)', async () => {
    idempotency.recordIfNew.mockResolvedValue(false);
    adapter.poll.mockResolvedValue({
      events: [{ tenantId: 'tenant_1', channel: 'EMAIL', provider: 'gmail', externalEventId: 'msg-dup', occurredAt: new Date() }],
      nextCursor: 'msg-dup',
    });

    await processor.process({ name: 'poll', data: pollData } as Job<typeof pollData>);

    expect(intake.handleIntakeEvent).not.toHaveBeenCalled();
  });

  it('self-requeues (does not poll, does not throw) when the tenant is at its channel-sync concurrency limit', async () => {
    concurrency.acquireSlot.mockResolvedValue(false);

    await processor.process({ name: 'poll', data: pollData } as Job<typeof pollData>);

    expect(adapter.poll).not.toHaveBeenCalled();
    expect(concurrency.releaseSlot).not.toHaveBeenCalled();
    expect(queue.add).toHaveBeenCalledWith('poll', pollData, { attempts: 1, delay: 2000 });
  });

  it('records a FAILED ConnectorSync with an incremented retryCount when the adapter throws, without letting the error escape (releaseSlot still runs)', async () => {
    adapter.poll.mockRejectedValue(new Error('Gmail API request failed (500)'));

    await expect(processor.process({ name: 'poll', data: pollData } as Job<typeof pollData>)).resolves.toBeUndefined();

    expect(connectorSync.update).toHaveBeenCalledWith({
      where: { connectionId: 'conn_1' },
      data: expect.objectContaining({ status: 'FAILED', retryCount: { increment: 1 }, lastErrorCode: 'Gmail API request failed (500)' }),
    });
    expect(concurrency.releaseSlot).toHaveBeenCalledWith('channel-sync', 'tenant_1', 'conn_1');
  });

  it('is a no-op when no adapter is registered for the job’s connectorType (registry declares pollingSupport before a real adapter exists)', async () => {
    const job = { name: 'poll', data: { ...pollData, connectorType: 'GOOGLE_CALENDAR' as const } } as Job<typeof pollData>;

    await processor.process(job);

    expect(connectorSync.update).not.toHaveBeenCalled();
  });
});
