import { IsEnum, IsOptional } from 'class-validator';

export enum InvoiceStatusDto {
  RECEIVED = 'RECEIVED',
  EXTRACTED = 'EXTRACTED',
  DUPLICATE_SUSPECTED = 'DUPLICATE_SUSPECTED',
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  TRANSFERRED = 'TRANSFERRED',
  TRANSFER_FAILED = 'TRANSFER_FAILED',
}

export class QueryInvoicesDto {
  @IsOptional()
  @IsEnum(InvoiceStatusDto)
  status?: InvoiceStatusDto;
}
