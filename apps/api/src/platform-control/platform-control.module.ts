import { Global, Module } from '@nestjs/common';
import { PlatformAuditModule } from '../platform/audit/platform-audit.module';
import { TenantFeaturesController } from './tenant-features.controller';
import { PlatformControlAdminService } from './platform-control-admin.service';
import { PlatformControlService } from './platform-control.service';

/**
 * Plattformsteuerung (Amendment 03 §6, §13–§15). Global, weil die Durchsetzungspunkte (Policy, KI-Auflösung, Planer, Capability-Ausführbarkeit, Anmeldung)
 * die lesende `PlatformControlService` abfragen, ohne das Plattformmodul zu kennen. Schreibzugriffe laufen ausschließlich über `PlatformControlAdminService`
 * hinter den Plattform-Guards.
 */
@Global()
@Module({
  imports: [PlatformAuditModule],
  providers: [PlatformControlService, PlatformControlAdminService],
  exports: [PlatformControlService, PlatformControlAdminService],
})
export class PlatformControlModule {}

/**
 * Die Mandantensicht auf Flags (HTTP) gehört nur in den API-Prozess; der Worker braucht ausschließlich die Plattformsteuerung (Policy, KI-Auflösung,
 * Capability-Ausführbarkeit) und importiert deshalb nur `PlatformControlModule`.
 */
@Module({ controllers: [TenantFeaturesController] })
export class TenantFeaturesModule {}
