import { extractPlainTextBody, listAttachmentRefs, parseGmailMessageHeaders, type GmailMessage } from './gmail-message-parser';

function base64Url(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

describe('parseGmailMessageHeaders', () => {
  it('extracts From/To/Subject and converts internalDate (epoch ms string) to a Date', () => {
    const message: GmailMessage = {
      id: 'msg_1',
      internalDate: '1700000000000',
      payload: {
        headers: [
          { name: 'From', value: 'sender@example.com' },
          { name: 'To', value: 'a@example.com, b@example.com' },
          { name: 'Subject', value: 'Hallo' },
        ],
      },
    };

    const result = parseGmailMessageHeaders(message);

    expect(result).toEqual({
      from: 'sender@example.com',
      to: ['a@example.com', 'b@example.com'],
      subject: 'Hallo',
      receivedAt: new Date(1700000000000),
    });
  });

  it('header lookup is case-insensitive and missing headers default to empty values', () => {
    const message: GmailMessage = { id: 'msg_1', payload: { headers: [{ name: 'from', value: 'x@example.com' }] } };
    const result = parseGmailMessageHeaders(message);
    expect(result.from).toBe('x@example.com');
    expect(result.subject).toBe('');
    expect(result.to).toEqual([]);
  });

  it('falls back to the current time when internalDate is absent, instead of throwing', () => {
    const before = Date.now();
    const result = parseGmailMessageHeaders({ id: 'msg_1', payload: {} });
    expect(result.receivedAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('extracts the bare address from "Display Name" <addr@example.com>-style From/To headers (found live against a real Gmail account, docs/ASSUMPTIONS.md Channel Event Runtime Increment D)', () => {
    const message: GmailMessage = {
      id: 'msg_1',
      payload: {
        headers: [
          { name: 'From', value: 'Reiner Pistorius <reinerpistorius@googlemail.com>' },
          { name: 'To', value: '"Musterwerk GmbH" <vertrieb@musterwerk.example>, plain@musterwerk.example' },
          { name: 'Subject', value: 'Angebot Badrenovierung' },
        ],
      },
    };

    const result = parseGmailMessageHeaders(message);

    expect(result.from).toBe('reinerpistorius@googlemail.com');
    expect(result.to).toEqual(['vertrieb@musterwerk.example', 'plain@musterwerk.example']);
  });
});

describe('extractPlainTextBody', () => {
  it('decodes a simple (non-multipart) text/plain payload', () => {
    const message: GmailMessage = {
      id: 'msg_1',
      payload: { mimeType: 'text/plain', body: { data: base64Url('Hallo Welt') } },
    };
    expect(extractPlainTextBody(message)).toBe('Hallo Welt');
  });

  it('finds the text/plain part nested inside multipart/alternative (alongside a sibling text/html part)', () => {
    const message: GmailMessage = {
      id: 'msg_1',
      payload: {
        mimeType: 'multipart/alternative',
        parts: [
          { mimeType: 'text/html', body: { data: base64Url('<p>Hallo</p>') } },
          { mimeType: 'text/plain', body: { data: base64Url('Hallo (Text)') } },
        ],
      },
    };
    expect(extractPlainTextBody(message)).toBe('Hallo (Text)');
  });

  it('returns an empty string for an HTML-only message instead of throwing', () => {
    const message: GmailMessage = { id: 'msg_1', payload: { mimeType: 'text/html', body: { data: base64Url('<p>x</p>') } } };
    expect(extractPlainTextBody(message)).toBe('');
  });
});

describe('listAttachmentRefs', () => {
  it('finds attachment parts nested inside multipart/mixed, ignoring inline body parts without a filename', () => {
    const message: GmailMessage = {
      id: 'msg_1',
      payload: {
        mimeType: 'multipart/mixed',
        parts: [
          { mimeType: 'text/plain', body: { data: base64Url('Text') } },
          { mimeType: 'application/pdf', filename: 'rechnung.pdf', body: { attachmentId: 'att_1', size: 1024 } },
        ],
      },
    };

    expect(listAttachmentRefs(message)).toEqual([{ filename: 'rechnung.pdf', mimeType: 'application/pdf', attachmentId: 'att_1' }]);
  });

  it('returns an empty array for a message with no attachments', () => {
    const message: GmailMessage = { id: 'msg_1', payload: { mimeType: 'text/plain', body: { data: base64Url('x') } } };
    expect(listAttachmentRefs(message)).toEqual([]);
  });
});
