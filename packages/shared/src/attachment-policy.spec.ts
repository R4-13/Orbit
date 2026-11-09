import { describe, expect, it } from 'vitest';
import { ATTACHMENT_FETCH_MAX_RESPONSE_BYTES, ATTACHMENT_POLICY, screenAttachments } from './attachment-policy';

const ascii = (text: string) => Uint8Array.from(Buffer.from(text, 'latin1'));
const MB = 1024 * 1024;

describe('Anhangsfreigabe (technisch erzwungen)', () => {
  it('freigegebene Arten innerhalb der Grenzen werden verarbeitet', () => {
    const verdicts = screenAttachments([
      { fileName: 'rechnung.pdf', mimeType: 'application/pdf', sizeBytes: 120_000 },
      { fileName: 'foto.JPG', mimeType: 'image/jpeg', sizeBytes: 2 * MB },
      { fileName: 'notiz.txt', mimeType: 'text/plain; charset=utf-8', sizeBytes: 300 },
    ]);
    expect(verdicts).toEqual([null, null, null]);
  });

  it('nicht freigegebene Art oder Endung wird zurückgehalten – auch wenn die Art harmlos angegeben ist (doppelte Endung)', () => {
    const [exe, zip, html, doubled, office] = screenAttachments([
      { fileName: 'setup.exe', mimeType: 'application/octet-stream', sizeBytes: 10 },
      { fileName: 'unterlagen.zip', mimeType: 'application/zip', sizeBytes: 10 },
      { fileName: 'angebot.html', mimeType: 'text/html', sizeBytes: 10 },
      { fileName: 'rechnung.pdf.exe', mimeType: 'application/pdf', sizeBytes: 10 },
      { fileName: 'tabelle.xls', mimeType: 'application/vnd.ms-excel', sizeBytes: 10 },
    ]);
    expect(exe).toMatchObject({ reason: 'BLOCKED_EXTENSION' });
    expect(zip).toMatchObject({ reason: 'BLOCKED_EXTENSION' });
    expect(html).toMatchObject({ reason: 'BLOCKED_EXTENSION' });
    expect(doubled).toMatchObject({ reason: 'BLOCKED_EXTENSION', mimeType: 'application/pdf' });
    expect(office).toMatchObject({ reason: 'TYPE_NOT_ALLOWED' });
  });

  it('Größe: einzeln, in der Summe und in der Anzahl – schon nach der Größenangabe, bevor irgendetwas abgerufen wird', () => {
    const big = screenAttachments([{ fileName: 'scan.pdf', mimeType: 'application/pdf', sizeBytes: 5 * MB + 1 }]);
    expect(big[0]).toMatchObject({ reason: 'TOO_LARGE', sizeBytes: 5 * MB + 1 });
    const four = Array.from({ length: 4 }, (_, i) => ({ fileName: `a${i}.pdf`, mimeType: 'application/pdf', sizeBytes: 4 * MB }));
    const total = screenAttachments(four);
    expect(total.map((v) => v?.reason ?? 'OK')).toEqual(['OK', 'OK', 'OK', 'TOTAL_TOO_LARGE']);
    const many = screenAttachments(Array.from({ length: ATTACHMENT_POLICY.maxCount + 2 }, (_, i) => ({ fileName: `b${i}.txt`, mimeType: 'text/plain', sizeBytes: 10 })));
    expect(many.map((v) => v?.reason ?? 'OK')).toEqual(['OK', 'OK', 'OK', 'OK', 'OK', 'TOO_MANY', 'TOO_MANY']);
  });

  it('unbekannte Größe zählt für die Gesamtgrenze mit der Einzelgrenze (kein Schlupfloch)', () => {
    const verdicts = screenAttachments([1, 2, 3, 4].map((i) => ({ fileName: `u${i}.pdf`, mimeType: 'application/pdf' })));
    expect(verdicts.map((v) => v?.reason ?? 'OK')).toEqual(['OK', 'OK', 'OK', 'TOTAL_TOO_LARGE']);
  });

  it('nach dem Abruf zählt der Inhalt: ein Programm in PDF-Verkleidung, eine falsche Art, eine leere Datei', () => {
    const [disguised, wrong, empty, fine] = screenAttachments([
      { fileName: 'rechnung.pdf', mimeType: 'application/pdf', bytes: Uint8Array.from([0x4d, 0x5a, 0x90, 0x00]) },
      { fileName: 'foto.png', mimeType: 'image/png', bytes: ascii('<html>kein Bild</html>') },
      { fileName: 'leer.txt', mimeType: 'text/plain', bytes: new Uint8Array(0) },
      { fileName: 'echt.pdf', mimeType: 'application/pdf', bytes: ascii('%PDF-1.7\n...') },
    ]);
    expect(disguised).toMatchObject({ reason: 'SIGNATURE_MISMATCH' });
    expect(wrong).toMatchObject({ reason: 'SIGNATURE_MISMATCH' });
    expect(empty).toMatchObject({ reason: 'EMPTY' });
    expect(fine).toBeNull();
  });

  it('die Abrufgrenze für die Antwort umfasst Base64-Aufschlag und Rahmen, aber bleibt begrenzt', () => {
    expect(ATTACHMENT_FETCH_MAX_RESPONSE_BYTES).toBeGreaterThan(ATTACHMENT_POLICY.maxBytesEach * 1.33);
    expect(ATTACHMENT_FETCH_MAX_RESPONSE_BYTES).toBeLessThan(ATTACHMENT_POLICY.maxBytesEach * 1.4);
  });
});
