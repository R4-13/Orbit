import { renderSimplePdf } from './simple-pdf';

describe('renderSimplePdf', () => {
  it('produces a structurally valid PDF with correct xref offsets and encoded umlauts', () => {
    const pdf = renderSimplePdf([{ text: 'Angebot Grüße (Größe) € \\ test', size: 16, bold: true }, { text: 'Zeile 2' }], 'Angebot');
    const text = pdf.toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);

    // Every xref offset points at "<n> 0 obj".
    const xrefStart = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(xrefStart, xrefStart + 4)).toBe('xref');
    const entries = text.slice(xrefStart).split('\n').filter((l) => /^\d{10} 00000 n/.test(l));
    entries.forEach((entry, index) => {
      const offset = Number(entry.slice(0, 10));
      expect(text.slice(offset, offset + `${index + 1} 0 obj`.length)).toBe(`${index + 1} 0 obj`);
    });

    // ü = 0xFC and the euro sign = 0x80 in WinAnsi; parentheses and backslash are escaped.
    expect(pdf.includes(Buffer.from([0x47, 0x72, 0xfc, 0xdf, 0x65]))).toBe(true);
    expect(pdf.includes(Buffer.from([0x80]))).toBe(true);
    expect(text).toContain('\\(Gr');
  });

  it('breaks long content onto additional pages', () => {
    const lines = Array.from({ length: 120 }, (_, i) => ({ text: `Zeile ${i}` }));
    const text = renderSimplePdf(lines, 'Lang').toString('latin1');
    expect(/\/Count (\d+)/.exec(text)![1]).not.toBe('1');
  });
});
