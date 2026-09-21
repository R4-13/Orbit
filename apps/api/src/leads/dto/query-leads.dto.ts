import { IsEnum, IsOptional } from 'class-validator';
import { LeadStatusDto } from './update-lead-status.dto';

export class QueryLeadsDto {
  @IsOptional()
  @IsEnum(LeadStatusDto)
  status?: LeadStatusDto;
}
