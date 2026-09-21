import { IsDateString, IsInt, IsOptional, IsPositive, IsString, MinLength } from 'class-validator';

export class ProposeMeetingSlotsDto {
  @IsOptional()
  @IsString()
  contactId?: string;

  @IsOptional()
  @IsString()
  opportunityId?: string;

  @IsString()
  @MinLength(1)
  title!: string;

  @IsInt()
  @IsPositive()
  durationMinutes!: number;

  @IsDateString()
  earliestStart!: string;

  @IsDateString()
  latestEnd!: string;
}
