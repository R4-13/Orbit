import { Test } from '@nestjs/testing';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CopilotConversationService } from './copilot-conversation.service';

describe('CopilotConversationService', () => {
  let service: CopilotConversationService;
  let scoped: {
    conversation: { findMany: jest.Mock; findUnique: jest.Mock; create: jest.Mock; delete: jest.Mock };
    conversationMessage: { findMany: jest.Mock };
  };
  let prisma: { forTenantId: jest.Mock };
  let audit: { record: jest.Mock };

  beforeEach(async () => {
    scoped = {
      conversation: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), delete: jest.fn() },
      conversationMessage: { findMany: jest.fn() },
    };
    prisma = { forTenantId: jest.fn().mockReturnValue(scoped) };
    audit = { record: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [CopilotConversationService, { provide: PrismaService, useValue: prisma }, { provide: AuditService, useValue: audit }],
    }).compile();

    service = moduleRef.get(CopilotConversationService);
  });

  describe('listConversations', () => {
    it('scopes to the calling user, ordered by most recent activity', async () => {
      scoped.conversation.findMany.mockResolvedValue([]);
      await service.listConversations('tenant_1', 'user_1');
      expect(scoped.conversation.findMany).toHaveBeenCalledWith({
        where: { userId: 'user_1' },
        orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
      });
    });
  });

  describe('getConversation', () => {
    it('throws NotFoundError when no row exists', async () => {
      scoped.conversation.findUnique.mockResolvedValue(null);
      await expect(service.getConversation('tenant_1', 'user_1', 'conv_1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it("throws NotFoundError when the conversation belongs to a different user (never leaks another user's conversation)", async () => {
      scoped.conversation.findUnique.mockResolvedValue({ id: 'conv_1', userId: 'someone_else' });
      await expect(service.getConversation('tenant_1', 'user_1', 'conv_1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('returns the conversation when owned by the calling user', async () => {
      scoped.conversation.findUnique.mockResolvedValue({ id: 'conv_1', userId: 'user_1' });
      await expect(service.getConversation('tenant_1', 'user_1', 'conv_1')).resolves.toMatchObject({ id: 'conv_1' });
    });
  });

  describe('createConversation', () => {
    it('creates the row and records COPILOT_CONVERSATION_STARTED', async () => {
      scoped.conversation.create.mockResolvedValue({ id: 'conv_1', tenantId: 'tenant_1', userId: 'user_1' });

      const result = await service.createConversation('tenant_1', 'user_1', 'Meine Frage');

      expect(scoped.conversation.create).toHaveBeenCalledWith({
        data: { tenantId: 'tenant_1', userId: 'user_1', title: 'Meine Frage' },
      });
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'COPILOT_CONVERSATION_STARTED' }));
      expect(result.id).toBe('conv_1');
    });
  });

  describe('deleteConversation', () => {
    it('throws NotFoundError instead of deleting when not owned by the calling user', async () => {
      scoped.conversation.findUnique.mockResolvedValue({ id: 'conv_1', userId: 'someone_else' });
      await expect(service.deleteConversation('tenant_1', 'user_1', 'conv_1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(scoped.conversation.delete).not.toHaveBeenCalled();
    });

    it('deletes the row and records COPILOT_CONVERSATION_DELETED', async () => {
      scoped.conversation.findUnique.mockResolvedValue({ id: 'conv_1', userId: 'user_1' });
      await service.deleteConversation('tenant_1', 'user_1', 'conv_1');
      expect(scoped.conversation.delete).toHaveBeenCalledWith({ where: { id: 'conv_1' } });
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'COPILOT_CONVERSATION_DELETED' }));
    });
  });

  describe('listMessages', () => {
    it('throws NotFoundError when the conversation is not owned by the calling user', async () => {
      scoped.conversation.findUnique.mockResolvedValue({ id: 'conv_1', userId: 'someone_else' });
      await expect(service.listMessages('tenant_1', 'user_1', 'conv_1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('returns messages ordered chronologically once ownership is confirmed', async () => {
      scoped.conversation.findUnique.mockResolvedValue({ id: 'conv_1', userId: 'user_1' });
      scoped.conversationMessage.findMany.mockResolvedValue([{ id: 'm1' }]);

      const result = await service.listMessages('tenant_1', 'user_1', 'conv_1');

      expect(scoped.conversationMessage.findMany).toHaveBeenCalledWith({
        where: { conversationId: 'conv_1' },
        orderBy: { createdAt: 'asc' },
      });
      expect(result).toEqual([{ id: 'm1' }]);
    });
  });
});
