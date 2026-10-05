import { describe, expect, it } from 'vitest';
import { contrastRatio, normalizeTheme, parseHex, readableForeground, toHex } from './theme-contrast';

const rgb = (hex: string) => parseHex(hex)!;

describe('contrastRatio', () => {
  it('matches the WCAG reference values', () => {
    expect(contrastRatio(rgb('#000000'), rgb('#ffffff'))).toBeCloseTo(21, 0);
    expect(contrastRatio(rgb('#ffffff'), rgb('#ffffff'))).toBeCloseTo(1, 5);
    // #767676 auf Weiß ist die bekannte Grenze von 4,54:1.
    expect(contrastRatio(rgb('#767676'), rgb('#ffffff'))).toBeGreaterThan(4.5);
    expect(contrastRatio(rgb('#777777'), rgb('#ffffff'))).toBeLessThan(4.5);
  });

  it('parses hex values defensively', () => {
    expect(parseHex('nope')).toBeNull();
    expect(parseHex('#12')).toBeNull();
    expect(toHex(rgb('#1666d8'))).toBe('#1666d8');
  });
});

describe('readableForeground', () => {
  it('picks white on dark and near-black on light backgrounds', () => {
    expect(toHex(readableForeground(rgb('#0b2340')))).toBe('#ffffff');
    expect(toHex(readableForeground(rgb('#ffe066')))).not.toBe('#ffffff');
  });
});

describe('normalizeTheme (AC-18: kontrastarme Kunden-CI)', () => {
  it('keeps a readable default theme untouched', () => {
    const result = normalizeTheme({ primaryColor: '#1666d8', primaryForeground: '#ffffff', navigationBackground: '#0b2340', navigationForeground: '#e2e8f0' });
    expect(result.corrections).toEqual([]);
  });

  it('darkens a primary colour that is too light for text and buttons on white, and keeps the hue family', () => {
    const result = normalizeTheme({ primaryColor: '#ffe066', primaryForeground: '#ffffff' });
    const adjusted = rgb(result.values.primaryColor as string);
    expect(contrastRatio(adjusted, rgb('#ffffff'))).toBeGreaterThanOrEqual(4.5);
    expect(result.corrections.map((c) => c.field)).toContain('primaryColor');
    expect(contrastRatio(rgb(result.values.primaryForeground as string), adjusted)).toBeGreaterThanOrEqual(4.5);
  });

  it('replaces a navigation foreground that is unreadable on its background', () => {
    const result = normalizeTheme({ navigationBackground: '#f5f7fb', navigationForeground: '#ffffff' });
    expect(result.corrections.map((c) => c.field)).toEqual(['navigationForeground']);
    expect(contrastRatio(rgb(result.values.navigationForeground as string), rgb('#f5f7fb'))).toBeGreaterThanOrEqual(4.5);
  });

  it('explains every correction (no silent changes)', () => {
    const result = normalizeTheme({ primaryColor: '#ffff00', primaryForeground: '#ffffff', accentColor: '#fffacd', accentForeground: '#ffffff', navigationBackground: '#ffffff', navigationForeground: '#eeeeee' });
    expect(result.corrections.length).toBeGreaterThanOrEqual(3);
    for (const correction of result.corrections) expect(correction.reason.length).toBeGreaterThan(10);
  });
});
