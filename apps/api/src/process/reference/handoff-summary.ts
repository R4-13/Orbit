import type { AnalysisResult } from './request-analysis';

/**
 * Die Zusammenfassung, die ORBIT einem nachgelagerten System (CRM, Angebotsprogramm) oder einer Person übergibt: was die Kundschaft will, was sie angegeben hat, was noch fehlt und wie
 * es mit dem Termin steht. Reine Funktion aus den festgehaltenen Angaben – nichts wird von einem Modell neu formuliert oder ergänzt, jede Angabe stammt aus dem Vorgang.
 */

export interface HandoffInput {
  customer: { name?: string; email: string };
  /** Titel des Vorgangs („Anfrage Wärmepumpe …“). */
  title: string;
  receivedAt: Date;
  timeZone: string;
  analysis?: AnalysisResult;
  /** Bestätigte, aktuelle Angaben des Vorgangs (Schlüssel → Wert). */
  facts: ReadonlyArray<{ key: string; value: unknown }>;
  appointment?: {
    /** Gebucht: Art, Beginn, zuständige Person. */
    booked?: { kind: string; start: string; assignee?: string };
    /** Die Antwort der Kundschaft auf Terminvorschläge bzw. ihr Terminwunsch (Wortlaut). */
    agreed?: string;
    /** Wie viele konkrete Termine vorgeschlagen wurden (0 = es wurde nach Zeiträumen gefragt). */
    proposedSlots?: number;
  };
}

export interface HandoffSummary {
  text: string;
  /** Angaben, die vorliegen (Bezeichnung → Wert). */
  known: Array<{ label: string; value: string }>;
  /** Fragen, die noch offen sind. */
  open: string[];
}

/** Schlüssel, die nie als „Angabe der Kundschaft“ erscheinen (sie stehen an anderer Stelle oder sind interne Marker). */
const HIDDEN_PREFIXES = ['contact.', 'appointment.', 'case.', 'inbound.', 'crm.'];

const display = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
};

const dateTime = (iso: string, timeZone: string): string => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : new Intl.DateTimeFormat('de-DE', { timeZone, dateStyle: 'full', timeStyle: 'short' }).format(date);
};

/** „ai.living_area“ → „Living area“ als Notbehelf, wenn die Analyse keine Bezeichnung kennt. */
const prettyKey = (key: string): string => {
  const last = key.split('.').pop() ?? key;
  const words = last.replace(/[_-]+/g, ' ').trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : key;
};

export function buildHandoffSummary(input: HandoffInput): HandoffSummary {
  const factValue = new Map(input.facts.map((f) => [f.key, f.value]));
  const known: HandoffSummary['known'] = [];
  const open: string[] = [];
  const seen = new Set<string>();

  // 1. Was die Analyse als Anforderungen kennt – mit dem Wert, wenn er inzwischen vorliegt, sonst als offene Frage.
  for (const requirement of input.analysis?.requirements ?? []) {
    seen.add(requirement.key);
    const value = factValue.get(requirement.key);
    if (value !== undefined && value !== null && display(value) !== '') known.push({ label: requirement.label, value: display(value) });
    else open.push(requirement.question);
  }
  // 2. Was die Analyse schon aus der Anfrage entnommen hat und nicht (mehr) als Anforderung auftaucht.
  for (const item of input.analysis?.known ?? []) {
    if (seen.has(item.key)) continue;
    seen.add(item.key);
    known.push({ label: item.label, value: display(factValue.get(item.key) ?? item.value) });
  }
  // 3. Weitere bestätigte Angaben des Vorgangs (z. B. aus Antworten), ohne interne Marker.
  for (const fact of input.facts) {
    if (seen.has(fact.key) || HIDDEN_PREFIXES.some((p) => fact.key.startsWith(p))) continue;
    const value = display(fact.value);
    if (value !== '') known.push({ label: prettyKey(fact.key), value });
  }

  const lines: string[] = [
    `Anfrage über ORBIT (E-Mail, ${new Intl.DateTimeFormat('de-DE', { timeZone: input.timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(input.receivedAt)})`,
    `Kundschaft: ${input.customer.name ? `${input.customer.name} ` : ''}<${input.customer.email}>`,
    `Anliegen: ${input.analysis?.summary?.trim() || input.title}`,
  ];
  if (known.length > 0) lines.push('', 'Angaben der Kundschaft:', ...known.map((k) => `- ${k.label}: ${k.value}`));
  if (open.length > 0) lines.push('', 'Noch offen:', ...open.map((q) => `- ${q}`));

  const { appointment } = input;
  const wantsVisit = input.analysis?.siteVisit.recommended === true || input.analysis?.nextStep === 'PROPOSE_SITE_VISIT';
  if (appointment?.booked) {
    lines.push('', `Termin: ${appointment.booked.kind === 'SITE_VISIT' ? 'Vor-Ort-Termin' : 'Termin'} gebucht für ${dateTime(appointment.booked.start, input.timeZone)}${appointment.booked.assignee ? ` (zuständig: ${appointment.booked.assignee})` : ''}.`);
  } else if (appointment?.agreed) {
    lines.push('', `Termin: noch nicht gebucht. Antwort/Wunsch der Kundschaft: „${appointment.agreed.slice(0, 300)}“.`);
  } else if (wantsVisit) {
    lines.push('', `Termin: Ein Vor-Ort-Termin ist sinnvoll${input.analysis?.siteVisit.reason ? ` (${input.analysis.siteVisit.reason})` : ''}; noch ${appointment?.proposedSlots ? 'keine Auswahl der Kundschaft' : 'kein Termin vereinbart'}.`);
  }
  lines.push('', 'Erfasst von ORBIT; die Angaben stammen aus den Nachrichten der Kundschaft.');
  return { text: lines.join('\n'), known, open };
}
