import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Ablehnung einer Freigabe mit optionaler Begründung (UI v2 §14: „Ablehnungsgrund“). */
export class RejectDecisionDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
