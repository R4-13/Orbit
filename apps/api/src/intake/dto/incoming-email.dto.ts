import { Type } from 'class-transformer';
import { IsArray, IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, ValidateNested } from 'class-validator';
import { SIMULATED_TRIAGE_SCENARIOS, type SimulatedTriageScenario } from '@orbit/shared';

export class EmailAttachmentDto {
  @IsString()
  @IsNotEmpty()
  fileName!: string;

  @IsString()
  @IsNotEmpty()
  mimeType!: string;

  /** Raw file bytes, base64-encoded — mirrors MailConnector's EmailAttachment shape. */
  @IsString()
  @IsNotEmpty()
  contentBase64!: string;
}

/**
 * Simulates an inbound email arriving (§1/§59 Scenario A/D) — stands in
 * for a real mail connector's webhook handler (§23/§29), which this MVP
 * doesn't have (no Microsoft Graph/Gmail credentials, see
 * docs/KNOWN_LIMITATIONS.md). Same payload shape a real webhook handler
 * would construct from MailConnector.listNewMessages()/a push
 * notification before calling this same IntakeService.
 */
export class IncomingEmailDto {
  @IsEmail()
  fromAddress!: string;

  @IsArray()
  @IsEmail({}, { each: true })
  toAddresses!: string[];

  @IsString()
  @IsNotEmpty()
  subject!: string;

  @IsString()
  @IsNotEmpty()
  bodyText!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => EmailAttachmentDto)
  attachment?: EmailAttachmentDto;

  /**
   * Demo/test only: pick the structured result the *simulated* AI provider returns for this message
   * (Amendment 02 §22.4). Rejected when a real provider is connected — a user can never inject a
   * triage verdict into a live AI run.
   */
  @IsOptional()
  @IsIn(SIMULATED_TRIAGE_SCENARIOS)
  simulatedTriageScenario?: SimulatedTriageScenario;
}
