import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class UpsertContactDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsString()
  @MinLength(1)
  firstName!: string;

  @IsString()
  @MinLength(1)
  lastName!: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  companyId?: string;
}
