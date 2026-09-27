import { Module } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module';
import { ApprovalsModule } from '../approvals/approvals.module';
import { AgentDefinitionResolverService } from './agent-definition-resolver.service';
import { AgentDefinitionTestRunService } from './agent-definition-test-run.service';
import { AgentDefinitionsController, ToolsController } from './agent-definitions.controller';
import { AgentDefinitionsService } from './agent-definitions.service';
import { AgentEvaluationService } from './agent-evaluation.service';

/**
 * docs/AGENT_STUDIO_CONCEPT.md Abschnitt 1/2. Imports AgentModule for its
 * exported LLM_PROVIDER/TOOL_REGISTRY tokens (both the admin CRUD's tool
 * catalog and the runtime resolver need them) — same dependency IntakeModule
 * already has. ApprovalsModule is for AgentDefinitionTestRunService's
 * blocked-tool-call handling (same pattern as IntakeService).
 */
@Module({
  imports: [AgentModule, ApprovalsModule],
  controllers: [AgentDefinitionsController, ToolsController],
  providers: [AgentDefinitionsService, AgentDefinitionResolverService, AgentDefinitionTestRunService, AgentEvaluationService],
  exports: [AgentDefinitionResolverService],
})
export class AgentDefinitionsModule {}
