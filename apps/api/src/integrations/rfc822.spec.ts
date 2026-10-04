import { assertAddress, buildRfc822Message, encodeHeaderText, toBase64Url } from './rfc822';

describe('buildRfc822Message', () => {
  const base = { from: 'firma@example.com', to: 'kunde@kunde.example', subject: 'Rückfrage zu Ihrer Anfrage', bodyText: 'Guten Tag,\nbitte nennen Sie die Menge.\nÄÖÜ ß €' };

  it('encodes non-ASCII subject and UTF-8 body and sets MIME headers', () => {
    const raw = buildRfc822Message(base);
    expect(raw).toContain('To: kunde@kunde.example');
    expect(raw).toMatch(/Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=/);
    expect(raw).toContain('Content-Type: text/plain; charset="UTF-8"');
    const bodyBase64 = raw.split('\r\n\r\n')[1]!.replace(/\r\n/g, '');
    expect(Buffer.from(bodyBase64, 'base64').toString('utf8')).toBe(base.bodyText);
  });

  it('sets threading headers only for a reply', () => {
    expect(buildRfc822Message(base)).not.toContain('In-Reply-To');
    const reply = buildRfc822Message({ ...base, inReplyTo: '<abc@mail.example>', references: ['<root@mail.example>', '<abc@mail.example>'] });
    expect(reply).toContain('In-Reply-To: <abc@mail.example>');
    expect(reply).toContain('References: <root@mail.example> <abc@mail.example>');
  });

  it('builds multipart/mixed with a base64 attachment', () => {
    const raw = buildRfc822Message({ ...base, attachments: [{ fileName: 'Angebot ANG-1.pdf', mimeType: 'application/pdf', content: Buffer.from('%PDF-1.4 test') }] });
    expect(raw).toMatch(/Content-Type: multipart\/mixed; boundary="orbit_[0-9a-f]+"/);
    expect(raw).toContain('Content-Disposition: attachment; filename="Angebot ANG-1.pdf"');
    expect(raw).toContain(Buffer.from('%PDF-1.4 test').toString('base64'));
    expect(raw.trimEnd().endsWith('--')).toBe(true);
  });

  it('refuses header injection through recipient, subject or reply headers', () => {
    expect(() => buildRfc822Message({ ...base, to: 'a@b.example\r\nBcc: x@evil.example' })).toThrow();
    expect(() => buildRfc822Message({ ...base, subject: 'Hallo\r\nBcc: x@evil.example' })).toThrow('Zeilenumbruch');
    expect(() => buildRfc822Message({ ...base, inReplyTo: '<a>\r\nBcc: x@evil.example' })).toThrow();
    expect(() => assertAddress('kein-at-zeichen')).toThrow('Ungültige');
    expect(() => assertAddress('a@b.example, c@d.example')).toThrow();
  });

  it('encodes header text and base64url', () => {
    expect(encodeHeaderText('plain')).toBe('plain');
    expect(encodeHeaderText('Größe')).toMatch(/^=\?UTF-8\?B\?/);
    expect(toBase64Url('a?b>c')).not.toMatch(/[+/=]/);
  });
});
