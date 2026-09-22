import { Module } from '@nestjs/common';
import { WebhookIdempotencyService } from './webhook-idempotency.service';

/**
 * No controller yet — there is no real webhook receiver to attach one to
 * (every connector is still a mock, see docs/INTEGRATIONS.md). This
 * exports the idempotency primitive so the first real webhook handler
 * (e.g. a Microsoft Graph mail push notification endpoint) can depend on
 * WebhookIdempotencyService from day one instead of bolting deduplication
 * on after the fact.
 */
@Module({
  providers: [WebhookIdempotencyService],
  exports: [WebhookIdempotencyService],
})
export class WebhooksModule {}
