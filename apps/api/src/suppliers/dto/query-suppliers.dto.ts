import { IsEnum, IsOptional } from 'class-validator';

export enum SupplierStatusDto {
  ACTIVE = 'ACTIVE',
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  BLOCKED = 'BLOCKED',
}

export class QuerySuppliersDto {
  @IsOptional()
  @IsEnum(SupplierStatusDto)
  status?: SupplierStatusDto;
}
