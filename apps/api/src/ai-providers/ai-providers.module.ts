import { Module } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module';
import { AiProviderResolverService } from './ai-provider-resolver.service';
import { AiProvidersController } from './ai-providers.controller';
import { AiProvidersService } from './ai-providers.service';

/** AgentModule for the platform-default LLM_PROVIDER token (AiProviderResolverService's ORBIT-Managed fallback). */
@Module({
  imports: [AgentModule],
  controllers: [AiProvidersController],
  providers: [AiProvidersService, AiProviderResolverService],
  exports: [AiProviderResolverService],
})
export class AiProvidersModule {}
