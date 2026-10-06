import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CredentialEncryptionService } from '../security/credential-encryption.service';

export interface PlatformSecretDescription {
  kind: 'vault' | 'env';
  configured: boolean;
  version?: number;
  updatedAt?: string;
}

/**
 * Plattform-Secrets (Amendment 03 §20): Konfiguration speichert nur eine Referenz (`vault:<id>` oder `env:<NAME>`), nie das Secret selbst. Gleiche
 * Verschlüsselung wie der Mandanten-Tresor (`CredentialEncryptionService`, AES-256-GCM); eine eigene Tabelle, weil dort `tenant_id` Pflicht ist.
 * Nach dem Speichern wird ein Secret nie wieder ausgegeben – nur „konfiguriert“, Version und Änderungszeit (`describe`).
 * `env:<NAME>` ist der Bootstrap-Pfad für Umgebungen, in denen das Secret per Deployment bereitgestellt wird.
 */
@Injectable()
export class PlatformSecretVaultService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: CredentialEncryptionService,
  ) {}

  async store(value: Record<string, unknown>, actorUserId?: string): Promise<string> {
    const encryptedValue = new Uint8Array(this.encryption.encrypt(JSON.stringify(value)));
    const row = await this.prisma.withPlatformScope((tx) => tx.platformSecret.create({ data: { encryptedValue, createdByUserId: actorUserId } }));
    return `vault:${row.id}`;
  }

  async read(reference: string): Promise<Record<string, unknown>> {
    if (reference.startsWith('env:')) {
      const name = reference.slice('env:'.length);
      const value = process.env[name];
      if (!value) throw new NotFoundException(`Die Umgebungsvariable ${name} ist nicht gesetzt.`);
      return { apiKey: value };
    }
    if (!reference.startsWith('vault:')) throw new NotFoundException('Unbekannte Secret-Referenz.');
    const row = await this.prisma.withPlatformScope((tx) => tx.platformSecret.findUnique({ where: { id: reference.slice('vault:'.length) } }));
    if (!row) throw new NotFoundException('Secret-Referenz nicht gefunden.');
    return JSON.parse(this.encryption.decrypt(Buffer.from(row.encryptedValue))) as Record<string, unknown>;
  }

  /** Rotation ohne Änderung der Referenz: Businesscode und Verbindungen bleiben unberührt (Amendment 03 §20.3). */
  async rotate(reference: string, value: Record<string, unknown>): Promise<number> {
    if (!reference.startsWith('vault:')) throw new NotFoundException('Nur vault:-Referenzen können rotiert werden.');
    const encryptedValue = new Uint8Array(this.encryption.encrypt(JSON.stringify(value)));
    const row = await this.prisma.withPlatformScope((tx) => tx.platformSecret.update({ where: { id: reference.slice('vault:'.length) }, data: { encryptedValue, version: { increment: 1 } } }));
    return row.version;
  }

  async describe(reference: string): Promise<PlatformSecretDescription> {
    if (reference.startsWith('env:')) return { kind: 'env', configured: Boolean(process.env[reference.slice('env:'.length)]) };
    const row = await this.prisma.withPlatformScope((tx) => tx.platformSecret.findUnique({ where: { id: reference.replace(/^vault:/, '') }, select: { version: true, updatedAt: true } }));
    return row ? { kind: 'vault', configured: true, version: row.version, updatedAt: row.updatedAt.toISOString() } : { kind: 'vault', configured: false };
  }
}
