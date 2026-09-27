import { Inject, Injectable } from '@nestjs/common';
import type { LLMProvider } from '@orbit/agent-core';
import { LLM_PROVIDER } from '../agent/agent.tokens';
import { PrismaService } from '../prisma/prisma.service';
import { CredentialEncryptionService } from '../security/credential-encryption.service';
import { buildProviderAdapter } from './ai-provider-adapter-factory';

/**
 * §35-38 des Unified-Evolution-Konzepts — die tatsächliche Laufzeit-
 * Auflösung "welcher LLMProvider gilt für diesen Tenant gerade": hat der
 * Tenant eine `CONNECTED`-`AIProviderConnection` (BYOK), wird deren
 * entschlüsseltes Credential zu einem frischen Adapter (siehe
 * `buildProviderAdapter`); sonst der plattformweite, envgesteuerte
 * `LLM_PROVIDER`-Token (ORBIT-Managed-Standard, unverändert seit Phase 6).
 *
 * Bewusst kein Caching der gebauten Adapter-Instanz über Aufrufe hinweg —
 * ein Adapter hält nur einen API-Key + Modellnamen (kein Verbindungspool),
 * Neubau ist günstig; ein zwischengespeicherter Adapter hätte sonst nach
 * einer `disconnect()`/Credential-Rotation veraltete Zugangsdaten benutzt.
 */
@Injectable()
export class AiProviderResolverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: CredentialEncryptionService,
    @Inject(LLM_PROVIDER) private readonly platformDefault: LLMProvider,
  ) {}

  async resolveForTenant(tenantId: string): Promise<LLMProvider> {
    const connection = await this.prisma.forTenantId(tenantId).aIProviderConnection.findUnique({ where: { tenantId } });

    if (!connection || connection.status !== 'CONNECTED' || !connection.encryptedCredentials || !connection.model) {
      return this.platformDefault;
    }

    const apiKey = this.encryption.decrypt(Buffer.from(connection.encryptedCredentials));
    return buildProviderAdapter(connection.providerKey, apiKey, connection.model);
  }
}
