import { IsObject } from 'class-validator';

/** Freiform — der Tenant/Autor entscheidet, welche Felder seine Schritte per inputMapping referenzieren. */
export class TriggerWorkflowDto {
  @IsObject()
  input!: Record<string, unknown>;
}
