// Baut eine E-Mail (RFC 5322 / MIME) ohne fremde Pakete. Betreff und Namen in UTF-8 (RFC 2047), Text als Base64, Anhang als multipart/mixed.
import { randomBytes } from 'node:crypto';

const wrap76 = (text) => text.replace(/(.{76})/g, '$1\r\n').replace(/\r\n$/, '');
const b64 = (data) => wrap76(Buffer.from(data).toString('base64'));

/** Kopfzeilenwert mit Umlauten: `=?UTF-8?B?...?=` (nur wenn nötig). */
export function encodeHeader(value) {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

/** Absender mit Anzeigename: `"Name" <adresse>`; der Name wird bei Bedarf kodiert. */
export function formatAddress(name, address) {
  if (!name) return address;
  const encoded = encodeHeader(name);
  return `${/^[\x20-\x7e]*$/.test(name) ? `"${name.replace(/["\\]/g, '')}"` : encoded} <${address}>`;
}

/**
 * @param {{ from: { name?: string, address: string }, to: string, subject: string, text: string, attachment?: { filename: string, mimeType: string, data: Buffer }, headers?: Record<string, string>, date?: Date }} mail
 * @returns {string} die Nachricht als Text mit CRLF-Zeilenenden
 */
export function buildMessage(mail) {
  const headers = [
    `From: ${formatAddress(mail.from.name, mail.from.address)}`,
    `To: ${mail.to}`,
    `Subject: ${encodeHeader(mail.subject)}`,
    `Date: ${(mail.date ?? new Date()).toUTCString().replace('GMT', '+0000')}`,
    'MIME-Version: 1.0',
    ...Object.entries(mail.headers ?? {}).map(([name, value]) => `${name}: ${value}`),
  ];
  const textPart = ['Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', b64(mail.text.replace(/\r?\n/g, '\r\n'))].join('\r\n');
  if (!mail.attachment) return [...headers, textPart].join('\r\n');
  const boundary = `sim-${randomBytes(12).toString('hex')}`;
  const filename = encodeHeader(mail.attachment.filename);
  const attachmentPart = [
    `Content-Type: ${mail.attachment.mimeType}; name="${filename}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${filename}"`,
    '',
    b64(mail.attachment.data),
  ].join('\r\n');
  return [...headers, `Content-Type: multipart/mixed; boundary="${boundary}"`, '', `--${boundary}`, textPart, `--${boundary}`, attachmentPart, `--${boundary}--`, ''].join('\r\n');
}

/** Gmail erwartet die ganze Nachricht als URL-sicheres Base64 im Feld `raw`. */
export function toRaw(message) {
  return Buffer.from(message, 'utf8').toString('base64url');
}
