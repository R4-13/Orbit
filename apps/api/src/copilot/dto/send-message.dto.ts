import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

/** The case the user is looking at; validated again on the server before it is used (tenant and permission). */
export class SondeCaseContextDto {
  @IsUUID()
  caseId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  nodeId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  planRevision?: number;
}

export class SendMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  content!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => SondeCaseContextDto)
  context?: SondeCaseContextDto;
}
