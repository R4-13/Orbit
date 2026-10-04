/**
 * A deliberately small PDF writer for the quote document: one or more A4 pages of Helvetica text, no images, no
 * external dependency. Text is encoded as WinAnsi (cp1252) so German umlauts and the euro sign render correctly; any
 * other character is replaced by "?". The output is a valid PDF 1.4 file (header, objects, xref table, trailer).
 */
const CP1252_EXTRA: Record<number, number> = { 0x20ac: 0x80, 0x201a: 0x82, 0x201e: 0x84, 0x2026: 0x85, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2013: 0x96, 0x2014: 0x97 };

function encodeWinAnsi(text: string): Buffer {
  const bytes: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0) as number;
    if (code < 0x80 || (code >= 0xa0 && code <= 0xff)) bytes.push(code);
    else bytes.push(CP1252_EXTRA[code] ?? 0x3f);
  }
  return Buffer.from(bytes);
}

function escapePdfText(buffer: Buffer): Buffer {
  const out: number[] = [];
  for (const byte of buffer) {
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) out.push(0x5c);
    out.push(byte);
  }
  return Buffer.from(out);
}

export interface PdfLine {
  text: string;
  size?: number;
  bold?: boolean;
  /** Left offset in points; used to build simple columns. */
  x?: number;
  /** Extra vertical space before the line, in points. */
  spaceBefore?: number;
}

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN_LEFT = 56;
const MARGIN_TOP = 64;
const MARGIN_BOTTOM = 56;

export function renderSimplePdf(lines: PdfLine[], title: string): Buffer {
  // Lay out lines onto pages.
  const pages: PdfLine[][] = [[]];
  let y = PAGE_HEIGHT - MARGIN_TOP;
  const positioned: Array<{ page: number; y: number; line: PdfLine }> = [];
  for (const line of lines) {
    const size = line.size ?? 11;
    const advance = size * 1.35 + (line.spaceBefore ?? 0);
    if (y - advance < MARGIN_BOTTOM) {
      pages.push([]);
      y = PAGE_HEIGHT - MARGIN_TOP;
    }
    y -= advance;
    positioned.push({ page: pages.length - 1, y, line });
  }

  const objects: Buffer[] = [];
  const add = (body: string | Buffer): number => {
    objects.push(Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1'));
    return objects.length;
  };
  const catalogId = add('');
  const pagesId = add('');
  const fontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const boldId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

  const pageIds: number[] = [];
  pages.forEach((_, pageIndex) => {
    const ops: Buffer[] = [];
    for (const item of positioned.filter((p) => p.page === pageIndex)) {
      const size = item.line.size ?? 11;
      const font = item.line.bold ? '/F2' : '/F1';
      ops.push(Buffer.from(`BT ${font} ${size} Tf ${MARGIN_LEFT + (item.line.x ?? 0)} ${item.y.toFixed(2)} Td (`, 'latin1'), escapePdfText(encodeWinAnsi(item.line.text)), Buffer.from(') Tj ET\n', 'latin1'));
    }
    const stream = Buffer.concat(ops);
    const contentId = add(Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`, 'latin1'), stream, Buffer.from('\nendstream', 'latin1')]));
    pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 ${fontId} 0 R /F2 ${boldId} 0 R >> >> /Contents ${contentId} 0 R >>`));
  });
  objects[catalogId - 1] = Buffer.from(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`, 'latin1');
  objects[pagesId - 1] = Buffer.from(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`, 'latin1');
  const infoId = add(Buffer.concat([Buffer.from('<< /Title (', 'latin1'), escapePdfText(encodeWinAnsi(title)), Buffer.from(') /Producer (ORBIT) >>', 'latin1')]));

  const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n', 'latin1')];
  const offsets: number[] = [];
  let position = chunks[0]!.length;
  objects.forEach((body, index) => {
    offsets.push(position);
    const chunk = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`, 'latin1'), body, Buffer.from('\nendobj\n', 'latin1')]);
    chunks.push(chunk);
    position += chunk.length;
  });
  const xrefStart = position;
  const xref = ['xref', `0 ${objects.length + 1}`, '0000000000 65535 f '];
  for (const offset of offsets) xref.push(`${String(offset).padStart(10, '0')} 00000 n `);
  chunks.push(Buffer.from(`${xref.join('\n')}\ntrailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`, 'latin1'));
  return Buffer.concat(chunks);
}
