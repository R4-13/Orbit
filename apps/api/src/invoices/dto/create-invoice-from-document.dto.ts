import { IsOptional, IsString, MinLength } from 'class-validator';

export class CreateInvoiceFromDocumentDto {
  @IsString()
  @MinLength(1)
  documentId!: string;

  @IsOptional()
  @IsString()
  caseId?: string;
}
