import { Module } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module';
import { AiProvidersModule } from '../ai-providers/ai-providers.module';
import { ApprovalsModule } from '../approvals/approvals.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { StorageModule } from '../storage/storage.module';
import { ActionLedgerService } from './action-ledger.service';
import { BlueprintRegistryService } from './blueprint-registry.service';
import { CapabilityRegistryService } from './capability-registry.service';
import { CaseCommandsController } from './case-commands.controller';
import { CaseOrchestrationController } from './case-orchestration.controller';
import { CaseOrchestrationService } from './case-orchestration.service';
import { CaseCommandsService } from './case-commands.service';
import { CaseCorrelationService } from './case-correlation.service';
import { CaseEventsService } from './case-events.service';
import { CaseFactsService } from './case-facts.service';
import { CaseLifecycleService } from './case-lifecycle.service';
import { HumanInteractionService } from './human-interaction.service';
import { OrchestratorService } from './orchestrator.service';
import { PlannerService } from './planner.service';
import { PlanStoreService } from './plan-store.service';
import { ProcessBlueprintsController } from './process-blueprints.controller';
import { ProcessSweepService } from './process-sweep.service';
import { DraftEditingService } from './reference/draft-editing.service';
import { ReferenceProcessService } from './reference/reference-process.service';
import { AppointmentSlotsService } from './reference/appointment-slots.service';
import { ReferenceProcessTools } from './reference/reference-process.tools';
import { RequestAnalysisService } from './reference/request-analysis.service';

/**
 * Business Process Framework (Amendment 02). Everything here builds on the
 * existing Prisma/Audit/Policy/Approval/AgentRuntime/ToolRegistry components;
 * it is not a second platform:
 *
 *  - Core state (no dependency on the tool registry): facts, correlation, lifecycle, case events, plans, action ledger.
 *  - Runtime: capability catalogue over the ToolRegistry, blueprint registry, AI planner + deterministic validator,
 *    the generic orchestrator and the command surface.
 */
@Module({
  imports: [AgentModule, AiProvidersModule, ApprovalsModule, IntegrationsModule, StorageModule],
  controllers: [ProcessBlueprintsController, CaseCommandsController, CaseOrchestrationController],
  providers: [
    CaseFactsService,
    CaseCorrelationService,
    CaseEventsService,
    CaseLifecycleService,
    PlanStoreService,
    ActionLedgerService,
    CapabilityRegistryService,
    BlueprintRegistryService,
    PlannerService,
    OrchestratorService,
    CaseCommandsService,
    ReferenceProcessService,
    ReferenceProcessTools,
    RequestAnalysisService,
    AppointmentSlotsService,
    DraftEditingService,
    ProcessSweepService,
    CaseOrchestrationService,
    HumanInteractionService,
  ],
  exports: [
    CaseFactsService,
    CaseCorrelationService,
    CaseEventsService,
    CaseLifecycleService,
    PlanStoreService,
    ActionLedgerService,
    CapabilityRegistryService,
    BlueprintRegistryService,
    PlannerService,
    OrchestratorService,
    CaseCommandsService,
    ReferenceProcessService,
    ProcessSweepService,
    CaseOrchestrationService,
    HumanInteractionService,
  ],
})
export class ProcessModule {}
