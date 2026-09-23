import { Module } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module';
import { AgentDefinitionsModule } from '../agent-definitions/agent-definitions.module';
import { ApprovalsModule } from '../approvals/approvals.module';
import { WorkflowDefinitionsController } from './workflow-definitions.controller';
import { WorkflowDefinitionsService } from './workflow-definitions.service';
import { WorkflowRunnerService } from './workflow-runner.service';

/**
 * docs/AGENT_STUDIO_CONCEPT.md Abschnitt 3. AgentModule for
 * AgentRunRecorderService (each workflow step's AgentRun), AgentDefinitionsModule
 * for the exported AgentDefinitionResolverService (resolves each step's
 * agent), ApprovalsModule for blocked-tool-call handling — same three
 * dependencies AgentDefinitionsModule itself already needed for its
 * test-run feature.
 */
@Module({
  imports: [AgentModule, AgentDefinitionsModule, ApprovalsModule],
  controllers: [WorkflowDefinitionsController],
  providers: [WorkflowDefinitionsService, WorkflowRunnerService],
})
export class WorkflowsModule {}
