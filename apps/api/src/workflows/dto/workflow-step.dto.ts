import { Type } from 'class-transformer';
import { IsInt, IsObject, IsOptional, IsString, Min, MinLength, ValidateNested } from 'class-validator';

export class WorkflowStepConditionDto {
  /** JSON-Path-artiger Ausdruck, siehe workflow-path.ts — z. B. "$.steps[1].output.classify_message.category". */
  @IsString()
  @MinLength(1)
  field!: string;

  @IsString()
  equals!: string;
}

export class WorkflowStepDto {
  @IsInt()
  @Min(1)
  order!: number;

  /** AgentDefinition.key dieses Tenants — Existenz wird erst beim Ausführen geprüft, siehe Schema-Kommentar. */
  @IsString()
  @MinLength(1)
  agentDefinitionKey!: string;

  /** Feldname -> JSON-Path-Ausdruck, siehe workflow-path.ts. */
  @IsOptional()
  @IsObject()
  inputMapping?: Record<string, string>;

  @IsOptional()
  @ValidateNested()
  @Type(() => WorkflowStepConditionDto)
  condition?: WorkflowStepConditionDto;
}

export const WORKFLOW_TRIGGER_TYPES = ['EMAIL', 'WEBHOOK', 'SCHEDULE', 'MANUAL'] as const;
export type WorkflowTriggerType = (typeof WORKFLOW_TRIGGER_TYPES)[number];
