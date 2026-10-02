import { Test } from '@nestjs/testing';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { BrandingService } from './branding.service';

describe('BrandingService', () => {
  let service: BrandingService;
  let scoped: { tenantBranding: { findUnique: jest.Mock; upsert: jest.Mock; delete: jest.Mock } };
  let prisma: { forTenantId: jest.Mock };
  let audit: { record: jest.Mock };
  let storage: { buildPublicStorageKey: jest.Mock; getPublicUploadUrl: jest.Mock; getPublicUrl: jest.Mock };

  beforeEach(async () => {
    scoped = {
      tenantBranding: { findUnique: jest.fn(), upsert: jest.fn(), delete: jest.fn() },
    };
    prisma = { forTenantId: jest.fn().mockReturnValue(scoped) };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    storage = {
      buildPublicStorageKey: jest.fn().mockReturnValue('public/tenants/tenant_1/branding/abc-logo.png'),
      getPublicUploadUrl: jest.fn().mockResolvedValue('https://minio.example/presigned-put'),
      getPublicUrl: jest.fn().mockReturnValue('https://minio.example/public/tenants/tenant_1/branding/abc-logo.png'),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        BrandingService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
        { provide: StorageService, useValue: storage },
      ],
    }).compile();

    service = moduleRef.get(BrandingService);
  });

  describe('getBranding', () => {
    it('returns null when the tenant has no branding row yet (falls back to default theme)', async () => {
      scoped.tenantBranding.findUnique.mockResolvedValue(null);
      await expect(service.getBranding('tenant_1')).resolves.toBeNull();
    });
  });

  describe('upsertBranding', () => {
    it('creates a new row, stamps updatedByUserId, and records TENANT_BRANDING_UPDATED', async () => {
      scoped.tenantBranding.upsert.mockResolvedValue({
        id: 'brand_1',
        tenantId: 'tenant_1',
        companyDisplayName: 'ACME GmbH',
        primaryColor: '#1d4ed8',
      });

      const result = await service.upsertBranding('tenant_1', 'user_1', {
        companyDisplayName: 'ACME GmbH',
        primaryColor: '#1d4ed8',
      });

      expect(scoped.tenantBranding.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: 'tenant_1' },
          create: expect.objectContaining({ tenantId: 'tenant_1', updatedByUserId: 'user_1', companyDisplayName: 'ACME GmbH' }),
          update: expect.objectContaining({ updatedByUserId: 'user_1', companyDisplayName: 'ACME GmbH' }),
        }),
      );
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'TENANT_BRANDING_UPDATED' }));
      expect(result.companyDisplayName).toBe('ACME GmbH');
    });
  });

  describe('createLogoUploadUrl', () => {
    it('builds a public storage key and returns both the presigned upload URL and the permanent public URL', async () => {
      const result = await service.createLogoUploadUrl('tenant_1', { fileName: 'logo.png', contentType: 'image/png' });

      expect(storage.buildPublicStorageKey).toHaveBeenCalledWith('tenant_1', 'branding', 'logo.png');
      expect(storage.getPublicUploadUrl).toHaveBeenCalledWith('public/tenants/tenant_1/branding/abc-logo.png', 'image/png');
      expect(storage.getPublicUrl).toHaveBeenCalledWith('public/tenants/tenant_1/branding/abc-logo.png');
      expect(result).toEqual({
        uploadUrl: 'https://minio.example/presigned-put',
        publicUrl: 'https://minio.example/public/tenants/tenant_1/branding/abc-logo.png',
      });
    });
  });

  describe('resetBranding', () => {
    it('is a no-op when no branding row exists', async () => {
      scoped.tenantBranding.findUnique.mockResolvedValue(null);
      await service.resetBranding('tenant_1', 'user_1');
      expect(scoped.tenantBranding.delete).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('deletes the row and records TENANT_BRANDING_RESET', async () => {
      scoped.tenantBranding.findUnique.mockResolvedValue({ id: 'brand_1', tenantId: 'tenant_1' });
      await service.resetBranding('tenant_1', 'user_1');
      expect(scoped.tenantBranding.delete).toHaveBeenCalledWith({ where: { tenantId: 'tenant_1' } });
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'TENANT_BRANDING_RESET' }));
    });
  });
});
