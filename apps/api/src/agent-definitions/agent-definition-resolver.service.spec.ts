import { Test } from '@nestjs/testing';
import { AgentRuntime, ToolRegistry, type LLMCompletionRequest, type LLMCompletionResult } from '@orbit/agent-core';
import { z } from 'zod';
import { LLM_PROVIDER, TOOL_REGISTRY } from '../agent/agent.tokens';
import { PolicyEnforcementService } from '../policy/policy-enforcement.service';
import { PrismaService } from '../prisma/prisma.service';
import { AgentDefinitionResolverService } from './agent-definition-resolver.service';

describe('AgentDefinitionResolverService', () => {
  let service: AgentDefinitionResolverService;
  let scoped: { agentDefinition: { findUnique: jest.Mock } };
  let prisma: { forTenantId: jest.Mock };
  let toolRegistry: ToolRegistry;
  let capturedRequest: LLMCompletionRequest | undefined;
  const fakeLlm = {
    providerName: 'fake',
    complete: jest.fn().mockImplementation(async (request: LLMCompletionRequest): Promise<LLMCompletionResult> => {
      capturedRequest = request;
      return { toolCalls: [], stopReason: 'end_turn' };
    }),
  };

  beforeEach(async () => {
    capturedRequest = undefined;
    scoped = { agentDefinition: { findUnique: jest.fn() } };
    prisma = { forTenantId: jest.fn().mockReturnValue(scoped) };

    toolRegistry = new ToolRegistry();
    toolRegistry.register({
      name: 'classify_message',
      description: 'Classifies a message.',
      inputSchema: z.object({}),
      policyAction: 'email.classify',
      execute: async () => ({}),
    });
    toolRegistry.register({
      name: 'extract_invoice',
      description: 'Extracts an invoice.',
      inputSchema: z.object({}),
      policyAction: 'invoice.intake',
      execute: async () => ({}),
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        AgentDefinitionResolverService,
        { provide: PrismaService, useValue: prisma },
        { provide: LLM_PROVIDER, useValue: fakeLlm },
        { provide: TOOL_REGISTRY, useValue: toolRegistry },
        { provide: PolicyEnforcementService, useValue: { resolveMode: jest.fn() } },
      ],
    }).compile();

    service = moduleRef.get(AgentDefinitionResolverService);
  });

  it('throws IntegrationUnavailableError when no AgentDefinition row exists for the key', async () => {
    scoped.agentDefinition.findUnique.mockResolvedValue(null);
    await expect(service.resolve('tenant_1', 'does-not-exist')).rejects.toMatchObject({
      code: 'INTEGRATION_UNAVAILABLE',
    });
  });

  it('throws IntegrationUnavailableError when the row is not ACTIVE', async () => {
    scoped.agentDefinition.findUnique.mockResolvedValue({
      key: 'sales-intake',
      status: 'DRAFT',
      systemPrompt: 'x',
      allowedTools: ['classify_message'],
    });
    await expect(service.resolve('tenant_1', 'sales-intake')).rejects.toMatchObject({
      code: 'INTEGRATION_UNAVAILABLE',
    });
  });

  it('returns the stored prompt and a runtime scoped to only the allowed tools', async () => {
    scoped.agentDefinition.findUnique.mockResolvedValue({
      key: 'finance-intake',
      status: 'ACTIVE',
      systemPrompt: 'Du bist der Finance-Agent.',
      allowedTools: ['extract_invoice'],
    });

    const resolved = await service.resolve('tenant_1', 'finance-intake');
    expect(resolved.systemPrompt).toBe('Du bist der Finance-Agent.');
    expect(resolved.runtime).toBeInstanceOf(AgentRuntime);

    // The real proof of scoping: the LLM only ever sees the one tool this
    // definition grants, not the full two-tool registry it was built from.
    await resolved.runtime.runTurn(
      { tenantId: 'tenant_1', agentRunId: 'run_1' },
      { systemPrompt: resolved.systemPrompt, messages: [{ role: 'user', content: 'hi' }] },
    );
    expect(capturedRequest?.tools?.map((t) => t.name)).toEqual(['extract_invoice']);
  });

  describe('resolveForTestRun', () => {
    it('throws NotFoundError when no row exists for the key', async () => {
      scoped.agentDefinition.findUnique.mockResolvedValue(null);
      await expect(service.resolveForTestRun('tenant_1', 'does-not-exist')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('throws NotFoundError when the row is DISABLED', async () => {
      scoped.agentDefinition.findUnique.mockResolvedValue({
        key: 'sales-intake',
        status: 'DISABLED',
        systemPrompt: 'x',
        allowedTools: ['classify_message'],
      });
      await expect(service.resolveForTestRun('tenant_1', 'sales-intake')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('resolves a DRAFT definition (unlike resolve(), which rejects it)', async () => {
      scoped.agentDefinition.findUnique.mockResolvedValue({
        key: 'custom-agent',
        status: 'DRAFT',
        baseType: 'SALES',
        systemPrompt: 'Du bist ein Entwurfs-Agent.',
        allowedTools: ['classify_message'],
      });

      const resolved = await service.resolveForTestRun('tenant_1', 'custom-agent');
      expect(resolved.systemPrompt).toBe('Du bist ein Entwurfs-Agent.');
      expect(resolved.baseType).toBe('SALES');
      expect(resolved.runtime).toBeInstanceOf(AgentRuntime);
    });
  });
});
