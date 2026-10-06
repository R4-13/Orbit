import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PlatformAuditService } from './audit/platform-audit.service';
import { PlatformAuthService } from './auth/platform-auth.service';
import { PlatformAuthGuard, PlatformScopeGuard } from './auth/platform-guards';
import { PlatformDiagnosticsService } from './diagnostics/platform-diagnostics.service';
import { PlatformIdentityService } from './identity/platform-identity.service';
import { PlatformAuthController, PlatformController, PlatformIdentityController } from './platform.controllers';
import { PlatformTenantsService } from './tenants/platform-tenants.service';

/**
 * ZERIONUS Platform Control Plane (Amendment 03) — eigene Sicherheitsdomäne im selben modularen Monolithen.
 * Keine Abhängigkeit von `AuthModule`/`JwtStrategy` des Mandantenpfads: eigene Identität, eigenes Secret (per Aufruf übergeben), eigene Guards.
 * Phase OPS-1: Identität, Rollen/Scopes, Sitzungen, Step-up, Audit, Mandantenregister (nur lesend). Weitere Funktionsbereiche folgen je Phase.
 */
@Module({
  imports: [JwtModule.register({})],
  controllers: [PlatformAuthController, PlatformController, PlatformIdentityController],
  providers: [PlatformAuditService, PlatformAuthService, PlatformDiagnosticsService, PlatformIdentityService, PlatformTenantsService, PlatformAuthGuard, PlatformScopeGuard],
  exports: [PlatformAuditService, PlatformAuthService, PlatformAuthGuard, PlatformScopeGuard],
})
export class PlatformModule {}
