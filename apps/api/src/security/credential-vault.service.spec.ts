import { NotFoundException } from '@nestjs/common';
import { CredentialEncryptionService } from './credential-encryption.service';
import { CredentialVaultService } from './credential-vault.service';
import { PrismaService } from '../prisma/prisma.service';

describe('CredentialVaultService', () => {
  let service: CredentialVaultService;
  let scoped: {
    integrationCredentialSecret: { create: jest.Mock; findUnique: jest.Mock; update: jest.Mock; delete: jest.Mock };
  };
  let prisma: { forTenantId: jest.Mock };
  let encryption: { encrypt: jest.Mock; decrypt: jest.Mock };

  beforeEach(() => {
    scoped = {
      integrationCredentialSecret: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), delete: jest.fn() },
    };
    prisma = { forTenantId: jest.fn().mockReturnValue(scoped) };
    encryption = {
      encrypt: jest.fn().mockImplementation((plaintext: string) => Buffer.from(`enc(${plaintext})`)),
      decrypt: jest.fn().mockImplementation((buf: Buffer) => buf.toString('utf8').replace(/^enc\(/, '').replace(/\)$/, '')),
    };

    service = new CredentialVaultService(prisma as unknown as PrismaService, encryption as unknown as CredentialEncryptionService);
  });

  it('storeSecret() encrypts the JSON-serialized value and returns the new row id as the opaque reference', async () => {
    scoped.integrationCredentialSecret.create.mockResolvedValue({ id: 'secret_1' });

    const reference = await service.storeSecret({ tenantId: 'tenant_1', value: { accessToken: 'x' } });

    expect(prisma.forTenantId).toHaveBeenCalledWith('tenant_1');
    expect(encryption.encrypt).toHaveBeenCalledWith(JSON.stringify({ accessToken: 'x' }));
    expect(scoped.integrationCredentialSecret.create).toHaveBeenCalledWith({
      data: { tenantId: 'tenant_1', encryptedValue: expect.any(Uint8Array) },
    });
    expect(reference).toBe('secret_1');
  });

  it('readSecret() decrypts and JSON-parses the stored value', async () => {
    scoped.integrationCredentialSecret.findUnique.mockResolvedValue({
      id: 'secret_1',
      encryptedValue: Buffer.from('enc({"accessToken":"x"})'),
    });

    const resolved = await service.readSecret('tenant_1', 'secret_1');

    expect(scoped.integrationCredentialSecret.findUnique).toHaveBeenCalledWith({ where: { id: 'secret_1' } });
    expect(resolved).toEqual({ value: { accessToken: 'x' } });
  });

  it('readSecret() throws NotFoundException for a reference that does not exist (or belongs to another tenant)', async () => {
    scoped.integrationCredentialSecret.findUnique.mockResolvedValue(null);

    await expect(service.readSecret('tenant_1', 'missing')).rejects.toThrow(NotFoundException);
  });

  it('updateSecret() re-encrypts and increments the version', async () => {
    await service.updateSecret('tenant_1', 'secret_1', { tenantId: 'tenant_1', value: { accessToken: 'new' } });

    expect(scoped.integrationCredentialSecret.update).toHaveBeenCalledWith({
      where: { id: 'secret_1' },
      data: { encryptedValue: expect.any(Uint8Array), version: { increment: 1 } },
    });
  });

  it('deleteSecret() removes the row, scoped to the tenant', async () => {
    await service.deleteSecret('tenant_1', 'secret_1');

    expect(prisma.forTenantId).toHaveBeenCalledWith('tenant_1');
    expect(scoped.integrationCredentialSecret.delete).toHaveBeenCalledWith({ where: { id: 'secret_1' } });
  });
});
