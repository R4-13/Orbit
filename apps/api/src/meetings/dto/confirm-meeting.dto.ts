import { ArrayMinSize, IsArray, IsDateString, IsEmail } from 'class-validator';

export class ConfirmMeetingDto {
  @IsDateString()
  start!: string;

  @IsDateString()
  end!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsEmail({}, { each: true })
  attendeeEmails!: string[];
}
