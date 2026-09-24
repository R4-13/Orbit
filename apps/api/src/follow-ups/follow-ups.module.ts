import { Module } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module';
import { ApprovalsModule } from '../approvals/approvals.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { FollowUpResumeService } from './follow-up-resume.service';
import { FollowUpsController } from './follow-ups.controller';

/**
 * docs/ORBIT_UNIFIED_IMPLEMENTATION_PLAN.md, Phase 1 ("Durable Workflow +
 * Approval Resume"). Separate from ApprovalsModule by design —
 * ApprovalsModule's own doc comment explicitly keeps it free of
 * entity-specific decide logic; AgentModule (TOOL_REGISTRY,
 * AgentRunRecorderService) and WorkflowsModule (WorkflowRunnerService)
 * are this module's actual dependencies, exactly like
 * AgentDefinitionsModule/WorkflowsModule already import AgentModule for
 * the same reasons.
 */
@Module({
  imports: [AgentModule, ApprovalsModule, WorkflowsModule],
  controllers: [FollowUpsController],
  providers: [FollowUpResumeService],
})
export class FollowUpsModule {}
