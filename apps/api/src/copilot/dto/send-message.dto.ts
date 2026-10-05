import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

/** The case the user is looking at; validated again on the server before it is used (tenant and permission). */
export class SondeCaseContextDto {
  @IsUUID()
  caseId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  nodeId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  planRevision?: number;
}

export const SONDE_REQUEST_MODES = ['ASK', 'PREPARE', 'ACT'] as const;
export type SondeRequestMode = (typeof SONDE_REQUEST_MODES)[number];

export class SendMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  content!: string;

  /**
   * UI v2 §8.3: der gewählte Modus beschränkt die Werkzeuge dieser Nachricht (Fragen < Vorbereiten < Ausführen).
   * Ohne Angabe gilt der sicherste Modus „Fragen“; ein Modus ersetzt nie Policy oder Freigabe.
   */
  @IsOptional()
  @IsIn(SONDE_REQUEST_MODES as unknown as string[])
  mode?: SondeRequestMode;

  @IsOptional()
  @ValidateNested()
  @Type(() => SondeCaseContextDto)
  context?: SondeCaseContextDto;
}
