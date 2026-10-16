import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { budgetExcerpts, extractAttachmentText, formatAttachmentBlock, type AttachmentExcerpt } from './attachment-text';

/**
 * Liest die Texte der Anhänge einer Nachricht für Triage und Extraktion (BPF-02). Ein Fehler beim Lesen darf den Eingang nie aufhalten: die Anhänge werden dann einfach als
 * „nicht gelesen“ gemeldet.
 */
@Injectable()
export class AttachmentTextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** Anhänge, die schon als Dokument gespeichert sind (Wiederholung der Triage, Analyse, Extraktion). */
  async forDocuments(tenantId: string, documentIds: readonly string[]): Promise<AttachmentExcerpt[]> {
    if (documentIds.length === 0) return [];
    const documents = await this.prisma.forTenantId(tenantId).document.findMany({ where: { id: { in: [...documentIds] } } });
    const byId = new Map(documents.map((d) => [d.id, d]));
    const items: AttachmentExcerpt[] = [];
    for (const [index, id] of documentIds.entries()) {
      const document = byId.get(id);
      if (!document) continue;
      if (index >= 5) {
        items.push({ fileName: document.fileName, mimeType: document.mimeType, result: { status: 'UNSUPPORTED', note: 'nur die ersten 5 Anhänge werden gelesen' } });
        continue;
      }
      const result = await this.storage
        .getObjectBytes(document.storageKey)
        .then((bytes) => extractAttachmentText({ fileName: document.fileName, mimeType: document.mimeType, bytes }))
        .catch(() => ({ status: 'ERROR' as const, note: 'Datei konnte nicht aus dem Speicher gelesen werden' }));
      items.push({ fileName: document.fileName, mimeType: document.mimeType, result });
    }
    return budgetExcerpts(items);
  }

  /** Die Anhänge der Nachricht mit dieser Kennung (über das zugehörige Eingangsereignis). */
  async forMessage(tenantId: string, emailMessageId: string): Promise<AttachmentExcerpt[]> {
    const intake = await this.prisma.forTenantId(tenantId).intakeEvent.findFirst({ where: { emailMessageId }, select: { documentIds: true } });
    return intake ? this.forDocuments(tenantId, intake.documentIds).catch(() => []) : [];
  }

  /** Der Textblock für die KI-Anfrage zu einer Nachricht (leer ohne Anhänge). */
  async blockForMessage(tenantId: string, emailMessageId: string): Promise<string> {
    return formatAttachmentBlock(await this.forMessage(tenantId, emailMessageId));
  }
}
