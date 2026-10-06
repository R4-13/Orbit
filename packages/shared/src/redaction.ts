/**
 * Zentrale Schwärzung für Audit-Snapshots und technische Diagnose (Amendment 03 §17.2, §19.2, OAS-02, OAS-04).
 * Schwärzt nach Schlüsselnamen UND nach Wertmustern (Bearer-/API-Schlüssel, JWTs, PEM-Blöcke, Basic-Auth in URLs), damit auch ein Secret
 * in einem harmlos benannten Feld (z. B. in einem Stacktrace-Text) nicht durchrutscht.
 */

export const REDACTED = '[REDACTED]';

const SENSITIVE_KEY = /(secret|password|passwd|token|api[-_]?key|apikey|authorization|credential|private[-_]?key|cookie|session[-_]?id|refresh)/i;

const VALUE_PATTERNS: Array<[RegExp, string]> = [
  [/\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi, `Bearer ${REDACTED}`],
  [/\bBasic\s+[A-Za-z0-9+/]{8,}={0,2}/g, `Basic ${REDACTED}`],
  [/\bsk-[A-Za-z0-9_-]{8,}/g, REDACTED],
  [/\bsk-ant-[A-Za-z0-9_-]{8,}/g, REDACTED],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, REDACTED],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, REDACTED],
  [/(\b[a-z][a-z0-9+.-]*:\/\/)([^\s/:@]+):([^\s/@]+)@/gi, `$1${REDACTED}:${REDACTED}@`],
  [/\b(api[_-]?key|token|secret|password)\s*[=:]\s*["']?[^\s"',;]{6,}/gi, `$1=${REDACTED}`],
];

export function redactString(value: string): string {
  let result = value;
  for (const [pattern, replacement] of VALUE_PATTERNS) result = result.replace(pattern, replacement);
  return result;
}

const MAX_DEPTH = 8;
const MAX_STRING = 4_000;

/** Tiefe, zyklensichere Kopie mit geschwärzten Schlüsseln/Werten; Texte werden gekürzt. Verändert das Original nie. */
export function redactValue(value: unknown, depth = 0, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    const redacted = redactString(value);
    return redacted.length > MAX_STRING ? `${redacted.slice(0, MAX_STRING)}…` : redacted;
  }
  if (typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return REDACTED;
  if (depth >= MAX_DEPTH) return '[TRUNCATED]';
  if (seen.has(value as object)) return '[CIRCULAR]';
  seen.add(value as object);
  if (Array.isArray(value)) return value.slice(0, 200).map((entry) => redactValue(entry, depth + 1, seen));
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEY.test(key) && entry !== null && entry !== undefined && entry !== '' ? REDACTED : redactValue(entry, depth + 1, seen);
  }
  return out;
}

/** Sichere Fehlerbeschreibung: Nachricht geschwärzt, Stacktrace nur als Typ + erste Zeilen ohne Secrets. */
export function safeErrorSummary(error: unknown): { name: string; message: string } {
  if (error instanceof Error) return { name: error.name, message: redactString(error.message).slice(0, 500) };
  return { name: 'Error', message: redactString(String(error)).slice(0, 500) };
}
