import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsDate, IsDefined, IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

const REASON = { min: 5, max: 500 } as const;

class EnvironmentOverrideDto {
  @IsIn(['development', 'test', 'staging', 'production']) environment!: string;
  @IsDefined() value!: boolean | string | number;
}

class CohortOverrideDto {
  @IsString() @Matches(/^[a-z][a-z0-9_-]{1,40}$/) cohort!: string;
  @IsDefined() value!: boolean | string | number;
  @IsOptional() @IsInt() @Min(1) percent?: number;
}

class TenantOverrideDto {
  @IsString() @MinLength(8) @MaxLength(64) tenantId!: string;
  @IsDefined() value!: boolean | string | number;
}

export class CreateFlagDto {
  @IsString() @Matches(/^[a-z][a-z0-9_.-]{2,80}$/) key!: string;
  @IsString() @MinLength(5) @MaxLength(300) description!: string;
  @IsString() @MinLength(2) @MaxLength(120) owner!: string;
  @IsDefined() defaultValue!: boolean | string | number;
  @IsOptional() @IsIn(['DRAFT', 'ACTIVE', 'EXPIRED', 'RETIRED']) lifecycle?: 'DRAFT' | 'ACTIVE' | 'EXPIRED' | 'RETIRED';
  @IsOptional() @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => EnvironmentOverrideDto) environmentOverrides?: EnvironmentOverrideDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => CohortOverrideDto) cohortOverrides?: CohortOverrideDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => TenantOverrideDto) tenantOverrides?: TenantOverrideDto[];
  @IsOptional() @Type(() => Date) @IsDate() expiresAt?: Date;
  @IsOptional() @IsBoolean() exposeToTenant?: boolean;
}

export class UpdateFlagDto {
  @IsInt() @Min(1) expectedVersion!: number;
  @IsString() @MinLength(REASON.min) @MaxLength(REASON.max) reason!: string;
  @IsOptional() @IsString() @MinLength(5) @MaxLength(300) description?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) owner?: string;
  @IsOptional() defaultValue?: boolean | string | number;
  @IsOptional() @IsIn(['DRAFT', 'ACTIVE', 'EXPIRED', 'RETIRED']) lifecycle?: 'DRAFT' | 'ACTIVE' | 'EXPIRED' | 'RETIRED';
  @IsOptional() @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => EnvironmentOverrideDto) environmentOverrides?: EnvironmentOverrideDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => CohortOverrideDto) cohortOverrides?: CohortOverrideDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => TenantOverrideDto) tenantOverrides?: TenantOverrideDto[];
  @IsOptional() @Type(() => Date) @IsDate() expiresAt?: Date;
  @IsOptional() @IsBoolean() exposeToTenant?: boolean;
}

export class KillSwitchDto {
  @IsString() @MinLength(REASON.min) @MaxLength(REASON.max) reason!: string;
  @IsOptional() @IsInt() @Min(0) expectedVersion?: number;
}

export class ConnectorLifecycleDto {
  @IsIn(['DRAFT', 'TESTING', 'ACTIVE', 'DEPRECATED', 'SUSPENDED', 'RETIRED']) to!: 'DRAFT' | 'TESTING' | 'ACTIVE' | 'DEPRECATED' | 'SUSPENDED' | 'RETIRED';
  @IsInt() @Min(0) expectedVersion!: number;
  @IsString() @MinLength(REASON.min) @MaxLength(REASON.max) reason!: string;
}

export class TenantLifecycleQueryDto {
  @IsOptional() @IsString() @MaxLength(20) status?: string;
  @IsOptional() @IsString() @MaxLength(200) suspensionScopes?: string;
  @IsOptional() @IsString() @MaxLength(400) featureCohorts?: string;
}

export class TenantLifecycleChangeDto {
  @IsOptional() @IsString() @MaxLength(20) status?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) suspensionScopes?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) featureCohorts?: string[];
  @IsString() @MinLength(REASON.min) @MaxLength(REASON.max) reason!: string;
  /** Aus der Vorschau: bindet die Bestätigung an genau die beschriebene Wirkung. */
  @IsString() @MinLength(10) @MaxLength(64) confirmationToken!: string;
}
