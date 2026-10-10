import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module';
import { AttentionService } from './attention.service';
import { AttentionController, StaffController, TenantProfileController } from './organization.controller';
import { StaffService } from './staff.service';
import { TenantProfileService } from './tenant-profile.service';

/** Betriebsprofil, Mitarbeiterverzeichnis und die Meldungen an Menschen – das Wissen über den Betrieb, mit dem ORBIT entscheidet und die richtigen Personen erreicht. */
@Module({
  imports: [IntegrationsModule],
  controllers: [TenantProfileController, StaffController, AttentionController],
  providers: [TenantProfileService, StaffService, AttentionService],
  exports: [TenantProfileService, StaffService, AttentionService],
})
export class OrganizationModule {}
