import { strToU8, zipSync } from 'fflate';
import { budgetExcerpts, extractAttachmentText, formatAttachmentBlock, MAX_ATTACHMENTS_READ, MAX_EXCERPT_CHARS, MAX_TOTAL_EXCERPT_CHARS, type AttachmentExcerpt } from './attachment-text';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Ein minimales, gültiges PDF mit einer Seite und einer Textzeile (mit korrekter Verweistabelle). */
function pdfWith(text: string | null): Buffer {
  const stream = text === null ? '' : `BT /F1 12 Tf 72 700 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

function docxWith(paragraphs: string[]): Buffer {
  const xml = `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>${paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`;
  return Buffer.from(zipSync({ 'word/document.xml': strToU8(xml), '[Content_Types].xml': strToU8('<Types/>') }));
}

describe('Textauszug aus Anhängen', () => {
  it('liest reinen Text und CSV und schneidet bei der Grenze ab', async () => {
    const small = await extractAttachmentText({ fileName: 'notiz.txt', mimeType: 'text/plain', bytes: Buffer.from('Bitte um Rückruf unter 0221 5550142.') });
    expect(small).toEqual({ status: 'TEXT', text: 'Bitte um Rückruf unter 0221 5550142.' });
    const big = await extractAttachmentText({ fileName: 'liste.csv', mimeType: 'text/csv', bytes: Buffer.from('a;b\n'.repeat(5000)) });
    expect(big.status).toBe('TEXT');
    expect(big.truncated).toBe(true);
    expect(big.text?.length).toBe(MAX_EXCERPT_CHARS);
  });

  it('entfernt Markup aus HTML und verwirft Skripte', async () => {
    const html = '<html><head><style>p{}</style><script>alert(1)</script></head><body><p>Rechnung&nbsp;Nr. 12</p><p>Summe 99 &amp; mehr</p></body></html>';
    const result = await extractAttachmentText({ fileName: 'mail.html', mimeType: 'text/html', bytes: Buffer.from(html) });
    expect(result.text).toBe('Rechnung Nr. 12\nSumme 99 & mehr');
    expect(result.text).not.toContain('alert');
  });

  it('liest ein PDF mit Textebene', async () => {
    const result = await extractAttachmentText({ fileName: 'rechnung.pdf', mimeType: 'application/pdf', bytes: pdfWith('Rechnung 2026-1001 Betrag 119,00 EUR zahlbar bis 30.10.2026') });
    expect(result.status).toBe('TEXT');
    expect(result.text).toContain('Rechnung 2026-1001');
    expect(result.text).toContain('119,00 EUR');
  });

  it('meldet ein PDF ohne Textebene ehrlich als „kein Text“ (keine Texterkennung)', async () => {
    const result = await extractAttachmentText({ fileName: 'scan.pdf', mimeType: 'application/pdf', bytes: pdfWith(null) });
    expect(result.status).toBe('NO_TEXT');
    expect(result.note).toMatch(/Texterkennung/);
  });

  it('liest ein Word-Dokument absatzweise', async () => {
    const result = await extractAttachmentText({ fileName: 'brief.docx', mimeType: DOCX, bytes: docxWith(['Sehr geehrte Damen und Herren,', 'wir bewerben uns.']) });
    expect(result.status).toBe('TEXT');
    expect(result.text).toBe('Sehr geehrte Damen und Herren,\nwir bewerben uns.');
  });

  it('Bilder, unbekannte Arten, zu große, leere und beschädigte Dateien liefern einen Grund statt eines Fehlers', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    expect((await extractAttachmentText({ fileName: 'foto.png', mimeType: 'image/png', bytes: png })).status).toBe('NO_TEXT');
    expect((await extractAttachmentText({ fileName: 'x.bin', mimeType: 'application/octet-stream', bytes: Buffer.from('abc') })).status).toBe('UNSUPPORTED');
    expect((await extractAttachmentText({ fileName: 'leer.txt', mimeType: 'text/plain', bytes: Buffer.alloc(0) })).status).toBe('NO_TEXT');
    expect((await extractAttachmentText({ fileName: 'riesig.txt', mimeType: 'text/plain', bytes: Buffer.alloc(6 * 1024 * 1024, 97) })).status).toBe('TOO_LARGE');
    expect((await extractAttachmentText({ fileName: 'kaputt.pdf', mimeType: 'application/pdf', bytes: Buffer.from('%PDF-1.4 kaputt') })).status).toBe('ERROR');
  });

  it('liest keine Datei, deren Inhalt nicht zur angegebenen Art passt', async () => {
    const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(100)]);
    const result = await extractAttachmentText({ fileName: 'rechnung.pdf', mimeType: 'application/pdf', bytes: exe });
    expect(result.status).toBe('REJECTED');
  });
});

describe('Begrenzung und Darstellung', () => {
  const item = (name: string, chars: number): AttachmentExcerpt => ({ fileName: name, mimeType: 'text/plain', result: { status: 'TEXT', text: 'x'.repeat(chars) } });

  it('die Gesamtgrenze gilt über alle Anhänge, spätere bekommen nur den Rest oder nichts', () => {
    const out = budgetExcerpts([item('a', 4000), item('b', 4000), item('c', 4000)]);
    expect(out[0]?.result.text?.length).toBe(4000);
    expect(out[1]?.result.text?.length).toBe(MAX_TOTAL_EXCERPT_CHARS - 4000);
    expect(out[2]?.result.status).toBe('UNSUPPORTED');
  });

  it('mehr als fünf Anhänge werden nicht gelesen', () => {
    const out = budgetExcerpts(Array.from({ length: MAX_ATTACHMENTS_READ + 2 }, (_, i) => item(`f${i}`, 10)));
    expect(out.filter((o) => o.result.status === 'TEXT')).toHaveLength(MAX_ATTACHMENTS_READ);
    expect(out.at(-1)?.result.note).toMatch(/nur die ersten/);
  });

  it('der Textblock nennt Name und Art, und sagt bei fehlendem Text warum', () => {
    const block = formatAttachmentBlock([
      { fileName: 'a.pdf', mimeType: 'application/pdf', result: { status: 'TEXT', text: 'Rechnung 1', truncated: true } },
      { fileName: 'b.png', mimeType: 'image/png', result: { status: 'NO_TEXT', note: 'Bild; eine Texterkennung ist nicht eingerichtet' } },
    ]);
    expect(block).toContain('--- Anhang 1: a.pdf (application/pdf) ---\nRechnung 1\n[… gekürzt]');
    expect(block).toContain('--- Anhang 2: b.png (image/png) ---\n[kein Text gelesen: Bild; eine Texterkennung ist nicht eingerichtet]');
    expect(formatAttachmentBlock([])).toBe('');
  });
});
