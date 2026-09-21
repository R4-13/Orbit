import { IsEnum, IsOptional, IsString } from 'class-validator';

export enum TaskStatusDto {
  OPEN = 'OPEN',
  DONE = 'DONE',
  CANCELLED = 'CANCELLED',
}

export class QueryTasksDto {
  @IsOptional()
  @IsEnum(TaskStatusDto)
  status?: TaskStatusDto;

  @IsOptional()
  @IsString()
  caseId?: string;
}
