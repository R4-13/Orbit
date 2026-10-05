import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class ConnectorRequestDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  systemName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
