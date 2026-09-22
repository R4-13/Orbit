import { IsObject, IsOptional } from 'class-validator';

/**
 * Deliberately `Record<string, unknown>` rather than a fixed shape — each
 * connector type (DATEV OAuth client, HubSpot API key, Twilio SID/token, …)
 * has a completely different credential shape, and this endpoint never
 * inspects the contents (they're encrypted opaquely, see
 * CredentialEncryptionService). Per-provider shape validation belongs to
 * the real connector adapter that would eventually consume these, none of
 * which exist yet (every connector is a mock — see docs/INTEGRATIONS.md).
 */
export class UpsertIntegrationCredentialsDto {
  @IsObject()
  credentials!: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}
