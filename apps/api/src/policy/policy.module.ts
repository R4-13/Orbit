import { Global, Module } from '@nestjs/common';
import { PolicyEnforcementService } from './policy-enforcement.service';

@Global()
@Module({
  providers: [PolicyEnforcementService],
  exports: [PolicyEnforcementService],
})
export class PolicyModule {}
