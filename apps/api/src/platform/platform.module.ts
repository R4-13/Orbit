import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ProcessModule } from '../process/process.module';
import { AiGovernanceModule } from '../ai-governance/ai-governance.module';
import { PlatformAuditModule } from './audit/platform-audit.module';
import { PlatformAiController } from './ai/platform-ai.controller';
import { PlatformConnectorsController, PlatformFeaturesController, PlatformKillSwitchController, PlatformTenantLifecycleController } from './control/platform-control.controller';
import { PlatformAuthService } from './auth/platform-auth.service';
import { PlatformAuthGuard, PlatformScopeGuard } from './auth/platform-guards';
import { PlatformDiagnosticsService } from './diagnostics/platform-diagnostics.service';
import { PlatformIdentityService } from './identity/platform-identity.service';
import { PlatformAuthController, PlatformController, PlatformIdentityController } from './platform.controllers';
import { QueueModule } from '../queue/queue.module';
import { TenantsModule } from '../tenants/tenants.module';
import { PlatformRuntimeMonitorService } from './runtime/platform-runtime-monitor.service';
import { PlatformRuntimeService } from './runtime/platform-runtime.service';
import { PlatformSupportController } from './support/platform-support.controller';
import { PlatformSupportService } from './support/platform-support.service';
import { PlatformTenantsService } from './tenants/platform-tenants.service';

/**
 * ZERIONUS Platform Control Plane (Amendment 03) — eigene Sicherheitsdomäne im selben modularen Monolithen.
 * Keine Abhängigkeit von `AuthModule`/`JwtStrategy` des Mandantenpfads: eigene Identität, eigenes Secret (per Aufruf übergeben), eigene Guards.
 * Phase OPS-1: Identität, Rollen/Scopes, Sitzungen, Step-up, Audit, Mandantenregister (nur lesend). Weitere Funktionsbereiche folgen je Phase.
 */
@Module({
  imports: [JwtModule.register({}), PlatformAuditModule, AiGovernanceModule, ProcessModule, QueueModule, TenantsModule],
  controllers: [PlatformAuthController, PlatformController, PlatformIdentityController, PlatformAiController, PlatformFeaturesController, PlatformKillSwitchController, PlatformConnectorsController, PlatformTenantLifecycleController, PlatformSupportController],
  providers: [PlatformAuthService, PlatformRuntimeService, PlatformRuntimeMonitorService, PlatformDiagnosticsService, PlatformSupportService, PlatformIdentityService, PlatformTenantsService, PlatformAuthGuard, PlatformScopeGuard],
  exports: [PlatformAuditModule, PlatformAuthService, PlatformAuthGuard, PlatformScopeGuard],
})
export class PlatformModule {}
