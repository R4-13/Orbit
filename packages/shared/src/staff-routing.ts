import { z } from 'zod';
import type { StaffContactChannel, StaffResponsibility, StaffRoleKind } from './tenant-profile';

/**
 * Wen ORBIT wofür informiert und wen als Nächstes, wenn niemand reagiert (reine Funktionen, ohne Datenbank).
 *
 * Kette bei Stillstand: zuständige Person → ihre Vertretung (die Person kann krank sein) → ihr Vorgesetzter → Inhaber/Leitung. Oft sind mehrere Bereiche beteiligt
 * (z. B. Buchhaltung und Einsatzplanung): jede Zuständigkeit hat ihre eigene Kette.
 */

export interface RoutableStaff {
  id: string;
  firstName: string;
  lastName: string;
  roleKind: StaffRoleKind;
  roleTitle?: string | null;
  responsibilities: readonly string[];
  supervisorId?: string | null;
  deputyId?: string | null;
  active: boolean;
  preferredChannel: StaffContactChannel;
  email?: string | null;
  phone?: string | null;
  teamsAddress?: string | null;
  whatsappNumber?: string | null;
}

const escalationShape = {
  /** Nach so vielen Minuten ohne Reaktion erinnert ORBIT die zuständige Person (und informiert ihre Vertretung). */
  reminderAfterMinutes: z.number().int().min(5).max(7 * 24 * 60),
  /** Nach so vielen Minuten ohne Reaktion geht die Meldung an den Vorgesetzten. */
  escalateAfterMinutes: z.number().int().min(10).max(14 * 24 * 60),
  /** Notfälle: deutlich kürzer. */
  emergencyReminderMinutes: z.number().int().min(1).max(240),
  emergencyEscalateMinutes: z.number().int().min(2).max(480),
};
export const EscalationPolicySchema = z
  .object(escalationShape)
  .strict()
  .refine((p) => p.escalateAfterMinutes > p.reminderAfterMinutes && p.emergencyEscalateMinutes > p.emergencyReminderMinutes, 'Die Eskalation muss nach der Erinnerung liegen.');
/** Eingabe beim Speichern: einzelne Werte genügen, der Rest bleibt wie er ist (die Gesamtprüfung folgt nach dem Zusammenführen). */
export const EscalationPolicyInputSchema = z.object(escalationShape).partial().strict();
export type EscalationPolicy = z.infer<typeof EscalationPolicySchema>;

/** Vorsichtige Standardwerte, solange der Betrieb nichts anderes festlegt: Erinnerung nach 4 Stunden, Eskalation nach 24; Notfall 15 bzw. 45 Minuten. */
export const DEFAULT_ESCALATION_POLICY: EscalationPolicy = { reminderAfterMinutes: 240, escalateAfterMinutes: 1440, emergencyReminderMinutes: 15, emergencyEscalateMinutes: 45 };

export function resolveEscalationPolicy(stored: unknown): EscalationPolicy {
  const parsed = EscalationPolicySchema.safeParse({ ...DEFAULT_ESCALATION_POLICY, ...(typeof stored === 'object' && stored !== null ? stored : {}) });
  return parsed.success ? parsed.data : DEFAULT_ESCALATION_POLICY;
}

const LEADERSHIP: readonly StaffRoleKind[] = ['OWNER', 'MANAGER'];

const nameOf = (s: Pick<RoutableStaff, 'firstName' | 'lastName'>) => `${s.firstName} ${s.lastName}`.trim();

/**
 * Wer ist für einen Bereich zuständig? Die Personen mit dieser Zuständigkeit; gibt es niemanden, die Leitung (Inhaber, Leitung) – ein Eingang bleibt nie ohne
 * Adressat. Ohne aktive Leitung: leere Liste (der Aufrufer meldet das als Lücke im Verzeichnis).
 */
export function responsiblesFor(directory: readonly RoutableStaff[], responsibility: StaffResponsibility): RoutableStaff[] {
  const active = directory.filter((s) => s.active);
  const direct = active.filter((s) => s.responsibilities.includes(responsibility));
  if (direct.length > 0) return direct;
  const general = active.filter((s) => s.responsibilities.includes('GENERAL'));
  if (general.length > 0) return general;
  const leaders = active.filter((s) => LEADERSHIP.includes(s.roleKind));
  return leaders.sort((a, b) => LEADERSHIP.indexOf(a.roleKind) - LEADERSHIP.indexOf(b.roleKind));
}

export interface EscalationStep {
  /** 0 = zuständige Person, danach Vertretung, Vorgesetzter, Leitung. */
  level: 0 | 1 | 2 | 3;
  role: 'RESPONSIBLE' | 'DEPUTY' | 'SUPERVISOR' | 'LEADERSHIP';
  staff: RoutableStaff;
}

/**
 * Die Eskalationskette einer zuständigen Person: sie selbst, ihre Vertretung, ihr Vorgesetzter, die Leitung. Inaktive Personen (ausgeschieden) werden übersprungen,
 * jede Person kommt nur einmal vor (die höchste Stufe, auf der sie auftaucht, ist die früheste).
 */
export function escalationChain(directory: readonly RoutableStaff[], responsibleId: string): EscalationStep[] {
  const byId = new Map(directory.map((s) => [s.id, s]));
  const steps: EscalationStep[] = [];
  const seen = new Set<string>();
  const push = (level: EscalationStep['level'], role: EscalationStep['role'], staff: RoutableStaff | undefined) => {
    if (!staff || !staff.active || seen.has(staff.id)) return;
    seen.add(staff.id);
    steps.push({ level, role, staff });
  };
  const responsible = byId.get(responsibleId);
  push(0, 'RESPONSIBLE', responsible);
  push(1, 'DEPUTY', responsible?.deputyId ? byId.get(responsible.deputyId) : undefined);
  push(2, 'SUPERVISOR', responsible?.supervisorId ? byId.get(responsible.supervisorId) : undefined);
  // Hat die Kette keinen Vorgesetzten, ist es die Leitung; ist die Person selbst die Leitung, gibt es keine weitere Stufe.
  for (const leader of directory.filter((s) => s.active && LEADERSHIP.includes(s.roleKind)).sort((a, b) => LEADERSHIP.indexOf(a.roleKind) - LEADERSHIP.indexOf(b.roleKind))) push(3, 'LEADERSHIP', leader);
  return steps;
}

export type EscalationPhase = 'INITIAL' | 'REMINDER' | 'ESCALATED';

/** Wie weit ist die Eskalation nach dieser Wartezeit? (Minuten seit der ersten Meldung.) */
export function escalationPhase(minutesWaiting: number, policy: EscalationPolicy, emergency: boolean): EscalationPhase {
  const reminder = emergency ? policy.emergencyReminderMinutes : policy.reminderAfterMinutes;
  const escalate = emergency ? policy.emergencyEscalateMinutes : policy.escalateAfterMinutes;
  if (minutesWaiting >= escalate) return 'ESCALATED';
  if (minutesWaiting >= reminder) return 'REMINDER';
  return 'INITIAL';
}

/** Wer wird in welcher Phase informiert? Erinnerung: zuständige Person und Vertretung; Eskalation: zusätzlich Vorgesetzter und Leitung. */
export function recipientsForPhase(chain: readonly EscalationStep[], phase: EscalationPhase): EscalationStep[] {
  if (phase === 'INITIAL') return chain.filter((s) => s.level === 0);
  if (phase === 'REMINDER') return chain.filter((s) => s.level <= 1);
  return [...chain];
}

export type DeliveryChannel = 'EMAIL' | 'TEAMS' | 'WHATSAPP' | 'SMS' | 'PHONE';

/** Kanäle, über die ORBIT heute tatsächlich zustellt (angebundener Anbieter). Die übrigen sind erfassbar, werden aber per E-Mail zugestellt, bis ein Anbieter angebunden ist. */
export const LIVE_DELIVERY_CHANNELS: readonly DeliveryChannel[] = ['EMAIL'];

export interface DeliveryPlan {
  /** Der Kanal, über den tatsächlich zugestellt wird. */
  via: DeliveryChannel;
  address: string;
  /** Der gewünschte Kanal, falls abweichend – ehrlich ausgewiesen („WhatsApp gewünscht, per E-Mail zugestellt“). */
  wanted?: DeliveryChannel;
  /** Warum abgewichen wurde. */
  note?: string;
}

/**
 * Wie wird zugestellt? Der bevorzugte Kanal, wenn er angebunden ist; sonst – ehrlich ausgewiesen – die E-Mail. `connected` nennt die Kanäle mit angebundenem Anbieter (heute: E-Mail).
 * Ohne erreichbaren Kanal: `undefined` (eine Lücke im Verzeichnis, die gemeldet wird).
 */
export function planDelivery(staff: RoutableStaff, connected: ReadonlySet<DeliveryChannel>): DeliveryPlan | undefined {
  const address: Record<DeliveryChannel, string | null | undefined> = { EMAIL: staff.email, TEAMS: staff.teamsAddress, WHATSAPP: staff.whatsappNumber ?? staff.phone, SMS: staff.phone, PHONE: staff.phone };
  const wanted = staff.preferredChannel;
  if (connected.has(wanted) && address[wanted]) return { via: wanted, address: address[wanted] as string };
  if (connected.has('EMAIL') && staff.email) {
    return wanted === 'EMAIL' ? { via: 'EMAIL', address: staff.email } : { via: 'EMAIL', address: staff.email, wanted, note: `Gewünscht ist ${wanted}; dieser Kanal ist noch nicht angebunden, deshalb per E-Mail.` };
  }
  return undefined;
}

export const describeStep = (step: EscalationStep): string => `${nameOf(step.staff)} (${{ RESPONSIBLE: 'zuständig', DEPUTY: 'Vertretung', SUPERVISOR: 'Vorgesetzte/r', LEADERSHIP: 'Leitung' }[step.role]})`;

// ---------------------------------------------------------------- Wer ist für diesen Vorgang zuständig, und was steht in der Meldung?

export const ATTENTION_KINDS = ['MANUAL_REVIEW', 'WAITING_FOR_APPROVAL', 'FAILED', 'EMERGENCY'] as const;
export type AttentionKind = (typeof ATTENTION_KINDS)[number];

/**
 * Zuständigkeit für einen Vorgang: Notfälle gehen an die Notfallzuständigen, sonst richtet sich die Zuständigkeit nach der erkannten Kategorie, ersatzweise nach der Art des
 * Vorgangs. Was nirgends passt, geht an „Allgemein“ (und weiter an die Leitung, siehe `responsiblesFor`).
 */
export function responsibilityForCase(input: { category?: string | null; caseType?: string | null; emergency?: boolean }): StaffResponsibility {
  if (input.emergency) return 'EMERGENCY';
  switch (input.category) {
    case 'INVOICE_RECEIVED':
    case 'SUPPLIER_OFFER':
      return 'INVOICES';
    case 'REQUEST_FOR_QUOTE':
    case 'SALES_INQUIRY':
      return 'QUOTES';
    case 'APPLICATION':
      return 'APPLICATIONS';
    case 'COMPLAINT_OR_SERVICE':
      return 'COMPLAINTS';
    default:
      return input.caseType === 'FINANCE' ? 'INVOICES' : input.caseType === 'SALES' ? 'QUOTES' : 'GENERAL';
  }
}

export interface StaffNoticeInput {
  phase: EscalationPhase;
  kind: AttentionKind;
  role: EscalationStep['role'];
  recipientFirstName: string;
  caseTitle: string;
  reason?: string | null;
  waitingMinutes: number;
  /** Wer zuerst zuständig war – bei Vertretung und Eskalation wichtig („Anna Beispiel hat nicht reagiert“). */
  responsibleName?: string;
  link: string;
  appName: string;
}

const KIND_TEXT: Record<AttentionKind, string> = {
  MANUAL_REVIEW: 'braucht Ihre Prüfung',
  WAITING_FOR_APPROVAL: 'wartet auf eine Freigabe',
  FAILED: 'ist fehlgeschlagen und braucht eine Entscheidung',
  EMERGENCY: 'ist ein Notfall',
};

export function formatWaiting(minutes: number): string {
  if (minutes < 90) return `${Math.max(1, Math.round(minutes))} Minuten`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} Stunden`;
  return `${Math.round(minutes / 1440)} Tagen`;
}

/** Text einer Meldung an eine Person (E-Mail): kurz, mit Grund, Wartezeit und Link – und bei Vertretung/Eskalation mit dem Hinweis, warum gerade diese Person angesprochen wird. */
export function composeStaffNotice(input: StaffNoticeInput): { subject: string; text: string } {
  const emergency = input.kind === 'EMERGENCY';
  const waited = formatWaiting(input.waitingMinutes);
  const prefix = emergency ? 'NOTFALL' : input.phase === 'ESCALATED' ? 'Eskalation' : input.phase === 'REMINDER' ? 'Erinnerung' : 'Neu';
  // Der Vorgangstitel eines Notfalls beginnt selbst mit „Notfall:“ – im Betreff nicht doppeln.
  const title = emergency ? input.caseTitle.replace(/^notfall:\s*/i, '') : input.caseTitle;
  const subject = `${prefix}: ${title}`.slice(0, 150);
  const why =
    input.phase === 'INITIAL'
      ? ''
      : input.role === 'RESPONSIBLE'
        ? `Dieser Vorgang wartet seit ${waited} auf Sie.`
        : input.role === 'DEPUTY'
          ? `Sie sind als Vertretung eingetragen${input.responsibleName ? ` für ${input.responsibleName}` : ''}. Der Vorgang wartet seit ${waited}, bisher gab es keine Reaktion.`
          : `${input.responsibleName ? `${input.responsibleName} hat` : 'Die zuständige Person hat'} seit ${waited} nicht reagiert (auch die Vertretung nicht), deshalb melden wir uns bei Ihnen.`;
  const lines = [
    `Guten Tag ${input.recipientFirstName},`,
    '',
    emergency ? `${input.appName} hat einen Notfall erkannt: „${input.caseTitle}“.` : `Der Vorgang „${input.caseTitle}“ ${KIND_TEXT[input.kind]}.`,
    ...(input.reason ? [`Grund: ${input.reason}`] : []),
    ...(why ? ['', why] : []),
    '',
    `Vorgang öffnen: ${input.link}`,
    '',
    input.phase === 'INITIAL' ? `${input.appName} wartet nicht untätig: Es prüft laufend, ob sich der Stand ändert, und meldet sich bei ausbleibender Reaktion erneut.` : `${input.appName} meldet sich weiter, bis der Vorgang übernommen ist.`,
  ];
  return { subject, text: lines.join('\n') };
}
