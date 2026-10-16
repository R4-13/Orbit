import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { PrismaService } from '../prisma/prisma.service';

const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

/** Der Schlüssel muss Base64 für genau 32 Byte sein (AES-256-GCM) – dieselbe Regel wie beim Start der Anwendung. */
export function parseKey(base64: string, name: string): Buffer {
  const key = Buffer.from(base64, 'base64');
  if (key.length !== 32) throw new Error(`${name} muss (Base64) genau 32 Byte ergeben, ist aber ${key.length} Byte lang.`);
  return key;
}

/** Entschlüsselt mit dem alten und verschlüsselt mit dem neuen Schlüssel (Format wie `CredentialEncryptionService`: IV ‖ Tag ‖ Chiffretext). Ein falscher alter Schlüssel wirft. */
export function reencrypt(payload: Uint8Array, oldKey: Buffer, newKey: Buffer): Buffer {
  const buffer = Buffer.from(payload);
  if (buffer.length < IV_LENGTH + AUTH_TAG_LENGTH) throw new Error('Der verschlüsselte Wert ist zu kurz.');
  const decipher = createDecipheriv('aes-256-gcm', oldKey, buffer.subarray(0, IV_LENGTH));
  decipher.setAuthTag(buffer.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH));
  const plaintext = Buffer.concat([decipher.update(buffer.subarray(IV_LENGTH + AUTH_TAG_LENGTH)), decipher.final()]);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', newKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

export interface RotationReport {
  integrationSecrets: number;
  platformSecrets: number;
  aiProviderConnections: number;
  /** Geheimnisse der zweiten Faktoren von Plattformzugängen (PLT-02). */
  mfaSecrets: number;
  dryRun: boolean;
}

/**
 * Schlüsselrotation für `CREDENTIAL_ENCRYPTION_KEY` (TEC-08): liest alle verschlüsselten Werte (Zugangsdaten der Anbindungen, Plattform-Geheimnisse, KI-Zugänge der Mandanten),
 * entschlüsselt sie mit dem **alten** und schreibt sie mit dem **neuen** Schlüssel zurück – alles in **einer** Transaktion: scheitert ein einziger Wert (falscher alter
 * Schlüssel, beschädigte Daten), bleibt alles unverändert. `dryRun` prüft nur, dass alle Werte mit dem alten Schlüssel lesbar sind. Danach `CREDENTIAL_ENCRYPTION_KEY`
 * auf den neuen Wert setzen und API und Worker neu starten.
 */
export async function rotateCredentialKey(prisma: PrismaService, oldKey: Buffer, newKey: Buffer, options: { dryRun: boolean }): Promise<RotationReport> {
  return prisma.withRlsBypass(async (tx) => {
    const report: RotationReport = { integrationSecrets: 0, platformSecrets: 0, aiProviderConnections: 0, mfaSecrets: 0, dryRun: options.dryRun };
    for (const row of await tx.integrationCredentialSecret.findMany({ select: { id: true, encryptedValue: true } })) {
      const next = reencrypt(row.encryptedValue, oldKey, newKey);
      if (!options.dryRun) await tx.integrationCredentialSecret.update({ where: { id: row.id }, data: { encryptedValue: new Uint8Array(next) } });
      report.integrationSecrets += 1;
    }
    for (const row of await tx.platformSecret.findMany({ select: { id: true, encryptedValue: true } })) {
      const next = reencrypt(row.encryptedValue, oldKey, newKey);
      if (!options.dryRun) await tx.platformSecret.update({ where: { id: row.id }, data: { encryptedValue: new Uint8Array(next) } });
      report.platformSecrets += 1;
    }
    for (const row of await tx.aIProviderConnection.findMany({ where: { encryptedCredentials: { not: null } }, select: { id: true, encryptedCredentials: true } })) {
      if (!row.encryptedCredentials) continue;
      const next = reencrypt(row.encryptedCredentials, oldKey, newKey);
      if (!options.dryRun) await tx.aIProviderConnection.update({ where: { id: row.id }, data: { encryptedCredentials: new Uint8Array(next) } });
      report.aiProviderConnections += 1;
    }
    for (const row of await tx.platformUser.findMany({ where: { mfaSecretEnc: { not: null } }, select: { id: true, mfaSecretEnc: true } })) {
      if (!row.mfaSecretEnc) continue;
      const next = reencrypt(row.mfaSecretEnc, oldKey, newKey);
      if (!options.dryRun) await tx.platformUser.update({ where: { id: row.id }, data: { mfaSecretEnc: new Uint8Array(next) } });
      report.mfaSecrets += 1;
    }
    return report;
  });
}
