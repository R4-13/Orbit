import { describe, expect, it } from 'vitest';
import { verifyFileSignature } from './file-signature';

const bytes = (...values: number[]) => Uint8Array.from(values);
const ascii = (text: string) => Uint8Array.from(Buffer.from(text, 'latin1'));

describe('verifyFileSignature (MST-09)', () => {
  it('erkennt passende Dateien an den Anfangsbytes', () => {
    expect(verifyFileSignature('application/pdf', ascii('%PDF-1.7\n...')).status).toBe('MATCH');
    expect(verifyFileSignature('image/png', bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0)).status).toBe('MATCH');
    expect(verifyFileSignature('image/jpeg', bytes(0xff, 0xd8, 0xff, 0xe0)).status).toBe('MATCH');
    expect(verifyFileSignature('image/tiff', bytes(0x49, 0x49, 0x2a, 0x00)).status).toBe('MATCH');
    expect(verifyFileSignature('application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes(0x50, 0x4b, 0x03, 0x04)).status).toBe('MATCH');
    expect(verifyFileSignature('text/plain', ascii('Rechnung 4711\nBetrag 120 EUR')).status).toBe('MATCH');
  });

  it('lehnt Dateien ab, deren Inhalt nicht zur angegebenen Art passt', () => {
    expect(verifyFileSignature('application/pdf', ascii('<html>nicht pdf</html>'))).toMatchObject({ status: 'MISMATCH' });
    expect(verifyFileSignature('image/png', bytes(0xff, 0xd8, 0xff))).toMatchObject({ status: 'MISMATCH' });
    expect(verifyFileSignature('text/plain', bytes(0x50, 0x00, 0x01, 0x02, 0x03))).toMatchObject({ status: 'MISMATCH' });
  });

  it('lehnt Programme und Skripte ab, gleich was sie vorgeben', () => {
    expect(verifyFileSignature('application/pdf', bytes(0x4d, 0x5a, 0x90, 0x00))).toMatchObject({ status: 'MISMATCH', reason: expect.stringContaining('Windows') });
    expect(verifyFileSignature('text/plain', ascii('#!/bin/sh\nrm -rf /'))).toMatchObject({ status: 'MISMATCH', reason: expect.stringContaining('Skript') });
    expect(verifyFileSignature('unknown/type', bytes(0x7f, 0x45, 0x4c, 0x46))).toMatchObject({ status: 'MISMATCH' });
  });

  it('eine unbekannte Art wird nicht geprüft (kein falscher Befund)', () => {
    expect(verifyFileSignature('application/x-custom', ascii('irgendwas'))).toEqual({ status: 'UNKNOWN_TYPE' });
  });
});
