import { Module } from '@nestjs/common';
import { PlatformAuditModule } from '../platform/audit/platform-audit.module';
import { AiAdapterRegistry } from './ai-adapter-registry.service';
import { AiMeterService } from './ai-meter.service';
import { AiRegistryAdminService } from './ai-registry-admin.service';
import { AiRegistryService } from './ai-registry.service';
import { PlatformSecretVaultService } from './platform-secret-vault.service';

/**
 * AI-Plattform-Governance (Amendment 03 §8–§12): Register, Adapter, Plattform-Tresor und Messung. Wird vom Mandanten-Laufzeitpfad (`AiProvidersModule`,
 * liest nur) und vom Plattformbetrieb (`PlatformModule`, schreibt – hinter Plattform-Guards) gemeinsam genutzt.
 */
@Module({
  imports: [PlatformAuditModule],
  providers: [AiAdapterRegistry, PlatformSecretVaultService, AiRegistryService, AiRegistryAdminService, AiMeterService],
  exports: [AiAdapterRegistry, PlatformSecretVaultService, AiRegistryService, AiRegistryAdminService, AiMeterService],
})
export class AiGovernanceModule {}
