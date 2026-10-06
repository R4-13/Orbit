import { Module } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module';
import { AiGovernanceModule } from '../ai-governance/ai-governance.module';
import { AiProviderResolverService } from './ai-provider-resolver.service';
import { AiProvidersController } from './ai-providers.controller';
import { AiProvidersService } from './ai-providers.service';

/** AgentModule for the platform-default LLM_PROVIDER token (AiProviderResolverService's ORBIT-Managed fallback). */
@Module({
  imports: [AgentModule, AiGovernanceModule],
  controllers: [AiProvidersController],
  providers: [AiProvidersService, AiProviderResolverService],
  exports: [AiProviderResolverService, AiProvidersService],
})
export class AiProvidersModule {}
