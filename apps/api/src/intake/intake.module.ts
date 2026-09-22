import { Module } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module';
import { ApprovalsModule } from '../approvals/approvals.module';
import { CasesModule } from '../cases/cases.module';
import { StorageModule } from '../storage/storage.module';
import { IntakeController } from './intake.controller';
import { IntakeService } from './intake.service';

@Module({
  imports: [AgentModule, CasesModule, ApprovalsModule, StorageModule],
  controllers: [IntakeController],
  providers: [IntakeService],
})
export class IntakeModule {}
