import { IsOptional, IsString, MinLength } from 'class-validator';

export class UpsertAiProviderConnectionDto {
  @IsString()
  @MinLength(1)
  apiKey!: string;

  /** Optional model override — leer = Plattform-Default für diesen Provider verwenden. */
  @IsOptional()
  @IsString()
  model?: string;
}
