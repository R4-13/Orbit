import { Injectable } from '@nestjs/common';
import { Prisma } from '@orbit/domain';
import type { AuditEventType } from '@orbit/shared';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

/** Postgres unique-violation error code — see https://www.postgresql.org/docs/current/errcodes-appendix.html */
const UNIQUE_VIOLATION = 'P2002';

/**
 * Idempotency guard for future real webhook receivers (§29/§31/§59) —
 * prepared ahead of time since no real connector webhook exists yet
 * (every connector is still a mock, see docs/INTEGRATIONS.md; the
 * endpoint side of this only makes sense once a real one does).
 *
 * Almost every webhook provider (Microsoft Graph, Gmail push, HubSpot,
 * Twilio) only guarantees *at-least-once* delivery, never exactly-once —
 * a handler that isn't idempotent will eventually double-process a
 * message (double-create a Case, double-book an invoice, ...) on a
 * network retry or provider-side redelivery.
 *
 * `recordIfNew()` relies on the database's own unique constraint
 * (`@@unique([tenantId, source, externalEventId])`, see WebhookEvent in
 * schema.prisma) rather than a "check, then insert" read-then-write —
 * the latter has a race window under concurrent redelivery (two requests
 * for the same event both see "not yet processed" before either commits).
 * Catching the resulting unique-violation as the "already processed"
 * signal is atomic and correct under concurrency.
 */
@Injectable()
export class WebhookIdempotencyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Returns `true` the first time this (source, externalEventId) pair is
   * seen for this tenant — the caller should process the payload. Returns
   * `false` if it was already recorded — the caller should skip
   * processing (this delivery/poll result is a duplicate) without
   * treating that as an error.
   *
   * `auditEventType` defaults to `'WEBHOOK_RECEIVED'` (this service's
   * original, push-webhook-only purpose) but the Channel Event Runtime
   * (docs/CHANNEL_EVENT_RUNTIME_PLAN.md Increment D) reuses this exact
   * dedup mechanism for POLLING-sourced events too — passing
   * `'CHANNEL_EVENT_RECEIVED'` there keeps the audit trail honest about
   * which delivery mechanism actually occurred, rather than mislabeling
   * every polled Gmail message as a "webhook".
   */
  async recordIfNew(
    tenantId: string,
    source: string,
    externalEventId: string,
    auditEventType: AuditEventType = 'WEBHOOK_RECEIVED',
  ): Promise<boolean> {
    try {
      await this.prisma.forTenantId(tenantId).webhookEvent.create({
        data: { tenantId, source, externalEventId },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_VIOLATION) {
        return false;
      }
      throw error;
    }

    await this.audit.record({
      tenantId,
      eventType: auditEventType,
      actorType: 'SYSTEM',
      entityType: 'WebhookEvent',
      payload: { source, externalEventId },
    });

    return true;
  }
}
