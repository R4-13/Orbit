import { Global, Module } from '@nestjs/common';
import { PolicyConfigService } from './policy-config.service';
import { PolicyController } from './policy.controller';
import { PolicyEnforcementService } from './policy-enforcement.service';

@Global()
@Module({
  controllers: [PolicyController],
  providers: [PolicyEnforcementService, PolicyConfigService],
  exports: [PolicyEnforcementService, PolicyConfigService],
})
export class PolicyModule {}
