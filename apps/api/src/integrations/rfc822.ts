import { randomBytes } from 'node:crypto';

export interface OutgoingAttachment {
  fileName: string;
  mimeType: string;
  content: Buffer;
}

export interface OutgoingMessage {
  from: string;
  to: string;
  subject: string;
  bodyText: string;
  inReplyTo?: string;
  references?: string[];
  attachments?: OutgoingAttachment[];
}

const CRLF = '\r\n';

/** Header values must never contain line breaks: a recipient or subject with CR/LF would be a header-injection vector. */
export function assertHeaderSafe(name: string, value: string): void {
  if (/[\r\n]/.test(value)) throw new Error(`Header ${name} enthält einen Zeilenumbruch.`);
}

/** RFC 2047 encoded-word for non-ASCII header text (subject, display names, file names). */
export function encodeHeaderText(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function foldBase64(base64: string): string {
  return base64.replace(/(.{76})/g, `$1${CRLF}`);
}

/** Minimal address check for an addr-spec (the application validates the reply target against facts before this point). */
export function assertAddress(address: string): void {
  assertHeaderSafe('address', address);
  if (!/^[^\s<>@,;"]+@[^\s<>@,;"]+\.[^\s<>@,;"]+$/.test(address)) throw new Error('Ungültige Empfängeradresse.');
}

/**
 * Builds an RFC 5322 / MIME message. Text is sent as UTF-8 base64, attachments as base64 parts. Threading headers
 * (`In-Reply-To`, `References`) are set when the message answers an existing one, so mail clients thread it correctly.
 * The `Message-ID` is deliberately left to the provider; the real value is read back after sending (see GmailConnector).
 */
export function buildRfc822Message(message: OutgoingMessage): string {
  assertAddress(message.to);
  assertAddress(message.from);
  assertHeaderSafe('Subject', message.subject);
  if (message.inReplyTo) assertHeaderSafe('In-Reply-To', message.inReplyTo);
  for (const ref of message.references ?? []) assertHeaderSafe('References', ref);

  const headers = [
    `From: ${message.from}`,
    `To: ${message.to}`,
    `Subject: ${encodeHeaderText(message.subject)}`,
    'MIME-Version: 1.0',
    ...(message.inReplyTo ? [`In-Reply-To: ${message.inReplyTo}`] : []),
    ...((message.references ?? []).length > 0 ? [`References: ${(message.references ?? []).join(' ')}`] : []),
  ];

  const textPart = ['Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', foldBase64(Buffer.from(message.bodyText, 'utf8').toString('base64'))].join(CRLF);
  const attachments = message.attachments ?? [];
  if (attachments.length === 0) return [...headers, textPart].join(CRLF);

  const boundary = `orbit_${randomBytes(12).toString('hex')}`;
  const parts = attachments.map((a) => {
    assertHeaderSafe('attachment', `${a.fileName}${a.mimeType}`);
    const encodedName = encodeHeaderText(a.fileName);
    return [
      `--${boundary}`,
      `Content-Type: ${a.mimeType}; name="${encodedName}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${encodedName}"`,
      '',
      foldBase64(a.content.toString('base64')),
    ].join(CRLF);
  });
  return [...headers, `Content-Type: multipart/mixed; boundary="${boundary}"`, '', `--${boundary}`, textPart, ...parts, `--${boundary}--`, ''].join(CRLF);
}

export function toBase64Url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
