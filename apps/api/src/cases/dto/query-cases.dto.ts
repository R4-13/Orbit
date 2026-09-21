import { IsEnum, IsOptional } from 'class-validator';
import { CaseStatusDto } from './update-case-status.dto';
import { CaseTypeDto } from './create-case.dto';

export class QueryCasesDto {
  @IsOptional()
  @IsEnum(CaseTypeDto)
  type?: CaseTypeDto;

  @IsOptional()
  @IsEnum(CaseStatusDto)
  status?: CaseStatusDto;
}
