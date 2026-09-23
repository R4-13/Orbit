import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsEnum, IsOptional, IsString, MinLength, ValidateNested } from 'class-validator';
import { WorkflowStepDto } from './workflow-step.dto';

export enum WorkflowDefinitionStatusDto {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  DISABLED = 'DISABLED',
}

/** `key` und `triggerType` sind nicht editierbar — dieselbe Begründung wie bei UpdateAgentDefinitionDto (key/baseType). */
export class UpdateWorkflowDefinitionDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => WorkflowStepDto)
  steps?: WorkflowStepDto[];

  @IsOptional()
  @IsEnum(WorkflowDefinitionStatusDto)
  status?: WorkflowDefinitionStatusDto;
}
