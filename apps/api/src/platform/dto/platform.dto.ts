import { ArrayMaxSize, IsArray, IsEmail, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';

export class PlatformLoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(512)
  password!: string;
}

export class PlatformRefreshDto {
  /** Fehlt im Cookie-Modus: dann kommt das Token aus dem httpOnly-Cookie. */
  @IsOptional()
  @IsString()
  @MinLength(16)
  @MaxLength(256)
  refreshToken!: string;
}

export class PlatformChangePasswordDto {
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  currentPassword!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(512)
  newPassword!: string;
}

export class PlatformStepUpDto {
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  password!: string;
}

export class CreatePlatformIdentityDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  displayName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(512)
  password!: string;

  @IsArray()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  roles!: string[];
}

export class SetPlatformRolesDto {
  @IsArray()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  roles!: string[];

  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;
}

export class DisablePlatformIdentityDto {
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;
}

export class PlatformAuditQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  before?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  eventType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  targetTenantId?: string;

  @IsOptional()
  @IsIn(['all'])
  view?: 'all';
}

export class DiagnosticsQueryDto {
  @IsString()
  @MinLength(8)
  @MaxLength(64)
  tenantId!: string;

  /** Begründung des Zugriffs (Amendment 03 §17.4, OPS-33): wird mit dem Zugriff auditiert. */
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;
}
