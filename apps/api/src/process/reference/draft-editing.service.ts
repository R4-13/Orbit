import { Injectable, OnModuleInit, UnprocessableEntityException } from '@nestjs/common';
import type { Prisma } from '@orbit/domain';
import { PrismaService } from '../../prisma/prisma.service';
import { CaseCommandsService } from '../case-commands.service';
import { OrchestratorService } from '../orchestrator.service';
import { PlanStoreService } from '../plan-store.service';
import { ReferenceProcessService } from './reference-process.service';

/**
 * EDIT_DRAFT (Amendment 02 §17.2): a person changes subject and/or text of the current draft before it is sent.
 * Recipient and attachments are deliberately NOT editable here — the recipient is the verified reply target. The edit
 * creates a new immutable draft version, repoints the node that produced the draft, and voids the approval that was
 * bound to the old content: the send step then prepares a fresh intent that needs a fresh approval.
 */
@Injectable()
export class DraftEditingService implements OnModuleInit {
  constructor(
    private readonly commands: CaseCommandsService,
    private readonly prisma: PrismaService,
    private readonly reference: ReferenceProcessService,
    private readonly store: PlanStoreService,
    private readonly orchestrator: OrchestratorService,
  ) {}

  onModuleInit(): void {
    this.commands.registerHandler('EDIT_DRAFT', async ({ actor, caseRow, payload }) => {
      const input = payload as { draftId: string; subject?: string; bodyText?: string };
      const scoped = this.prisma.forTenantId(actor.tenantId);
      const draft = await scoped.communicationDraft.findFirst({ where: { id: input.draftId, caseId: caseRow.id } });
      if (!draft) throw new UnprocessableEntityException('Der Entwurf gehört nicht zu diesem Vorgang.');
      if (draft.status !== 'DRAFT') throw new UnprocessableEntityException('Dieser Entwurf ist bereits versendet oder ersetzt.');
      if (input.subject && /[\r\n]/.test(input.subject)) throw new UnprocessableEntityException('Der Betreff darf keinen Zeilenumbruch enthalten.');

      const { draft: next, created } = await this.reference.saveDraftVersion(actor.tenantId, {
        caseId: caseRow.id,
        purpose: draft.purpose,
        toAddress: draft.toAddress,
        subject: input.subject ?? draft.subject,
        bodyText: input.bodyText ?? draft.bodyText,
        attachmentDocumentIds: draft.attachmentDocumentIds,
        threadId: draft.threadId ?? undefined,
        inReplyTo: draft.inReplyTo ?? undefined,
        createdByUserId: actor.id,
      });
      if (!created) return;

      // Repoint the producing node's output at the new version and void what was approved for the old one.
      const graph = await this.store.getActive(actor.tenantId, caseRow.id);
      const producer = graph?.nodes.find((n) => (n.output as { draftId?: string } | null)?.draftId === draft.id);
      if (graph && producer) {
        await this.store.setNodeOutput(actor.tenantId, caseRow.id, graph.plan.id, producer.nodeKey, { ...(producer.output as object), draftId: next.id, version: next.version, contentHash: next.contentHash, subject: next.subject } as Prisma.InputJsonValue);
        const consumers = graph.edges.filter((e) => e.sourceKey === producer.nodeKey).map((e) => e.targetKey);
        for (const consumer of consumers) await this.orchestrator.invalidateNodeApprovals(actor.tenantId, caseRow.id, consumer);
      }
    });
  }
}
