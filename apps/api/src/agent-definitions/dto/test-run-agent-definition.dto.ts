import { IsString, MinLength } from 'class-validator';

export class TestRunAgentDefinitionDto {
  @IsString()
  @MinLength(1)
  userMessage!: string;
}
