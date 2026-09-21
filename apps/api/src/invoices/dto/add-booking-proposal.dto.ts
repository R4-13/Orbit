import { IsNumber, IsOptional, IsPositive, IsString, MinLength } from 'class-validator';

export class AddBookingProposalDto {
  @IsString()
  @MinLength(1)
  accountCode!: string;

  @IsOptional()
  @IsString()
  costCenter?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber()
  @IsPositive()
  amount!: number;
}
