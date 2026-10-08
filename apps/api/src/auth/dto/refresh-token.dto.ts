import { IsOptional, IsString, MinLength } from 'class-validator';

export class RefreshTokenDto {
  /** Fehlt im Cookie-Modus (Browser): dann kommt das Token aus dem httpOnly-Cookie. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  refreshToken?: string;
}
