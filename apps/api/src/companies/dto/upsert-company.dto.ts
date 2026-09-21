import { IsOptional, IsString, MinLength } from 'class-validator';

export class UpsertCompanyDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  domain?: string;

  @IsOptional()
  @IsString()
  industry?: string;
}
