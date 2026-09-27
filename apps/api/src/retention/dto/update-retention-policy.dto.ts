import { IsInt, Max, Min } from 'class-validator';
import { MAX_RETENTION_DAYS, MIN_RETENTION_DAYS } from '../retention.constants';

export class UpdateRetentionPolicyDto {
  @IsInt()
  @Min(MIN_RETENTION_DAYS)
  @Max(MAX_RETENTION_DAYS)
  retentionDays!: number;
}
