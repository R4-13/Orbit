import { Module } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module';
import { AgentDefinitionResolverService } from './agent-definition-resolver.service';
import { AgentDefinitionsController, ToolsController } from './agent-definitions.controller';
import { AgentDefinitionsService } from './agent-definitions.service';

/**
 * docs/AGENT_STUDIO_CONCEPT.md Abschnitt 1. Imports AgentModule for its
 * exported LLM_PROVIDER/TOOL_REGISTRY tokens (both the admin CRUD's tool
 * catalog and the runtime resolver need them) — same dependency IntakeModule
 * already has.
 */
@Module({
  imports: [AgentModule],
  controllers: [AgentDefinitionsController, ToolsController],
  providers: [AgentDefinitionsService, AgentDefinitionResolverService],
  exports: [AgentDefinitionResolverService],
})
export class AgentDefinitionsModule {}
