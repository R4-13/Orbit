import { IsInt, IsOptional, IsPositive, IsString, MinLength } from 'class-validator';

export class CreateUploadUrlDto {
  @IsOptional()
  @IsString()
  caseId?: string;

  @IsString()
  @MinLength(1)
  fileName!: string;

  @IsString()
  @MinLength(1)
  mimeType!: string;

  @IsInt()
  @IsPositive()
  sizeBytes!: number;
}
