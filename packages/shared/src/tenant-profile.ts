import { z } from 'zod';

/**
 * Betriebsprofil und Mitarbeiterverzeichnis: das Wissen, mit dem ORBIT im Sinne des Unternehmens entscheidet (Branche, Leistungen, Zeiten, Notdienst, Tonalität,
 * häufige Fragen) und weiß, wen es wofür wie erreicht (Rolle, Zuständigkeit, bevorzugter Kanal).
 */

export const STAFF_ROLE_KINDS = ['OWNER', 'MANAGER', 'DISPATCHER', 'TECHNICIAN', 'OFFICE', 'ACCOUNTING', 'SALES', 'OTHER'] as const;
export type StaffRoleKind = (typeof STAFF_ROLE_KINDS)[number];
export const STAFF_ROLE_LABELS: Readonly<Record<StaffRoleKind, string>> = {
  OWNER: 'Inhaber/Geschäftsführung',
  MANAGER: 'Leitung',
  DISPATCHER: 'Disposition/Einsatzplanung',
  TECHNICIAN: 'Monteur/Techniker',
  OFFICE: 'Büro/Verwaltung',
  ACCOUNTING: 'Buchhaltung',
  SALES: 'Vertrieb/Kalkulation',
  OTHER: 'Sonstige',
};

export const STAFF_CONTACT_CHANNELS = ['EMAIL', 'TEAMS', 'WHATSAPP', 'SMS', 'PHONE'] as const;
export type StaffContactChannel = (typeof STAFF_CONTACT_CHANNELS)[number];
export const STAFF_CHANNEL_LABELS: Readonly<Record<StaffContactChannel, string>> = { EMAIL: 'E-Mail', TEAMS: 'Microsoft Teams', WHATSAPP: 'WhatsApp', SMS: 'SMS', PHONE: 'Anruf' };

/** Wofür eine Person zuständig ist – danach richtet sich, wen ORBIT informiert. */
export const STAFF_RESPONSIBILITIES = ['EMERGENCY', 'QUOTES', 'INVOICES', 'APPLICATIONS', 'COMPLAINTS', 'APPOINTMENTS', 'GENERAL'] as const;
export type StaffResponsibility = (typeof STAFF_RESPONSIBILITIES)[number];
export const STAFF_RESPONSIBILITY_LABELS: Readonly<Record<StaffResponsibility, string>> = {
  EMERGENCY: 'Notfälle/Notdienst',
  QUOTES: 'Angebote/Kalkulation',
  INVOICES: 'Rechnungen',
  APPLICATIONS: 'Bewerbungen/Personal',
  COMPLAINTS: 'Reklamationen/Service',
  APPOINTMENTS: 'Termine/Einsatzplanung',
  GENERAL: 'Allgemeine Anfragen',
};

export const PROFILE_TONES = ['FORMAL', 'FRIENDLY'] as const;
export type ProfileTone = (typeof PROFILE_TONES)[number];
export const PROFILE_TONE_LABELS: Readonly<Record<ProfileTone, string>> = { FORMAL: 'Förmlich (Sie, sachlich)', FRIENDLY: 'Freundlich (Sie, persönlich und locker)' };

export const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export const WEEKDAY_LABELS: Readonly<Record<Weekday, string>> = { MON: 'Mo', TUE: 'Di', WED: 'Mi', THU: 'Do', FRI: 'Fr', SAT: 'Sa', SUN: 'So' };

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Uhrzeit im Format HH:MM');
export const OpeningHoursSchema = z.array(z.object({ days: z.array(z.enum(WEEKDAYS)).min(1).max(7), from: time, to: time }).strict()).max(14);
export type OpeningHours = z.infer<typeof OpeningHoursSchema>;

const shortText = (max: number) => z.string().trim().max(max);
const list = (maxItems: number, maxLength: number) => z.array(z.string().trim().min(1).max(maxLength)).max(maxItems);

export const UpdateTenantProfileSchema = z
  .object({
    industry: shortText(120).optional(),
    description: shortText(1500).optional(),
    services: list(60, 120).optional(),
    exclusions: list(40, 120).optional(),
    serviceArea: shortText(300).optional(),
    openingHours: OpeningHoursSchema.optional(),
    emergencyService: z.boolean().optional(),
    emergencyNote: shortText(500).optional(),
    tone: z.enum(PROFILE_TONES).optional(),
    languages: z.array(z.string().regex(/^[a-z]{2}$/)).min(1).max(10).optional(),
    faqs: z.array(z.object({ question: shortText(300).min(3), answer: shortText(1500).min(3) }).strict()).max(50).optional(),
  })
  .strict();
export type UpdateTenantProfileInput = z.infer<typeof UpdateTenantProfileSchema>;

const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal('').transform(() => undefined));
const phone = z.string().trim().regex(/^\+?[0-9 ()/.-]{5,25}$/, 'Rufnummer im Format +49 171 1234567');

export const StaffInputSchema = z
  .object({
    externalId: optionalText(80),
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().min(1).max(80),
    roleKind: z.enum(STAFF_ROLE_KINDS).default('OTHER'),
    roleTitle: optionalText(120),
    email: z.string().trim().toLowerCase().email().max(200).optional().or(z.literal('').transform(() => undefined)),
    phone: phone.optional().or(z.literal('').transform(() => undefined)),
    teamsAddress: z.string().trim().toLowerCase().email().max(200).optional().or(z.literal('').transform(() => undefined)),
    whatsappNumber: phone.optional().or(z.literal('').transform(() => undefined)),
    preferredChannel: z.enum(STAFF_CONTACT_CHANNELS).default('EMAIL'),
    responsibilities: z.array(z.enum(STAFF_RESPONSIBILITIES)).max(7).default([]),
    calendarId: optionalText(200),
    availabilityNote: optionalText(300),
    /** Verweis auf den Vorgesetzten / die Vertretung: Personalnummer oder E-Mail-Adresse einer anderen Person im Verzeichnis (beim Speichern aufgelöst). */
    supervisorRef: optionalText(200),
    deputyRef: optionalText(200),
    active: z.boolean().default(true),
  })
  .strict();
export type StaffInput = z.infer<typeof StaffInputSchema>;

/**
 * Ob der bevorzugte Kanal mit den vorhandenen Angaben überhaupt erreichbar ist (E-Mail braucht eine Adresse, WhatsApp/SMS/Anruf eine Nummer, Teams eine
 * Teams-Adresse). Ein nicht erreichbarer Wunsch ist ein Fehler bei der Erfassung, nicht erst im Notfall.
 */
export function channelAddressProblem(staff: Pick<StaffInput, 'preferredChannel' | 'email' | 'phone' | 'teamsAddress' | 'whatsappNumber'>): string | undefined {
  switch (staff.preferredChannel) {
    case 'EMAIL':
      return staff.email ? undefined : 'Für den Kanal E-Mail fehlt die E-Mail-Adresse.';
    case 'TEAMS':
      return staff.teamsAddress ? undefined : 'Für den Kanal Teams fehlt die Teams-Adresse.';
    case 'WHATSAPP':
      return staff.whatsappNumber || staff.phone ? undefined : 'Für den Kanal WhatsApp fehlt die Nummer.';
    case 'SMS':
    case 'PHONE':
      return staff.phone ? undefined : `Für den Kanal ${STAFF_CHANNEL_LABELS[staff.preferredChannel]} fehlt die Rufnummer.`;
  }
}

/** Das Profil als Text für die KI (Anweisungen an die Modelle, nie Daten der Kundschaft): was der Betrieb tut, wo, wann, wie er auftritt. */
export function profileForPrompt(profile: {
  industry?: string | null;
  description?: string | null;
  services?: string[];
  exclusions?: string[];
  serviceArea?: string | null;
  openingHours?: unknown;
  emergencyService?: boolean;
  emergencyNote?: string | null;
  tone?: string;
  languages?: string[];
  faqs?: unknown;
}): string {
  const parts: string[] = [];
  if (profile.industry) parts.push(`Branche: ${profile.industry}.`);
  if (profile.description) parts.push(`Der Betrieb: ${profile.description}`);
  if (profile.services && profile.services.length > 0) parts.push(`Leistungen: ${profile.services.join('; ')}.`);
  if (profile.exclusions && profile.exclusions.length > 0) parts.push(`Nicht im Angebot: ${profile.exclusions.join('; ')}.`);
  if (profile.serviceArea) parts.push(`Einsatzgebiet: ${profile.serviceArea}.`);
  const hours = OpeningHoursSchema.safeParse(profile.openingHours);
  if (hours.success && hours.data.length > 0) parts.push(`Erreichbar: ${hours.data.map((h) => `${h.days.map((d) => WEEKDAY_LABELS[d]).join('/')} ${h.from}–${h.to}`).join(', ')}.`);
  if (profile.emergencyService) parts.push(`Notdienst: ja${profile.emergencyNote ? ` (${profile.emergencyNote})` : ''}.`);
  else parts.push('Notdienst: nein – dringende Fälle werden so schnell wie möglich in den Geschäftszeiten bearbeitet.');
  if (profile.tone) parts.push(`Tonalität der Antworten: ${PROFILE_TONE_LABELS[profile.tone as ProfileTone] ?? profile.tone}.`);
  const faqs = z.array(z.object({ question: z.string(), answer: z.string() })).safeParse(profile.faqs);
  if (faqs.success && faqs.data.length > 0) parts.push(`Häufige Fragen und freigegebene Antworten: ${faqs.data.slice(0, 20).map((f) => `„${f.question}“ → ${f.answer}`).join(' | ')}`);
  return parts.join('\n');
}
