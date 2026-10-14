/**
 * Prüfung hochgeladener Dateien an ihren **Bytes** (MST-09): die deklarierte Art (MIME-Type) eines Uploads ist eine Behauptung des Absenders. Hier wird sie an den
 * Anfangsbytes (Magic Bytes) gemessen. Ausführbare Programme und Skripte werden unabhängig von der Deklaration abgelehnt.
 * Kein Virenscan: er braucht eine eigene Komponente (ClamAV o. Ä.) und steht in docs/OPEN_DEVELOPMENT_ITEMS.md.
 */
export type SignatureVerdict =
  /** Die Bytes passen zur deklarierten Art. */
  | { status: 'MATCH' }
  /** Die Bytes passen nicht zur deklarierten Art oder sind gefährlich – die Datei ist abzulehnen. */
  | { status: 'MISMATCH'; reason: string }
  /** Für diese deklarierte Art gibt es keine Prüfung (nicht in der Liste bekannter Signaturen). */
  | { status: 'UNKNOWN_TYPE' };

const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0): boolean => signature.every((byte, index) => bytes[offset + index] === byte);

/** Programme und Skripte, die nie als Dokument hochgeladen werden sollen – gleich welcher Art sie sich ausgeben. */
function dangerousKind(bytes: Uint8Array): string | undefined {
  if (startsWith(bytes, [0x4d, 0x5a])) return 'Windows-Programm (MZ)';
  if (startsWith(bytes, [0x7f, 0x45, 0x4c, 0x46])) return 'Linux-Programm (ELF)';
  if (startsWith(bytes, [0xcf, 0xfa, 0xed, 0xfe]) || startsWith(bytes, [0xca, 0xfe, 0xba, 0xbe])) return 'Programm (Mach-O/Java)';
  if (startsWith(bytes, [0x23, 0x21])) return 'Skript (#!)';
  return undefined;
}

function looksLikeText(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, 4096);
  if (sample.length === 0) return true;
  let control = 0;
  for (const byte of sample) {
    if (byte === 0) return false;
    if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) control += 1;
  }
  return control / sample.length < 0.02;
}

const CHECKS: Record<string, (bytes: Uint8Array) => boolean> = {
  'application/pdf': (b) => startsWith(b, [0x25, 0x50, 0x44, 0x46, 0x2d]),
  'image/png': (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  'image/jpeg': (b) => startsWith(b, [0xff, 0xd8, 0xff]),
  'image/tiff': (b) => startsWith(b, [0x49, 0x49, 0x2a, 0x00]) || startsWith(b, [0x4d, 0x4d, 0x00, 0x2a]),
  'application/msword': (b) => startsWith(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': (b) => startsWith(b, [0x50, 0x4b, 0x03, 0x04]),
  'text/plain': looksLikeText,
};

export function verifyFileSignature(declaredMimeType: string, bytes: Uint8Array): SignatureVerdict {
  const dangerous = dangerousKind(bytes);
  if (dangerous) return { status: 'MISMATCH', reason: `Die Datei ist ein ${dangerous} und kein Dokument.` };
  const check = CHECKS[declaredMimeType.toLowerCase()];
  if (!check) return { status: 'UNKNOWN_TYPE' };
  return check(bytes) ? { status: 'MATCH' } : { status: 'MISMATCH', reason: `Der Inhalt passt nicht zur angegebenen Art (${declaredMimeType}).` };
}

/** Wie viele Anfangsbytes für die Prüfung reichen. */
export const FILE_SIGNATURE_PROBE_BYTES = 4096;
