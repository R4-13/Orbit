import { Inject, Logger, type OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import type { OrbitEnv } from '@orbit/config';
import { CONNECTOR_REGISTRY } from '@orbit/integration-core';
import type { IntegrationConnectorType } from '@orbit/domain';
import { ORBIT_ENV } from '../src/config/env.token';
import { CHANNEL_SYNC_QUEUE } from '../src/queue/queue.tokens';
import { TenantConcurrencyService } from '../src/queue/tenant-concurrency.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { WebhookIdempotencyService } from '../src/webhooks/webhook-idempotency.service';
import { IntakeService } from '../src/intake/intake.service';
import { CHANNEL_POLL_ADAPTERS } from '../src/channel-sync/channel-sync.tokens';
import type { ChannelPollAdapter } from '../src/channel-sync/channel-poll-adapter';

const CONCURRENCY_CATEGORY = 'channel-sync';
const SCAN_JOB_ID = 'channel-sync-scan';
const REQUEUE_DELAY_MS = 2000;

interface PollJobData {
  tenantId: string;
  connectionId: string;
  connectorType: IntegrationConnectorType;
}

/**
 * Channel Event Runtime (docs/CHANNEL_EVENT_RUNTIME_PLAN.md, Increment D)
 * — the generic sync queue/processor/scheduler that finally makes a
 * connected, polling-capable connector (today: Gmail) actually feed
 * `IntakeService`. Two job kinds on one queue:
 *
 * - `'scan'` — a single repeatable job (registered once at worker
 *   startup, `onModuleInit`), fans out one `'poll'` job per due
 *   connection. Cross-tenant by necessity (a scheduler has no single
 *   tenant context) — uses `PrismaService.withRlsBypass()`, the same
 *   documented, pre-existing escape hatch tenant bootstrap/auth/seed
 *   already use, not a new RLS workaround.
 * - `'poll'` — one connection. Looks up the registered
 *   `ChannelPollAdapter` for its `connectorType` (never imports
 *   `GmailPollAdapter` directly — §6 of the plan: "the runtime must
 *   remain channel/connector-independent"), dedupes each returned event
 *   via `WebhookIdempotencyService` (reused unmodified from Increment A's
 *   research — already built, never had a caller), and feeds every new
 *   event into `IntakeService.handleIntakeEvent()` — the exact same
 *   pipeline the `/inbox` simulate-email form already uses (Increment B).
 *
 * Per-tenant concurrency (`TenantConcurrencyService`, generalized in this
 * increment — see its own doc comment) prevents one tenant's sync jobs
 * from starving another's, same pattern `WorkflowRunProcessor` already
 * established: a deferred, self-requeued job instead of a disguised retry
 * when the tenant is at its limit.
 */
@Processor(CHANNEL_SYNC_QUEUE)
export class ChannelSyncProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(ChannelSyncProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly concurrency: TenantConcurrencyService,
    private readonly idempotency: WebhookIdempotencyService,
    private readonly intake: IntakeService,
    @Inject(CHANNEL_POLL_ADAPTERS) private readonly adapters: ChannelPollAdapter[],
    @InjectQueue(CHANNEL_SYNC_QUEUE) private readonly queue: Queue<PollJobData | Record<string, never>>,
    @Inject(ORBIT_ENV) private readonly env: OrbitEnv,
  ) {
    super();
  }

  /** Registers the repeatable "scan" job once — BullMQ dedupes repeatable jobs by their `jobId`+`repeat` key, so this is safe to call on every worker (re)start, including multiple worker replicas. */
  async onModuleInit(): Promise<void> {
    await this.queue.add(
      'scan',
      {},
      { repeat: { every: this.env.CHANNEL_SYNC_POLL_INTERVAL_MS }, jobId: SCAN_JOB_ID },
    );
  }

  async process(job: Job<PollJobData | Record<string, never>>): Promise<void> {
    if (job.name === 'scan') {
      await this.scan();
      return;
    }
    if (job.name === 'poll') {
      await this.pollConnection(job.data as PollJobData);
    }
  }

  private async scan(): Promise<void> {
    const pollableTypes = CONNECTOR_REGISTRY.filter((c) => c.pollingSupport).map((c) => c.id) as IntegrationConnectorType[];
    if (pollableTypes.length === 0) return;

    const dueConnections = await this.prisma.withRlsBypass(async (tx) => {
      const connected = await tx.integration.findMany({
        where: { status: 'CONNECTED', connectorType: { in: pollableTypes } },
      });

      const due: { tenantId: string; connectionId: string; connectorType: IntegrationConnectorType }[] = [];
      for (const integration of connected) {
        const sync = await tx.connectorSync.findUnique({ where: { connectionId: integration.id } });
        if (!sync) {
          await tx.connectorSync.create({
            data: {
              tenantId: integration.tenantId,
              connectionId: integration.id,
              connectorType: integration.connectorType,
              syncMode: 'POLLING',
              status: 'IDLE',
            },
          });
          due.push({ tenantId: integration.tenantId, connectionId: integration.id, connectorType: integration.connectorType });
          continue;
        }
        if (!sync.nextRunAt || sync.nextRunAt.getTime() <= Date.now()) {
          due.push({ tenantId: integration.tenantId, connectionId: integration.id, connectorType: integration.connectorType });
        }
      }
      return due;
    });

    for (const connection of dueConnections) {
      await this.queue.add('poll', connection, { attempts: 1 });
    }
  }

  private async pollConnection(data: PollJobData): Promise<void> {
    const acquired = await this.concurrency.acquireSlot(
      CONCURRENCY_CATEGORY,
      data.tenantId,
      data.connectionId,
      this.env.TENANT_MAX_CONCURRENT_CHANNEL_SYNCS,
    );
    if (!acquired) {
      this.logger.log(`Tenant ${data.tenantId} at its channel-sync concurrency limit — deferring connection ${data.connectionId}`);
      await this.queue.add('poll', data, { attempts: 1, delay: REQUEUE_DELAY_MS });
      return;
    }

    try {
      await this.runPoll(data);
    } finally {
      await this.concurrency.releaseSlot(CONCURRENCY_CATEGORY, data.tenantId, data.connectionId);
    }
  }

  private async runPoll(data: PollJobData): Promise<void> {
    const adapter = this.adapters.find((a) => a.connectorType === data.connectorType);
    if (!adapter) {
      // A connector can declare pollingSupport in the registry before a real adapter exists for it
      // (§21.9's "never auto-mark as compatible" principle, extended here) — nothing to do yet.
      return;
    }

    const scoped = this.prisma.forTenantId(data.tenantId);
    const sync = await scoped.connectorSync.findUnique({ where: { connectionId: data.connectionId } });
    await scoped.connectorSync.update({
      where: { connectionId: data.connectionId },
      data: { status: 'RUNNING', lastAttemptAt: new Date() },
    });

    try {
      const { events, nextCursor } = await adapter.poll(data.tenantId, data.connectionId, sync?.cursor ?? null);

      for (const event of events) {
        const isNew = await this.idempotency.recordIfNew(data.tenantId, event.provider, event.externalEventId, 'CHANNEL_EVENT_RECEIVED');
        if (!isNew) continue;
        await this.intake.handleIntakeEvent(data.tenantId, undefined, event);
      }

      await scoped.connectorSync.update({
        where: { connectionId: data.connectionId },
        data: {
          status: 'SUCCEEDED',
          cursor: nextCursor,
          lastSuccessAt: new Date(),
          retryCount: 0,
          lastErrorCode: null,
          nextRunAt: new Date(Date.now() + this.env.CHANNEL_SYNC_POLL_INTERVAL_MS),
        },
      });
    } catch (error) {
      this.logger.error(`Channel sync failed for connection ${data.connectionId} (tenant ${data.tenantId})`, error instanceof Error ? error.stack : undefined);
      await scoped.connectorSync.update({
        where: { connectionId: data.connectionId },
        data: {
          status: 'FAILED',
          retryCount: { increment: 1 },
          lastErrorCode: error instanceof Error ? error.message.slice(0, 255) : 'UNKNOWN',
          nextRunAt: new Date(Date.now() + this.env.CHANNEL_SYNC_POLL_INTERVAL_MS),
        },
      });
    }
  }
}
