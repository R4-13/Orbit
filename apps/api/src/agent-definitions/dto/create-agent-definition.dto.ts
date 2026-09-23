import { ArrayMinSize, IsArray, IsEnum, IsOptional, IsString, Matches, MinLength } from 'class-validator';

export enum AgentBaseTypeDto {
  ORCHESTRATOR = 'ORCHESTRATOR',
  COMMUNICATION = 'COMMUNICATION',
  FINANCE = 'FINANCE',
  SALES = 'SALES',
}

export class CreateAgentDefinitionDto {
  /** Stable slug — lowercase letters/digits/hyphens, so it doubles as a URL path segment. */
  @IsString()
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: 'key must be lowercase letters, digits and hyphens only, e.g. "sales-support-agent".',
  })
  key!: string;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsEnum(AgentBaseTypeDto)
  baseType!: AgentBaseTypeDto;

  @IsString()
  @MinLength(1)
  systemPrompt!: string;

  /** Tool names from the ToolRegistry catalog (see GET /tools) — validated server-side against what's actually registered. */
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  allowedTools!: string[];
}
