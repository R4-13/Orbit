import { IsArray, IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateEvaluationCaseDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @MinLength(1)
  userMessage!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  expectedTools?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  forbiddenTools?: string[];

  @IsOptional()
  @IsBoolean()
  expectedApprovalRequired?: boolean;

  @IsOptional()
  @IsBoolean()
  critical?: boolean;
}
