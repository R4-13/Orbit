import { IsIn } from 'class-validator';
import { AUTOMATION_PRESET_KEYS } from '@orbit/shared';

export class ApplyAutomationDto {
  @IsIn([...AUTOMATION_PRESET_KEYS])
  preset!: string;
}
