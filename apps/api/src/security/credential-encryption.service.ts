import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { OrbitEnv } from '@orbit/config';
import { ORBIT_ENV } from '../config/env.token';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

/**
 * Encrypts/decrypts third-party connector credentials at rest
 * (`Integration.encryptedCredentials`, §30/§52). CREDENTIAL_ENCRYPTION_KEY
 * has been a required env var since Phase 1 (`packages/config/src/env.ts`)
 * but was never actually used anywhere to encrypt or decrypt anything —
 * see docs/SECURITY.md §4 and docs/ASSUMPTIONS.md #7 — this closes that
 * gap. AES-256-GCM: a fresh random IV per call (never reused with the same
 * key), authenticated (tamper-evident — decrypt() throws if the ciphertext
 * or stored IV/tag were altered). Output layout is a single Buffer:
 * `iv (12 bytes) || authTag (16 bytes) || ciphertext`, so the whole thing
 * round-trips as one `Bytes` column value with no separate metadata to keep
 * in sync.
 */
@Injectable()
export class CredentialEncryptionService {
  private readonly key: Buffer;

  constructor(@Inject(ORBIT_ENV) env: OrbitEnv) {
    this.key = Buffer.from(env.CREDENTIAL_ENCRYPTION_KEY, 'base64');
    if (this.key.length !== 32) {
      throw new Error(
        `CREDENTIAL_ENCRYPTION_KEY must decode (base64) to exactly 32 bytes for AES-256-GCM, got ${this.key.length}.`,
      );
    }
  }

  encrypt(plaintext: string): Buffer {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, ciphertext]);
  }

  decrypt(payload: Buffer): string {
    if (payload.length < IV_LENGTH + AUTH_TAG_LENGTH) {
      throw new Error('Encrypted credential payload is too short to contain an IV and auth tag.');
    }
    const iv = payload.subarray(0, IV_LENGTH);
    const authTag = payload.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = payload.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }
}
