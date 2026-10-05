/**
 * UI v2 §21.3 / AC-18: Tenant-CI darf die Lesbarkeit nicht zerstören. Diese reinen Funktionen berechnen WCAG-Kontraste und
 * korrigieren unlesbare Kombinationen, statt Statuswerte oder Schrift zu verstecken. Statusfarben (Erfolg/Warnung/Fehler) kommen nie
 * aus der Kunden-CI.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function parseHex(value: string): Rgb | null {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(value.trim());
  if (!match) return null;
  const int = Number.parseInt(match[1] as string, 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

export function toHex({ r, g, b }: Rgb): string {
  const part = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}

function channel(value: number): number {
  const s = value / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(color: Rgb): number {
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

/** WCAG-Kontrastverhältnis 1:1 … 21:1. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [light, dark] = la >= lb ? [la, lb] : [lb, la];
  return (light + 0.05) / (dark + 0.05);
}

const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const NEAR_BLACK: Rgb = { r: 15, g: 23, b: 42 };

/** Die besser lesbare Schriftfarbe (weiß oder fast schwarz) auf einem Hintergrund. */
export function readableForeground(background: Rgb): Rgb {
  return contrastRatio(WHITE, background) >= contrastRatio(NEAR_BLACK, background) ? WHITE : NEAR_BLACK;
}

/** Mischt `color` schrittweise mit Schwarz, bis `minimum` gegen `against` erreicht ist (Farbton bleibt erkennbar). */
export function darkenUntilContrast(color: Rgb, against: Rgb, minimum: number): Rgb {
  let current = color;
  for (let step = 0; step < 40 && contrastRatio(current, against) < minimum; step += 1) {
    current = { r: current.r * 0.92, g: current.g * 0.92, b: current.b * 0.92 };
  }
  return current;
}

export interface ThemeInput {
  primaryColor?: string | null;
  primaryForeground?: string | null;
  accentColor?: string | null;
  accentForeground?: string | null;
  navigationBackground?: string | null;
  navigationForeground?: string | null;
}

export interface ThemeCorrection {
  field: keyof ThemeInput;
  from: string;
  to: string;
  reason: string;
}

export interface NormalizedTheme {
  values: ThemeInput;
  corrections: ThemeCorrection[];
}

/**
 * Normalisiert die Kunden-CI: Die Primärfarbe muss als Text/Link auf Weiß mindestens 4,5:1 erreichen (sonst wird sie abgedunkelt),
 * jede Vordergrundfarbe muss auf ihrem Hintergrund 4,5:1 erreichen (sonst wird eine sichere Schriftfarbe gewählt). Jede Korrektur
 * wird zurückgemeldet, damit die Vorschau sie ehrlich erklären kann.
 */
export function normalizeTheme(input: ThemeInput): NormalizedTheme {
  const values: ThemeInput = { ...input };
  const corrections: ThemeCorrection[] = [];

  const primary = input.primaryColor ? parseHex(input.primaryColor) : null;
  if (primary && input.primaryColor) {
    const adjusted = darkenUntilContrast(primary, WHITE, 4.5);
    if (adjusted !== primary) {
      values.primaryColor = toHex(adjusted);
      corrections.push({ field: 'primaryColor', from: input.primaryColor, to: values.primaryColor, reason: 'Die Primärfarbe war als Schrift und Schaltfläche auf Weiß zu hell (Kontrast unter 4,5:1) und wurde abgedunkelt.' });
    }
    const resolved = parseHex(values.primaryColor ?? input.primaryColor) as Rgb;
    const fg = input.primaryForeground ? parseHex(input.primaryForeground) : null;
    if (!fg || contrastRatio(fg, resolved) < 4.5) {
      const safe = toHex(readableForeground(resolved));
      if (input.primaryForeground && safe !== input.primaryForeground) corrections.push({ field: 'primaryForeground', from: input.primaryForeground, to: safe, reason: 'Die Schriftfarbe auf Primärflächen war zu schwach (unter 4,5:1) und wurde angepasst.' });
      values.primaryForeground = safe;
    }
  }

  const accent = input.accentColor ? parseHex(input.accentColor) : null;
  if (accent && input.accentColor) {
    const fg = input.accentForeground ? parseHex(input.accentForeground) : null;
    if (!fg || contrastRatio(fg, accent) < 4.5) {
      const safe = toHex(readableForeground(accent));
      if (input.accentForeground && safe !== input.accentForeground) corrections.push({ field: 'accentForeground', from: input.accentForeground, to: safe, reason: 'Die Schriftfarbe auf Akzentflächen war zu schwach und wurde angepasst.' });
      values.accentForeground = safe;
    }
  }

  const navBackground = input.navigationBackground ? parseHex(input.navigationBackground) : null;
  if (navBackground && input.navigationBackground) {
    const fg = input.navigationForeground ? parseHex(input.navigationForeground) : null;
    if (!fg || contrastRatio(fg, navBackground) < 4.5) {
      const safe = toHex(readableForeground(navBackground));
      if (input.navigationForeground && safe !== input.navigationForeground) corrections.push({ field: 'navigationForeground', from: input.navigationForeground, to: safe, reason: 'Die Schriftfarbe in der Navigation war zu schwach und wurde angepasst.' });
      values.navigationForeground = safe;
    }
  }

  return { values, corrections };
}
