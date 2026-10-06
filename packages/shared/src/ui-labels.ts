/**
 * UI/UX v2 §3 — die zentrale Anzeige-Registry. Fachliche Schlüssel (Kategorien, Policy-Aktionen, Prozess- und
 * Fähigkeitsschlüssel) werden NIE verteilt per Stringersetzung übersetzt: jede Ansicht fragt diese Tabelle. Ein
 * unbekannter Schlüssel wird nicht erraten, sondern ehrlich als „Noch nicht zugeordnet“ gezeigt (Details im Detail).
 */

export const UNMAPPED_LABEL = 'Noch nicht zugeordnet';

/** Die zehn Funktionsbereiche (§3.1): Registry-Key → deutsches Standardlabel und Hauptfrage. */
export const MODULE_LABELS = {
  home: { label: 'Home', question: 'Was ist heute wichtig?' },
  inbox: { label: 'Posteingang', question: 'Was ist eingegangen und was wurde daraus?' },
  finance: { label: 'Finanzen', question: 'Welche Rechnungen und Ausnahmen brauchen Bearbeitung?' },
  sales: { label: 'Vertrieb', question: 'Welche Kundenanfragen und nächsten Schritte sind offen?' },
  approvals: { label: 'Freigaben', question: 'Welche konkrete Entscheidung wird von mir benötigt?' },
  tasks: { label: 'Aufgaben', question: 'Was muss ich bis wann erledigen?' },
  cases: { label: 'Vorgänge', question: 'Wie hängt die Arbeit zusammen und wo steht sie?' },
  activity: { label: 'Aktivitäten', question: 'Was ist tatsächlich passiert?' },
  integrations: { label: 'Systeme & Verbindungen', question: 'Welche vorhandenen Systeme sind verbunden?' },
  administration: { label: 'Administration', question: 'Wie wird ORBIT für das Unternehmen eingerichtet?' },
} as const;
export type ModuleKey = keyof typeof MODULE_LABELS;

/** Triage-Kategorien (Amendment 02 §5.2) – fachliche Anzeige statt Enum-Schlüssel. */
export const CATEGORY_LABELS: Readonly<Record<string, string>> = {
  REQUEST_FOR_QUOTE: 'Angebotsanfrage',
  SALES_INQUIRY: 'Vertriebsanfrage',
  INVOICE_RECEIVED: 'Rechnungseingang',
  SUPPLIER_OFFER: 'Lieferantenangebot',
  COMPLAINT_OR_SERVICE: 'Reklamation oder Service',
  APPLICATION: 'Bewerbung',
  NEWSLETTER_OR_MARKETING: 'Newsletter oder Werbung',
  PRIVATE: 'Privat',
  SPAM: 'Spam',
  UNKNOWN: UNMAPPED_LABEL,
  // Ältere Klassifikationen der Domänen-Agenten (vor der semantischen Triage).
  FINANCE: 'Finanzen',
  SALES: 'Vertrieb',
  OTHER: 'Sonstiges',
};

export const CASE_TYPE_DISPLAY: Readonly<Record<string, string>> = {
  FINANCE: 'Finanzen',
  SALES: 'Vertrieb',
  GENERAL: 'Allgemein',
};

/** Policy-Aktionen → verständliche Beschreibung dessen, was geschehen soll (Freigaben, Regeln). */
export const POLICY_ACTION_LABELS: Readonly<Record<string, string>> = {
  'email.classify': 'E-Mail einordnen',
  'lead.create': 'Interessenten anlegen',
  'followup.send': 'Nachricht versenden',
  'booking_proposal.create': 'Buchungsvorschlag erstellen',
  'invoice.transfer_to_fibu': 'Rechnung zur Buchhaltung übertragen',
  'supplier.bank_details.change': 'Bankverbindung eines Lieferanten ändern',
  'supplier.create': 'Lieferanten anlegen',
  'payment.execute': 'Zahlung ausführen',
  'crm.activity.log': 'Aktivität im CRM festhalten',
  'meeting.propose': 'Termin vorschlagen',
  'meeting.create': 'Termin anlegen',
  'invoice.intake': 'Rechnung erfassen',
  'crm.contact.manage': 'Kontakt pflegen',
  'task.create': 'Aufgabe anlegen',
  'calendar.read': 'Kalender lesen',
  'email.draft': 'Antwort vorbereiten',
  'copilot.read': 'Sonde liest Daten',
  'email.triage': 'E-Mail auf Relevanz prüfen',
  'context.lookup': 'Kontext nachschlagen',
  'requirements.resolve': 'Angaben prüfen',
  'pricing.resolve': 'Preise ermitteln',
  'quote.create': 'Angebot erstellen',
  'quote.render': 'Angebots-PDF erzeugen',
  'email.send.clarification': 'Rückfrage an den Kunden senden',
  'email.send.quote_delivery': 'Angebot an den Kunden senden',
  'process.plan': 'Ablauf planen',
  // Werkzeuge der Agenten und von Sonde, die als Freigabe (FOLLOW_UP) auftauchen können.
  create_booking_proposal: 'Buchungsvorschlag erstellen',
  send_email: 'Nachricht versenden',
  draft_email: 'Antwort vorbereiten',
  create_meeting: 'Termin vorschlagen',
  create_task: 'Aufgabe anlegen',
  create_contact: 'Kontakt anlegen',
  create_lead: 'Interessenten anlegen',
};

/** Freigabe-Entitätstypen → Objektbezeichnung. */
export const APPROVAL_ENTITY_LABELS: Readonly<Record<string, string>> = {
  INVOICE: 'Rechnung',
  BOOKING_PROPOSAL: 'Buchungsvorschlag',
  SUPPLIER: 'Lieferant',
  FOLLOW_UP: 'Nachricht',
  PROCESS_ACTION: 'Vorbereitete Aktion',
  MEETING: 'Termin',
};

export const INTAKE_STATUS_LABELS: Readonly<Record<string, string>> = {
  RECEIVED: 'Neu',
  PENDING_TRIAGE: 'Wird geprüft',
  TRIAGED: 'Eingeordnet',
  ROUTED: 'In Bearbeitung',
  PROCESSING: 'In Bearbeitung',
  COMPLETED: 'Verarbeitet',
  SKIPPED_NON_ACTIONABLE: 'Keine Aktion nötig',
  NEEDS_REVIEW: 'Prüfung erforderlich',
  FAILED: 'Bearbeitung fehlgeschlagen',
};

export const RELEVANCE_LABELS: Readonly<Record<string, string>> = {
  BUSINESS_ACTIONABLE: 'Geschäftlich, Handlung nötig',
  BUSINESS_INFORMATIONAL: 'Geschäftlich, zur Information',
  NON_ACTIONABLE: 'Keine Handlung nötig',
  PRIVATE_PERSONAL: 'Privat',
  UNKNOWN_REQUIRES_REVIEW: 'Unklar, bitte prüfen',
};

export const CONNECTOR_LABELS: Readonly<Record<string, string>> = {
  DATEV: 'DATEV',
  LEXWARE: 'Lexware',
  MICROSOFT: 'Microsoft 365',
  GMAIL: 'Gmail',
  GOOGLE_CALENDAR: 'Google Kalender',
  HUBSPOT: 'HubSpot',
  TWILIO: 'Twilio',
};

/** Vergangenheitsform einer bestätigten Aktion (Zuletzt erledigt, §6.8). Nur mit Nachweis (Receipt) verwenden. */
export const COMPLETED_ACTION_LABELS: Readonly<Record<string, string>> = {
  'email.send.clarification': 'Rückfrage versandt',
  'email.send.quote_delivery': 'Angebot versandt',
  'quote.create': 'Angebot erstellt',
  'quote.render': 'Angebots-PDF erzeugt',
  'meeting.create': 'Termin angelegt',
  'task.create': 'Aufgabe angelegt',
  'invoice.transfer_to_fibu': 'Rechnung zur Buchhaltung übertragen',
};

export const EXECUTION_MODE_LABELS: Readonly<Record<string, string>> = {
  LIVE: 'Live',
  SIMULATED: 'Simuliert',
  TEST: 'Testbetrieb',
};

/** Sonde-Modi (§8.3): deutsches Anzeigelabel; der interne Key bleibt unverändert. */
export const SONDE_MODE_LABELS = {
  ASK: { label: 'Fragen', hint: 'Antworten und Zusammenfassungen, ohne etwas zu verändern.' },
  PREPARE: { label: 'Vorbereiten', hint: 'Entwürfe und Vorschläge erstellen, ohne etwas auszuführen.' },
  ACT: { label: 'Ausführen', hint: 'Erlaubte Aktionen ausführen; externe Wirkungen brauchen weiterhin Ihre Freigabe.' },
  DELEGATE: { label: 'Beauftragen', hint: 'Einen Ablauf im Hintergrund beauftragen.' },
  NAVIGATE: { label: 'Navigieren', hint: 'Zu einer Ansicht oder einem Objekt springen.' },
} as const;
export type SondeModeKey = keyof typeof SONDE_MODE_LABELS;

function lookup(table: Readonly<Record<string, string>>, key: string | null | undefined): string {
  if (!key) return UNMAPPED_LABEL;
  return table[key] ?? UNMAPPED_LABEL;
}

/** Fehlercodes der Verbindungen in Alltagssprache; unbekannte Codes werden nie roh angezeigt. */
export const INTEGRATION_ERROR_LABELS: Readonly<Record<string, string>> = {
  AUTH_REQUIRED: 'Anmeldung beim Anbieter erforderlich',
  TOKEN_REFRESH_FAILED: 'Zugriff abgelaufen – bitte neu verbinden',
};
export const integrationErrorLabel = (code: string | null | undefined): string => (code && INTEGRATION_ERROR_LABELS[code]) || 'Technischer Fehler bei der Verbindung';

export const categoryLabel = (key: string | null | undefined): string => lookup(CATEGORY_LABELS, key);
export const caseTypeDisplay = (key: string | null | undefined): string => lookup(CASE_TYPE_DISPLAY, key);
export const policyActionLabel = (key: string | null | undefined): string => lookup(POLICY_ACTION_LABELS, key);
export const approvalEntityLabel = (key: string | null | undefined): string => lookup(APPROVAL_ENTITY_LABELS, key);
export const intakeStatusLabel = (key: string | null | undefined): string => lookup(INTAKE_STATUS_LABELS, key);
export const relevanceLabel = (key: string | null | undefined): string => lookup(RELEVANCE_LABELS, key);
export const connectorLabel = (key: string | null | undefined): string => (key && CONNECTOR_LABELS[key]) || UNMAPPED_LABEL;
export const executionModeLabel = (key: string | null | undefined): string => lookup(EXECUTION_MODE_LABELS, key);

/**
 * Begrüßung nach lokaler Uhrzeit (§6.4). Ohne Vornamen bleibt es bei „Guten Morgen“ – kein erfundener Name und nie die
 * E-Mail-Adresse als Überschrift (GAP-08).
 */
export function greeting(hour: number, firstName?: string | null): string {
  const base = hour < 11 ? 'Guten Morgen' : hour < 18 ? 'Guten Tag' : 'Guten Abend';
  const name = firstName?.trim();
  return name ? `${base}, ${name}` : base;
}

/** Risikohinweise der Triage (Amendment 02 §5) in Alltagssprache. */
export const RISK_FLAG_LABELS: Readonly<Record<string, string>> = {
  PROMPT_INJECTION_SUSPECTED: 'Verdacht auf einen Manipulationsversuch',
  PHISHING_SUSPECTED: 'Phishing-Verdacht',
  IDENTITY_MISMATCH: 'Absender passt nicht zur angegebenen Identität',
  AUTO_RESPONDER: 'Automatische Antwort',
  MULTIPLE_INTENTS: 'Mehrere Anliegen in einer Nachricht',
  UNSUPPORTED_LANGUAGE: 'Nicht unterstützte Sprache',
};

export const riskFlagLabel = (key: string | null | undefined): string => (key && RISK_FLAG_LABELS[key]) || UNMAPPED_LABEL;

const KNOWN_KEY_PATTERN = new RegExp(String.raw`\b(${Object.keys(RISK_FLAG_LABELS).join('|')})\b`, 'g');

/**
 * Sicherheitsnetz für Freitext aus dem Bestand (Aufgabentitel, Begründungen): bekannte technische Risikoschlüssel werden durch ihre
 * verständliche Bezeichnung ersetzt (UI v2 §3.2: keine sichtbaren Enum-Schlüssel). Unbekannte Wörter bleiben unverändert.
 */
export function humanizeKnownKeys(text: string): string {
  return text.replace(KNOWN_KEY_PATTERN, (key) => RISK_FLAG_LABELS[key] ?? key);
}
