import { randomBytes } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ORBIT_ENV } from '../config/env.token';
import { CredentialEncryptionService } from './credential-encryption.service';

const VALID_KEY = randomBytes(32).toString('base64');

async function buildService(key: string): Promise<CredentialEncryptionService> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      CredentialEncryptionService,
      { provide: ORBIT_ENV, useValue: { CREDENTIAL_ENCRYPTION_KEY: key } },
    ],
  }).compile();
  return moduleRef.get(CredentialEncryptionService);
}

describe('CredentialEncryptionService', () => {
  it('throws at construction if the key does not decode to exactly 32 bytes', async () => {
    await expect(buildService(Buffer.from('too short').toString('base64'))).rejects.toThrow(/32 bytes/);
  });

  it('round-trips a plaintext string through encrypt()/decrypt()', async () => {
    const service = await buildService(VALID_KEY);
    const plaintext = JSON.stringify({ clientId: 'abc', clientSecret: 'super-secret-value' });

    const encrypted = service.encrypt(plaintext);
    expect(encrypted).toBeInstanceOf(Buffer);
    expect(encrypted.toString('utf8')).not.toContain('super-secret-value');

    expect(service.decrypt(encrypted)).toBe(plaintext);
  });

  it('produces a different ciphertext each time (random IV) even for the same plaintext', async () => {
    const service = await buildService(VALID_KEY);
    const a = service.encrypt('same-value');
    const b = service.encrypt('same-value');

    expect(a.equals(b)).toBe(false);
    expect(service.decrypt(a)).toBe('same-value');
    expect(service.decrypt(b)).toBe('same-value');
  });

  it('rejects a tampered ciphertext (authenticated encryption)', async () => {
    const service = await buildService(VALID_KEY);
    const encrypted = service.encrypt('sensitive-credentials');
    const lastIndex = encrypted.length - 1;
    encrypted[lastIndex] = (encrypted[lastIndex] ?? 0) ^ 0xff; // flip the last ciphertext byte

    expect(() => service.decrypt(encrypted)).toThrow();
  });

  it('fails to decrypt with the wrong key', async () => {
    const serviceA = await buildService(VALID_KEY);
    const serviceB = await buildService(randomBytes(32).toString('base64'));

    const encrypted = serviceA.encrypt('sensitive-credentials');
    expect(() => serviceB.decrypt(encrypted)).toThrow();
  });
});
