import { Injectable } from '@nestjs/common';
import { NotFoundError } from '@orbit/shared';
import type { Conversation, ConversationMessage } from '@orbit/domain';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * §29 des Master-Dokuments ("Sonde backend and conversation model") —
 * reines CRUD für `Conversation`/`ConversationMessage`. Bewusst getrennt
 * von `CopilotRuntimeService` (das die eigentliche Turn-Ausführung über
 * AgentRuntime/Policy Engine übernimmt) — derselbe Schnitt wie
 * `PolicyConfigService`/`PolicyEnforcementService` oder
 * `AgentDefinitionsService`/`AgentDefinitionResolverService` an anderer
 * Stelle in diesem Projekt: administrative CRUD vs. heißer Laufzeit-Pfad.
 *
 * Konversationen sind bewusst **persönlich** (§29: `userId` ist Teil des
 * Modells) — ein Nutzer sieht nur seine eigenen, nicht die eines anderen
 * Nutzers im selben Tenant, selbst mit TENANT_ADMIN-Rechten. Das ist ein
 * absichtlicher Datenschutz-Schnitt (Sonde-Gespräche können sensible,
 * beiläufig erwähnte Informationen enthalten), keine übersehene
 * Zugriffskontrolle.
 */
@Injectable()
export class CopilotConversationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  listConversations(tenantId: string, userId: string): Promise<Conversation[]> {
    return this.prisma.forTenantId(tenantId).conversation.findMany({
      where: { userId },
      orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async getConversation(tenantId: string, userId: string, id: string): Promise<Conversation> {
    const found = await this.prisma.forTenantId(tenantId).conversation.findUnique({ where: { id } });
    if (!found || found.userId !== userId) {
      throw new NotFoundError('Conversation not found.', { id });
    }
    return found;
  }

  async createConversation(tenantId: string, userId: string, title: string | undefined): Promise<Conversation> {
    const created = await this.prisma.forTenantId(tenantId).conversation.create({ data: { tenantId, userId, title } });

    await this.audit.record({
      tenantId,
      eventType: 'COPILOT_CONVERSATION_STARTED',
      actorType: 'USER',
      actorUserId: userId,
      entityType: 'Conversation',
      entityId: created.id,
      payload: {},
    });

    return created;
  }

  async deleteConversation(tenantId: string, userId: string, id: string): Promise<void> {
    await this.getConversation(tenantId, userId, id);
    await this.prisma.forTenantId(tenantId).conversation.delete({ where: { id } });

    await this.audit.record({
      tenantId,
      eventType: 'COPILOT_CONVERSATION_DELETED',
      actorType: 'USER',
      actorUserId: userId,
      entityType: 'Conversation',
      entityId: id,
      payload: {},
    });
  }

  async listMessages(tenantId: string, userId: string, conversationId: string): Promise<ConversationMessage[]> {
    await this.getConversation(tenantId, userId, conversationId);
    return this.prisma.forTenantId(tenantId).conversationMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
    });
  }
}
