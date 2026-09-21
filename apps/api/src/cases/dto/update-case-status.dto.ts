import { IsEnum } from 'class-validator';

export enum CaseStatusDto {
  OPEN = 'OPEN',
  IN_PROGRESS = 'IN_PROGRESS',
  WAITING_APPROVAL = 'WAITING_APPROVAL',
  DONE = 'DONE',
  CANCELLED = 'CANCELLED',
}

export class UpdateCaseStatusDto {
  @IsEnum(CaseStatusDto)
  status!: CaseStatusDto;
}
