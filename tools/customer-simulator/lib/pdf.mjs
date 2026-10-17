// Ein kleines, gültiges PDF mit einer Seite Text (Standardschrift Helvetica) – für Anhänge wie eine Lieferantenrechnung. Der Text ist lesbar (Textebene), damit ORBIT ihn lesen kann.

const escapePdf = (text) => text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

/** Nicht-Latin-1-Zeichen kann die Standardschrift nicht darstellen; Umlaute und ß werden in WinAnsi umgesetzt. */
function winAnsi(text) {
  return Buffer.from(text, 'latin1').toString('latin1');
}

/**
 * @param {string[]} lines Textzeilen von oben nach unten
 * @returns {Buffer}
 */
export function buildPdf(lines) {
  const content = ['BT', '/F1 12 Tf', '14 TL', '56 780 Td', ...lines.map((line) => `(${escapePdf(winAnsi(line))}) Tj T*`), 'ET'].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
