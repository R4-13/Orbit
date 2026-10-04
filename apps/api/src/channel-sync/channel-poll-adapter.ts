import type { IntegrationConnectorType } from '@orbit/domain';
import type { NormalizedIntakeEvent } from '../intake/channel-event.types';

/**
 * Channel Event Runtime (docs/CHANNEL_EVENT_RUNTIME_PLAN.md, Increment C)
 * — the one interface every POLLING connector implements. Deliberately
 * narrow: `poll()` only fetches and translates raw provider data into
 * `NormalizedIntakeEvent[]` — no idempotency, no queueing, no
 * relevance/domain routing. That's the generic sync runtime's job
 * (Increment D) and `IntakeService`'s job (Increment B), not this
 * adapter's. `GmailPollAdapter` is the only Gmail-specific code in the
 * entire runtime — the connector itself (`GmailConnectorService`) stays
 * completely unaware this adapter exists.
 *
 * A future webhook/push-based connector would implement a parallel,
 * narrower `ChannelWebhookAdapter` (a single `handleWebhookPayload()`
 * method, no cursor) instead — not built yet since nothing in this
 * codebase has a real webhook receiver to call it (same reasoning
 * `WebhookIdempotencyService` was built narrow-but-ready, see Increment
 * A's research). `on_demand`/`batch` sync modes (§4 of
 * `docs/CHANNEL_EVENT_RUNTIME_PLAN.md`'s target diagram) are architecture
 * slots documented here, not speculative code written ahead of a real
 * connector that needs them.
 */
export interface ChannelPollResult {
  events: NormalizedIntakeEvent[];
  /** Opaque — only ever written and read by the SAME adapter that produced it. The generic sync runtime stores/passes it through `ConnectorSync.cursor` without interpreting it. */
  nextCursor: string | null;
}

export interface ChannelPollAdapter {
  readonly connectorType: IntegrationConnectorType;
  poll(tenantId: string, connectionId: string, cursor: string | null): Promise<ChannelPollResult>;
}
