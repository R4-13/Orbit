import { Injectable, Logger } from '@nestjs/common';
import type { InboundEmail } from '@orbit/integration-core';
import { PrismaService } from '../prisma/prisma.service';
import { GmailConnectorService } from '../integrations/gmail-connector.service';
import type { NormalizedIntakeEvent } from '../intake/channel-event.types';
import type { ChannelPollAdapter, ChannelPollResult } from './channel-poll-adapter';

/**
 * Gmail-Abruf mit Fortschrittsmarke. Pro Takt werden die Kennungen **bis zur Marke** gelesen (neueste zuerst, seitenweise), die noch unbekannten (kein Eingang mit dieser Kennung) vollständig geholt – höchstens
 * `GMAIL_POLL_BATCH_SIZE` je Takt, die ältesten zuerst. **Solange danach noch Unbekanntes übrig ist, bleibt die Marke stehen**; erst wenn der Rückstand abgearbeitet ist, rückt sie auf die neueste gesehene Nachricht.
 * Damit geht auch ein Rückstand weit über das Fenster hinaus (nach einer Unterbrechung oder bei einem Schwall) nicht verloren; die Anzahl je Takt begrenzt nur das Tempo. Beim allerersten Abruf (keine Marke) gelten
 * die neuesten `GMAIL_POLL_WINDOW` Nachrichten als Umfang; der Rand dieses Fensters wird zur Marke, damit der Umfang nicht mit neu eintreffenden Nachrichten wegwandert.
 * Früher wurden nur die zehn neuesten Nachrichten betrachtet (Messlauf 21.10.: drei Mails lagen im Posteingang, ORBIT kannte sie nicht), danach ein festes Fenster von 200 ohne Fortschrittsmarke.
 */
const GMAIL_POLL_BATCH_SIZE = 25;
const GMAIL_POLL_WINDOW = 200;
/** Obergrenze der in einem Takt gelesenen Kennungen mit Marke (nur Kennungen, 100 je Anfrage); wird sie erreicht, ohne die Marke zu finden (Marke gelöscht), endet das Lesen dort. */
const GMAIL_MAX_BACKLOG_SCAN = 5000;
const KNOWN_LOOKUP_CHUNK = 1000;

interface PollState {
  /** Kennung der ersten Nachricht, die **nicht mehr** zum Umfang gehört (nicht enthalten); `null` = bis zum Anfang des Postfachs. */
  mark: string | null;
}

/** Ein Marker im Format `{"v":1,"mark":…}`; der frühere Wert (nur eine Kennung) trägt keinen Fortschritt und gilt wie ein erster Abruf. */
function parseCursor(cursor: string | null): PollState | null {
  if (!cursor?.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(cursor) as { v?: number; mark?: string | null };
    if (parsed.v !== 1) return null;
    return { mark: typeof parsed.mark === 'string' ? parsed.mark : null };
  } catch {
    return null;
  }
}

const serializeCursor = (state: PollState): string => JSON.stringify({ v: 1, mark: state.mark });

/**
 * The ONLY Gmail-specific code in the Channel Event Runtime (§1/§6 of
 * `docs/CHANNEL_EVENT_RUNTIME_PLAN.md`: "No Gmail-specific Finance/Sales
 * routing logic"). Translates `GmailConnectorService.listMessages()`'s
 * output into the generic `NormalizedIntakeEvent` shape — nothing here
 * decides relevance, domain, or routing; that's `IntakeService`'s job,
 * reached only through the generic sync runtime (Increment D), never
 * called directly by this adapter.
 *
 * **Cursor = Fortschrittsmarke** (siehe oben), nicht die Korrektheitsgarantie: Eine bereits gesehene Nachricht wird nie ein zweites Mal verarbeitet, weil die Idempotenz bei der Aufnahme
 * (`WebhookIdempotencyService`, eindeutige Eingangs-Kennung) und der Filter „unbekannt“ sie ausschließen – auch wenn ein Takt unterbrochen wurde und derselbe Abschnitt noch einmal gelesen wird.
 * Ein inkrementeller Abruf über `history.list` wird bewusst nicht benutzt (Drittanbieter-Vertrag, der erst gegen die offizielle Dokumentation zu prüfen wäre).
 */
@Injectable()
export class GmailPollAdapter implements ChannelPollAdapter {
  readonly connectorType = 'GMAIL' as const;
  private readonly logger = new Logger(GmailPollAdapter.name);

  constructor(
    private readonly gmailConnector: GmailConnectorService,
    private readonly prisma: PrismaService,
  ) {}

  async poll(tenantId: string, connectionId: string, cursor: string | null): Promise<ChannelPollResult> {
    const state = parseCursor(cursor);
    const scan = await this.gmailConnector.listMessageIdsSince(tenantId, state?.mark ?? null, state ? GMAIL_MAX_BACKLOG_SCAN : GMAIL_POLL_WINDOW);
    if (state?.mark && !scan.markFound) this.logger.warn(`Gmail-Marke ${state.mark} nicht gefunden (Tenant ${tenantId}); gelesen wurden die neuesten ${scan.ids.length} Kennungen.`);
    const ids = scan.ids;
    const known = await this.knownIds(tenantId, ids);
    // Die Liste ist neueste-zuerst; unbekannte werden von den ältesten an abgearbeitet.
    const unseenNewestFirst = ids.filter((id) => !known.has(id));
    const batch = unseenNewestFirst.slice(-GMAIL_POLL_BATCH_SIZE).reverse();
    const emails = batch.length === 0 ? [] : await this.gmailConnector.fetchMessages(tenantId, batch);
    const connectedAddress = await this.connectedAddress(tenantId, connectionId);
    const events = emails.map((email) => this.toNormalizedIntakeEvent(tenantId, connectionId, email, connectedAddress));
    const remaining = unseenNewestFirst.length - batch.length;
    // Rückstand übrig: die Marke bleibt (beim ersten Abruf wird der Rand des Fensters zur Marke). Sonst rückt sie auf die neueste gesehene Nachricht.
    const nextCursor =
      remaining > 0 ? serializeCursor({ mark: state ? state.mark : scan.boundary }) : ids[0] !== undefined ? serializeCursor({ mark: ids[0] }) : cursor;
    return { events, nextCursor };
  }

  private async knownIds(tenantId: string, ids: readonly string[]): Promise<Set<string>> {
    const known = new Set<string>();
    for (let i = 0; i < ids.length; i += KNOWN_LOOKUP_CHUNK) {
      const rows = await this.prisma
        .forTenantId(tenantId)
        .intakeEvent.findMany({ where: { provider: 'gmail', externalEventId: { in: ids.slice(i, i + KNOWN_LOOKUP_CHUNK) as string[] } }, select: { externalEventId: true } });
      for (const row of rows) known.add(row.externalEventId);
    }
    return known;
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
