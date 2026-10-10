import { describe, expect, it } from 'vitest';
import { STAFF_CSV_TEMPLATE, parseCsv, parseStaffCsv } from './staff-csv';
import { StaffInputSchema, UpdateTenantProfileSchema, channelAddressProblem, profileForPrompt } from './tenant-profile';

describe('Mitarbeiter-Import (CSV)', () => {
  it('die mitgelieferte Beispieldatei ist selbst gültig: zwei Personen, Rolle, Kanal, Zuständigkeiten, Notdienst, Kalender', () => {
    const result = parseStaffCsv(STAFF_CSV_TEMPLATE);
    expect(result.fatal).toBeUndefined();
    expect(result.rows.map((r) => r.errors)).toEqual([[], []]);
    expect(result.mapping.every((m) => m.field !== null)).toBe(true);
    const [anna, ben] = result.rows.map((r) => r.staff!);
    expect(anna).toMatchObject({ externalId: 'P-001', firstName: 'Anna', lastName: 'Beispiel', roleKind: 'OWNER', roleTitle: 'Geschäftsführerin', preferredChannel: 'WHATSAPP', calendarId: 'primary' });
    expect(anna!.responsibilities).toEqual(expect.arrayContaining(['EMERGENCY', 'QUOTES']));
    expect(ben).toMatchObject({ roleKind: 'TECHNICIAN', preferredChannel: 'PHONE', responsibilities: ['APPOINTMENTS'], calendarId: 'ben@betrieb.example' });
  });

  it('versteht Excel-Exporte: Byte-Order-Marke, Semikolon, Umlaute in Köpfen, „Name“ als eine Spalte, „Nachname, Vorname“', () => {
    const csv = '﻿Name;Funktion;E-Mail;Mobil;Bevorzugter Kanal\r\n"Müller, Anna";Bauleiterin;anna.mueller@betrieb.example;0171 1234567;E-Mail\r\nBen Muster;Monteur;ben@betrieb.example;;Teams\r\n';
    const result = parseStaffCsv(csv);
    expect(result.rows[0]!.staff).toMatchObject({ firstName: 'Anna', lastName: 'Müller', roleTitle: 'Bauleiterin', email: 'anna.mueller@betrieb.example' });
    // Teams ohne Teams-Adresse ist nicht erreichbar – schon beim Import ein klarer Fehler, nicht erst im Notfall.
    expect(result.rows[1]!.errors).toEqual(['Für den Kanal Teams fehlt die Teams-Adresse.']);
  });

  it('englische Köpfe, Kommas, Anführungszeichen mit Komma im Feld', () => {
    const csv = 'First Name,Last Name,Role,Email,Phone,Preferred Channel,Responsibilities\n' + 'Eva,Stone,Dispatcher,eva@shop.example,"+49 30 123456","SMS","Emergency, Appointments"\n';
    const row = parseStaffCsv(csv).rows[0]!;
    expect(row.errors).toEqual([]);
    expect(row.staff).toMatchObject({ roleKind: 'DISPATCHER', preferredChannel: 'SMS', responsibilities: ['EMERGENCY', 'APPOINTMENTS'] });
  });

  it('jede Zeile wird einzeln geprüft: ein Fehler stoppt die übrigen nicht und nennt die Zeile', () => {
    const csv = 'Vorname;Nachname;E-Mail;Zuständigkeiten;Bevorzugter Kanal\nAnna;Eins;anna@x.example;Notfälle;E-Mail\nBen;;ben@x.example;;E-Mail\nCarla;Drei;kaputt;;E-Mail\nDirk;Vier;dirk@x.example;Hausmeister;Brieftaube\n';
    const rows = parseStaffCsv(csv).rows;
    expect(rows.map((r) => [r.line, r.errors.length === 0])).toEqual([[2, true], [3, false], [4, false], [5, false]]);
    expect(rows[1]!.errors.join(' ')).toContain('lastName');
    expect(rows[2]!.errors.join(' ')).toContain('email');
    expect(rows[3]!.errors).toEqual(expect.arrayContaining([expect.stringContaining('Hausmeister'), expect.stringContaining('Brieftaube')]));
  });

  it('eine unbekannte Rolle geht nicht verloren: sie bleibt als Funktion erhalten', () => {
    const row = parseStaffCsv('Vorname;Nachname;Rolle;E-Mail\nAnna;Eins;Qualitätsbeauftragte;a@x.example\n').rows[0]!;
    expect(row.staff).toMatchObject({ roleKind: 'OTHER', roleTitle: 'Qualitätsbeauftragte' });
  });

  it('Notdienst-Spalte (Ja/Nein) und „aktiv“ werden ausgewertet; Unsinn wird gemeldet', () => {
    const csv = 'Vorname;Nachname;E-Mail;Notdienst;Aktiv\nA;Eins;a@x.example;ja;nein\nB;Zwei;b@x.example;nein;ja\nC;Drei;c@x.example;vielleicht;ja\n';
    const rows = parseStaffCsv(csv).rows;
    expect(rows[0]!.staff).toMatchObject({ responsibilities: ['EMERGENCY'], active: false });
    expect(rows[1]!.staff).toMatchObject({ responsibilities: [], active: true });
    expect(rows[2]!.errors[0]).toContain('vielleicht');
  });

  it('Dateien ohne Namensspalten, leere Dateien und zu große Dateien werden mit klarer Meldung abgewiesen', () => {
    expect(parseStaffCsv('').fatal).toBe('Die Datei ist leer.');
    expect(parseStaffCsv('E-Mail;Mobil\na@x.example;123').fatal).toContain('Name');
    const many = 'Vorname;Nachname;E-Mail\n' + Array.from({ length: 2001 }, (_, i) => `A${i};B;a${i}@x.example`).join('\n');
    expect(parseStaffCsv(many).fatal).toContain('mehr als 2000');
  });

  it('parseCsv: Trennzeichen wird erkannt, Zeilenumbrüche in Anführungszeichen bleiben im Feld', () => {
    expect(parseCsv('a;b\n1;2')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsv('a,b\n"x\ny",2')).toEqual([['a', 'b'], ['x\ny', '2']]);
    expect(parseCsv('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']]);
  });
});

describe('Mitarbeiter und Erreichbarkeit', () => {
  const base = { preferredChannel: 'EMAIL' as const };
  it('der bevorzugte Kanal muss mit den vorhandenen Angaben erreichbar sein', () => {
    expect(channelAddressProblem({ ...base, email: 'a@x.example' })).toBeUndefined();
    expect(channelAddressProblem({ ...base })).toContain('E-Mail-Adresse');
    expect(channelAddressProblem({ preferredChannel: 'WHATSAPP', phone: '+49 171 123456' })).toBeUndefined(); // Mobilnummer genügt
    expect(channelAddressProblem({ preferredChannel: 'PHONE' })).toContain('Rufnummer');
    expect(channelAddressProblem({ preferredChannel: 'TEAMS', email: 'a@x.example' })).toContain('Teams-Adresse');
  });

  it('Eingaben werden bereinigt: E-Mail klein geschrieben, leere Felder entfallen, Nummern geprüft', () => {
    const ok = StaffInputSchema.parse({ firstName: ' Anna ', lastName: 'Eins', email: ' ANNA@X.EXAMPLE ', phone: '', roleKind: 'OWNER' });
    expect(ok).toMatchObject({ firstName: 'Anna', email: 'anna@x.example', phone: undefined, preferredChannel: 'EMAIL', responsibilities: [], active: true });
    expect(StaffInputSchema.safeParse({ firstName: 'A', lastName: 'B', phone: 'abc' }).success).toBe(false);
    expect(StaffInputSchema.safeParse({ firstName: 'A', lastName: 'B', unknown: 1 }).success).toBe(false);
  });
});

describe('Betriebsprofil', () => {
  it('prüft Öffnungszeiten und Sprachen', () => {
    expect(UpdateTenantProfileSchema.safeParse({ openingHours: [{ days: ['MON', 'TUE'], from: '07:30', to: '16:00' }], languages: ['de', 'en'] }).success).toBe(true);
    expect(UpdateTenantProfileSchema.safeParse({ openingHours: [{ days: ['MON'], from: '25:00', to: '16:00' }] }).success).toBe(false);
    expect(UpdateTenantProfileSchema.safeParse({ languages: ['deutsch'] }).success).toBe(false);
    expect(UpdateTenantProfileSchema.safeParse({ industry: 'Dachdecker', unbekannt: true }).success).toBe(false);
  });

  it('der Profiltext für die KI nennt Branche, Leistungen, Zeiten, Notdienst und Tonalität – und sagt ehrlich, wenn es keinen Notdienst gibt', () => {
    const text = profileForPrompt({
      industry: 'Heizung und Sanitär',
      description: 'Familienbetrieb mit 8 Mitarbeitern.',
      services: ['Heizungswartung', 'Badsanierung'],
      exclusions: ['Elektroarbeiten'],
      serviceArea: 'Köln und Umgebung (30 km)',
      openingHours: [{ days: ['MON', 'TUE', 'WED', 'THU', 'FRI'], from: '07:00', to: '16:30' }],
      emergencyService: true,
      emergencyNote: 'rund um die Uhr unter der Notdienst-Nummer',
      tone: 'FRIENDLY',
      faqs: [{ question: 'Machen Sie Fliesenarbeiten?', answer: 'Ja, im Rahmen einer Badsanierung.' }],
    });
    expect(text).toContain('Branche: Heizung und Sanitär.');
    expect(text).toContain('Leistungen: Heizungswartung; Badsanierung.');
    expect(text).toContain('Nicht im Angebot: Elektroarbeiten.');
    expect(text).toContain('Erreichbar: Mo/Di/Mi/Do/Fr 07:00–16:30.');
    expect(text).toContain('Notdienst: ja (rund um die Uhr unter der Notdienst-Nummer).');
    expect(text).toContain('„Machen Sie Fliesenarbeiten?“ → Ja, im Rahmen einer Badsanierung.');
    expect(profileForPrompt({ emergencyService: false })).toContain('Notdienst: nein');
  });
});
