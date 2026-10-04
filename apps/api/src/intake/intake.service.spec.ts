import { MockLLMProvider } from '@orbit/agent-core';
import { ValidationFailedError } from '@orbit/shared';
import { IntakeService } from './intake.service';
import { SUBMIT_TRIAGE_TOOL } from './semantic-triage.service';

function buildService(provider: unknown) {
  const prisma = { forTenantId: jest.fn(() => {
    throw new Error('prisma must not be touched when the scenario hook is refused');
  }) };
  const triage = { triage: jest.fn() };
  const service = new IntakeService(
    new MockLLMProvider(),
    {} as never,
    { resolveForTenant: jest.fn().mockResolvedValue(provider) } as never,
    triage as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    prisma as never,
    {} as never,
    {} as never,
  );
  return { service, prisma, triage };
}

const INPUT = {
  fromAddress: 'kunde@example.com',
  toAddresses: ['info@firma.example'],
  subject: 'Anfrage',
  bodyText: 'Text',
  simulatedTriageScenario: 'REQUEST_FOR_QUOTE' as const,
};

describe('IntakeService simulated triage scenarios (Amendment 02 §22.4)', () => {
  it('refuses a simulation scenario when a real provider would decide — a user can never inject a verdict into a live AI run', async () => {
    const realProvider = { providerName: 'anthropic', complete: jest.fn() };
    const { service, prisma, triage } = buildService(realProvider);

    await expect(service.handleIncomingEmail('tenant_1', 'user_1', INPUT)).rejects.toBeInstanceOf(ValidationFailedError);

    expect(prisma.forTenantId).not.toHaveBeenCalled(); // nothing was stored
    expect(triage.triage).not.toHaveBeenCalled();
    expect(realProvider.complete).not.toHaveBeenCalled();
  });

  it('scripts the simulated provider with exactly the chosen scenario as a structured tool call', async () => {
    const mock = new MockLLMProvider();
    const { service } = buildService(mock);
    // handleIntakeEvent will fail on the prisma stub right after seeding; the seeding itself is what is asserted.
    await expect(service.handleIncomingEmail('tenant_1', 'user_1', INPUT)).rejects.toThrow('prisma must not be touched');

    const seeded = await mock.complete({ messages: [], tools: [] });
    expect(seeded.toolCalls[0]).toMatchObject({ toolName: SUBMIT_TRIAGE_TOOL });
    expect((seeded.toolCalls[0]?.input as { category: string }).category).toBe('REQUEST_FOR_QUOTE');
  });
});
