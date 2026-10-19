import { ValidationFailedError } from '@orbit/shared';
import { zonedTimeToUtc } from './reference/appointment-slots';

const NAIVE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;
const WITH_OFFSET = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i;

/**
 * Zeitangaben eines Auftrags: entweder mit Zeitzonenversatz (ISO 8601, z. B. `2026-10-20T08:00:00+02:00`) oder als **Ortszeit des Betriebs** ohne Versatz (`2026-10-20T08:00`). Die Ortszeit
 * wird in der Zeitzone des Betriebs gelesen (inklusive Sommerzeit) – das Modell soll nie selbst einen Versatz raten müssen.
 */
export function parseOrderTime(value: string, timeZone: string, label: string): Date {
  const text = value.trim();
  if (WITH_OFFSET.test(text)) {
    const date = new Date(text.replace(' ', 'T'));
    if (!Number.isNaN(date.getTime())) return date;
  }
  const naive = NAIVE.exec(text);
  if (naive) {
    const [, y, mo, d, h, mi] = naive.map(Number) as [number, number, number, number, number, number];
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && h <= 23 && mi <= 59) return zonedTimeToUtc({ year: y, month: mo, day: d }, h, mi, timeZone);
  }
  throw new ValidationFailedError(`${label} ist ungültig: „${value}“. Erwartet wird die Ortszeit des Betriebs als JJJJ-MM-TTTHH:MM (z. B. 2026-10-20T08:00) oder ISO 8601 mit Zeitzonenversatz.`);
}

/** Lesbare Ortszeit des Betriebs, z. B. „Di., 20.10.2026, 08:00 Uhr“. */
export function formatOrderTime(date: Date, timeZone: string): string {
  return `${new Intl.DateTimeFormat('de-DE', { timeZone, weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)} Uhr`;
}
