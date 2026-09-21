import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

export enum CaseTypeDto {
  FINANCE = 'FINANCE',
  SALES = 'SALES',
}

export class CreateCaseDto {
  @IsEnum(CaseTypeDto)
  type!: CaseTypeDto;

  @IsString()
  @MinLength(1)
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;
}
