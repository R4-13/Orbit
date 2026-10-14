import { Inject, Injectable } from '@nestjs/common';
import { FILE_SIGNATURE_PROBE_BYTES, NotFoundError, PolicyViolationError, ValidationFailedError, verifyFileSignature } from '@orbit/shared';
import type { Document } from '@orbit/domain';
import type { OrbitEnv } from '@orbit/config';
import { AuditService } from '../audit/audit.service';
import { ORBIT_ENV } from '../config/env.token';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { LIST_HARD_LIMIT } from '../common/list-limit';

export interface CreateUploadUrlInput {
  caseId?: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface CreateUploadUrlResult {
  document: Document;
  uploadUrl: string;
}

/**
 * Document rows are metadata only — actual bytes never transit through the
 * API process. The client asks for an upload URL, PUTs the file straight to
 * object storage, and only then is the Document row's existence meaningful.
 * Die hochgeladenen Bytes werden **nach** dem Upload geprüft (`verifyUpload`, MST-09): Größe wie angekündigt, Anfangsbytes passend zur angegebenen Art, keine
 * Programme/Skripte. Der Client ruft dazu `POST /documents/:id/verify` auf; wer es vergisst, wird beim ersten Download bzw. bei der Verarbeitung geprüft
 * (`ensureUsable`). Eine abgelehnte Datei wird aus dem Speicher gelöscht und nie ausgeliefert.
 */
@Injectable()
export class DocumentsService {
  private readonly allowedMimeTypes: Set<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    @Inject(ORBIT_ENV) private readonly env: OrbitEnv,
  ) {
    this.allowedMimeTypes = new Set(env.ALLOWED_UPLOAD_MIME_TYPES.split(',').map((type) => type.trim()));
  }

  /**
   * Rejects an oversized or disallowed-type upload *before* a Document row
   * or presigned URL is even created (§ Security detail work — see
   * docs/SECURITY.md §5). This validates only the client's *declared*
   * metadata: files never transit through the API process (direct
   * client-to-S3 PUT), so there is no point at which the actually-uploaded
   * bytes could be re-checked against this declaration without a
   * substantially different upload flow (S3 event webhook or routing every
   * upload through the API) — documented there as a remaining gap, not
   * silently pretended away.
   */
  private assertUploadAllowed(input: CreateUploadUrlInput): void {
    if (input.sizeBytes > this.env.MAX_UPLOAD_SIZE_BYTES) {
      throw new PolicyViolationError('File exceeds the maximum allowed upload size.', {
        sizeBytes: input.sizeBytes,
        maxAllowedBytes: this.env.MAX_UPLOAD_SIZE_BYTES,
      });
    }
    if (!this.allowedMimeTypes.has(input.mimeType)) {
      throw new PolicyViolationError('File type is not allowed.', {
        mimeType: input.mimeType,
        allowedMimeTypes: [...this.allowedMimeTypes],
      });
    }
  }

  async createUploadUrl(
    tenantId: string,
    actorUserId: string,
    input: CreateUploadUrlInput,
  ): Promise<CreateUploadUrlResult> {
    this.assertUploadAllowed(input);

    const storageKey = this.storage.buildStorageKey(tenantId, input.fileName);

    const document = await this.prisma.forTenantId(tenantId).document.create({
      data: {
        tenantId,
        caseId: input.caseId,
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        storageKey,
        uploadedByUserId: actorUserId,
      },
    });

    await this.audit.record({
      tenantId,
      eventType: 'DOCUMENT_UPLOADED',
      actorType: 'USER',
      actorUserId,
      entityType: 'Document',
      entityId: document.id,
      payload: { fileName: document.fileName, mimeType: document.mimeType },
    });

    const uploadUrl = await this.storage.getUploadUrl(storageKey, input.mimeType);
    return { document, uploadUrl };
  }

  /**
   * Prüft die tatsächlich hochgeladene Datei gegen die Ankündigung. Liegt noch nichts im Speicher, bleibt der Status offen (der Upload kann noch laufen).
   * Eine Abweichung löscht die Datei, vermerkt den Grund am Dokument und im Audit und liefert `PolicyViolationError`.
   */
  async verifyUpload(tenantId: string, id: string, actorUserId?: string): Promise<Document> {
    const document = await this.findOne(tenantId, id);
    if (document.verificationStatus === 'VERIFIED') return document;
    if (document.verificationStatus === 'REJECTED') throw new PolicyViolationError('Die Datei wurde abgelehnt und gelöscht.', { id, reason: document.verificationNote });

    const probe = await this.storage.probeObject(document.storageKey, FILE_SIGNATURE_PROBE_BYTES);
    if (!probe) throw new ValidationFailedError('Die Datei ist noch nicht hochgeladen.', { id });

    let reason: string | undefined;
    if (probe.sizeBytes > this.env.MAX_UPLOAD_SIZE_BYTES) reason = `Die Datei ist größer als erlaubt (${probe.sizeBytes} Bytes).`;
    else if (probe.sizeBytes !== document.sizeBytes) reason = `Die Größe (${probe.sizeBytes} Bytes) weicht von der Ankündigung (${document.sizeBytes} Bytes) ab.`;
    else {
      const verdict = verifyFileSignature(document.mimeType, probe.head);
      if (verdict.status === 'MISMATCH') reason = verdict.reason;
    }

    const scoped = this.prisma.forTenantId(tenantId);
    if (reason) {
      await this.storage.delete(document.storageKey).catch(() => undefined);
      await scoped.document.update({ where: { id }, data: { verificationStatus: 'REJECTED', verifiedAt: new Date(), verificationNote: reason } });
      await this.audit.record({ tenantId, eventType: 'DOCUMENT_UPLOAD_REJECTED', actorType: actorUserId ? 'USER' : 'SYSTEM', actorUserId, entityType: 'Document', entityId: id, payload: { fileName: document.fileName, declaredMimeType: document.mimeType, reason } });
      throw new PolicyViolationError(`Die Datei wurde abgelehnt: ${reason}`, { id, reason });
    }
    return scoped.document.update({ where: { id }, data: { verificationStatus: 'VERIFIED', verifiedAt: new Date(), verificationNote: null } });
  }

  /** Vor jeder Auslieferung oder Verarbeitung: eine noch ungeprüfte Datei wird jetzt geprüft, eine abgelehnte nie freigegeben. */
  async ensureUsable(tenantId: string, id: string): Promise<Document> {
    const document = await this.findOne(tenantId, id);
    if (document.verificationStatus === 'VERIFIED') return document;
    return this.verifyUpload(tenantId, id);
  }

  findAll(tenantId: string, caseId?: string): Promise<Document[]> {
    return this.prisma.forTenantId(tenantId).document.findMany({
      where: { caseId },
      orderBy: { createdAt: 'desc' },
      take: LIST_HARD_LIMIT,
    });
  }

  async findOne(tenantId: string, id: string): Promise<Document> {
    const found = await this.prisma.forTenantId(tenantId).document.findUnique({ where: { id } });
    if (!found) {
      throw new NotFoundError('Document not found.', { id });
    }
    return found;
  }

  async getDownloadUrl(tenantId: string, id: string): Promise<string> {
    const document = await this.ensureUsable(tenantId, id);
    return this.storage.getDownloadUrl(document.storageKey);
  }

  async remove(tenantId: string, id: string, actorUserId: string): Promise<void> {
    const document = await this.findOne(tenantId, id);

    await this.storage.delete(document.storageKey);
    await this.prisma.forTenantId(tenantId).document.delete({ where: { id } });

    await this.audit.record({
      tenantId,
      eventType: 'DOCUMENT_DELETED',
      actorType: 'USER',
      actorUserId,
      entityType: 'Document',
      entityId: id,
      payload: { fileName: document.fileName },
    });
  }
}
