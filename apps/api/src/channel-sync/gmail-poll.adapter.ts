import { Injectable } from '@nestjs/common';
import type { InboundEmail } from '@orbit/integration-core';
import { PrismaService } from '../prisma/prisma.service';
import { GmailConnectorService } from '../integrations/gmail-connector.service';
import type { NormalizedIntakeEvent } from '../intake/channel-event.types';
import type { ChannelPollAdapter, ChannelPollResult } from './channel-poll-adapter';

/**
 * Gmail polling: pro Takt werden die Kennungen der neuesten `GMAIL_POLL_WINDOW` Nachrichten gelesen und nur die noch unbekannten (kein Eingang mit dieser Kennung) vollständig geholt, höchstens
 * `GMAIL_POLL_BATCH_SIZE` je Takt, die ältesten zuerst – ein Rückstand baut sich über einige Takte ab. Früher wurden nur die zehn neuesten Nachrichten betrachtet: kamen zwischen zwei Takten mehr als
 * zehn an (eigene gesendete Nachrichten zählen mit), gingen ältere Eingänge unbemerkt verloren (Messlauf 21.10.: drei Mails lagen im Posteingang, ORBIT kannte sie nicht).
 */
const GMAIL_POLL_BATCH_SIZE = 25;
const GMAIL_POLL_WINDOW = 200;

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
 * There is no incremental/history-based fetch (`history.list` is deliberately not used): each tick reads the ids of the newest
 * `GMAIL_POLL_WINDOW` messages and fetches the ones no intake event exists for; `cursor` is only ever set to the most
 * recently seen message id and is not used as a fetch filter.
 * Re-processing an already-seen message is prevented by the idempotency
 * layer (`WebhookIdempotencyService`, Increment D) and the unique intake event id, not by this cursor —
 * a deliberate choice over guessing at Gmail's `history.list` API (a
 * correctness-critical third-party contract CLAUDE.md requires verifying
 * against official docs before use, not assuming); a real incremental
 * cursor is a legitimate, explicitly flagged future optimization, not
 * built here.
 */
@Injectable()
export class GmailPollAdapter implements ChannelPollAdapter {
  readonly connectorType = 'GMAIL' as const;

  constructor(
    private readonly gmailConnector: GmailConnectorService,
    private readonly prisma: PrismaService,
  ) {}

  async poll(tenantId: string, connectionId: string, cursor: string | null): Promise<ChannelPollResult> {
    const ids = await this.gmailConnector.listMessageIds(tenantId, GMAIL_POLL_WINDOW);
    const known = new Set(
      ids.length === 0
        ? []
        : (await this.prisma.forTenantId(tenantId).intakeEvent.findMany({ where: { provider: 'gmail', externalEventId: { in: ids } }, select: { externalEventId: true } })).map((row) => row.externalEventId),
    );
    // Die Liste ist neueste-zuerst; unbekannte werden von den ältesten an abgearbeitet.
    const unseen = ids.filter((id) => !known.has(id)).reverse().slice(0, GMAIL_POLL_BATCH_SIZE);
    const emails = unseen.length === 0 ? [] : await this.gmailConnector.fetchMessages(tenantId, unseen);
    const connectedAddress = await this.connectedAddress(tenantId, connectionId);
    const events = emails.map((email) => this.toNormalizedIntakeEvent(tenantId, connectionId, email, connectedAddress));
    const nextCursor = ids[0] ?? cursor;
    return { events, nextCursor };
  }

  recover(tenantId: string): Promise<boolean> {
    return this.gmailConnector.attemptRecovery(tenantId);
  }

  /** The mailbox this connection authenticated as — read from the Integration, never hardcoded (Amendment 02 §0.2). */
  private async connectedAddress(tenantId: string, connectionId: string): Promise<string | undefined> {
    const integration = await this.prisma.forTenantId(tenantId).integration.findUnique({ where: { id: connectionId } });
    return integration?.externalAccountId?.toLowerCase() ?? undefined;
  }

  private toNormalizedIntakeEvent(tenantId: string, connectionId: string, email: InboundEmail, connectedAddress: string | undefined): NormalizedIntakeEvent {
    const labels = email.labelIds ?? [];
    // A message we sent ourselves (label SENT, or From == the connected account) is OUTBOUND: it is recorded but must never
    // be treated as a customer request (Amendment 02 §5.1, E19) — otherwise our own questions would spawn new processes.
    const outbound = labels.includes('SENT') || (connectedAddress !== undefined && email.from.toLowerCase() === connectedAddress);
    return {
      tenantId,
      connectionId,
      channel: 'EMAIL',
      provider: 'gmail',
      externalEventId: email.providerMessageId,
      occurredAt: email.receivedAt,
      sender: { address: email.from, ...(email.fromName ? { displayName: email.fromName } : {}) },
      recipients: email.to.map((address) => ({ address })),
      subject: email.subject,
      content: email.bodyText,
      attachments: email.attachments,
      threadId: email.threadId,
      rfcMessageId: email.rfcMessageId,
      inReplyTo: email.inReplyTo,
      references: email.references,
      direction: outbound ? 'OUTBOUND' : 'INBOUND',
      hints: { autoGenerated: email.autoGenerated, bulk: email.bulk, providerSpam: labels.includes('SPAM') },
    };
  }
}
