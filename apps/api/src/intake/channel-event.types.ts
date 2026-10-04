import type { IntakeChannel } from '@orbit/domain';

/**
 * Channel Event Runtime — the normalized, channel-independent root object
 * every intake source (Gmail poll adapter, the `/inbox` "simulate incoming
 * email" form, and any future channel) converges onto before reaching
 * `IntakeService`. Deliberately NOT `IncomingEmailDto` — that DTO stays the
 * HTTP input shape for the simulate endpoint only; everything past the
 * controller boundary speaks `NormalizedIntakeEvent`.
 *
 * This type is transient (never persisted as-is) — `IntakeService` extracts
 * `content`/`attachments` into their proper domain homes (`EmailMessage`,
 * `Document`) and persists only references + orchestration metadata on the
 * durable `IntakeEvent` row (see schema.prisma's `IntakeEvent` model
 * doc comment for why the DB row itself avoids duplicating source data).
 */
export interface PartyReference {
  address?: string;
  displayName?: string;
}

export interface AttachmentReference {
  fileName: string;
  mimeType: string;
  contentBase64: string;
}

export interface NormalizedIntakeEvent {
  tenantId: string;
  /** `Integration.id` — absent for the SIMULATED channel (no real connector behind it). */
  connectionId?: string;
  channel: IntakeChannel;
  /** e.g. "gmail" | "simulated". */
  provider: string;
  /** The provider's own event/message id — the idempotency key together with `tenantId`+`provider`. */
  externalEventId: string;
  occurredAt: Date;
  sender?: PartyReference;
  recipients?: PartyReference[];
  subject?: string;
  content?: string;
  attachments?: AttachmentReference[];
  metadata?: Record<string, unknown>;
}
