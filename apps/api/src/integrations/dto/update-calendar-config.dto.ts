import { ArrayMaxSize, ArrayMinSize, IsArray, IsString, Matches, MaxLength } from 'class-validator';

/** Welche Kalender für Terminvorschläge gelesen werden: „primary“ (Hauptkalender) oder die Kalender-ID (meist eine E-Mail-Adresse) eines freigegebenen Kalenders. */
export class UpdateCalendarConfigDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  @Matches(/^[^\s,;<>"']+$/, { each: true, message: 'Eine Kalender-ID darf keine Leerzeichen, Kommas oder Anführungszeichen enthalten.' })
  calendarIds!: string[];
}
