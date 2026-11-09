// Szenarien laden, auswählen und zu einer fertigen Mail ausfüllen.
import { readFileSync } from 'node:fs';
import { buildPdf } from './pdf.mjs';

export function loadScenarios(file) {
  const data = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(data.szenarien) || data.szenarien.length === 0) throw new Error(`Keine Szenarien in ${file}.`);
  const ids = new Set();
  for (const s of data.szenarien) {
    for (const field of ['id', 'art', 'titel', 'betreff', 'text']) if (typeof s[field] !== 'string' || !s[field]) throw new Error(`Szenario ohne ${field}: ${JSON.stringify(s).slice(0, 80)}`);
    if (ids.has(s.id)) throw new Error(`Doppelte Szenario-Kennung: ${s.id}`);
    ids.add(s.id);
  }
  return data.szenarien;
}

/** Auswahl: nach Kennung, nach Art oder – ohne Angabe – alle. */
export function select(scenarios, { id, art } = {}) {
  const chosen = scenarios.filter((s) => (!id || s.id === id) && (!art || s.art === art));
  if (chosen.length === 0) throw new Error(`Kein Szenario gefunden${id ? ` mit Kennung „${id}“` : ''}${art ? ` der Art „${art}“` : ''}. Siehe: node simulator.mjs liste`);
  return chosen;
}

/**
 * Anhangsarten: `pdf` (Standard, mit Textebene), `ohne-text` (gültiges PDF ohne Text, wie ein Scan), `gross` (PDF, aufgefüllt auf `megabyte` MB), `ausfuehrbar` (ein Programm, das sich als PDF ausgibt – nur Anfangsbytes,
 * nichts Ausführbares). Die drei letzten dienen den Sonderprüfungen der Anhangsfreigabe.
 */
function buildAttachment(spec, fill) {
  const filename = fill(spec.dateiname);
  switch (spec.art ?? 'pdf') {
    case 'ohne-text':
      return { filename, mimeType: 'application/pdf', data: buildPdf([]) };
    case 'gross':
      return { filename, mimeType: 'application/pdf', data: Buffer.concat([buildPdf(['Scan']), Buffer.alloc(Math.round((spec.megabyte ?? 6) * 1024 * 1024), 0x20)]) };
    case 'ausfuehrbar':
      return { filename, mimeType: 'application/pdf', data: Buffer.concat([Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]), Buffer.alloc(2048)]) };
    default:
      return { filename, mimeType: 'application/pdf', data: buildPdf(spec.zeilen.map(fill)) };
  }
}

const germanDate = (date) => new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);

/**
 * Setzt Platzhalter ein ({{nr}} fünfstellige Zufallsnummer, {{datum}} heute, {{faellig}} in 14 Tagen) und erzeugt den Anhang.
 * @returns {{ subject: string, text: string, fromName: string, attachment?: { filename: string, mimeType: string, data: Buffer } }}
 */
export function render(scenario, { now = new Date(), random = Math.random, notice = true } = {}) {
  const values = { nr: String(10000 + Math.floor(random() * 89999)), datum: germanDate(now), faellig: germanDate(new Date(now.getTime() + 14 * 86_400_000)) };
  const fill = (text) => text.replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] ?? `{{${key}}}`);
  let text = fill(scenario.text);
  // Der Hinweis macht für jeden, der die Mail später findet, erkennbar, dass sie nicht von einem echten Kunden stammt.
  if (notice) text += '\n\n[Simulation] Diese Nachricht ist eine automatisch erzeugte Testanfrage (customer-simulator).';
  const attachment = scenario.anhang ? buildAttachment(scenario.anhang, fill) : undefined;
  return { subject: fill(scenario.betreff), text, fromName: scenario.absender ?? 'Tom Orbit', attachment };
}
