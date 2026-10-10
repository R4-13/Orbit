import { ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';
import { AUTOMATION_PRESET_KEYS } from '@orbit/shared';

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

  /** Die Person muss das Startpasswort bei der ersten Anmeldung ändern. Standard aus: API-Clients und Skripte legen Zugänge ohne Zwang an. */
  @IsOptional()
  @IsBoolean()
  requirePasswordChange?: boolean;
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

export class ResetPlatformPasswordDto {
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

export class DiagnosticsSearchQueryDto {
  @IsString()
  @MinLength(3)
  @MaxLength(80)
  reference!: string;

  /** Begründung der Suche (Amendment 03 §17.4): wird mit dem Zugriff auditiert. */
  @IsString()
  @MinLength(5)
  @MaxLength(300)
  reason!: string;
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

/** Neuen Betrieb anlegen: Stammdaten, Branche, Automatisierungsgrad und der erste Administrator (Amendment 03 §6). */
export class ProvisionTenantDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  /** Kleinbuchstaben, Ziffern und Bindestriche; fehlt sie, wird sie aus dem Namen abgeleitet. */
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, { message: 'slug darf nur Kleinbuchstaben, Ziffern und einzelne Bindestriche enthalten' })
  @MaxLength(60)
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  industry?: string;

  @IsIn([...AUTOMATION_PRESET_KEYS])
  automationPreset!: string;

  @IsEmail()
  adminEmail!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  adminFirstName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  adminLastName!: string;

  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;
}
