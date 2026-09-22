import { Test } from '@nestjs/testing';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CredentialEncryptionService } from '../security/credential-encryption.service';
import { IntegrationsService } from './integrations.service';

describe('IntegrationsService', () => {
  let service: IntegrationsService;
  let scoped: { integration: { findMany: jest.Mock; findUnique: jest.Mock; upsert: jest.Mock; update: jest.Mock } };
  let prisma: { forTenantId: jest.Mock };
  let audit: { record: jest.Mock };
  let encryption: { encrypt: jest.Mock; decrypt: jest.Mock };

  beforeEach(async () => {
    scoped = {
      integration: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        upsert: jest.fn(),
        update: jest.fn(),
      },
    };
    prisma = { forTenantId: jest.fn().mockReturnValue(scoped) };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    encryption = { encrypt: jest.fn().mockReturnValue(Buffer.from('cipher-bytes')), decrypt: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        IntegrationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
        { provide: CredentialEncryptionService, useValue: encryption },
      ],
    }).compile();

    service = moduleRef.get(IntegrationsService);
  });

  describe('findAll', () => {
    it('never returns encryptedCredentials, only a hasCredentials flag', async () => {
      scoped.integration.findMany.mockResolvedValue([
        { id: 'int_1', connectorType: 'DATEV', status: 'CONNECTED', encryptedCredentials: Buffer.from('secret') },
        { id: 'int_2', connectorType: 'HUBSPOT', status: 'NOT_CONFIGURED', encryptedCredentials: null },
      ]);

      const [first, second] = await service.findAll('tenant_1');

      expect(first).not.toHaveProperty('encryptedCredentials');
      expect(first?.hasCredentials).toBe(true);
      expect(second?.hasCredentials).toBe(false);
    });
  });

  describe('upsertCredentials', () => {
    it('encrypts the credentials before storing them and records INTEGRATION_CONNECTED', async () => {
      scoped.integration.upsert.mockResolvedValue({
        id: 'int_1',
        connectorType: 'DATEV',
        status: 'CONNECTED',
        encryptedCredentials: Buffer.from('cipher-bytes'),
      });

      const result = await service.upsertCredentials('tenant_1', 'user_1', 'DATEV', { clientSecret: 'super-secret' });

      expect(encryption.encrypt).toHaveBeenCalledWith(JSON.stringify({ clientSecret: 'super-secret' }));
      const upsertArgs = scoped.integration.upsert.mock.calls[0][0];
      expect(Buffer.from(upsertArgs.create.encryptedCredentials).toString()).not.toContain('super-secret');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'INTEGRATION_CONNECTED', payload: { connectorType: 'DATEV' } }),
      );
      expect(result).not.toHaveProperty('encryptedCredentials');
      expect(result.hasCredentials).toBe(true);
    });
  });

  describe('disconnect', () => {
    it('throws NotFoundError when the integration was never configured', async () => {
      scoped.integration.findUnique.mockResolvedValue(null);
      await expect(service.disconnect('tenant_1', 'user_1', 'DATEV')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('clears the stored credentials and records INTEGRATION_DISCONNECTED', async () => {
      scoped.integration.findUnique.mockResolvedValue({ id: 'int_1', connectorType: 'DATEV' });
      scoped.integration.update.mockResolvedValue({
        id: 'int_1',
        connectorType: 'DATEV',
        status: 'DISCONNECTED',
        encryptedCredentials: null,
      });

      const result = await service.disconnect('tenant_1', 'user_1', 'DATEV');

      expect(scoped.integration.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'DISCONNECTED', encryptedCredentials: null } }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'INTEGRATION_DISCONNECTED' }),
      );
      expect(result.hasCredentials).toBe(false);
    });
  });
});
