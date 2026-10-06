import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { SUPPORT_MODES, SUPPORT_REASON_CODES } from '@orbit/shared';

export class RequestSupportSessionDto {
  @IsString() @MinLength(8) @MaxLength(64) tenantId!: string;
  @IsString() @IsIn([...SUPPORT_MODES]) mode!: string;
  @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) scopes!: string[];
  @IsInt() @Min(5) @Max(1440) minutes!: number;
  @IsString() @IsIn([...SUPPORT_REASON_CODES]) reasonCode!: string;
  @IsString() @MinLength(10) @MaxLength(500) freeTextReason!: string;
  @IsOptional() @IsString() @MaxLength(80) ticketRef?: string;
}

export class ApproveSupportSessionDto {
  @IsInt() @Min(1) expectedVersion!: number;
  @IsString() @MinLength(5) @MaxLength(500) reason!: string;
}

export class CloseSupportSessionDto {
  @IsString() @MinLength(5) @MaxLength(500) reason!: string;
}
