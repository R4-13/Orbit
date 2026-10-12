import { Module } from '@nestjs/common';
import { ProfileContextModule } from '../organization/profile-context.module';
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
import { LiveReconciliationService } from './live-reconciliation.service';
import { OrchestratorService } from './orchestrator.service';
import { PlannerService } from './planner.service';
import { PlanStoreService } from './plan-store.service';
import { ProcessBlueprintsController } from './process-blueprints.controller';
import { ProcessSweepService } from './process-sweep.service';
import { CUSTOMER_DIRECTORIES, OrbitContactsDirectory } from './customer/customer-directory';
import { CustomerRecordService } from './customer/customer-record.service';
import { ContactsModule } from '../contacts/contacts.module';
import { TasksModule } from '../tasks/tasks.module';
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
  imports: [ProfileContextModule, ContactsModule, TasksModule, AgentModule, AiProvidersModule, ApprovalsModule, IntegrationsModule, StorageModule],
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
    LiveReconciliationService,
    CaseOrchestrationService,
    HumanInteractionService,
    OrbitContactsDirectory,
    // Angebundene Kundenverzeichnisse (Kundenstamm). Heute ORBITs eigene Kontakte; CRM-/ERP-Adapter (HubSpot, Lexware …) kommen mit ihren Zugangsdaten hinzu.
    { provide: CUSTOMER_DIRECTORIES, useFactory: (orbit: OrbitContactsDirectory) => [orbit], inject: [OrbitContactsDirectory] },
    CustomerRecordService,
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
    CustomerRecordService,
    CUSTOMER_DIRECTORIES,
  ],
})
export class ProcessModule {}
