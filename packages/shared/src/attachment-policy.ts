import { verifyFileSignature } from './file-signature';

/**
 * Freigabe von E-Mail-Anhängen für die automatische Verarbeitung (Pilotvorbereitung, technisch erzwungen). Reine Regeln ohne Datenbank und Speicher.
 *
 * Nur ein **freigegebener** Anhang wird abgerufen, gespeichert, als Dokument geführt und gelesen (Textauszug für Triage und Extraktion). Alles andere wird **zurückgehalten**: es wird nicht
 * gespeichert, nicht gelesen und nicht angezeigt; die Nachricht trägt nur den Vermerk (Name, Art, Größe, Grund), und eine Person bekommt eine Aufgabe, den Anhang im Postfach selbst zu prüfen.
 * Die Grenzen gelten vor dem Abruf (Größenangabe des Anbieters), während des Abrufs (Abbruch bei Überschreitung) und nach dem Abruf (tatsächliche Bytes, Dateisignatur).
 */
export const ATTACHMENT_POLICY = {
  /** Mehr freigegebene Anhänge je Nachricht werden nicht abgerufen. */
  maxCount: 5,
  /** Größer wird weder abgerufen noch gespeichert. */
  maxBytesEach: 5 * 1024 * 1024,
  /** Summe der freigegebenen Anhänge je Nachricht. */
  maxBytesTotal: 15 * 1024 * 1024,
  /** Dateiarten, die verarbeitet werden dürfen (Text wird nur aus PDF mit Textebene, Word und Klartext gelesen; Bilder werden abgelegt, aber nicht ausgewertet). */
  allowedTypes: [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/csv',
    'image/jpeg',
    'image/png',
  ],
  /** Endungen, die nie verarbeitet werden – auch nicht, wenn die Art harmlos angegeben ist (z. B. „rechnung.pdf.exe“). */
  blockedExtensions: ['exe', 'dll', 'bat', 'cmd', 'com', 'scr', 'msi', 'js', 'jse', 'vbs', 'vbe', 'wsf', 'ps1', 'jar', 'lnk', 'iso', 'img', 'zip', 'rar', '7z', 'tar', 'gz', 'docm', 'xlsm', 'pptm', 'html', 'htm', 'svg'],
} as const;

export const HOLD_REASONS = ['TOO_MANY', 'TOO_LARGE', 'TOTAL_TOO_LARGE', 'TYPE_NOT_ALLOWED', 'BLOCKED_EXTENSION', 'SIGNATURE_MISMATCH', 'EMPTY'] as const;
export type HoldReason = (typeof HOLD_REASONS)[number];

export const HOLD_REASON_TEXT: Record<HoldReason, string> = {
  TOO_MANY: `mehr als ${ATTACHMENT_POLICY.maxCount} Anhänge in einer Nachricht`,
  TOO_LARGE: `größer als ${ATTACHMENT_POLICY.maxBytesEach / 1024 / 1024} MB`,
  TOTAL_TOO_LARGE: `Anhänge zusammen größer als ${ATTACHMENT_POLICY.maxBytesTotal / 1024 / 1024} MB`,
  TYPE_NOT_ALLOWED: 'Dateiart nicht freigegeben',
  BLOCKED_EXTENSION: 'Dateiendung nicht freigegeben (Programm, Skript, Archiv oder Webseite)',
  SIGNATURE_MISMATCH: 'Inhalt passt nicht zur angegebenen Dateiart oder ist ein Programm',
  EMPTY: 'leere Datei',
};

/** Ein zurückgehaltener Anhang: nur Metadaten, nie Inhalt. */
export interface HeldAttachment {
  fileName: string;
  mimeType: string;
  sizeBytes: number | null;
  reason: HoldReason;
  note: string;
}

export interface AttachmentCandidate {
  fileName: string;
  mimeType: string;
  /** Größe laut Anbieter (vor dem Abruf) oder tatsächliche Länge. */
  sizeBytes?: number | null;
  /** Nur nach dem Abruf: die Bytes (Dateisignatur wird geprüft). */
  bytes?: Uint8Array;
}

const hold = (c: AttachmentCandidate, reason: HoldReason): HeldAttachment => ({
  fileName: c.fileName,
  mimeType: c.mimeType,
  sizeBytes: c.bytes ? c.bytes.byteLength : (c.sizeBytes ?? null),
  reason,
  note: HOLD_REASON_TEXT[reason],
});

const normalizedType = (mimeType: string): string => mimeType.toLowerCase().split(';')[0]?.trim() ?? '';
const extensionOf = (fileName: string): string => {
  const dot = fileName.lastIndexOf('.');
  return dot < 0 ? '' : fileName.slice(dot + 1).trim().toLowerCase();
};

/**
 * Prüft Anhänge einer Nachricht in ihrer Reihenfolge und liefert je Anhang `null` (freigegeben) oder den Vermerk, warum er zurückgehalten wird. Kennt der Aufrufer nur die Größenangaben
 * (vor dem Abruf), genügen `sizeBytes`; mit `bytes` wird zusätzlich die Dateisignatur geprüft. Unbekannte Größe zählt für die Gesamtgrenze mit der Einzelgrenze.
 */
export function screenAttachments(candidates: readonly AttachmentCandidate[]): Array<HeldAttachment | null> {
  let accepted = 0;
  let totalBytes = 0;
  return candidates.map((c) => {
    const size = c.bytes ? c.bytes.byteLength : (c.sizeBytes ?? null);
    if (extensionOf(c.fileName) && (ATTACHMENT_POLICY.blockedExtensions as readonly string[]).includes(extensionOf(c.fileName))) return hold(c, 'BLOCKED_EXTENSION');
    if (!(ATTACHMENT_POLICY.allowedTypes as readonly string[]).includes(normalizedType(c.mimeType))) return hold(c, 'TYPE_NOT_ALLOWED');
    if (size !== null && size > ATTACHMENT_POLICY.maxBytesEach) return hold(c, 'TOO_LARGE');
    if (size === 0) return hold(c, 'EMPTY');
    if (c.bytes) {
      const verdict = verifyFileSignature(normalizedType(c.mimeType), c.bytes);
      if (verdict.status === 'MISMATCH') return hold(c, 'SIGNATURE_MISMATCH');
    }
    if (accepted >= ATTACHMENT_POLICY.maxCount) return hold(c, 'TOO_MANY');
    const counted = size ?? ATTACHMENT_POLICY.maxBytesEach;
    if (totalBytes + counted > ATTACHMENT_POLICY.maxBytesTotal) return hold(c, 'TOTAL_TOO_LARGE');
    accepted += 1;
    totalBytes += counted;
    return null;
  });
}

/** Obergrenze der Antwort-Bytes beim Abruf eines Anhangs über die Gmail-Schnittstelle (Base64 vergrößert um ein Drittel, dazu der JSON-Rahmen). */
export const ATTACHMENT_FETCH_MAX_RESPONSE_BYTES = Math.ceil((ATTACHMENT_POLICY.maxBytesEach * 4) / 3) + 4096;
