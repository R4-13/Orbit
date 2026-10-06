import { describe, expect, it } from 'vitest';
import { REDACTED, redactString, redactValue, safeErrorSummary } from './redaction';

describe('redaction', () => {
  it('schwärzt sensible Schlüssel, egal wie tief', () => {
    const out = redactValue({ name: 'x', apiKey: 'sk-live-123456789', nested: { Authorization: 'Bearer abc.def.ghi', refreshToken: 'r', ok: 1 }, list: [{ password: 'p' }] }) as Record<string, any>;
    expect(out.name).toBe('x');
    expect(out.apiKey).toBe(REDACTED);
    expect(out.nested.Authorization).toBe(REDACTED);
    expect(out.nested.refreshToken).toBe(REDACTED);
    expect(out.nested.ok).toBe(1);
    expect(out.list[0].password).toBe(REDACTED);
  });

  it('schwärzt Secrets in Freitext, auch wenn das Feld harmlos heißt (OAS-04: Stacktrace mit Token)', () => {
    const text = 'Error: request failed Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJl at fn (https://user:hunter2@host/x) key sk-abcdefgh12345678 api_key=abcdef123456';
    const out = redactString(text);
    for (const leaked of ['eyJhbGciOiJIUzI1NiJ9', 'hunter2', 'sk-abcdefgh12345678', 'abcdef123456']) expect(out).not.toContain(leaked);
    expect(out).toContain(REDACTED);
  });

  it('schwärzt PEM-Blöcke und lässt gewöhnlichen Text unverändert', () => {
    expect(redactString('-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----')).toBe(REDACTED);
    expect(redactString('Rechnung 4711 wurde geprüft.')).toBe('Rechnung 4711 wurde geprüft.');
  });

  it('ist zyklensicher, kürzt Tiefe und verändert das Original nicht', () => {
    const a: Record<string, unknown> = { secret: 's', child: {} };
    (a.child as Record<string, unknown>).back = a;
    const out = redactValue(a) as Record<string, any>;
    expect(a.secret).toBe('s');
    expect(out.secret).toBe(REDACTED);
    expect(out.child.back).toBe('[CIRCULAR]');
  });

  it('safeErrorSummary gibt nie Secrets aus', () => {
    expect(safeErrorSummary(new Error('401 with Bearer abc123def456ghi')).message).not.toContain('abc123def456ghi');
  });
});
