import { IsEnum, IsOptional } from 'class-validator';
import { OpportunityStageDto } from './update-opportunity-stage.dto';

export class QueryOpportunitiesDto {
  @IsOptional()
  @IsEnum(OpportunityStageDto)
  stage?: OpportunityStageDto;
}
