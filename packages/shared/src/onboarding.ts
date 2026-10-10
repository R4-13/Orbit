import type { z } from 'zod';
import { EscalationPolicyInputSchema, escalationChain, type RoutableStaff } from './staff-routing';
import { OpeningHoursSchema, UpdateTenantProfileSchema, channelAddressProblem } from './tenant-profile';

/** Anfrage zum Speichern des Betriebsprofils: Profilfelder plus (teilweise) die Zeiten für Erinnerung und Eskalation. */
export const UpdateTenantProfileRequestSchema = UpdateTenantProfileSchema.extend({ escalationPolicy: EscalationPolicyInputSchema.optional() });
export type UpdateTenantProfileRequest = z.infer<typeof UpdateTenantProfileRequestSchema>;

/**
 * Einrichtung eines Betriebs: was ORBIT wissen muss, um im Sinne des Unternehmens zu arbeiten, und welche Lücken im Verzeichnis dazu führen würden, dass eine
 * Meldung niemanden erreicht. Reine Funktionen – das Ergebnis erscheint als Checkliste in der Verwaltung und als Hinweis auf der Startseite.
 */

export interface OnboardingStep {
  key: 'INDUSTRY' | 'SERVICES' | 'HOURS' | 'AUTOMATION' | 'STAFF' | 'REACHABILITY' | 'EMERGENCY';
  label: string;
  done: boolean;
  /** Was zu tun ist, wenn der Schritt offen ist. */
  hint: string;
  href: string;
}

export interface OnboardingInput {
  profile: { industry?: string | null; services?: string[]; openingHours?: unknown; emergencyService?: boolean } | null;
  staff: readonly RoutableStaff[];
  /** Ob die Regeln bewusst gewählt wurden (der Automatisierungsgrad ist immer gesetzt; „bestätigt“ heißt: das Profil wurde einmal gespeichert). */
  automationConfirmed: boolean;
}

/** Lücken im Verzeichnis, die im Ernstfall verhindern, dass jemand erreicht wird. Jede Meldung ist ein vollständiger Satz. */
export function directoryGaps(staff: readonly RoutableStaff[], options: { emergencyService?: boolean } = {}): string[] {
  const gaps: string[] = [];
  const active = staff.filter((s) => s.active);
  if (active.length === 0) return ['Es ist noch keine Person erfasst.'];
  if (!active.some((s) => s.roleKind === 'OWNER' || s.roleKind === 'MANAGER')) gaps.push('Es fehlt eine Person mit der Rolle Inhaber oder Leitung – sie ist die letzte Stufe, wenn niemand reagiert.');
  for (const s of active) {
    const problem = channelAddressProblem({ preferredChannel: s.preferredChannel, email: s.email ?? undefined, phone: s.phone ?? undefined, teamsAddress: s.teamsAddress ?? undefined, whatsappNumber: s.whatsappNumber ?? undefined });
    if (problem) gaps.push(`${s.firstName} ${s.lastName}: ${problem}`);
    else if (!s.email) gaps.push(`${s.firstName} ${s.lastName} hat keine E-Mail-Adresse; heute ist E-Mail der einzige angebundene Kanal, Meldungen würden sie nicht erreichen.`);
  }
  if (options.emergencyService && !active.some((s) => s.responsibilities.includes('EMERGENCY'))) {
    gaps.push('Der Betrieb bietet einen Notdienst an, aber keine Person ist für Notfälle zuständig.');
  }
  // Wer ohne Vertretung und ohne Vorgesetzten dasteht, kann bei Krankheit nicht aufgefangen werden – nur ein Hinweis für Personen mit Zuständigkeit.
  for (const s of active.filter((p) => p.responsibilities.length > 0 && p.roleKind !== 'OWNER')) {
    const chain = escalationChain(active, s.id);
    if (chain.length < 3) gaps.push(`${s.firstName} ${s.lastName} ist zuständig, hat aber keine Vertretung oder keinen Vorgesetzten; fällt die Person aus, bleibt die Meldung liegen.`);
  }
  return gaps;
}

export function onboardingChecklist(input: OnboardingInput): { steps: OnboardingStep[]; doneCount: number; complete: boolean; gaps: string[] } {
  const { profile, staff } = input;
  const hours = OpeningHoursSchema.safeParse(profile?.openingHours);
  const active = staff.filter((s) => s.active);
  const gaps = directoryGaps(staff, { emergencyService: profile?.emergencyService });
  const reachable = active.length > 0 && gaps.filter((g) => /fehlt|keine E-Mail/.test(g)).length === 0;
  const steps: OnboardingStep[] = [
    { key: 'INDUSTRY', label: 'Branche angeben', done: Boolean(profile?.industry?.trim()), hint: 'Die Branche bestimmt, wie ORBIT Anfragen versteht (z. B. Dachdecker, Heizung und Sanitär, KFZ-Werkstatt).', href: '/admin/company' },
    { key: 'SERVICES', label: 'Leistungen beschreiben', done: (profile?.services?.length ?? 0) > 0, hint: 'Nennen Sie, was Sie anbieten – und was nicht. So erkennt ORBIT, ob eine Anfrage zu Ihnen passt.', href: '/admin/company' },
    { key: 'HOURS', label: 'Erreichbarkeit und Notdienst festlegen', done: hours.success && hours.data.length > 0, hint: 'Öffnungszeiten und ob es einen Notdienst gibt – danach richtet sich, wie schnell ORBIT Menschen informiert.', href: '/admin/company' },
    { key: 'AUTOMATION', label: 'Automatisierungsgrad wählen', done: input.automationConfirmed, hint: 'Vorsichtig, Ausgewogen oder Hochautomatisiert – wie selbstständig ORBIT arbeiten soll.', href: '/admin/policies' },
    { key: 'STAFF', label: 'Mitarbeiter erfassen', done: active.length > 0, hint: 'Manuell, per CSV-Datei oder über die Schnittstelle – mit Rolle, Zuständigkeit und gewünschtem Kontaktweg.', href: '/admin/staff' },
    { key: 'REACHABILITY', label: 'Erreichbarkeit der Mitarbeiter prüfen', done: reachable, hint: 'Jede Person braucht eine Adresse für den gewählten Kontaktweg und es braucht eine Leitung.', href: '/admin/staff' },
    { key: 'EMERGENCY', label: 'Notfallzuständigkeit klären', done: !profile?.emergencyService || active.some((s) => s.responsibilities.includes('EMERGENCY')), hint: 'Wer wird informiert, wenn ein Notfall eingeht?', href: '/admin/staff' },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  return { steps, doneCount, complete: doneCount === steps.length, gaps };
}
