import { Injectable } from '@nestjs/common';
import { Prisma } from '@orbit/domain';
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
   * seen for this tenant — the caller should process the webhook payload.
   * Returns `false` if it was already recorded — the caller should skip
   * processing (this delivery is a duplicate) without treating that as an
   * error.
   */
  async recordIfNew(tenantId: string, source: string, externalEventId: string): Promise<boolean> {
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
      eventType: 'WEBHOOK_RECEIVED',
      actorType: 'SYSTEM',
      entityType: 'WebhookEvent',
      payload: { source, externalEventId },
    });

    return true;
  }
}
