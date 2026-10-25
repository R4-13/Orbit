import { describe, expect, it } from 'vitest';
import { CRM_NOTES_MAX_CHARS, crmFieldText, leadContentHash, normalizeCrmText } from './lead-sync';

describe('Lead-Abgleich: Fingerabdruck', () => {
  it('gleicher Inhalt gleicher Hash; Zeilenenden und Ränder zählen nicht, ein geänderter Wert schon', () => {
    const a = leadContentHash('Anfrage – Tom', 'Zeile 1\nZeile 2');
    expect(leadContentHash(' Anfrage – Tom ', 'Zeile 1\r\nZeile 2\n')).toBe(a);
    expect(leadContentHash('Anfrage – Tom', 'Zeile 1\nZeile 3')).not.toBe(a);
  });
  it('längere Texte werden wie im CRM gekürzt verglichen', () => {
    const long = 'x'.repeat(CRM_NOTES_MAX_CHARS + 500);
    expect(crmFieldText(long)).toHaveLength(CRM_NOTES_MAX_CHARS);
    expect(leadContentHash('t', long)).toBe(leadContentHash('t', long.slice(0, CRM_NOTES_MAX_CHARS)));
  });
  it('normalisiert Zeilenenden', () => {
    expect(normalizeCrmText(' a\r\nb\rc ')).toBe('a\nb\nc');
  });
});
