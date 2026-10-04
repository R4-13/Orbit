import { IsIn, IsObject } from 'class-validator';
import { BLUEPRINT_STATUSES, type BlueprintStatus } from '@orbit/shared';

/** The blueprint document itself is validated by its zod schema (strict, versioned), not by class-validator. */
export class ImportBlueprintDto {
  @IsObject()
  definition!: Record<string, unknown>;
}

export class TransitionBlueprintDto {
  @IsIn([...BLUEPRINT_STATUSES])
  to!: BlueprintStatus;
}

/** The command envelope is validated by `parseCaseCommand` (strict zod); the DTO only requires an object. */
export class CaseCommandDto {
  @IsObject()
  command!: Record<string, unknown>;
}
