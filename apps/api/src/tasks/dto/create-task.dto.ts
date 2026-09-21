import { IsDateString, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateTaskDto {
  @IsOptional()
  @IsString()
  caseId?: string;

  @IsString()
  @MinLength(1)
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;
}
