import { Test } from '@nestjs/testing';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CredentialVaultService } from '../security/credential-vault.service';
import { IntegrationsService } from './integrations.service';

describe('IntegrationsService', () => {
  let service: IntegrationsService;
  let scoped: { integration: { findMany: jest.Mock; findUnique: jest.Mock; upsert: jest.Mock; update: jest.Mock } };
  let prisma: { forTenantId: jest.Mock };
  let audit: { record: jest.Mock };
  let vault: { storeSecret: jest.Mock; readSecret: jest.Mock; updateSecret: jest.Mock; deleteSecret: jest.Mock };

  beforeEach(async () => {
    scoped = {
      integration: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn(),
        update: jest.fn(),
      },
    };
    prisma = { forTenantId: jest.fn().mockReturnValue(scoped) };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    vault = {
      storeSecret: jest.fn().mockResolvedValue('secret_new'),
      readSecret: jest.fn(),
      updateSecret: jest.fn().mockResolvedValue(undefined),
      deleteSecret: jest.fn().mockResolvedValue(undefined),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        IntegrationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
        { provide: CredentialVaultService, useValue: vault },
      ],
    }).compile();

    service = moduleRef.get(IntegrationsService);
  });

  describe('findAll', () => {
    it('never returns credentialReference, only a hasCredentials flag', async () => {
      scoped.integration.findMany.mockResolvedValue([
        { id: 'int_1', connectorType: 'DATEV', status: 'CONNECTED', credentialReference: 'secret_1' },
        { id: 'int_2', connectorType: 'HUBSPOT', status: 'NOT_CONFIGURED', credentialReference: null },
      ]);

      const [first, second] = await service.findAll('tenant_1');

      expect(first).not.toHaveProperty('credentialReference');
      expect(first?.hasCredentials).toBe(true);
      expect(second?.hasCredentials).toBe(false);
    });
  });

  describe('upsertCredentials', () => {
    it('stores a new secret via the vault (never calling encryption directly) when none exists yet, and records INTEGRATION_CONNECTED', async () => {
      scoped.integration.findUnique.mockResolvedValue(null);
      scoped.integration.upsert.mockResolvedValue({
        id: 'int_1',
        connectorType: 'DATEV',
        status: 'CONNECTED',
        credentialReference: 'secret_new',
      });

      const result = await service.upsertCredentials('tenant_1', 'user_1', 'DATEV', { clientSecret: 'super-secret' });

      expect(vault.storeSecret).toHaveBeenCalledWith({ tenantId: 'tenant_1', value: { clientSecret: 'super-secret' } });
      expect(vault.updateSecret).not.toHaveBeenCalled();
      const upsertArgs = scoped.integration.upsert.mock.calls[0][0];
      expect(upsertArgs.create.credentialReference).toBe('secret_new');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'INTEGRATION_CONNECTED', payload: { connectorType: 'DATEV' } }),
      );
      expect(result).not.toHaveProperty('credentialReference');
      expect(result.hasCredentials).toBe(true);
    });

    it('updates the existing secret in place (same reference) when the integration was already connected', async () => {
      scoped.integration.findUnique.mockResolvedValue({ id: 'int_1', connectorType: 'DATEV', credentialReference: 'secret_existing' });
      scoped.integration.upsert.mockResolvedValue({
        id: 'int_1',
        connectorType: 'DATEV',
        status: 'CONNECTED',
        credentialReference: 'secret_existing',
      });

      await service.upsertCredentials('tenant_1', 'user_1', 'DATEV', { clientSecret: 'rotated' });

      expect(vault.updateSecret).toHaveBeenCalledWith('tenant_1', 'secret_existing', { tenantId: 'tenant_1', value: { clientSecret: 'rotated' } });
      expect(vault.storeSecret).not.toHaveBeenCalled();
      const upsertArgs = scoped.integration.upsert.mock.calls[0][0];
      expect(upsertArgs.update.credentialReference).toBe('secret_existing');
    });
  });

  describe('disconnect', () => {
    it('throws NotFoundError when the integration was never configured', async () => {
      scoped.integration.findUnique.mockResolvedValue(null);
      await expect(service.disconnect('tenant_1', 'user_1', 'DATEV')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('deletes the vault secret, clears the reference, and records INTEGRATION_DISCONNECTED', async () => {
      scoped.integration.findUnique.mockResolvedValue({ id: 'int_1', connectorType: 'DATEV', credentialReference: 'secret_1' });
      scoped.integration.update.mockResolvedValue({
        id: 'int_1',
        connectorType: 'DATEV',
        status: 'DISCONNECTED',
        credentialReference: null,
      });

      const result = await service.disconnect('tenant_1', 'user_1', 'DATEV');

      expect(vault.deleteSecret).toHaveBeenCalledWith('tenant_1', 'secret_1');
      expect(scoped.integration.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'DISCONNECTED', credentialReference: null } }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'INTEGRATION_DISCONNECTED' }),
      );
      expect(result.hasCredentials).toBe(false);
    });

    it('does not call the vault when the integration had no stored credential reference', async () => {
      scoped.integration.findUnique.mockResolvedValue({ id: 'int_1', connectorType: 'DATEV', credentialReference: null });
      scoped.integration.update.mockResolvedValue({ id: 'int_1', connectorType: 'DATEV', status: 'DISCONNECTED', credentialReference: null });

      await service.disconnect('tenant_1', 'user_1', 'DATEV');

      expect(vault.deleteSecret).not.toHaveBeenCalled();
    });
  });
});
