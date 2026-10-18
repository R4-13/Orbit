import { Module } from '@nestjs/common';
import { OrganizationModule } from '../organization/organization.module';
import { ProcessModule } from '../process/process.module';
import { SetupController } from './setup.controller';
import { SetupService } from './setup.service';

/** Einrichtungsassistent: führt durch Profil, Mitarbeitende, Verbindungen und Regeln und zeigt, was ORBIT damit übernimmt. */
@Module({
  imports: [OrganizationModule, ProcessModule],
  controllers: [SetupController],
  providers: [SetupService],
})
export class SetupModule {}
