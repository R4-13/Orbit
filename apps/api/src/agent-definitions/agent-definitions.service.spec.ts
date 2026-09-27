import { Test } from '@nestjs/testing';
import { Prisma } from '@orbit/domain';
import { z } from 'zod';
import { TOOL_REGISTRY } from '../agent/agent.tokens';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { AgentDefinitionsService } from './agent-definitions.service';
import { AgentEvaluationService } from './agent-evaluation.service';
import { AgentBaseTypeDto } from './dto/create-agent-definition.dto';
import { AgentDefinitionStatusDto } from './dto/update-agent-definition.dto';

function uniqueViolation(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

describe('AgentDefinitionsService', () => {
  let service: AgentDefinitionsService;
  let scoped: {
    agentDefinition: { findMany: jest.Mock; findUnique: jest.Mock; create: jest.Mock; update: jest.Mock };
    agentDefinitionVersion: { findMany: jest.Mock; findFirst: jest.Mock; create: jest.Mock };
  };
  let prisma: { forTenantId: jest.Mock };
  let audit: { record: jest.Mock };
  let evaluation: { assertCriticalCasesPass: jest.Mock };
  let toolRegistry: { list: jest.Mock; describe: jest.Mock };

  beforeEach(async () => {
    scoped = {
      agentDefinition: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
      agentDefinitionVersion: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
    };
    prisma = { forTenantId: jest.fn().mockReturnValue(scoped) };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    evaluation = { assertCriticalCasesPass: jest.fn().mockResolvedValue(undefined) };
    toolRegistry = {
      list: jest.fn().mockReturnValue([
        { name: 'classify_message', description: 'Classifies a message.', policyAction: 'email.classify', inputSchema: z.object({}) },
        { name: 'extract_invoice', description: 'Extracts an invoice.', policyAction: 'invoice.intake', inputSchema: z.object({}) },
      ]),
      describe: jest.fn().mockReturnValue([
        { name: 'classify_message', description: 'Classifies a message.', policyAction: 'email.classify', inputSchema: {} },
        { name: 'extract_invoice', description: 'Extracts an invoice.', policyAction: 'invoice.intake', inputSchema: {} },
      ]),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AgentDefinitionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
        { provide: AgentEvaluationService, useValue: evaluation },
        { provide: TOOL_REGISTRY, useValue: toolRegistry },
      ],
    }).compile();

    service = moduleRef.get(AgentDefinitionsService);
  });

  describe('listTools', () => {
    it('delegates to ToolRegistry.describe()', () => {
      const tools = service.listTools();
      expect(tools).toHaveLength(2);
      expect(toolRegistry.describe).toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('throws NotFoundError when no row matches', async () => {
      scoped.agentDefinition.findUnique.mockResolvedValue(null);
      await expect(service.findOne('tenant_1', 'does-not-exist')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('returns the matching row', async () => {
      scoped.agentDefinition.findUnique.mockResolvedValue({ id: 'def_1', key: 'sales-intake' });
      const result = await service.findOne('tenant_1', 'sales-intake');
      expect(result).toEqual({ id: 'def_1', key: 'sales-intake' });
    });
  });

  describe('create', () => {
    it('rejects an unknown tool name before touching the database', async () => {
      await expect(
        service.create('tenant_1', 'user_1', {
          key: 'custom-agent',
          name: 'Custom Agent',
          baseType: AgentBaseTypeDto.SALES,
          systemPrompt: 'Du bist ein Agent.',
          allowedTools: ['does-not-exist'],
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      expect(scoped.agentDefinition.create).not.toHaveBeenCalled();
    });

    it('creates the definition as DRAFT plus a v1 version row and records AGENT_DEFINITION_CREATED', async () => {
      scoped.agentDefinition.create.mockResolvedValue({
        id: 'def_1',
        key: 'custom-agent',
        systemPrompt: 'Du bist ein Agent.',
        allowedTools: ['classify_message'],
        baseType: 'SALES',
      });

      const result = await service.create('tenant_1', 'user_1', {
        key: 'custom-agent',
        name: 'Custom Agent',
        baseType: AgentBaseTypeDto.SALES,
        systemPrompt: 'Du bist ein Agent.',
        allowedTools: ['classify_message'],
      });

      expect(scoped.agentDefinition.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: 'tenant_1',
          key: 'custom-agent',
          status: 'DRAFT',
          createdByUserId: 'user_1',
        }),
      });
      expect(scoped.agentDefinitionVersion.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ agentDefinitionId: 'def_1', version: 1 }),
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'AGENT_DEFINITION_CREATED', entityId: 'def_1' }),
      );
      expect(result.key).toBe('custom-agent');
    });

    it('translates a duplicate key into ValidationFailedError', async () => {
      scoped.agentDefinition.create.mockRejectedValue(uniqueViolation());

      await expect(
        service.create('tenant_1', 'user_1', {
          key: 'sales-intake',
          name: 'Duplicate',
          baseType: AgentBaseTypeDto.SALES,
          systemPrompt: 'x',
          allowedTools: ['classify_message'],
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });
  });

  describe('update', () => {
    it('increments the version, appends a new AgentDefinitionVersion row, and records AGENT_DEFINITION_UPDATED', async () => {
      scoped.agentDefinition.findUnique.mockResolvedValue({
        id: 'def_1',
        key: 'sales-intake',
        name: 'Sales Agent',
        description: null,
        systemPrompt: 'old prompt',
        allowedTools: ['classify_message'],
        status: 'ACTIVE',
        version: 1,
      });
      scoped.agentDefinition.update.mockResolvedValue({
        id: 'def_1',
        key: 'sales-intake',
        systemPrompt: 'new prompt',
        allowedTools: ['classify_message'],
        version: 2,
      });

      const result = await service.update('tenant_1', 'user_1', 'sales-intake', { systemPrompt: 'new prompt' });

      expect(scoped.agentDefinition.update).toHaveBeenCalledWith({
        where: { tenantId_key: { tenantId: 'tenant_1', key: 'sales-intake' } },
        data: expect.objectContaining({ systemPrompt: 'new prompt', version: 2, updatedByUserId: 'user_1' }),
      });
      expect(scoped.agentDefinitionVersion.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ agentDefinitionId: 'def_1', version: 2, systemPrompt: 'new prompt' }),
      });
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'AGENT_DEFINITION_UPDATED' }));
      expect(result.version).toBe(2);
    });

    it('rejects an unknown tool name in allowedTools', async () => {
      scoped.agentDefinition.findUnique.mockResolvedValue({
        id: 'def_1',
        key: 'sales-intake',
        systemPrompt: 'p',
        allowedTools: [],
        status: 'ACTIVE',
        version: 1,
      });

      await expect(
        service.update('tenant_1', 'user_1', 'sales-intake', { allowedTools: ['does-not-exist'] }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      expect(scoped.agentDefinition.update).not.toHaveBeenCalled();
    });

    it('gates a DRAFT→ACTIVE transition on critical evaluation cases and persists nothing when they fail', async () => {
      scoped.agentDefinition.findUnique.mockResolvedValue({
        id: 'def_1',
        key: 'sales-intake',
        systemPrompt: 'p',
        allowedTools: ['classify_message'],
        baseType: 'SALES',
        status: 'DRAFT',
        version: 1,
      });
      evaluation.assertCriticalCasesPass.mockRejectedValue(
        Object.assign(new Error('blocked'), { code: 'VALIDATION_FAILED' }),
      );

      await expect(
        service.update('tenant_1', 'user_1', 'sales-intake', { status: AgentDefinitionStatusDto.ACTIVE }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      expect(evaluation.assertCriticalCasesPass).toHaveBeenCalledWith('tenant_1', 'user_1', 'sales-intake', {
        systemPrompt: 'p',
        allowedTools: ['classify_message'],
        baseType: 'SALES',
      });
      expect(scoped.agentDefinition.update).not.toHaveBeenCalled();
    });

    it('gates editing the prompt of an already-ACTIVE definition in place, not only an explicit status transition', async () => {
      scoped.agentDefinition.findUnique.mockResolvedValue({
        id: 'def_1',
        key: 'sales-intake',
        systemPrompt: 'old prompt',
        allowedTools: ['classify_message'],
        baseType: 'SALES',
        status: 'ACTIVE',
        version: 1,
      });
      scoped.agentDefinition.update.mockResolvedValue({ id: 'def_1', key: 'sales-intake', version: 2 });

      await service.update('tenant_1', 'user_1', 'sales-intake', { systemPrompt: 'new prompt' });

      expect(evaluation.assertCriticalCasesPass).toHaveBeenCalledWith('tenant_1', 'user_1', 'sales-intake', {
        systemPrompt: 'new prompt',
        allowedTools: ['classify_message'],
        baseType: 'SALES',
      });
    });

    it('does not gate a transition that does not result in ACTIVE (e.g. DRAFT→DISABLED)', async () => {
      scoped.agentDefinition.findUnique.mockResolvedValue({
        id: 'def_1',
        key: 'sales-intake',
        systemPrompt: 'p',
        allowedTools: [],
        baseType: 'SALES',
        status: 'DRAFT',
        version: 1,
      });
      scoped.agentDefinition.update.mockResolvedValue({ id: 'def_1', key: 'sales-intake', version: 2 });

      await service.update('tenant_1', 'user_1', 'sales-intake', { status: AgentDefinitionStatusDto.DISABLED });

      expect(evaluation.assertCriticalCasesPass).not.toHaveBeenCalled();
    });
  });

  describe('rollback', () => {
    it('throws NotFoundError when the target version does not exist', async () => {
      scoped.agentDefinition.findUnique.mockResolvedValue({ id: 'def_1', key: 'sales-intake', version: 3 });
      scoped.agentDefinitionVersion.findFirst.mockResolvedValue(null);

      await expect(service.rollback('tenant_1', 'user_1', 'sales-intake', 1)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('restores the target version as a new current version and records AGENT_DEFINITION_ROLLED_BACK', async () => {
      scoped.agentDefinition.findUnique.mockResolvedValue({
        id: 'def_1',
        key: 'sales-intake',
        version: 3,
      });
      scoped.agentDefinitionVersion.findFirst.mockResolvedValue({
        version: 1,
        systemPrompt: 'original prompt',
        allowedTools: ['classify_message'],
      });
      scoped.agentDefinition.update.mockResolvedValue({
        id: 'def_1',
        key: 'sales-intake',
        systemPrompt: 'original prompt',
        version: 4,
      });

      const result = await service.rollback('tenant_1', 'user_1', 'sales-intake', 1);

      expect(scoped.agentDefinition.update).toHaveBeenCalledWith({
        where: { tenantId_key: { tenantId: 'tenant_1', key: 'sales-intake' } },
        data: expect.objectContaining({ systemPrompt: 'original prompt', version: 4 }),
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'AGENT_DEFINITION_ROLLED_BACK',
          payload: expect.objectContaining({ restoredFromVersion: 1, newVersion: 4 }),
        }),
      );
      expect(result.version).toBe(4);
    });
  });
});
