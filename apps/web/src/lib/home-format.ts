import type { DashboardMetric, DashboardMetricKey, DashboardPeriod } from '@orbit/shared';

export const PERIOD_LABELS: Record<DashboardPeriod, string> = { TODAY: 'Heute', WEEK: 'Diese Woche', MONTH: 'Dieser Monat' };

const PERIOD_ADVERB: Record<DashboardPeriod, string> = { TODAY: 'heute', WEEK: 'diese Woche', MONTH: 'diesen Monat' };

export interface KpiDescriptor {
  label: string;
  /** Zeitbezug unter dem Wert (§7): „heute“ für Zeitraumwerte, „aktuell“ für Bestandswerte. */
  basisLabel: string;
  /** Erklärung der Zählbasis (Tooltip und Screenreader). */
  definition: string;
  href: string;
}

/** Fünf Standard-KPIs mit präzisierter Zählbasis (UI v2 §7). */
export function describeKpi(key: DashboardMetricKey, period: DashboardPeriod): KpiDescriptor {
  const when = PERIOD_ADVERB[period];
  switch (key) {
    case 'processed':
      return {
        label: 'Verarbeitete Posten',
        basisLabel: when,
        definition: `Fachlich relevante Eingänge, die ${when} bearbeitet wurden. Ausgefilterte Eingänge zählen nicht mit.`,
        href: '/inbox',
      };
    case 'automated':
      return {
        label: 'Automatisiert',
        basisLabel: `ohne Eingriff, ${when}`,
        definition: `Vorgänge, die ${when} ohne menschlichen Eingriff mit erfüllten Abschlusskriterien abgeschlossen wurden.`,
        href: '/cases',
      };
    case 'approvalsOpen':
      return {
        label: 'Freigaben offen',
        basisLabel: 'aktuell',
        definition: 'Zum angezeigten Stand offene Freigaben in Ihrem Zuständigkeitsbereich.',
        href: '/approvals',
      };
    case 'problems':
      return {
        label: 'Fehler / ungeklärt',
        basisLabel: 'aktuell betroffene Vorgänge',
        definition: 'Vorgänge mit fehlgeschlagener Bearbeitung oder ungewissem Ergebnis – nicht die Zahl einzelner Wiederholungsversuche.',
        href: '/cases',
      };
    case 'timeSaved':
      return {
        label: 'Geschätzte Zeitersparnis',
        basisLabel: `Schätzung, ${when}`,
        definition: `Schätzung auf Basis der ${when} automatisiert abgeschlossenen Vorgänge (feste Annahme je Vorgang). Keine Garantie.`,
        href: '/activity',
      };
  }
}

export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** `null` = „Noch nicht verfügbar“ – nie als 0 darstellen (§7). */
export function formatMetricValue(metric: DashboardMetric | undefined): string {
  if (!metric || metric.value === null) return '–';
  if (metric.key === 'timeSaved') return formatMinutes(metric.value);
  return new Intl.NumberFormat('de-DE').format(metric.value);
}

export function formatClock(value: string | Date): string {
  return new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

export function formatShortDate(value: string | Date): string {
  return new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(value));
}

/** Kurze, relative Zeitangabe für Listenzeilen: „08:12“ heute, sonst „04.10.“. */
export function formatListTime(value: string | Date, now: Date = new Date()): string {
  const date = new Date(value);
  const sameDay = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  return sameDay ? formatClock(date) : new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit' }).format(date);
}

/** Eindeutige Zeitangabe für Listen: „Heute, 11:25“ bzw. „04.10.2026, 17:56“ – mit Jahr, damit nie unklar ist, wann etwas eingegangen ist. */
export function formatListDateTime(value: string | Date, now: Date = new Date()): string {
  const date = new Date(value);
  const sameDay = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  if (sameDay) return `Heute, ${formatClock(date)}`;
  return `${new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date)}, ${formatClock(date)}`;
}

/** Fristtext: „überfällig seit 03.10.“, „heute 14:00“, „bis 08.10.“. */
export function formatDue(value: string | Date, now: Date = new Date()): string {
  const date = new Date(value);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTomorrow = new Date(startOfToday.getTime() + 24 * 3600 * 1000);
  const day = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit' }).format(date);
  if (date < startOfToday) return `überfällig seit ${day}`;
  if (date < startOfTomorrow) return 'heute fällig';
  return `fällig ${day}`;
}
