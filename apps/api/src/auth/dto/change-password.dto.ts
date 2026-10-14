import { IsString, MaxLength, MinLength } from 'class-validator';
import { TENANT_MIN_PASSWORD_LENGTH } from '@orbit/shared';

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  currentPassword!: string;

  @IsString()
  @MinLength(TENANT_MIN_PASSWORD_LENGTH)
  @MaxLength(200)
  newPassword!: string;
}
