import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@orbit/domain';
import type { HeldAttachment } from '@orbit/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CaseEventsService } from '../process/case-events.service';

const EVENT_TYPE = 'attachment.held';

/**
 * Sichtbare manuelle Übergabe für zurückgehaltene Anhänge (Anhangsfreigabe): Ein Anhang, den die Freigabe nicht zur Verarbeitung zulässt, wird weder gespeichert noch gelesen. Damit er nicht still verloren geht,
 * bekommt der Vorgang eine Aufgabe für eine Person („im Postfach selbst prüfen“) und einen Verlaufseintrag. Genau einmal je Eingang (Markierung im Eingangsereignis, Aufgabe mit festem Titel); hat der
 * Eingang keinen Vorgang (z. B. als Werbung aussortiert), bleibt der Vermerk am Eingangsereignis sichtbar.
 */
@Injectable()
export class HeldAttachmentService {
  private readonly logger = new Logger(HeldAttachmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: CaseEventsService,
  ) {}

  /** Wirft nie: eine fehlgeschlagene Übergabe darf den Eingang nicht beeinträchtigen (sie wird beim nächsten Durchlauf erneut versucht). */
  async handOverSafely(tenantId: string, intakeEventId: string): Promise<void> {
    try {
      await this.handOver(tenantId, intakeEventId);
    } catch (error) {
      this.logger.warn(`Übergabe zurückgehaltener Anhänge für Eingang ${intakeEventId} fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async handOver(tenantId: string, intakeEventId: string): Promise<'HANDED_OVER' | 'NOTHING_HELD' | 'NO_CASE_YET' | 'ALREADY_DONE'> {
    const scoped = this.prisma.forTenantId(tenantId);
    const intake = await scoped.intakeEvent.findUnique({ where: { id: intakeEventId }, select: { caseId: true, metadata: true, subject: true } });
    const metadata = (intake?.metadata && typeof intake.metadata === 'object' && !Array.isArray(intake.metadata) ? intake.metadata : {}) as { heldAttachments?: HeldAttachment[]; heldAttachmentsHandedOver?: boolean };
    const held = metadata.heldAttachments ?? [];
    if (held.length === 0) return 'NOTHING_HELD';
    if (metadata.heldAttachmentsHandedOver) return 'ALREADY_DONE';
    if (!intake?.caseId) return 'NO_CASE_YET';

    const caseId = intake.caseId;
    const names = held.map((h) => h.fileName).join(', ');
    const lines = held.map((h) => `• ${h.fileName} (${h.mimeType}${h.sizeBytes !== null ? `, ${Math.round(h.sizeBytes / 1024)} KB` : ''}): ${h.note}`);
    await this.prisma.inTenantTransaction(tenantId, async (tx) => {
      const title = `Anhang prüfen: ${names.length > 120 ? `${names.slice(0, 117)}…` : names}`;
      if (!(await tx.task.findFirst({ where: { tenantId, caseId, title }, select: { id: true } }))) {
        await tx.task.create({
          data: {
            tenantId,
            caseId,
            title,
            description: `Diese Anhänge wurden nicht automatisch verarbeitet: sie sind nicht gespeichert, nicht gelesen und nicht in der Vorschau. Bitte im Postfach selbst prüfen und bei Bedarf weiterleiten.\n\n${lines.join('\n')}`,
            source: 'AGENT',
          },
        });
      }
      await this.events.appendInTx(tx, tenantId, caseId, { type: EVENT_TYPE, payload: { intakeEventId, attachments: held.map((h) => ({ fileName: h.fileName, mimeType: h.mimeType, sizeBytes: h.sizeBytes, reason: h.reason })) }, dedupeKey: `attachment-held:${intakeEventId}` });
      const current = await tx.intakeEvent.findUnique({ where: { id: intakeEventId }, select: { metadata: true } });
      const base = current?.metadata && typeof current.metadata === 'object' && !Array.isArray(current.metadata) ? current.metadata : {};
      await tx.intakeEvent.update({ where: { id: intakeEventId }, data: { metadata: { ...base, heldAttachmentsHandedOver: true } as unknown as Prisma.InputJsonValue } });
    });
    return 'HANDED_OVER';
  }
}
