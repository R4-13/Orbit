import { IsEnum, IsOptional, IsString, IsUrl, Matches, MaxLength } from 'class-validator';

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export enum BrandingBorderRadiusPresetDto {
  COMPACT = 'COMPACT',
  STANDARD = 'STANDARD',
  SOFT = 'SOFT',
}

/** §5.2 der UI/UX-Spezifikation (`TenantBranding`) — jedes Feld optional, ein `null`-Wert setzt es zurück auf den Standard. */
export class UpdateTenantBrandingDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  companyDisplayName?: string;

  @IsOptional()
  @IsUrl({ require_tld: false }, { message: 'logoUrl must be a valid URL.' })
  logoUrl?: string;

  @IsOptional()
  @IsUrl({ require_tld: false }, { message: 'logoMarkUrl must be a valid URL.' })
  logoMarkUrl?: string;

  @IsOptional()
  @Matches(HEX_COLOR, { message: 'primaryColor must be a hex color, e.g. #1d4ed8.' })
  primaryColor?: string;

  @IsOptional()
  @Matches(HEX_COLOR, { message: 'primaryForeground must be a hex color, e.g. #ffffff.' })
  primaryForeground?: string;

  @IsOptional()
  @Matches(HEX_COLOR, { message: 'secondaryColor must be a hex color.' })
  secondaryColor?: string;

  @IsOptional()
  @Matches(HEX_COLOR, { message: 'secondaryForeground must be a hex color.' })
  secondaryForeground?: string;

  @IsOptional()
  @Matches(HEX_COLOR, { message: 'accentColor must be a hex color.' })
  accentColor?: string;

  @IsOptional()
  @Matches(HEX_COLOR, { message: 'accentForeground must be a hex color.' })
  accentForeground?: string;

  @IsOptional()
  @Matches(HEX_COLOR, { message: 'navigationBackground must be a hex color.' })
  navigationBackground?: string;

  @IsOptional()
  @Matches(HEX_COLOR, { message: 'navigationForeground must be a hex color.' })
  navigationForeground?: string;

  @IsOptional()
  @IsEnum(BrandingBorderRadiusPresetDto)
  borderRadiusPreset?: BrandingBorderRadiusPresetDto;
}
