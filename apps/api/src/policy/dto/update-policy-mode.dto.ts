import { IsIn } from 'class-validator';
import { POLICY_MODES, type PolicyMode } from '@orbit/shared';

export class UpdatePolicyModeDto {
  @IsIn(POLICY_MODES)
  mode!: PolicyMode;
}
