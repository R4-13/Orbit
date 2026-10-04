import { Module } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module';
import { AiProvidersModule } from '../ai-providers/ai-providers.module';
import { AgentDefinitionsModule } from '../agent-definitions/agent-definitions.module';
import { ApprovalsModule } from '../approvals/approvals.module';
import { CasesModule } from '../cases/cases.module';
import { ProcessModule } from '../process/process.module';
import { StorageModule } from '../storage/storage.module';
import { TasksModule } from '../tasks/tasks.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { ExecutionEvidenceService } from './execution-evidence.service';
import { IntakeController } from './intake.controller';
import { IntakeDecisionsController } from './intake-decisions.controller';
import { IntakeDecisionsService } from './intake-decisions.service';
import { IntakeService } from './intake.service';
import { SemanticTriageService } from './semantic-triage.service';

@Module({
  imports: [AgentModule, AiProvidersModule, ProcessModule, AgentDefinitionsModule, CasesModule, ApprovalsModule, StorageModule, TasksModule, WorkflowsModule],
  controllers: [IntakeController, IntakeDecisionsController],
  providers: [IntakeService, ExecutionEvidenceService, SemanticTriageService, IntakeDecisionsService],
  // IntakeService exported for ChannelSyncProcessor (Increment D) — the pipeline a real connector
  // sync event is fed into, same entry point `handleIncomingEmail()` already uses.
  exports: [IntakeService],
})
export class IntakeModule {}
