import { randomUUID } from 'node:crypto';
import type { InboundEmail, MailConnector, SendEmailInput, SendEmailResult } from './types';

/**
 * Deterministic in-memory Mail connector (MAIL_CONNECTOR=mock, the
 * default). `seedInboundEmail()` lets tests/demo scripts inject messages
 * as if they'd arrived, without a real mailbox.
 */
export class MockMailConnector implements MailConnector {
  readonly providerName = 'mock';

  private readonly inbox: InboundEmail[] = [];
  private readonly sent: SendEmailInput[] = [];

  async testConnection(): Promise<boolean> {
    return true;
  }

  async listNewMessages(sinceProviderMessageId?: string): Promise<InboundEmail[]> {
    if (!sinceProviderMessageId) {
      return [...this.inbox];
    }
    const cutoffIndex = this.inbox.findIndex(
      (email) => email.providerMessageId === sinceProviderMessageId,
    );
    return cutoffIndex === -1 ? [...this.inbox] : this.inbox.slice(cutoffIndex + 1);
  }

  async sendMessage(input: SendEmailInput): Promise<SendEmailResult> {
    this.sent.push(input);
    return { providerMessageId: `mock-sent-${randomUUID()}` };
  }

  /** Test/dev helper — not part of the MailConnector contract. */
  seedInboundEmail(email: Omit<InboundEmail, 'providerMessageId'> & { providerMessageId?: string }): InboundEmail {
    const record: InboundEmail = { ...email, providerMessageId: email.providerMessageId ?? `mock-inbound-${randomUUID()}` };
    this.inbox.push(record);
    return record;
  }

  /** Test/dev helper — not part of the MailConnector contract. */
  getSentMessages(): readonly SendEmailInput[] {
    return this.sent;
  }
}
