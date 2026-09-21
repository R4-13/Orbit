import { IsEnum, IsOptional } from 'class-validator';

export enum ApprovalStatusDto {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export enum ApprovalEntityTypeDto {
  INVOICE = 'INVOICE',
  BOOKING_PROPOSAL = 'BOOKING_PROPOSAL',
  SUPPLIER = 'SUPPLIER',
  FOLLOW_UP = 'FOLLOW_UP',
  MEETING = 'MEETING',
}

export class QueryApprovalsDto {
  @IsOptional()
  @IsEnum(ApprovalStatusDto)
  status?: ApprovalStatusDto;

  @IsOptional()
  @IsEnum(ApprovalEntityTypeDto)
  entityType?: ApprovalEntityTypeDto;
}
