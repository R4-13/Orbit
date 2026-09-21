import { IsEnum } from 'class-validator';

export enum OpportunityStageDto {
  NEW = 'NEW',
  QUALIFICATION = 'QUALIFICATION',
  PROPOSAL = 'PROPOSAL',
  WON = 'WON',
  LOST = 'LOST',
}

export class UpdateOpportunityStageDto {
  @IsEnum(OpportunityStageDto)
  stage!: OpportunityStageDto;
}
