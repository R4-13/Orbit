import { ArrayMinSize, IsArray, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

export enum AgentDefinitionStatusDto {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  DISABLED = 'DISABLED',
}

/**
 * `key` and `baseType` are deliberately not editable here — they identify
 * the agent and its category; changing either is conceptually "create a
 * different agent", not "reconfigure this one".
 */
export class UpdateAgentDefinitionDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  systemPrompt?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  allowedTools?: string[];

  @IsOptional()
  @IsEnum(AgentDefinitionStatusDto)
  status?: AgentDefinitionStatusDto;

  /** Free-text note attached to the resulting AgentDefinitionVersion row — purely descriptive, not validated further. */
  @IsOptional()
  @IsString()
  changeNote?: string;
}
