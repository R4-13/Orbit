import { Test } from '@nestjs/testing';
import { AuditService } from '../audit/audit.service';
import { ORBIT_ENV } from '../config/env.token';
import { PrismaService } from '../prisma/prisma.service';
import { CredentialEncryptionService } from '../security/credential-encryption.service';
import { buildProviderAdapter } from './ai-provider-adapter-factory';
import { AiProvidersService } from './ai-providers.service';

jest.mock('./ai-provider-adapter-factory');

const mockedBuildProviderAdapter = buildProviderAdapter as jest.Mock;

describe('AiProvidersService', () => {
  let service: AiProvidersService;
  let scoped: { aIProviderConnection: { findUnique: jest.Mock; upsert: jest.Mock; update: jest.Mock } };
  let prisma: { forTenantId: jest.Mock };
  let audit: { record: jest.Mock };
  let encryption: { encrypt: jest.Mock; decrypt: jest.Mock };

  beforeEach(async () => {
    scoped = {
      aIProviderConnection: { findUnique: jest.fn(), upsert: jest.fn(), update: jest.fn() },
    };
    prisma = { forTenantId: jest.fn().mockReturnValue(scoped) };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    encryption = { encrypt: jest.fn().mockReturnValue(Buffer.from('cipher-bytes')), decrypt: jest.fn().mockReturnValue('sk-real-key') };
    mockedBuildProviderAdapter.mockReset();

    const moduleRef = await Test.createTestingModule({
      providers: [
        AiProvidersService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
        { provide: CredentialEncryptionService, useValue: encryption },
        { provide: ORBIT_ENV, useValue: { ANTHROPIC_MODEL: 'claude-default', OPENAI_MODEL: 'gpt-default' } },
      ],
    }).compile();

    service = moduleRef.get(AiProvidersService);
  });

  describe('getStatus', () => {
    it('reports ORBIT_MANAGED when no connection row exists', async () => {
      scoped.aIProviderConnection.findUnique.mockResolvedValue(null);
      const status = await service.getStatus('tenant_1');
      expect(status).toEqual({ mode: 'ORBIT_MANAGED', connection: null });
    });

    it('reports ORBIT_MANAGED when the row exists but is not CONNECTED (e.g. after disconnect)', async () => {
      scoped.aIProviderConnection.findUnique.mockResolvedValue({
        id: 'conn_1',
        providerKey: 'OPENAI',
        status: 'DISCONNECTED',
        encryptedCredentials: null,
      });
      const status = await service.getStatus('tenant_1');
      expect(status.mode).toBe('ORBIT_MANAGED');
      expect(status.connection).not.toBeNull();
    });

    it('reports TENANT_MANAGED when a CONNECTED row exists, and never returns the encrypted credentials', async () => {
      scoped.aIProviderConnection.findUnique.mockResolvedValue({
        id: 'conn_1',
        providerKey: 'ANTHROPIC',
        status: 'CONNECTED',
        encryptedCredentials: Buffer.from('secret'),
      });
      const status = await service.getStatus('tenant_1');
      expect(status.mode).toBe('TENANT_MANAGED');
      expect(status.connection).not.toHaveProperty('encryptedCredentials');
      expect(status.connection?.hasCredentials).toBe(true);
    });
  });

  describe('upsertConnection', () => {
    it('validates the credential against the real provider, encrypts it, and stores CONNECTED on success', async () => {
      const validateConfiguration = jest.fn().mockResolvedValue({ valid: true });
      mockedBuildProviderAdapter.mockReturnValue({ validateConfiguration });
      scoped.aIProviderConnection.upsert.mockResolvedValue({
        id: 'conn_1',
        providerKey: 'OPENAI',
        status: 'CONNECTED',
        encryptedCredentials: Buffer.from('cipher-bytes'),
      });

      const result = await service.upsertConnection('tenant_1', 'user_1', 'OPENAI', 'sk-test', undefined);

      expect(mockedBuildProviderAdapter).toHaveBeenCalledWith('OPENAI', 'sk-test', 'gpt-default');
      expect(encryption.encrypt).toHaveBeenCalledWith('sk-test');
      const upsertArgs = scoped.aIProviderConnection.upsert.mock.calls[0][0];
      expect(upsertArgs.create.status).toBe('CONNECTED');
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'AI_PROVIDER_CONNECTED' }));
      expect(result.hasCredentials).toBe(true);
    });

    it('stores ERROR status and records AI_PROVIDER_TEST_FAILED when validation fails', async () => {
      const validateConfiguration = jest.fn().mockResolvedValue({ valid: false, error: 'invalid_api_key' });
      mockedBuildProviderAdapter.mockReturnValue({ validateConfiguration });
      scoped.aIProviderConnection.upsert.mockResolvedValue({
        id: 'conn_1',
        providerKey: 'OPENAI',
        status: 'ERROR',
        encryptedCredentials: Buffer.from('cipher-bytes'),
      });

      await service.upsertConnection('tenant_1', 'user_1', 'OPENAI', 'sk-bad', undefined);

      const upsertArgs = scoped.aIProviderConnection.upsert.mock.calls[0][0];
      expect(upsertArgs.create.status).toBe('ERROR');
      expect(upsertArgs.create.lastTestStatus).toBe('invalid_api_key');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'AI_PROVIDER_TEST_FAILED', payload: expect.objectContaining({ error: 'invalid_api_key' }) }),
      );
    });

    it('uses the given model override instead of the platform default', async () => {
      mockedBuildProviderAdapter.mockReturnValue({ validateConfiguration: jest.fn().mockResolvedValue({ valid: true }) });
      scoped.aIProviderConnection.upsert.mockResolvedValue({ id: 'conn_1', providerKey: 'ANTHROPIC', status: 'CONNECTED', encryptedCredentials: Buffer.from('x') });

      await service.upsertConnection('tenant_1', 'user_1', 'ANTHROPIC', 'sk-test', 'claude-custom');

      expect(mockedBuildProviderAdapter).toHaveBeenCalledWith('ANTHROPIC', 'sk-test', 'claude-custom');
    });
  });

  describe('testConnection', () => {
    it('throws NotFoundError when no connection is configured', async () => {
      scoped.aIProviderConnection.findUnique.mockResolvedValue(null);
      await expect(service.testConnection('tenant_1', 'user_1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('decrypts the stored credential and re-validates it against the real provider', async () => {
      scoped.aIProviderConnection.findUnique.mockResolvedValue({
        id: 'conn_1',
        providerKey: 'OPENAI',
        model: 'gpt-custom',
        encryptedCredentials: Buffer.from('cipher-bytes'),
      });
      const validateConfiguration = jest.fn().mockResolvedValue({ valid: true });
      mockedBuildProviderAdapter.mockReturnValue({ validateConfiguration });
      scoped.aIProviderConnection.update.mockResolvedValue({
        id: 'conn_1',
        providerKey: 'OPENAI',
        status: 'CONNECTED',
        encryptedCredentials: Buffer.from('cipher-bytes'),
      });

      await service.testConnection('tenant_1', 'user_1');

      expect(encryption.decrypt).toHaveBeenCalled();
      expect(mockedBuildProviderAdapter).toHaveBeenCalledWith('OPENAI', 'sk-real-key', 'gpt-custom');
      expect(validateConfiguration).toHaveBeenCalled();
    });
  });

  describe('disconnect', () => {
    it('throws NotFoundError when no connection is configured', async () => {
      scoped.aIProviderConnection.findUnique.mockResolvedValue(null);
      await expect(service.disconnect('tenant_1', 'user_1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('clears the stored credentials and records AI_PROVIDER_DISCONNECTED', async () => {
      scoped.aIProviderConnection.findUnique.mockResolvedValue({ id: 'conn_1', providerKey: 'OPENAI' });
      scoped.aIProviderConnection.update.mockResolvedValue({
        id: 'conn_1',
        providerKey: 'OPENAI',
        status: 'DISCONNECTED',
        encryptedCredentials: null,
      });

      const result = await service.disconnect('tenant_1', 'user_1');

      expect(scoped.aIProviderConnection.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'DISCONNECTED', encryptedCredentials: null } }),
      );
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'AI_PROVIDER_DISCONNECTED' }));
      // Must return a JSON-serializable summary, not void — an empty 200 body breaks apiFetch()'s
      // client-side response.json() parse (found live: a real bug, see docs/ASSUMPTIONS.md).
      expect(result).not.toHaveProperty('encryptedCredentials');
      expect(result.hasCredentials).toBe(false);
    });
  });
});
