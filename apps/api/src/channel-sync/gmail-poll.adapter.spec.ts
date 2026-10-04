import type { InboundEmail } from '@orbit/integration-core';
import { GmailPollAdapter } from './gmail-poll.adapter';
import { GmailConnectorService } from '../integrations/gmail-connector.service';

describe('GmailPollAdapter', () => {
  function buildAdapter(emails: InboundEmail[]) {
    const gmailConnector = { listMessages: jest.fn().mockResolvedValue(emails) } as unknown as GmailConnectorService;
    return { adapter: new GmailPollAdapter(gmailConnector), gmailConnector };
  }

  it('translates InboundEmail[] into NormalizedIntakeEvent[] with the EMAIL/gmail channel tagging and the given connectionId', async () => {
    const receivedAt = new Date('2026-10-04T08:00:00Z');
    const { adapter } = buildAdapter([
      {
        providerMessageId: 'msg-1',
        from: 'kunde@example.com',
        to: ['vertrieb@musterwerk.example'],
        subject: 'Anfrage',
        bodyText: 'Wir haben Interesse.',
        receivedAt,
        attachments: [],
      },
    ]);

    const result = await adapter.poll('tenant_1', 'connection_1', null);

    expect(result.events).toEqual([
      {
        tenantId: 'tenant_1',
        connectionId: 'connection_1',
        channel: 'EMAIL',
        provider: 'gmail',
        externalEventId: 'msg-1',
        occurredAt: receivedAt,
        sender: { address: 'kunde@example.com' },
        recipients: [{ address: 'vertrieb@musterwerk.example' }],
        subject: 'Anfrage',
        content: 'Wir haben Interesse.',
        attachments: [],
      },
    ]);
  });

  it('calls GmailConnectorService.listMessages with the given tenantId, ignoring the cursor (no incremental fetch support — see the adapter\'s own doc comment)', async () => {
    const { adapter, gmailConnector } = buildAdapter([]);

    await adapter.poll('tenant_2', 'connection_2', 'some-previous-cursor');

    expect(gmailConnector.listMessages).toHaveBeenCalledWith('tenant_2', expect.any(Number));
  });

  it('sets nextCursor to the most recently fetched message id, or keeps the previous cursor if nothing new was fetched', async () => {
    const { adapter: adapterWithResults } = buildAdapter([
      {
        providerMessageId: 'newest-msg',
        from: 'a@example.com',
        to: ['b@example.com'],
        subject: 's',
        bodyText: 'b',
        receivedAt: new Date(),
        attachments: [],
      },
    ]);
    const resultWithResults = await adapterWithResults.poll('tenant_3', 'connection_3', 'old-cursor');
    expect(resultWithResults.nextCursor).toBe('newest-msg');

    const { adapter: adapterEmpty } = buildAdapter([]);
    const resultEmpty = await adapterEmpty.poll('tenant_3', 'connection_3', 'old-cursor');
    expect(resultEmpty.nextCursor).toBe('old-cursor');
  });
});
