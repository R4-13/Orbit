import { IsEnum } from 'class-validator';

export enum LeadStatusDto {
  NEW = 'NEW',
  QUALIFIED = 'QUALIFIED',
  DISQUALIFIED = 'DISQUALIFIED',
  CONVERTED = 'CONVERTED',
}

export class UpdateLeadStatusDto {
  @IsEnum(LeadStatusDto)
  status!: LeadStatusDto;
}
