import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from './sha256';

describe('sha256 (browserfähig)', () => {
  it('liefert die bekannten Testvektoren', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('stimmt für beliebige Längen, Umlaute und Emojis mit node:crypto überein', () => {
    for (const input of ['a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'a'.repeat(1000), 'Mandant Müller – Äpfel € 😀', JSON.stringify({ t: 'x', s: ['a', 'b'] })]) {
      expect(sha256Hex(input)).toBe(createHash('sha256').update(input).digest('hex'));
    }
  });
});
