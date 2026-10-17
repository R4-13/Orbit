// Schutzregeln: wohin und wie viel verschickt werden darf. Alles hier gilt unabhängig von dem, was ein Aufrufer will.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Reine Adresse aus `Name <a@b.example>` oder `a@b.example`, klein geschrieben. */
export function bareAddress(value) {
  const match = /<([^<>\s]+@[^<>\s]+)>/.exec(value) ?? /^\s*([^<>\s]+@[^<>\s]+)\s*$/.exec(value);
  return match ? match[1].toLowerCase() : undefined;
}

/**
 * Der Empfänger muss genau eine Adresse sein und in der Liste der erlaubten stehen. Mehrere Empfänger, Kopien oder Listen werden abgelehnt.
 * @returns {string} die erlaubte Adresse
 */
export function assertAllowedRecipient(to, allowed) {
  if (/[,;]/.test(to)) throw new Error('Es ist genau ein Empfänger erlaubt.');
  const address = bareAddress(to);
  if (!address) throw new Error(`Keine gültige Empfängeradresse: ${to}`);
  const list = allowed.map((a) => a.trim().toLowerCase()).filter(Boolean);
  if (list.length === 0) throw new Error('SIM_ALLOWED_RECIPIENTS ist leer: der Simulator verschickt nichts, solange keine Empfänger erlaubt sind.');
  if (!list.includes(address)) throw new Error(`Empfänger ${address} ist nicht erlaubt (erlaubt: ${list.join(', ')}).`);
  return address;
}

/** Gesendete Zeitpunkte, gespeichert in einer lokalen Datei (nur Zeitstempel, keine Inhalte). */
export class SendLedger {
  constructor(file, now = () => Date.now()) {
    this.file = file;
    this.now = now;
  }

  read() {
    if (!existsSync(this.file)) return [];
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8'));
      return Array.isArray(parsed.sent) ? parsed.sent.filter((t) => Number.isFinite(t)) : [];
    } catch {
      return [];
    }
  }

  counts() {
    const now = this.now();
    const sent = this.read();
    return { lastHour: sent.filter((t) => now - t < HOUR).length, lastDay: sent.filter((t) => now - t < DAY).length };
  }

  /** Wirft, wenn ein weiterer Versand die Grenzen überschreiten würde. */
  assertRoom(limits) {
    const { lastHour, lastDay } = this.counts();
    if (lastHour >= limits.perHour) throw new Error(`Grenze erreicht: ${lastHour} Mails in der letzten Stunde (erlaubt ${limits.perHour}).`);
    if (lastDay >= limits.perDay) throw new Error(`Grenze erreicht: ${lastDay} Mails in den letzten 24 Stunden (erlaubt ${limits.perDay}).`);
  }

  record() {
    const now = this.now();
    writeFileSync(this.file, JSON.stringify({ sent: [...this.read().filter((t) => now - t < DAY), now] }), 'utf8');
  }
}

/** Notaus: existiert die Datei `STOP` im Ordner des Werkzeugs, wird nichts mehr verschickt. */
export function stopRequested(stopFile) {
  return existsSync(stopFile);
}
