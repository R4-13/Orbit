import { ToolRegistry, type ToolExecutionContext } from '@orbit/agent-core';
import { SalesAgentTools } from './sales.tools';

/** Absicherung der Absenderbindung (Messlauf 21.10.): eine vom Modell genannte, formal gültige Adresse legt ohne Herkunft aus dem Vorgang keinen Kontakt an und erhält keine Nachricht. */
describe('Vertriebs-Agent: Adressen stammen aus dem Vorgang', () => {
  const upsert = jest.fn(async (_t: string, _u: unknown, input: { email?: string }) => ({ id: 'c1', email: input.email }));
  const messages = [{ fromAddress: 'Tom.Orbit@Gmail.com', bodyText: 'Bitte um Rückruf, erreichbar auch unter mueller@firma.example. Danke' }];
  const prisma = {
    forTenantId: () => ({
      agentRun: { findUnique: async () => ({ caseId: 'case-1' }) },
      case: { findFirst: async () => ({ parentCaseId: null }), findMany: async () => [] },
      emailMessage: { findMany: async () => messages, create: jest.fn(async () => ({ id: 'd1' })) },
      integration: { findFirst: async () => null },
    }),
  };
  const tools = new SalesAgentTools({ upsert } as never, {} as never, {} as never, {} as never, {} as never, {} as never, prisma as never, {} as never, {} as never, {} as never);
  const registry = new ToolRegistry();
  tools.register(registry);
  const context = { tenantId: 't1', agentRunId: 'run-1' } as ToolExecutionContext;
  const run = (name: string, input: Record<string, unknown>) => registry.get(name)!.execute(input as never, context);

  beforeEach(() => upsert.mockClear());

  it('die Absenderadresse (unabhängig von der Schreibweise) und eine im Text genannte Adresse sind zulässig', async () => {
    await expect(run('create_contact', { email: 'tom.orbit@gmail.com', firstName: 'Tom', lastName: 'Orbit' })).resolves.toBeDefined();
    await expect(run('create_contact', { email: 'mueller@firma.example', firstName: 'M', lastName: 'Müller' })).resolves.toBeDefined();
    expect(upsert).toHaveBeenCalledTimes(2);
  });

  it('eine erfundene, formal gültige Adresse wird nicht verwendet – kein Kontakt, kein Entwurf', async () => {
    await expect(run('create_contact', { email: 'info@kunde-erfunden.example', firstName: 'X', lastName: 'Y' })).rejects.toMatchObject({ errorCode: 'ADDRESS_NOT_FROM_CASE' });
    await expect(run('draft_email', { toAddress: 'chef@erfunden.example', subject: 'Hallo', bodyText: 'Text' })).rejects.toMatchObject({ errorCode: 'ADDRESS_NOT_FROM_CASE' });
    expect(upsert).not.toHaveBeenCalled();
  });
});
