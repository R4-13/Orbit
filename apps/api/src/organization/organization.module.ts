import { Module } from '@nestjs/common';
import { StaffController, TenantProfileController } from './organization.controller';
import { StaffService } from './staff.service';
import { TenantProfileService } from './tenant-profile.service';

/** Betriebsprofil und Mitarbeiterverzeichnis – das Wissen über den Betrieb, mit dem ORBIT entscheidet und Menschen erreicht. */
@Module({
  controllers: [TenantProfileController, StaffController],
  providers: [TenantProfileService, StaffService],
  exports: [TenantProfileService, StaffService],
})
export class OrganizationModule {}
