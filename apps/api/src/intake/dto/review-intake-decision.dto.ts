import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ReviewIntakeDecisionDto {
  /** Short, human reason recorded with the audited override. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
