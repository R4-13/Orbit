import { base32Decode, base32Encode, generateRecoveryCodes, generateTotpSecret, hashRecoveryCode, hotp, looksLikeRecoveryCode, otpauthUri, totp, verifyTotp } from './totp';

/** Testvektoren aus RFC 4226 (Anhang D) und RFC 6238 (Anhang B, SHA-1, hier auf 6 Stellen gekürzt). */
const RFC_SECRET = Buffer.from('12345678901234567890', 'ascii');

describe('HOTP / TOTP nach RFC', () => {
  it('RFC 4226 Anhang D: die ersten zehn Codes', () => {
    const expected = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
    expected.forEach((code, counter) => expect(hotp(RFC_SECRET, counter)).toBe(code));
  });

  it('RFC 6238 Anhang B (SHA-1): Codes zu festen Zeitpunkten', () => {
    // Die Vektoren des RFC haben 8 Stellen; die letzten 6 sind der 6-stellige Code.
    const vectors: Array<[number, string]> = [
      [59, '287082'],
      [1111111109, '081804'],
      [1111111111, '050471'],
      [1234567890, '005924'],
      [2000000000, '279037'],
      [20000000000, '353130'],
    ];
    for (const [seconds, code] of vectors) expect(totp(RFC_SECRET, new Date(seconds * 1000))).toBe(code);
  });
});

describe('Prüfung eines Codes', () => {
  const now = new Date(1234567890 * 1000); // Schritt 41152263

  it('akzeptiert den aktuellen Code und die Nachbarschritte (Uhrabweichung), nicht mehr', () => {
    const at = (offsetSeconds: number) => totp(RFC_SECRET, new Date(now.getTime() + offsetSeconds * 1000));
    expect(verifyTotp(RFC_SECRET, at(0), now)).toBe(41152263);
    expect(verifyTotp(RFC_SECRET, at(-30), now)).toBe(41152262);
    expect(verifyTotp(RFC_SECRET, at(30), now)).toBe(41152264);
    expect(verifyTotp(RFC_SECRET, at(-60), now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, at(60), now)).toBeNull();
  });

  it('derselbe Code gilt nie zweimal: nur ein neuerer Zeitschritt als der zuletzt akzeptierte', () => {
    const code = totp(RFC_SECRET, now);
    expect(verifyTotp(RFC_SECRET, code, now, 41152262)).toBe(41152263);
    expect(verifyTotp(RFC_SECRET, code, now, 41152263)).toBeNull();
    expect(verifyTotp(RFC_SECRET, code, now, 41152300)).toBeNull();
  });

  it('weist falsche Eingaben ab: falsche Länge, Buchstaben, leer; Leerzeichen werden toleriert', () => {
    const code = totp(RFC_SECRET, now);
    expect(verifyTotp(RFC_SECRET, '12345', now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, '1234567', now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, 'abcdef', now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, '', now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, `${code.slice(0, 3)} ${code.slice(3)}`, now)).toBe(41152263);
    expect(verifyTotp(RFC_SECRET, code === '000000' ? '000001' : '000000', now)).toBeNull();
  });
});

describe('Base32, Adresse, Wiederherstellungscodes', () => {
  it('Base32 nach RFC 4648 (Testvektoren) und Umkehrung', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(base32Encode(Buffer.from('fooba'))).toBe('MZXW6YTB');
    expect(base32Decode('MZXW6YTBOI').toString()).toBe('foobar');
    expect(base32Decode('mzxw 6ytb-oi').toString()).toBe('foobar'); // Groß-/Kleinschreibung, Leerzeichen, Bindestrich
    expect(() => base32Decode('MZXW1')).toThrow();
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(secret)).toHaveLength(20);
  });

  it('die Adresse für die Authenticator-App enthält Geheimnis, Aussteller und Konto, korrekt kodiert', () => {
    const uri = otpauthUri({ secret: 'ABCDEFGH', account: 'anna@firma.example', issuer: 'ZERIONUS Plattform' });
    expect(uri).toBe('otpauth://totp/ZERIONUS%20Plattform:anna%40firma.example?secret=ABCDEFGH&issuer=ZERIONUS%20Plattform&algorithm=SHA1&digits=6&period=30');
  });

  it('Wiederherstellungscodes: acht verschiedene im Format xxxxx-xxxxx; der Hash ignoriert Schreibweise und Leerraum', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(8);
    expect(new Set(codes).size).toBe(8);
    for (const code of codes) expect(looksLikeRecoveryCode(code)).toBe(true);
    expect(hashRecoveryCode(' ABCDE-fghjk ')).toBe(hashRecoveryCode('abcde-fghjk'));
    expect(looksLikeRecoveryCode('123456')).toBe(false);
  });
});
