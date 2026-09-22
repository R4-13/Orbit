import { Type } from 'class-transformer';
import { IsArray, IsEmail, IsNotEmpty, IsOptional, IsString, ValidateNested } from 'class-validator';

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
}
