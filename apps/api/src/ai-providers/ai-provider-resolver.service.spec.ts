import { Test } from '@nestjs/testing';
import { LLM_PROVIDER } from '../agent/agent.tokens';
import { PrismaService } from '../prisma/prisma.service';
import { CredentialEncryptionService } from '../security/credential-encryption.service';
import { buildProviderAdapter } from './ai-provider-adapter-factory';
import { AiProviderResolverService } from './ai-provider-resolver.service';

jest.mock('./ai-provider-adapter-factory');

const mockedBuildProviderAdapter = buildProviderAdapter as jest.Mock;

describe('AiProviderResolverService', () => {
  let service: AiProviderResolverService;
  let scoped: { aIProviderConnection: { findUnique: jest.Mock } };
  let prisma: { forTenantId: jest.Mock };
  let encryption: { decrypt: jest.Mock };
  const platformDefault = { providerName: 'platform-default', complete: jest.fn() };

  beforeEach(async () => {
    scoped = { aIProviderConnection: { findUnique: jest.fn() } };
    prisma = { forTenantId: jest.fn().mockReturnValue(scoped) };
    encryption = { decrypt: jest.fn().mockReturnValue('sk-real-key') };
    mockedBuildProviderAdapter.mockReset();

    const moduleRef = await Test.createTestingModule({
      providers: [
        AiProviderResolverService,
        { provide: PrismaService, useValue: prisma },
        { provide: CredentialEncryptionService, useValue: encryption },
        { provide: LLM_PROVIDER, useValue: platformDefault },
      ],
    }).compile();

    service = moduleRef.get(AiProviderResolverService);
  });

  it('returns the platform default when the tenant has no connection row', async () => {
    scoped.aIProviderConnection.findUnique.mockResolvedValue(null);
    const llm = await service.resolveForTenant('tenant_1');
    expect(llm).toBe(platformDefault);
    expect(mockedBuildProviderAdapter).not.toHaveBeenCalled();
  });

  it('returns the platform default when the connection exists but is not CONNECTED', async () => {
    scoped.aIProviderConnection.findUnique.mockResolvedValue({
      providerKey: 'OPENAI',
      status: 'DISCONNECTED',
      encryptedCredentials: Buffer.from('x'),
      model: 'gpt-4o',
    });
    const llm = await service.resolveForTenant('tenant_1');
    expect(llm).toBe(platformDefault);
  });

  it('builds a BYOK adapter from the decrypted credential when a CONNECTED row exists', async () => {
    scoped.aIProviderConnection.findUnique.mockResolvedValue({
      providerKey: 'ANTHROPIC',
      status: 'CONNECTED',
      encryptedCredentials: Buffer.from('cipher-bytes'),
      model: 'claude-tenant-custom',
    });
    const byokAdapter = { providerName: 'anthropic', complete: jest.fn() };
    mockedBuildProviderAdapter.mockReturnValue(byokAdapter);

    const llm = await service.resolveForTenant('tenant_1');

    expect(encryption.decrypt).toHaveBeenCalled();
    expect(mockedBuildProviderAdapter).toHaveBeenCalledWith('ANTHROPIC', 'sk-real-key', 'claude-tenant-custom');
    expect(llm).toBe(byokAdapter);
  });
});
