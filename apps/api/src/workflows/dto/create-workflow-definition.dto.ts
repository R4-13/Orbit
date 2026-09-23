import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsIn, IsOptional, IsString, Matches, MinLength, ValidateNested } from 'class-validator';
import { WORKFLOW_TRIGGER_TYPES, WorkflowStepDto, type WorkflowTriggerType } from './workflow-step.dto';

export class CreateWorkflowDefinitionDto {
  @IsString()
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: 'key must be lowercase letters, digits and hyphens only, e.g. "sales-intake-workflow".',
  })
  key!: string;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  /** Rein informativ — kein Trigger ruft diese WorkflowDefinition in dieser Phase automatisch auf, siehe WorkflowRunnerService. */
  @IsIn(WORKFLOW_TRIGGER_TYPES)
  triggerType!: WorkflowTriggerType;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => WorkflowStepDto)
  steps!: WorkflowStepDto[];
}
