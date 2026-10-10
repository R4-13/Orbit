import { STAFF_CHANNEL_LABELS, STAFF_CONTACT_CHANNELS, STAFF_RESPONSIBILITIES, STAFF_RESPONSIBILITY_LABELS, STAFF_ROLE_KINDS, STAFF_ROLE_LABELS, StaffInputSchema, channelAddressProblem, type StaffInput } from './tenant-profile';

/**
 * CSV-Import des Mitarbeiterverzeichnisses (reine Funktion, ohne Datenbank). Ein Betrieb exportiert meist aus Excel oder einem Verzeichnis: deutsche oder englische Spaltenköpfe,
 * Semikolon oder Komma, Anführungszeichen, Umlaute, evtl. eine Byte-Order-Marke. Jede Zeile wird einzeln geprüft; ein Fehler in einer Zeile stoppt die anderen nicht.
 */

export interface StaffCsvRow {
  /** Zeilennummer in der Datei (die Kopfzeile ist Zeile 1). */
  line: number;
  staff?: StaffInput;
  errors: string[];
}

export interface StaffCsvResult {
  rows: StaffCsvRow[];
  /** Erkannte Spalten (Kopf → Feld) und nicht zugeordnete Köpfe – damit die Person sieht, was ankam. */
  mapping: Array<{ header: string; field: string | null }>;
  fatal?: string;
}

const MAX_ROWS = 2000;

const normalizeHeader = (value: string): string => value.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');

/** Bekannte Spaltenköpfe (normalisiert) → Feld. */
const HEADER_FIELDS: Record<string, string> = {
  personalnummer: 'externalId', mitarbeiternummer: 'externalId', id: 'externalId', externalid: 'externalId', kennung: 'externalId', employeeid: 'externalId',
  vorname: 'firstName', firstname: 'firstName', givenname: 'firstName',
  nachname: 'lastName', familienname: 'lastName', lastname: 'lastName', surname: 'lastName',
  name: 'fullName', vollstandigername: 'fullName', fullname: 'fullName', displayname: 'fullName',
  rolle: 'roleKind', role: 'roleKind', rollenart: 'roleKind', abteilung: 'roleKind',
  funktion: 'roleTitle', titel: 'roleTitle', position: 'roleTitle', jobtitle: 'roleTitle', stelle: 'roleTitle',
  email: 'email', emailadresse: 'email', mail: 'email', emailgeschaeftlich: 'email',
  telefon: 'phone', mobil: 'phone', handy: 'phone', mobiltelefon: 'phone', phone: 'phone', mobile: 'phone', telefonnummer: 'phone', rufnummer: 'phone',
  teams: 'teamsAddress', teamsadresse: 'teamsAddress', teamsaddress: 'teamsAddress', upn: 'teamsAddress',
  whatsapp: 'whatsappNumber', whatsappnummer: 'whatsappNumber',
  kanal: 'preferredChannel', bevorzugterkanal: 'preferredChannel', erreichbarkeit: 'preferredChannel', kontaktweg: 'preferredChannel', preferredchannel: 'preferredChannel', bevorzugtekontaktart: 'preferredChannel',
  zustandigkeiten: 'responsibilities', zustandig: 'responsibilities', zustandigfur: 'responsibilities', responsibilities: 'responsibilities', aufgaben: 'responsibilities',
  notdienst: 'emergency', bereitschaft: 'emergency', emergency: 'emergency', notfallkontakt: 'emergency',
  kalender: 'calendarId', kalenderid: 'calendarId', calendarid: 'calendarId', calendar: 'calendarId',
  verfugbarkeit: 'availabilityNote', anmerkung: 'availabilityNote', hinweis: 'availabilityNote', arbeitszeit: 'availabilityNote', notiz: 'availabilityNote',
  vorgesetzter: 'supervisorRef', vorgesetzte: 'supervisorRef', supervisor: 'supervisorRef', berichtetan: 'supervisorRef',
  vertretung: 'deputyRef', stellvertreter: 'deputyRef', stellvertretung: 'deputyRef', deputy: 'deputyRef', backup: 'deputyRef',
  aktiv: 'active', active: 'active', status: 'active',
};

/** Werte → Aufzählung (deutsche und englische Schreibweisen). */
const ROLE_ALIASES: Record<string, (typeof STAFF_ROLE_KINDS)[number]> = {
  owner: 'OWNER', inhaber: 'OWNER', inhaberin: 'OWNER', geschaftsfuhrung: 'OWNER', geschaftsfuhrer: 'OWNER', geschaftsfuhrerin: 'OWNER', chef: 'OWNER', chefin: 'OWNER',
  manager: 'MANAGER', leitung: 'MANAGER', leiter: 'MANAGER', leiterin: 'MANAGER', bauleiter: 'MANAGER', bauleitung: 'MANAGER', meister: 'MANAGER', meisterin: 'MANAGER',
  dispatcher: 'DISPATCHER', disposition: 'DISPATCHER', disponent: 'DISPATCHER', disponentin: 'DISPATCHER', einsatzplanung: 'DISPATCHER', einsatzleitung: 'DISPATCHER',
  technician: 'TECHNICIAN', monteur: 'TECHNICIAN', monteurin: 'TECHNICIAN', techniker: 'TECHNICIAN', technikerin: 'TECHNICIAN', geselle: 'TECHNICIAN', gesellin: 'TECHNICIAN', handwerker: 'TECHNICIAN', installateur: 'TECHNICIAN', elektriker: 'TECHNICIAN', auszubildender: 'TECHNICIAN', azubi: 'TECHNICIAN', werkstatt: 'TECHNICIAN',
  office: 'OFFICE', buro: 'OFFICE', verwaltung: 'OFFICE', backoffice: 'OFFICE', sekretariat: 'OFFICE', empfang: 'OFFICE', assistenz: 'OFFICE',
  accounting: 'ACCOUNTING', buchhaltung: 'ACCOUNTING', buchhalter: 'ACCOUNTING', buchhalterin: 'ACCOUNTING', finanzen: 'ACCOUNTING', lohn: 'ACCOUNTING',
  sales: 'SALES', vertrieb: 'SALES', kalkulation: 'SALES', verkauf: 'SALES', kundenberater: 'SALES', kundenberaterin: 'SALES', angebotswesen: 'SALES',
  other: 'OTHER', sonstige: 'OTHER', sonstiges: 'OTHER',
};
for (const kind of STAFF_ROLE_KINDS) ROLE_ALIASES[normalizeHeader(STAFF_ROLE_LABELS[kind])] = kind;

const CHANNEL_ALIASES: Record<string, (typeof STAFF_CONTACT_CHANNELS)[number]> = {
  email: 'EMAIL', mail: 'EMAIL', emailadresse: 'EMAIL',
  teams: 'TEAMS', microsoftteams: 'TEAMS',
  whatsapp: 'WHATSAPP', wa: 'WHATSAPP',
  sms: 'SMS', textnachricht: 'SMS',
  phone: 'PHONE', telefon: 'PHONE', anruf: 'PHONE', anrufen: 'PHONE', call: 'PHONE', handy: 'PHONE',
};
for (const channel of STAFF_CONTACT_CHANNELS) CHANNEL_ALIASES[normalizeHeader(STAFF_CHANNEL_LABELS[channel])] = channel;

const RESPONSIBILITY_ALIASES: Record<string, (typeof STAFF_RESPONSIBILITIES)[number]> = {
  emergency: 'EMERGENCY', notfall: 'EMERGENCY', notfalle: 'EMERGENCY', notdienst: 'EMERGENCY', bereitschaft: 'EMERGENCY',
  quotes: 'QUOTES', angebote: 'QUOTES', angebot: 'QUOTES', kalkulation: 'QUOTES',
  invoices: 'INVOICES', rechnungen: 'INVOICES', rechnung: 'INVOICES', buchhaltung: 'INVOICES',
  applications: 'APPLICATIONS', bewerbungen: 'APPLICATIONS', bewerbung: 'APPLICATIONS', personal: 'APPLICATIONS',
  complaints: 'COMPLAINTS', reklamationen: 'COMPLAINTS', reklamation: 'COMPLAINTS', service: 'COMPLAINTS', beschwerden: 'COMPLAINTS',
  appointments: 'APPOINTMENTS', termine: 'APPOINTMENTS', termin: 'APPOINTMENTS', einsatzplanung: 'APPOINTMENTS', disposition: 'APPOINTMENTS',
  general: 'GENERAL', allgemein: 'GENERAL', anfragen: 'GENERAL', sonstiges: 'GENERAL',
};
for (const responsibility of STAFF_RESPONSIBILITIES) RESPONSIBILITY_ALIASES[normalizeHeader(STAFF_RESPONSIBILITY_LABELS[responsibility])] = responsibility;

const TRUE_VALUES = new Set(['ja', 'j', 'yes', 'y', 'true', '1', 'x', 'wahr', 'aktiv', 'active']);
const FALSE_VALUES = new Set(['nein', 'n', 'no', 'false', '0', 'falsch', 'inaktiv', 'inactive', 'ausgeschieden', 'deaktiviert']);

/** Zerlegt CSV-Text (RFC 4180 mit frei wählbarem Trennzeichen) in Zeilen aus Zellen. */
export function parseCsv(text: string): string[][] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // Byte-Order-Marke von Excel-Exporten
  const firstLine = input.split(/\r?\n/, 1)[0] ?? '';
  const counts = { ';': (firstLine.match(/;/g) ?? []).length, ',': (firstLine.match(/,/g) ?? []).length, '\t': (firstLine.match(/\t/g) ?? []).length };
  const delimiter = counts[';'] >= counts[','] && counts[';'] >= counts['\t'] ? ';' : counts[','] >= counts['\t'] ? ',' : '\t';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i] as string;
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i += 1;
      row.push(cell);
      cell = '';
      if (row.some((value) => value.trim() !== '')) rows.push(row);
      row = [];
    } else cell += char;
  }
  row.push(cell);
  if (row.some((value) => value.trim() !== '')) rows.push(row);
  return rows;
}

const splitName = (full: string): { firstName: string; lastName: string } => {
  const text = full.trim();
  if (text.includes(',')) {
    const [last, first] = text.split(',', 2) as [string, string];
    return { firstName: first.trim(), lastName: last.trim() };
  }
  const parts = text.split(/\s+/);
  return parts.length === 1 ? { firstName: '', lastName: parts[0] ?? '' } : { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] as string };
};

function listOf(value: string): string[] {
  return value.split(/[;,|/]+/).map((part) => part.trim()).filter(Boolean);
}

export function parseStaffCsv(text: string): StaffCsvResult {
  const table = parseCsv(text);
  if (table.length === 0) return { rows: [], mapping: [], fatal: 'Die Datei ist leer.' };
  const header = table[0] as string[];
  const mapping = header.map((h) => ({ header: h.trim(), field: HEADER_FIELDS[normalizeHeader(h)] ?? null }));
  const fields = new Set(mapping.map((m) => m.field).filter(Boolean));
  if (!fields.has('fullName') && !(fields.has('firstName') && fields.has('lastName'))) return { rows: [], mapping, fatal: 'Es fehlen die Spalten für den Namen (Vorname und Nachname oder Name).' };
  if (table.length - 1 > MAX_ROWS) return { rows: [], mapping, fatal: `Die Datei hat mehr als ${MAX_ROWS} Zeilen. Bitte in Teilen importieren oder die Schnittstelle nutzen.` };

  const rows: StaffCsvRow[] = [];
  for (let index = 1; index < table.length; index += 1) {
    const cells = table[index] as string[];
    const get = (field: string): string => {
      const position = mapping.findIndex((m) => m.field === field);
      return position >= 0 ? (cells[position] ?? '').trim() : '';
    };
    const errors: string[] = [];
    const raw: Record<string, unknown> = {};
    const name = get('fullName') ? splitName(get('fullName')) : { firstName: '', lastName: '' };
    raw.firstName = get('firstName') || name.firstName;
    raw.lastName = get('lastName') || name.lastName;
    for (const field of ['externalId', 'roleTitle', 'email', 'phone', 'teamsAddress', 'whatsappNumber', 'calendarId', 'availabilityNote', 'supervisorRef', 'deputyRef']) raw[field] = get(field);

    const role = get('roleKind');
    if (role) {
      const kind = ROLE_ALIASES[normalizeHeader(role)];
      if (kind) raw.roleKind = kind;
      else {
        raw.roleKind = 'OTHER';
        // Eine unbekannte Rolle bleibt als Funktion erhalten statt verloren zu gehen.
        if (!raw.roleTitle) raw.roleTitle = role;
      }
    }
    const channel = get('preferredChannel');
    if (channel) {
      const kind = CHANNEL_ALIASES[normalizeHeader(channel)];
      if (kind) raw.preferredChannel = kind;
      else errors.push(`Unbekannter Kontaktweg „${channel}“ (erlaubt: E-Mail, Teams, WhatsApp, SMS, Anruf).`);
    }
    const responsibilities: string[] = [];
    for (const item of listOf(get('responsibilities'))) {
      const known = RESPONSIBILITY_ALIASES[normalizeHeader(item)];
      if (known) responsibilities.push(known);
      else errors.push(`Unbekannte Zuständigkeit „${item}“.`);
    }
    const emergency = normalizeHeader(get('emergency'));
    if (emergency) {
      if (TRUE_VALUES.has(emergency)) responsibilities.push('EMERGENCY');
      else if (!FALSE_VALUES.has(emergency)) errors.push(`„${get('emergency')}“ ist kein Ja/Nein für den Notdienst.`);
    }
    raw.responsibilities = [...new Set(responsibilities)];
    const active = normalizeHeader(get('active'));
    if (active) {
      if (TRUE_VALUES.has(active)) raw.active = true;
      else if (FALSE_VALUES.has(active)) raw.active = false;
      else errors.push(`„${get('active')}“ ist kein Ja/Nein für „aktiv“.`);
    }

    const parsed = StaffInputSchema.safeParse(raw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) errors.push(`${issue.path.join('.') || 'Zeile'}: ${issue.message}`);
      rows.push({ line: index + 1, errors });
      continue;
    }
    const problem = channelAddressProblem(parsed.data);
    if (problem) errors.push(problem);
    rows.push(errors.length > 0 ? { line: index + 1, errors } : { line: index + 1, staff: parsed.data, errors: [] });
  }
  return { rows, mapping };
}

/** Beispiel-Datei zum Herunterladen: zeigt die Spalten und gültige Werte. */
export const STAFF_CSV_TEMPLATE = [
  'Personalnummer;Vorname;Nachname;Rolle;Funktion;E-Mail;Mobil;Teams;WhatsApp;Bevorzugter Kanal;Zuständigkeiten;Notdienst;Kalender;Verfügbarkeit;Vorgesetzter;Vertretung;Aktiv',
  'P-001;Anna;Beispiel;Inhaber;Geschäftsführerin;anna@betrieb.example;+49 171 1234567;anna@betrieb.example;+49 171 1234567;WhatsApp;"Notfälle, Angebote";Ja;primary;Mo–Fr 7–17 Uhr;;P-002;Ja',
  'P-002;Ben;Muster;Monteur;Heizungsmonteur;ben@betrieb.example;+49 172 7654321;;;Anruf;Termine;Nein;ben@betrieb.example;Mo–Do 7–16 Uhr;P-001;;Ja',
].join('\r\n');
