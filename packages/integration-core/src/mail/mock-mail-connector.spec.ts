import { describe, expect, it } from 'vitest';
import { MockMailConnector } from './mock-mail-connector';

describe('MockMailConnector', () => {
  it('listNewMessages() with no cursor returns everything seeded so far', async () => {
    const connector = new MockMailConnector();
    connector.seedInboundEmail({
      from: 'kunde@example.com',
      to: ['sales@orbit.local'],
      subject: 'Anfrage',
      bodyText: 'Hallo, ich interessiere mich für...',
      receivedAt: new Date(),
      attachments: [],
    });

    expect(await connector.listNewMessages()).toHaveLength(1);
  });

  it('listNewMessages(cursor) returns only messages after that provider message id', async () => {
    const connector = new MockMailConnector();
    const first = connector.seedInboundEmail({
      from: 'a@example.com',
      to: ['x@orbit.local'],
      subject: 'A',
      bodyText: '...',
      receivedAt: new Date(),
      attachments: [],
    });
    connector.seedInboundEmail({
      from: 'b@example.com',
      to: ['x@orbit.local'],
      subject: 'B',
      bodyText: '...',
      receivedAt: new Date(),
      attachments: [],
    });

    const result = await connector.listNewMessages(first.providerMessageId);
    expect(result).toHaveLength(1);
    expect(result[0]?.subject).toBe('B');
  });

  it('sendMessage() records the send and returns a unique provider message id', async () => {
    const connector = new MockMailConnector();
    const result = await connector.sendMessage({
      to: ['kunde@example.com'],
      subject: 'Re: Anfrage',
      bodyText: 'Vielen Dank für Ihre Anfrage...',
    });

    expect(result.providerMessageId).toMatch(/^mock-sent-/);
    expect(connector.getSentMessages()).toHaveLength(1);
  });
});
