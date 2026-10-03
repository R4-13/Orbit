import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CredentialEncryptionService } from './credential-encryption.service';

export interface StoreSecretInput {
  tenantId: string;
  /** Arbitrary, connector-defined secret payload (OAuth tokens, an API key, …) — never inspected by the vault itself. */
  value: Record<string, unknown>;
}

export interface UpdateSecretInput {
  tenantId: string;
  value: Record<string, unknown>;
}

export interface ResolvedSecret {
  value: Record<string, unknown>;
}

/** Opaque — callers (e.g. `Integration.credentialReference`) only ever see this id, never the plaintext or ciphertext. */
export type CredentialReference = string;

/**
 * §6 des Integration-Framework-Amendments (ORBIT_MASTER_SPECIFICATION_v3_
 * AMENDMENT_01, v2.0) — die generische Credential-/Secret-Store-
 * Abstraktion. Verbindlich: "Connectoren und Business-Services speichern
 * oder lesen Secrets niemals direkt aus normalen Integrationstabellen" —
 * `IntegrationsService`/zukünftige Connector-Services rufen ausschließlich
 * diese vier Methoden auf, nie direkt `IntegrationCredentialSecret` oder
 * `CredentialEncryptionService`.
 *
 * MVP-Implementierung (vom Amendment ausdrücklich erlaubt, §6: "Für das
 * MVP darf die konkrete Implementierung... weiterhin eine AES-256-GCM-
 * verschlüsselte Datenbankspeicherung verwenden"): wrapped die bereits
 * bestehende, echte `CredentialEncryptionService` um eine neue,
 * tenant-gescopte Tabelle (`IntegrationCredentialSecret`). Ein Wechsel auf
 * einen externen Secret Manager später würde nur diese eine Klasse
 * ersetzen — `CredentialReference` bleibt eine opake String-ID, kein
 * Aufrufer verlässt sich auf ihre interne Struktur.
 *
 * `tenantId` ist explizit Teil jeder Signatur (abweichend vom Amendment-
 * Pseudocode, der nur `reference` zeigt) — dieses Projekt setzt
 * Tenant-Isolation über Postgres RLS durch, die pro Query einen expliziten
 * `forTenantId(tenantId)`-Aufruf braucht (siehe `tenant-scope.ts`); eine
 * Methode ohne Tenant-Parameter könnte diese GUC-Session-Variable nicht
 * setzen. Das ist die Umsetzung von §2.3 ("technisch nicht möglich, ...
 * eines Tenants über einen anderen Tenant abzurufen"), kein Abweichen von
 * dessen Absicht.
 */
@Injectable()
export class CredentialVaultService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: CredentialEncryptionService,
  ) {}

  async storeSecret(input: StoreSecretInput): Promise<CredentialReference> {
    const encryptedValue = new Uint8Array(this.encryption.encrypt(JSON.stringify(input.value)));
    const row = await this.prisma.forTenantId(input.tenantId).integrationCredentialSecret.create({
      data: { tenantId: input.tenantId, encryptedValue },
    });
    return row.id;
  }

  async readSecret(tenantId: string, reference: CredentialReference): Promise<ResolvedSecret> {
    const row = await this.prisma.forTenantId(tenantId).integrationCredentialSecret.findUnique({
      where: { id: reference },
    });
    if (!row) {
      throw new NotFoundException('Credential reference not found.');
    }
    const plaintext = this.encryption.decrypt(Buffer.from(row.encryptedValue));
    return { value: JSON.parse(plaintext) as Record<string, unknown> };
  }

  async updateSecret(tenantId: string, reference: CredentialReference, input: UpdateSecretInput): Promise<void> {
    const encryptedValue = new Uint8Array(this.encryption.encrypt(JSON.stringify(input.value)));
    await this.prisma.forTenantId(tenantId).integrationCredentialSecret.update({
      where: { id: reference },
      data: { encryptedValue, version: { increment: 1 } },
    });
  }

  async deleteSecret(tenantId: string, reference: CredentialReference): Promise<void> {
    await this.prisma.forTenantId(tenantId).integrationCredentialSecret.delete({
      where: { id: reference },
    });
  }
}
