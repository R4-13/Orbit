import { Test } from '@nestjs/testing';
import { isOrbitError } from '@orbit/shared';
import { AuditService } from '../audit/audit.service';
import { ORBIT_ENV } from '../config/env.token';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { DocumentsService } from './documents.service';

describe('DocumentsService', () => {
  let service: DocumentsService;
  let scoped: {
    document: { create: jest.Mock; findMany: jest.Mock; findUnique: jest.Mock; delete: jest.Mock };
  };
  let audit: { record: jest.Mock };
  let storage: {
    buildStorageKey: jest.Mock;
    getUploadUrl: jest.Mock;
    getDownloadUrl: jest.Mock;
    delete: jest.Mock;
  };

  beforeEach(async () => {
    scoped = {
      document: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), delete: jest.fn() },
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    storage = {
      buildStorageKey: jest.fn().mockReturnValue('tenants/tenant_1/documents/abc-invoice.pdf'),
      getUploadUrl: jest.fn().mockResolvedValue('https://minio.local/upload?sig=1'),
      getDownloadUrl: jest.fn().mockResolvedValue('https://minio.local/download?sig=2'),
      delete: jest.fn().mockResolvedValue(undefined),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        DocumentsService,
        { provide: PrismaService, useValue: { forTenantId: jest.fn().mockReturnValue(scoped) } },
        { provide: AuditService, useValue: audit },
        { provide: StorageService, useValue: storage },
        {
          provide: ORBIT_ENV,
          useValue: { MAX_UPLOAD_SIZE_BYTES: 20 * 1024 * 1024, ALLOWED_UPLOAD_MIME_TYPES: 'application/pdf,image/png' },
        },
      ],
    }).compile();

    service = moduleRef.get(DocumentsService);
  });

  it('createUploadUrl() persists metadata under the storage-derived key and returns a presigned URL', async () => {
    scoped.document.create.mockResolvedValue({
      id: 'doc_1',
      fileName: 'invoice.pdf',
      mimeType: 'application/pdf',
      storageKey: 'tenants/tenant_1/documents/abc-invoice.pdf',
    });

    const result = await service.createUploadUrl('tenant_1', 'user_1', {
      fileName: 'invoice.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 12345,
    });

    expect(scoped.document.create).toHaveBeenCalledWith({
      data: {
        tenantId: 'tenant_1',
        caseId: undefined,
        fileName: 'invoice.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 12345,
        storageKey: 'tenants/tenant_1/documents/abc-invoice.pdf',
        uploadedByUserId: 'user_1',
      },
    });
    expect(result.uploadUrl).toBe('https://minio.local/upload?sig=1');
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'DOCUMENT_UPLOADED' }));
  });

  it('createUploadUrl() rejects a file exceeding MAX_UPLOAD_SIZE_BYTES before creating any row', async () => {
    await expect(
      service.createUploadUrl('tenant_1', 'user_1', {
        fileName: 'huge.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 21 * 1024 * 1024,
      }),
    ).rejects.toMatchObject({ code: 'POLICY_VIOLATION' });
    expect(scoped.document.create).not.toHaveBeenCalled();
    expect(storage.getUploadUrl).not.toHaveBeenCalled();
  });

  it('createUploadUrl() rejects a MIME type outside the allow-list before creating any row', async () => {
    await expect(
      service.createUploadUrl('tenant_1', 'user_1', {
        fileName: 'script.exe',
        mimeType: 'application/x-msdownload',
        sizeBytes: 1024,
      }),
    ).rejects.toMatchObject({ code: 'POLICY_VIOLATION' });
    expect(scoped.document.create).not.toHaveBeenCalled();
    expect(storage.getUploadUrl).not.toHaveBeenCalled();
  });

  it('findOne() throws NotFoundError for a missing document', async () => {
    scoped.document.findUnique.mockResolvedValue(null);
    let caught: unknown;
    try {
      await service.findOne('tenant_1', 'missing');
    } catch (error) {
      caught = error;
    }
    expect(isOrbitError(caught)).toBe(true);
  });

  it('remove() deletes the object from storage before deleting the DB row, then audits it', async () => {
    scoped.document.findUnique.mockResolvedValue({
      id: 'doc_1',
      fileName: 'invoice.pdf',
      storageKey: 'tenants/tenant_1/documents/abc-invoice.pdf',
    });

    await service.remove('tenant_1', 'doc_1', 'user_1');

    expect(storage.delete).toHaveBeenCalledWith('tenants/tenant_1/documents/abc-invoice.pdf');
    expect(scoped.document.delete).toHaveBeenCalledWith({ where: { id: 'doc_1' } });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'DOCUMENT_DELETED' }));
  });
});
