import { Module } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module';
import { AiProvidersModule } from '../ai-providers/ai-providers.module';
import { AgentDefinitionsModule } from '../agent-definitions/agent-definitions.module';
import { ApprovalsModule } from '../approvals/approvals.module';
import { CasesModule } from '../cases/cases.module';
import { StorageModule } from '../storage/storage.module';
import { TasksModule } from '../tasks/tasks.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { ExecutionEvidenceService } from './execution-evidence.service';
import { IntakeController } from './intake.controller';
import { IntakeService } from './intake.service';

@Module({
  imports: [AgentModule, AiProvidersModule, AgentDefinitionsModule, CasesModule, ApprovalsModule, StorageModule, TasksModule, WorkflowsModule],
  controllers: [IntakeController],
  providers: [IntakeService, ExecutionEvidenceService],
  // IntakeService exported for ChannelSyncProcessor (Increment D) — the pipeline a real connector
  // sync event is fed into, same entry point `handleIncomingEmail()` already uses.
  exports: [IntakeService],
})
export class IntakeModule {}
