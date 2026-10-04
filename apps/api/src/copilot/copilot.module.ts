import { Module } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module';
import { AiProvidersModule } from '../ai-providers/ai-providers.module';
import { ApprovalsModule } from '../approvals/approvals.module';
import { ProcessModule } from '../process/process.module';
import { SondeCaseContextService } from './case-context.service';
import { CopilotConversationService } from './copilot-conversation.service';
import { CopilotController } from './copilot.controller';
import { CopilotRuntimeService } from './copilot-runtime.service';

/** AgentModule for TOOL_REGISTRY/AgentRunRecorderService, AiProvidersModule for per-tenant provider resolution, ApprovalsModule for blocked-tool-call routing (same pattern as AgentDefinitionTestRunService). */
@Module({
  imports: [AgentModule, AiProvidersModule, ApprovalsModule, ProcessModule],
  controllers: [CopilotController],
  providers: [CopilotConversationService, CopilotRuntimeService, SondeCaseContextService],
})
export class CopilotModule {}
