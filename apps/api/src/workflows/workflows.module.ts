import { Module } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module';
import { AgentDefinitionsModule } from '../agent-definitions/agent-definitions.module';
import { ApprovalsModule } from '../approvals/approvals.module';
import { QueueModule } from '../queue/queue.module';
import { WorkflowDefinitionsController } from './workflow-definitions.controller';
import { WorkflowDefinitionsService } from './workflow-definitions.service';
import { WorkflowRunQueueService } from './workflow-run-queue.service';
import { WorkflowRunnerService } from './workflow-runner.service';

/**
 * docs/AGENT_STUDIO_CONCEPT.md Abschnitt 3. AgentModule for
 * AgentRunRecorderService (each workflow step's AgentRun), AgentDefinitionsModule
 * for the exported AgentDefinitionResolverService (resolves each step's
 * agent), ApprovalsModule for blocked-tool-call handling — same three
 * dependencies AgentDefinitionsModule itself already needed for its
 * test-run feature. QueueModule (docs/SCALABILITY_CONCEPT.md) for
 * WorkflowRunQueueService's `@InjectQueue()`.
 *
 * Exports WorkflowRunnerService so `apps/api/worker`'s WorkerModule can
 * import this whole module (and, with it, its entire dependency graph)
 * instead of re-wiring every transitive dependency by hand.
 */
@Module({
  imports: [AgentModule, AgentDefinitionsModule, ApprovalsModule, QueueModule],
  controllers: [WorkflowDefinitionsController],
  providers: [WorkflowDefinitionsService, WorkflowRunnerService, WorkflowRunQueueService],
  exports: [WorkflowRunnerService],
})
export class WorkflowsModule {}
