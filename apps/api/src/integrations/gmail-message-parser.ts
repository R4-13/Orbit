/**
 * Pure parsing of the Gmail REST API's `Message`/`MessagePart` shape
 * (verified against https://developers.google.com/gmail/api/reference/rest/v1/users.messages)
 * — split out from `GmailConnectorService` so it's unit-testable without
 * mocking `fetch`, the same reasoning as `buildDonutArcs`/`sortItems`
 * elsewhere in this project (packages/ui has no DOM to test against;
 * here there's no network to mock against).
 */
export interface GmailHeader {
  name: string;
  value: string;
}

export interface GmailMessagePart {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: GmailMessagePart[];
}

export interface GmailMessage {
  id: string;
  payload?: GmailMessagePart;
  /** Epoch milliseconds, as a string (Gmail's int64 JSON convention). */
  internalDate?: string;
}

export interface ParsedGmailHeaders {
  from: string;
  to: string[];
  subject: string;
  receivedAt: Date;
}

export interface GmailAttachmentRef {
  filename: string;
  mimeType: string;
  attachmentId: string;
}

function decodeBase64Url(data: string): string {
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64').toString('utf8');
}

/** Gmail's attachment `data` field is already base64url — this project's `EmailAttachment.contentBase64` expects standard base64, so re-pad/translate rather than decode-then-reencode (keeps binary attachments binary-safe). */
export function base64UrlToBase64(data: string): string {
  return data.replace(/-/g, '+').replace(/_/g, '/');
}

function getHeader(headers: GmailHeader[] | undefined, name: string): string {
  return headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

function findPlainTextPart(part: GmailMessagePart | undefined): GmailMessagePart | undefined {
  if (!part) return undefined;
  if (part.mimeType === 'text/plain' && part.body?.data) return part;
  for (const child of part.parts ?? []) {
    const found = findPlainTextPart(child);
    if (found) return found;
  }
  return undefined;
}

function collectAttachmentParts(part: GmailMessagePart | undefined): GmailMessagePart[] {
  if (!part) return [];
  const result: GmailMessagePart[] = part.filename && part.body?.attachmentId ? [part] : [];
  for (const child of part.parts ?? []) {
    result.push(...collectAttachmentParts(child));
  }
  return result;
}

export function parseGmailMessageHeaders(message: GmailMessage): ParsedGmailHeaders {
  const headers = message.payload?.headers;
  const toRaw = getHeader(headers, 'To');
  return {
    from: getHeader(headers, 'From'),
    to: toRaw
      ? toRaw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [],
    subject: getHeader(headers, 'Subject'),
    receivedAt: message.internalDate ? new Date(Number(message.internalDate)) : new Date(),
  };
}

/** Walks `payload`/`payload.parts` recursively (multipart messages nest a text/plain part inside multipart/alternative, etc.) and returns '' if none exists (e.g. an HTML-only message) rather than throwing — an email with no plain-text part is still a valid email to list. */
export function extractPlainTextBody(message: GmailMessage): string {
  const part = findPlainTextPart(message.payload);
  return part?.body?.data ? decodeBase64Url(part.body.data) : '';
}

export function listAttachmentRefs(message: GmailMessage): GmailAttachmentRef[] {
  return collectAttachmentParts(message.payload).map((part) => ({
    filename: part.filename as string,
    mimeType: part.mimeType ?? 'application/octet-stream',
    attachmentId: (part.body as { attachmentId: string }).attachmentId,
  }));
}
