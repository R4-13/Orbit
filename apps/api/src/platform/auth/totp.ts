import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Zeitbasierte Einmalcodes nach RFC 6238 (TOTP) auf HOTP (RFC 4226): HMAC-SHA1, 30-Sekunden-Schritte, 6 Ziffern – das, was jede Authenticator-App kann. Reine Funktionen
 * ohne Datenbank; Speicherung, Verschlüsselung und Ablaufprüfung machen die Aufrufer. Nichts davon ist selbst erfunden: Aufbau und Testvektoren stehen in den RFCs.
 */

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Wie viele Schritte vor und nach dem aktuellen noch gelten (Uhrabweichung des Geräts). */
export const TOTP_WINDOW = 1;
export const RECOVERY_CODE_COUNT = 8;

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=-]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const index = BASE32.indexOf(ch);
    if (index < 0) throw new Error('Ungültiges Base32-Zeichen.');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Ein neues Geheimnis (160 Bit, wie von RFC 4226 empfohlen) als Base32-Text. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** HOTP (RFC 4226) für einen Zähler. */
export function hotp(secret: Buffer, counter: number, digits = TOTP_DIGITS): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', secret).update(message).digest();
  const offset = (hmac[hmac.length - 1] as number) & 0x0f;
  const binary = (((hmac[offset] as number) & 0x7f) << 24) | (((hmac[offset + 1] as number) & 0xff) << 16) | (((hmac[offset + 2] as number) & 0xff) << 8) | ((hmac[offset + 3] as number) & 0xff);
  return String(binary % 10 ** digits).padStart(digits, '0');
}

export function totpStep(now: Date): number {
  return Math.floor(now.getTime() / 1000 / TOTP_STEP_SECONDS);
}

export function totp(secret: Buffer, now: Date, digits = TOTP_DIGITS): string {
  return hotp(secret, totpStep(now), digits);
}

const equal = (a: string, b: string): boolean => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Prüft einen eingegebenen Code. Gibt den Zeitschritt zurück, zu dem er passt, sonst `null`. Ein Code gilt nur, wenn sein Schritt **neuer** ist als `lastAcceptedStep`
 * (derselbe Code wird nicht ein zweites Mal angenommen, auch nicht innerhalb des Fensters).
 */
export function verifyTotp(secret: Buffer, input: string, now: Date, lastAcceptedStep?: number | null): number | null {
  const code = input.replace(/\s/g, '');
  if (!/^\d{6}$/.test(code)) return null;
  const current = totpStep(now);
  let matched: number | null = null;
  for (let delta = -TOTP_WINDOW; delta <= TOTP_WINDOW; delta += 1) {
    const step = current + delta;
    // Alle Schritte werden geprüft (gleiche Laufzeit), unabhängig vom Treffer.
    if (equal(hotp(secret, step), code) && (lastAcceptedStep === undefined || lastAcceptedStep === null || step > lastAcceptedStep)) matched = matched === null || step > matched ? step : matched;
  }
  return matched;
}

/** Die Adresse für den QR-Code bzw. die manuelle Eingabe in der Authenticator-App. */
export function otpauthUri(input: { secret: string; account: string; issuer: string }): string {
  const label = `${encodeURIComponent(input.issuer)}:${encodeURIComponent(input.account)}`;
  return `otpauth://totp/${label}?secret=${input.secret}&issuer=${encodeURIComponent(input.issuer)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SECONDS}`;
}

/** Wiederherstellungscodes im Format `xxxxx-xxxxx` (ohne leicht verwechselbare Zeichen). */
export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const piece = () => Array.from(randomBytes(5), (b) => alphabet[b % alphabet.length]).join('');
  return Array.from({ length: count }, () => `${piece()}-${piece()}`);
}

export const normalizeRecoveryCode = (input: string): string => input.trim().toLowerCase().replace(/\s/g, '');
export const hashRecoveryCode = (input: string): string => createHash('sha256').update(normalizeRecoveryCode(input)).digest('hex');
export const looksLikeRecoveryCode = (input: string): boolean => /^[a-z2-9]{5}-[a-z2-9]{5}$/.test(normalizeRecoveryCode(input));
