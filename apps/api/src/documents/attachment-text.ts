import { unzipSync, strFromU8 } from 'fflate';
import { extractText, getDocumentProxy } from 'unpdf';
import { verifyFileSignature } from '@orbit/shared';

/**
 * Textauszug aus Anhängen für Triage und Extraktion (BPF-02). Reine Funktion ohne Datenbank und Speicher: Bytes rein, begrenzter Text raus.
 *
 * Gelesen wird nur, was einen Text trägt: reiner Text/CSV/HTML, Word (.docx) und PDF **mit Textebene**. Gescannte PDFs und Bilder haben keinen Text; eine Texterkennung (OCR) gibt es
 * hier bewusst nicht – sie wird ehrlich als „kein lesbarer Text“ gemeldet (MST-03). Der Auszug ist Text aus einer fremden Quelle und wird vom Aufrufer wie die Nachricht selbst als
 * nicht vertrauenswürdig behandelt.
 */

export type AttachmentTextStatus = 'TEXT' | 'NO_TEXT' | 'UNSUPPORTED' | 'TOO_LARGE' | 'REJECTED' | 'ERROR';

export interface AttachmentText {
  status: AttachmentTextStatus;
  /** Begrenzter Auszug (nur bei `TEXT`). */
  text?: string;
  /** Der Text war länger als die Grenze. */
  truncated?: boolean;
  /** Knappe Erklärung für Menschen und KI, wenn kein Text gelesen wurde. */
  note?: string;
}

/** Größer als das wird nicht gelesen (Speicher und Laufzeit). */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
/** Zeichen je Anhang im Auszug. */
export const MAX_EXCERPT_CHARS = 4000;
/** Zeichen über alle Anhänge einer Nachricht. */
export const MAX_TOTAL_EXCERPT_CHARS = 8000;
/** Mehr Anhänge als das werden nicht gelesen. */
export const MAX_ATTACHMENTS_READ = 5;
/** Unter dieser Zeichenzahl gilt ein PDF als „ohne Textebene“ (Scan mit Kopfzeile o. Ä.). */
const MIN_PDF_TEXT_CHARS = 20;
const MAX_PDF_PAGES = 15;
const MAX_DOCX_XML_BYTES = 4 * 1024 * 1024;

const TEXT_TYPES = new Set(['text/plain', 'text/csv', 'text/markdown', 'text/html', 'application/json', 'application/xml', 'text/xml']);
const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function cleaned(text: string): string {
  // Steuerzeichen (außer Zeilenumbruch und Tabulator) raus, Leerraum glätten.
  const printable = Array.from(text, (ch) => {
    const code = ch.charCodeAt(0);
    return (code < 32 && code !== 9 && code !== 10) || code === 127 ? ' ' : ch;
  }).join('');
  return printable
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function limited(text: string, max = MAX_EXCERPT_CHARS): AttachmentText {
  const value = cleaned(text);
  if (value.length === 0) return { status: 'NO_TEXT', note: 'enthält keinen lesbaren Text' };
  return value.length > max ? { status: 'TEXT', text: value.slice(0, max), truncated: true } : { status: 'TEXT', text: value };
}

function stripMarkup(markup: string): string {
  return markup
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|br|tr|li|h[1-6])>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

async function pdfText(bytes: Buffer): Promise<AttachmentText> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: true });
  const merged = Array.isArray(text) ? text.join('\n') : text;
  if (cleaned(merged).length < MIN_PDF_TEXT_CHARS) {
    return { status: 'NO_TEXT', note: 'PDF ohne Textebene (vermutlich ein Scan); eine Texterkennung ist nicht eingerichtet' };
  }
  const result = limited(merged);
  if (pdf.numPages > MAX_PDF_PAGES) result.truncated = true;
  return result;
}

function docxText(bytes: Buffer): AttachmentText {
  const files = unzipSync(new Uint8Array(bytes), { filter: (file) => file.name === 'word/document.xml' && file.originalSize <= MAX_DOCX_XML_BYTES });
  const xml = files['word/document.xml'];
  if (!xml) return { status: 'NO_TEXT', note: 'Word-Datei ohne lesbaren Text' };
  const text = strFromU8(xml)
    .replace(/<w:tab\s*\/>/g, '\t')
    .replace(/<\/w:p>|<w:br\s*\/>/g, '\n')
    .replace(/<[^>]+>/g, '');
  return limited(stripMarkup(text));
}

export async function extractAttachmentText(input: { fileName: string; mimeType: string; bytes: Buffer }): Promise<AttachmentText> {
  const { mimeType, bytes } = input;
  const type = mimeType.toLowerCase().split(';')[0]?.trim() ?? '';
  if (bytes.byteLength === 0) return { status: 'NO_TEXT', note: 'leere Datei' };
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) return { status: 'TOO_LARGE', note: `größer als ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB, nicht gelesen` };
  // Eine Datei, deren Inhalt nicht zur angegebenen Art passt, wird nicht gelesen (wie beim Hochladen, MST-09).
  const signature = verifyFileSignature(type, bytes);
  if (signature.status === 'MISMATCH') return { status: 'REJECTED', note: 'Inhalt passt nicht zur angegebenen Dateiart, nicht gelesen' };
  try {
    if (type === 'application/pdf') return await pdfText(bytes);
    if (type === DOCX_TYPE) return docxText(bytes);
    if (type === 'text/html') return limited(stripMarkup(bytes.toString('utf8')));
    if (TEXT_TYPES.has(type)) return limited(bytes.toString('utf8'));
    if (type.startsWith('image/')) return { status: 'NO_TEXT', note: 'Bild; eine Texterkennung ist nicht eingerichtet' };
    return { status: 'UNSUPPORTED', note: 'Dateiart wird nicht gelesen' };
  } catch {
    return { status: 'ERROR', note: 'Datei konnte nicht gelesen werden (beschädigt oder passwortgeschützt)' };
  }
}

export interface AttachmentExcerpt {
  fileName: string;
  mimeType: string;
  result: AttachmentText;
}

/** Wendet die Gesamtgrenze an: spätere Anhänge bekommen nur den Rest, über die Anzahlgrenze hinaus wird nicht gelesen. */
export function budgetExcerpts(items: AttachmentExcerpt[]): AttachmentExcerpt[] {
  let left = MAX_TOTAL_EXCERPT_CHARS;
  return items.map((item, index) => {
    if (index >= MAX_ATTACHMENTS_READ) return { ...item, result: { status: 'UNSUPPORTED', note: `nur die ersten ${MAX_ATTACHMENTS_READ} Anhänge werden gelesen` } };
    if (item.result.status !== 'TEXT' || !item.result.text) return item;
    if (left <= 0) return { ...item, result: { status: 'UNSUPPORTED', note: 'Gesamtgrenze für Anhangstexte erreicht, nicht gelesen' } };
    if (item.result.text.length <= left) {
      left -= item.result.text.length;
      return item;
    }
    const text = item.result.text.slice(0, left);
    left = 0;
    return { ...item, result: { status: 'TEXT', text, truncated: true } };
  });
}

/** Der Block, der hinter den Nachrichtentext in den (untrusted) Inhalt der KI-Anfrage kommt. Leer, wenn es keine Anhänge gibt. */
export function formatAttachmentBlock(items: AttachmentExcerpt[]): string {
  if (items.length === 0) return '';
  return items
    .map((item, index) => {
      const head = `--- Anhang ${index + 1}: ${item.fileName} (${item.mimeType}) ---`;
      if (item.result.status === 'TEXT') return `${head}\n${item.result.text}${item.result.truncated ? '\n[… gekürzt]' : ''}`;
      return `${head}\n[kein Text gelesen: ${item.result.note ?? item.result.status}]`;
    })
    .join('\n\n');
}
