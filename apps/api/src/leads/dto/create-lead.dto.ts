import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

export enum LeadSourceDto {
  EMAIL = 'EMAIL',
  PHONE = 'PHONE',
  WEB = 'WEB',
  MANUAL = 'MANUAL',
}

export class CreateLeadDto {
  @IsString()
  @MinLength(1)
  contactId!: string;

  @IsOptional()
  @IsString()
  companyId?: string;

  @IsEnum(LeadSourceDto)
  source!: LeadSourceDto;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  caseId?: string;
}
