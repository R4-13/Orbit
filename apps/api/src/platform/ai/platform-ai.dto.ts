import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsDate, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

const REASON = { min: 5, max: 500 } as const;
const FALLBACK_MODES = ['NO_FALLBACK', 'SAME_PROVIDER_FALLBACK', 'APPROVED_CROSS_PROVIDER_FALLBACK'] as const;
const ENVIRONMENTS = ['development', 'test', 'staging', 'production'] as const;

export class CreateProviderDto {
  @IsString() @Matches(/^[a-z][a-z0-9-]{1,40}$/) providerKey!: string;
  @IsString() @MinLength(2) @MaxLength(80) displayName!: string;
  @IsString() @Matches(/^[a-z][a-z0-9-]{1,40}$/) adapterKey!: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) supportedRegions?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) supportedCapabilities?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) supportedCredentialTypes?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) dataPolicyRefs?: string[];
}

export class TransitionProviderDto {
  @IsIn(['DRAFT', 'VALIDATING', 'ACTIVE', 'DEPRECATED', 'SUSPENDED', 'RETIRED']) to!: 'DRAFT' | 'VALIDATING' | 'ACTIVE' | 'DEPRECATED' | 'SUSPENDED' | 'RETIRED';
  @IsInt() @Min(1) expectedVersion!: number;
  @IsString() @MinLength(REASON.min) @MaxLength(REASON.max) reason!: string;
}

export class CreateModelDto {
  @IsString() @MinLength(2) @MaxLength(60) providerKey!: string;
  @IsString() @MinLength(1) @MaxLength(120) providerModelId!: string;
  @IsString() @MinLength(1) @MaxLength(120) displayName!: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) capabilityTags?: string[];
  @IsOptional() @IsInt() @Min(1) contextLimit?: number;
  @IsOptional() @IsBoolean() toolUseSupported?: boolean;
  @IsOptional() @IsBoolean() structuredOutputSupported?: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) regionAvailability?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) dataPolicyRefs?: string[];
  @IsOptional() @IsNumber() @Min(0) costInputPerMtok?: number;
  @IsOptional() @IsNumber() @Min(0) costOutputPerMtok?: number;
  @IsOptional() @IsString() @MaxLength(3) costCurrency?: string;
}

export class RecordEvaluationDto {
  @IsIn(['PASSED', 'FAILED']) result!: 'PASSED' | 'FAILED';
  @IsInt() @Min(1) expectedVersion!: number;
  @IsString() @MinLength(REASON.min) @MaxLength(REASON.max) note!: string;
}

export class TransitionModelDto {
  @IsIn(['VALIDATING', 'APPROVED', 'DEPRECATED', 'BLOCKED', 'RETIRED']) to!: 'VALIDATING' | 'APPROVED' | 'DEPRECATED' | 'BLOCKED' | 'RETIRED';
  @IsInt() @Min(1) expectedVersion!: number;
  @IsString() @MinLength(REASON.min) @MaxLength(REASON.max) reason!: string;
}

export class CreateProfileDraftDto {
  @IsString() @Matches(/^[A-Z][A-Z0-9_]{2,60}$/) profileKey!: string;
  @IsString() @MinLength(5) @MaxLength(300) purpose!: string;
  @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) requiredCapabilities!: string[];
  @IsOptional() @IsIn(FALLBACK_MODES) fallbackMode?: (typeof FALLBACK_MODES)[number];
  @IsOptional() @IsInt() @Min(100) maxLatencyMs?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) requiredDataPolicyRefs?: string[];
}

export class PublishProfileDto {
  @IsString() @MinLength(REASON.min) @MaxLength(REASON.max) reason!: string;
}

export class CreateRouteDto {
  @IsString() @Matches(/^[A-Z][A-Z0-9_]{2,60}$/) modelProfileKey!: string;
  @IsIn(ENVIRONMENTS) environment!: (typeof ENVIRONMENTS)[number];
  @IsOptional() @IsString() @MaxLength(64) tenantScope?: string;
  @IsString() @MinLength(8) @MaxLength(64) primaryModelId!: string;
  @IsOptional() @IsArray() @ArrayMaxSize(5) @IsString({ each: true }) fallbackModelIds?: string[];
  @IsOptional() @IsIn(FALLBACK_MODES) fallbackMode?: (typeof FALLBACK_MODES)[number];
  @IsOptional() @IsInt() @Min(1) @Max(100) trafficPercent?: number;
  @IsOptional() @Type(() => Date) @IsDate() activeFrom?: Date;
  @IsOptional() @Type(() => Date) @IsDate() activeUntil?: Date;
}

export class RouteChangeDto {
  @IsInt() @Min(1) expectedVersion!: number;
  @IsString() @MinLength(REASON.min) @MaxLength(REASON.max) reason!: string;
}

export class CreateConnectionDto {
  @IsString() @MinLength(2) @MaxLength(60) providerKey!: string;
  @IsIn(ENVIRONMENTS) environment!: (typeof ENVIRONMENTS)[number];
  @IsOptional() @IsString() @MaxLength(20) regionKey?: string;
  /** Der Schlüssel selbst – wird verschlüsselt abgelegt und nie wieder ausgegeben. */
  @IsOptional() @IsString() @MinLength(8) @MaxLength(4096) secretValue?: string;
  /** Alternativ eine Referenz auf ein per Deployment bereitgestelltes Secret (`env:NAME`). */
  @IsOptional() @IsString() @MaxLength(100) secretRef?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) allowedProfileKeys?: string[];
}

export class RotateSecretDto {
  @IsString() @MinLength(8) @MaxLength(4096) secretValue!: string;
  @IsInt() @Min(1) expectedVersion!: number;
  @IsString() @MinLength(REASON.min) @MaxLength(REASON.max) reason!: string;
}

export class ConnectionLifecycleDto {
  @IsIn(['CONFIGURING', 'ACTIVE', 'DEGRADED', 'SUSPENDED', 'REVOKED']) to!: 'CONFIGURING' | 'ACTIVE' | 'DEGRADED' | 'SUSPENDED' | 'REVOKED';
  @IsInt() @Min(1) expectedVersion!: number;
  @IsString() @MinLength(REASON.min) @MaxLength(REASON.max) reason!: string;
}

export class DisableProviderDto {
  @IsBoolean() disabled!: boolean;
  @IsString() @MinLength(REASON.min) @MaxLength(REASON.max) reason!: string;
}

export class UsageQueryDto {
  @IsOptional() @Type(() => Date) @IsDate() from?: Date;
  @IsOptional() @Type(() => Date) @IsDate() to?: Date;
  @IsOptional() @IsIn(['profileKey', 'providerKey', 'tenantId', 'modelId']) groupBy?: 'profileKey' | 'providerKey' | 'tenantId' | 'modelId';
}

export class UpsertCostLimitDto {
  @IsIn(['GLOBAL', 'TENANT', 'PROFILE']) scope!: 'GLOBAL' | 'TENANT' | 'PROFILE';
  @IsOptional() @IsString() @MinLength(8) @MaxLength(64) targetTenantId?: string;
  @IsOptional() @IsString() @Matches(/^[A-Z][A-Z0-9_]{2,60}$/) profileKey?: string;
  @IsOptional() @IsString() @Matches(/^[A-Za-z]{3}$/) currency?: string;
  @IsOptional() @IsNumber() @Min(0.01) warnAmount?: number;
  @IsOptional() @IsNumber() @Min(0.01) softAmount?: number;
  @IsOptional() @IsNumber() @Min(0.01) hardAmount?: number;
  @IsOptional() @IsBoolean() hardEnforced?: boolean;
  /** Beim Ändern eines bestehenden Limits Pflicht (Konkurrenzschutz). */
  @IsOptional() @IsInt() @Min(0) expectedVersion?: number;
  @IsString() @MinLength(REASON.min) @MaxLength(REASON.max) reason!: string;
}

export class RemoveCostLimitDto {
  @IsInt() @Min(1) expectedVersion!: number;
  @IsString() @MinLength(REASON.min) @MaxLength(REASON.max) reason!: string;
}
