import { ToolRegistry } from '@orbit/agent-core';
import { IntegrationUnavailableError } from '@orbit/shared';
import { SalesAgentTools } from './sales.tools';

/**
 * `send_email` darf eine Mail nur dann als versendet führen, wenn der Anbieter den Versand bestätigt hat. Früher rief das Werkzeug einen Mock auf und setzte
 * `sentAt` trotzdem – eine „erledigte“ Aktion ohne Wirkung, unabhängig vom Zustand der Gmail-Verbindung.
 */
describe('SalesAgentTools send_email', () => {
  let email: { findUnique: jest.Mock; update: jest.Mock };
  let send: jest.Mock;
  let registry: ToolRegistry;

  const draft = {
    id: 'mail_1',
    toAddresses: ['kunde@example.com', 'zweite@example.com'],
    subject: 'Ihr Angebot',
    bodyText: 'x'.repeat(900), // länger als die 500 Zeichen der Vorschau
    bodyPreview: 'x'.repeat(500),
    sentAt: null as Date | null,
    threadId: null,
    inReplyTo: null,
    references: [] as string[],
    rfcMessageId: null,
    fromAddress: 'Kein Postfach verbunden',
  };

  beforeEach(() => {
    email = { findUnique: jest.fn().mockResolvedValue({ ...draft }), update: jest.fn().mockImplementation(async ({ data }) => ({ ...draft, ...data })) };
    send = jest.fn();
    const prisma = { forTenantId: jest.fn().mockReturnValue({ emailMessage: email }) };
    registry = new ToolRegistry();
    new SalesAgentTools({} as never, {} as never, {} as never, {} as never, {} as never, {} as never, prisma as never, {} as never, {} as never, { send } as never).register(registry);
  });

  const run = () => registry.execute('send_email', { draftEmailId: 'mail_1' }, { tenantId: 'tenant_1', agentRunId: 'run_1', actorUserId: 'user_1' });

  it('sendet über das verbundene Postfach, mit dem VOLLEN Text, und führt die Mail erst nach der Bestätigung des Anbieters als gesendet', async () => {
    send.mockResolvedValue({ providerMessageId: 'gm_1', threadId: 'th_1', rfcMessageId: '<m@x>', from: 'me@example.com', executionMode: 'LIVE' });

    await run();

    expect(send).toHaveBeenCalledWith('tenant_1', expect.objectContaining({ to: 'kunde@example.com, zweite@example.com', subject: 'Ihr Angebot', bodyText: draft.bodyText }));
    expect(email.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ providerMessageId: 'gm_1', threadId: 'th_1', rfcMessageId: '<m@x>', fromAddress: 'me@example.com', sentAt: expect.any(Date) }) }),
    );
  });

  it('ist die Verbindung unterbrochen, wirft das Werkzeug – die Mail wird NICHT als gesendet geführt', async () => {
    send.mockRejectedValue(new IntegrationUnavailableError('Die Verbindung zu Gmail ist unterbrochen. Die E-Mail wurde nicht gesendet.'));

    await expect(run()).rejects.toThrow(/Gmail ist unterbrochen|Verbindung zu Gmail ist unterbrochen/);

    expect(email.update).not.toHaveBeenCalled();
  });

  it('eine bereits gesendete Mail wird nie ein zweites Mal gesendet', async () => {
    email.findUnique.mockResolvedValue({ ...draft, sentAt: new Date('2026-10-01T10:00:00Z') });

    await run();

    expect(send).not.toHaveBeenCalled();
    expect(email.update).not.toHaveBeenCalled();
  });
});
