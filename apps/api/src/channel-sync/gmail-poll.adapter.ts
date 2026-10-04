import { Injectable } from '@nestjs/common';
import type { InboundEmail } from '@orbit/integration-core';
import { GmailConnectorService } from '../integrations/gmail-connector.service';
import type { NormalizedIntakeEvent } from '../intake/channel-event.types';
import type { ChannelPollAdapter, ChannelPollResult } from './channel-poll-adapter';

/**
 * Gmail polling batch size per sync tick — deliberately small (the
 * generic sync runtime, Increment D, polls on a short interval, so a
 * backlog drains over a few ticks rather than needing one huge fetch).
 */
const GMAIL_POLL_BATCH_SIZE = 10;

/**
 * The ONLY Gmail-specific code in the Channel Event Runtime (§1/§6 of
 * `docs/CHANNEL_EVENT_RUNTIME_PLAN.md`: "No Gmail-specific Finance/Sales
 * routing logic"). Translates `GmailConnectorService.listMessages()`'s
 * output into the generic `NormalizedIntakeEvent` shape — nothing here
 * decides relevance, domain, or routing; that's `IntakeService`'s job,
 * reached only through the generic sync runtime (Increment D), never
 * called directly by this adapter.
 *
 * **Cursor is best-effort, not the correctness guarantee.**
 * `GmailConnectorService.listMessages()` has no incremental/history-based
 * fetch (confirmed during Increment A's research — it always returns the
 * most recent `maxResults` messages; `cursor` is only ever set to the most
 * recently seen message id and currently unused as a fetch filter.
 * Re-processing an already-seen message is prevented by the idempotency
 * layer (`WebhookIdempotencyService`, Increment D), not by this cursor —
 * a deliberate choice over guessing at Gmail's `history.list` API (a
 * correctness-critical third-party contract CLAUDE.md requires verifying
 * against official docs before use, not assuming); a real incremental
 * cursor is a legitimate, explicitly flagged future optimization, not
 * built here.
 */
@Injectable()
export class GmailPollAdapter implements ChannelPollAdapter {
  readonly connectorType = 'GMAIL' as const;

  constructor(private readonly gmailConnector: GmailConnectorService) {}

  async poll(tenantId: string, connectionId: string, cursor: string | null): Promise<ChannelPollResult> {
    const emails = await this.gmailConnector.listMessages(tenantId, GMAIL_POLL_BATCH_SIZE);
    const events = emails.map((email) => this.toNormalizedIntakeEvent(tenantId, connectionId, email));
    const nextCursor = emails[0]?.providerMessageId ?? cursor;
    return { events, nextCursor };
  }

  private toNormalizedIntakeEvent(tenantId: string, connectionId: string, email: InboundEmail): NormalizedIntakeEvent {
    return {
      tenantId,
      connectionId,
      channel: 'EMAIL',
      provider: 'gmail',
      externalEventId: email.providerMessageId,
      occurredAt: email.receivedAt,
      sender: { address: email.from },
      recipients: email.to.map((address) => ({ address })),
      subject: email.subject,
      content: email.bodyText,
      attachments: email.attachments,
    };
  }
}
