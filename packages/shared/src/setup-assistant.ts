import type { PolicyMode } from './policy';
import type { onboardingChecklist } from './onboarding';

/**
 * Einrichtungsassistent: führt durch alles, was ORBIT über den Betrieb und seine Systeme wissen muss, und zeigt am Ende ehrlich, **was ORBIT damit übernimmt** – und was nicht.
 * Die Aufgaben richten sich nach der Ausstattung des Betriebs (angeschlossene Systeme, Regeln): ohne Kalender schlägt ORBIT keine Termine aus dem Kalender vor, ohne CRM führt es die
 * Anfragen in der eigenen Kundenverwaltung. Reine Funktionen – dieselbe Eingabe ergibt dasselbe Ergebnis.
 */

export type SetupStepKey = 'PROFILE' | 'STAFF' | 'MAIL' | 'CALENDAR' | 'CRM' | 'RULES';
export type SetupStepStatus = 'DONE' | 'PARTIAL' | 'OPEN';

export interface SetupItem {
  label: string;
  done: boolean;
}

export interface SetupStep {
  key: SetupStepKey;
  title: string;
  /** Warum ORBIT das wissen muss – in Worten des Betriebs. */
  why: string;
  /** Pflicht für den Start; optionale Schritte erweitern, was ORBIT übernehmen kann. */
  required: boolean;
  status: SetupStepStatus;
  items: SetupItem[];
  action: { label: string; href: string };
}

export type SetupTaskState = 'AUTOMATIC' | 'WITH_APPROVAL' | 'BY_HAND' | 'UNAVAILABLE';

export interface SetupTask {
  key: 'READ_MAIL' | 'ASK_BACK' | 'ANSWER' | 'PROPOSE_SLOTS' | 'BOOK' | 'HANDOFF' | 'NOTIFY';
  title: string;
  state: SetupTaskState;
  /** Was das für den Betrieb heißt (inkl. Grund, wenn etwas nicht möglich ist). */
  detail: string;
  /** Wie sich die Aufgabe freischalten oder erweitern lässt. */
  unlock?: { label: string; stepKey: SetupStepKey };
}

export interface SetupAssessment {
  steps: SetupStep[];
  tasks: SetupTask[];
  requiredDone: number;
  requiredTotal: number;
  /** Alle Pflichtschritte erledigt. */
  ready: boolean;
}

export interface SetupInput {
  onboarding: Pick<ReturnType<typeof onboardingChecklist>, 'steps' | 'gaps'>;
  integrations: {
    gmail?: { connected: boolean; granted: readonly string[] };
    hubspot?: { connected: boolean };
  };
  /** Ob die Fähigkeit für den Betrieb jetzt wirklich ausführbar ist (Verbindung, Berechtigung, Regel). */
  capabilities: Readonly<Record<string, boolean | undefined>>;
  /** Wirksamer Modus je Regel (z. B. `meeting.create`). */
  modes: Readonly<Record<string, PolicyMode | undefined>>;
  staffCount: number;
}

const stepDone = (onboarding: SetupInput['onboarding'], key: string): boolean => onboarding.steps.find((s) => s.key === key)?.done ?? false;

const statusOf = (items: readonly SetupItem[]): SetupStepStatus => (items.every((i) => i.done) ? 'DONE' : items.some((i) => i.done) ? 'PARTIAL' : 'OPEN');

/** Wie weit die Regel ORBIT allein arbeiten lässt. */
function modeState(mode: PolicyMode | undefined): { state: SetupTaskState; text: string } {
  if (mode === 'AUTONOMOUS') return { state: 'AUTOMATIC', text: 'ORBIT erledigt das selbstständig.' };
  if (mode === 'REQUIRE_APPROVAL') return { state: 'WITH_APPROVAL', text: 'ORBIT bereitet es vor; vor der Ausführung geben Sie frei.' };
  return { state: 'BY_HAND', text: 'Nach Ihren Regeln schlägt ORBIT es nur vor oder macht es nicht – Sie erledigen es selbst.' };
}

export function buildSetupAssessment(input: SetupInput): SetupAssessment {
  const { onboarding, integrations, capabilities, modes } = input;
  const gmail = integrations.gmail;
  const granted = new Set(gmail?.granted ?? []);
  const gmailConnected = gmail?.connected === true;

  const profileItems: SetupItem[] = [
    { label: 'Branche', done: stepDone(onboarding, 'INDUSTRY') },
    { label: 'Leistungen', done: stepDone(onboarding, 'SERVICES') },
    { label: 'Öffnungszeiten und Notdienst', done: stepDone(onboarding, 'HOURS') },
  ];
  const staffItems: SetupItem[] = [
    { label: 'Mitarbeitende erfasst', done: stepDone(onboarding, 'STAFF') },
    { label: 'Jede Person ist erreichbar, eine Leitung ist festgelegt', done: stepDone(onboarding, 'REACHABILITY') },
    { label: 'Zuständigkeit für Notfälle geklärt', done: stepDone(onboarding, 'STAFF') && stepDone(onboarding, 'EMERGENCY') },
  ];
  const mailItems: SetupItem[] = [
    { label: 'Gmail verbunden', done: gmailConnected },
    { label: 'Mails lesen erlaubt', done: gmailConnected && granted.has('email.read') },
    { label: 'Mails senden erlaubt', done: gmailConnected && granted.has('email.send') },
  ];
  const calendarItems: SetupItem[] = [
    { label: 'Freie und belegte Zeiten lesen', done: gmailConnected && granted.has('calendar.freebusy') },
    { label: 'Termine anlegen', done: gmailConnected && granted.has('calendar.write') },
  ];
  const crmItems: SetupItem[] = [{ label: 'HubSpot verbunden', done: integrations.hubspot?.connected === true }];
  const rulesItems: SetupItem[] = [{ label: 'Automatisierungsgrad gewählt', done: stepDone(onboarding, 'AUTOMATION') }];

  const steps: SetupStep[] = [
    {
      key: 'PROFILE',
      title: 'Ihr Betrieb',
      why: 'Branche und Leistungen bestimmen, wie ORBIT Anfragen versteht und ob sie zu Ihnen passen. Öffnungszeiten und Notdienst bestimmen, wie schnell Menschen informiert werden.',
      required: true,
      status: statusOf(profileItems),
      items: profileItems,
      action: { label: 'Betriebsprofil bearbeiten', href: '/admin/company' },
    },
    {
      key: 'STAFF',
      title: 'Ihre Mitarbeitenden',
      why: 'ORBIT muss wissen, wen es bei welchem Thema erreicht – und wer vertritt, wenn niemand reagiert.',
      required: true,
      status: statusOf(staffItems),
      items: staffItems,
      action: { label: 'Mitarbeitende erfassen', href: '/admin/staff' },
    },
    {
      key: 'MAIL',
      title: 'E-Mail (Gmail)',
      why: 'Über das Postfach kommen Anfragen herein, und darüber stellt ORBIT Rückfragen und bestätigt Termine. Ohne Postfach kann ORBIT keine Anfrage entgegennehmen.',
      required: true,
      status: statusOf(mailItems),
      items: mailItems,
      action: { label: 'Gmail verbinden', href: '/integrations' },
    },
    {
      key: 'CALENDAR',
      title: 'Kalender',
      why: 'Mit Einblick in freie Zeiten schlägt ORBIT der Kundschaft konkrete Termine vor; mit der Erlaubnis, Termine anzulegen, bucht es den gewählten Termin. Ohne Kalender bittet ORBIT nur um Terminwünsche.',
      required: false,
      status: statusOf(calendarItems),
      items: calendarItems,
      action: { label: 'Kalender erlauben', href: '/integrations' },
    },
    {
      key: 'CRM',
      title: 'CRM (HubSpot)',
      why: 'Mit einem CRM übergibt ORBIT jede aufgenommene Anfrage dorthin, wo Ihre Leute weiterarbeiten. Ohne CRM führt ORBIT Kontakte und Interessenten in der eigenen Kundenverwaltung.',
      required: false,
      status: statusOf(crmItems),
      items: crmItems,
      action: { label: 'HubSpot verbinden', href: '/integrations' },
    },
    {
      key: 'RULES',
      title: 'Wie selbstständig ORBIT arbeitet',
      why: 'Vorsichtig, ausgewogen oder hochautomatisiert: Sie bestimmen, was ORBIT allein erledigt und wo vorher Ihre Freigabe nötig ist. Sie können das jederzeit für jede einzelne Handlung ändern.',
      required: true,
      status: statusOf(rulesItems),
      items: rulesItems,
      action: { label: 'Regeln wählen', href: '/admin/policies' },
    },
  ];

  const tasks: SetupTask[] = [];

  // 1. Mails lesen
  const canRead = gmailConnected && granted.has('email.read');
  tasks.push(
    canRead
      ? { key: 'READ_MAIL', title: 'Eingehende Mails lesen und einordnen', state: 'AUTOMATIC', detail: 'ORBIT liest das verbundene Postfach, erkennt Anfragen, Rechnungen, Beschwerden und Notfälle und legt dazu Vorgänge an.' }
      : { key: 'READ_MAIL', title: 'Eingehende Mails lesen und einordnen', state: 'UNAVAILABLE', detail: 'Ohne verbundenes Postfach nimmt ORBIT keine Anfragen entgegen.', unlock: { label: 'Gmail verbinden', stepKey: 'MAIL' } },
  );

  // 2. Rückfragen
  if (capabilities['email.send'] === true) {
    const m = modeState(modes['email.send.clarification']);
    tasks.push({ key: 'ASK_BACK', title: 'Rückfragen an die Kundschaft stellen', state: m.state, detail: `Bis zu drei Runden, jeweils nur zu dem, was noch fehlt; danach übernimmt ein Mensch. ${m.text}` });
  } else {
    tasks.push({ key: 'ASK_BACK', title: 'Rückfragen an die Kundschaft stellen', state: 'UNAVAILABLE', detail: 'Ohne die Erlaubnis, Mails zu senden, kann ORBIT keine Rückfragen stellen oder Eingänge bestätigen.', unlock: { label: 'Senden erlauben', stepKey: 'MAIL' } });
  }

  // 3. Auskünfte aus dem Betriebswissen
  const hasKnowledge = profileItems.every((i) => i.done) || stepDone(onboarding, 'SERVICES');
  if (capabilities['email.send'] === true && hasKnowledge) {
    const m = modeState(modes['email.send.information']);
    tasks.push({ key: 'ANSWER', title: 'Fragen zu Ihrem Betrieb beantworten', state: m.state, detail: `ORBIT antwortet nur aus dem, was in Ihrem Profil steht – und gibt sonst an einen Menschen weiter. ${m.text}` });
  } else {
    tasks.push({
      key: 'ANSWER',
      title: 'Fragen zu Ihrem Betrieb beantworten',
      state: 'UNAVAILABLE',
      detail: !hasKnowledge ? 'Ohne Leistungen im Betriebsprofil hat ORBIT keine Grundlage für Auskünfte und erfindet nichts.' : 'Ohne die Erlaubnis, Mails zu senden, kann ORBIT nicht antworten.',
      unlock: !hasKnowledge ? { label: 'Leistungen im Profil beschreiben', stepKey: 'PROFILE' } : { label: 'Senden erlauben', stepKey: 'MAIL' },
    });
  }

  // 4. Termine vorschlagen
  if (capabilities['calendar.read'] === true || (gmailConnected && granted.has('calendar.freebusy'))) {
    tasks.push({ key: 'PROPOSE_SLOTS', title: 'Termine aus Ihrem Kalender vorschlagen', state: 'AUTOMATIC', detail: 'ORBIT schlägt der Kundschaft konkrete freie Zeiten vor (nur frei/belegt, keine Termininhalte).' });
  } else {
    tasks.push({ key: 'PROPOSE_SLOTS', title: 'Termine aus Ihrem Kalender vorschlagen', state: 'BY_HAND', detail: 'Ohne Kalender bittet ORBIT die Kundschaft um Terminwünsche; die Abstimmung übernimmt Ihr Team.', unlock: { label: 'Kalender erlauben', stepKey: 'CALENDAR' } });
  }

  // 5. Termine buchen
  if (capabilities['calendar.book'] === true) {
    const m = modeState(modes['meeting.create']);
    tasks.push({ key: 'BOOK', title: 'Gewählte Termine im Kalender buchen', state: m.state, detail: `Gebucht wird nur ein vorgeschlagener, noch freier Termin; Gäste werden nicht eingeladen. ${m.text}` });
  } else {
    tasks.push({ key: 'BOOK', title: 'Gewählte Termine im Kalender buchen', state: 'BY_HAND', detail: 'Ohne die Erlaubnis, Termine anzulegen, gibt ORBIT den Terminwunsch an Ihr Team weiter.', unlock: { label: 'Termine anlegen erlauben', stepKey: 'CALENDAR' } });
  }

  // 6. Übergabe an das CRM
  const hubspot = integrations.hubspot?.connected === true;
  {
    const m = modeState(modes['lead.create']);
    tasks.push({
      key: 'HANDOFF',
      title: 'Anfragen an Ihr CRM übergeben',
      state: m.state,
      detail: `${hubspot ? 'ORBIT legt Kontakt und Anfrage in HubSpot an, mit einer Zusammenfassung aller Angaben und des Termins.' : 'Ohne CRM führt ORBIT Kontakt und Interessent in der eigenen Kundenverwaltung (mit Folgeaufgabe).'} ${m.text}`,
      ...(hubspot ? {} : { unlock: { label: 'HubSpot verbinden', stepKey: 'CRM' as const } }),
    });
  }

  // 7. Mitarbeitende informieren
  if (input.staffCount > 0 && stepDone(onboarding, 'REACHABILITY')) {
    const m = modeState(modes['staff.notify']);
    tasks.push({ key: 'NOTIFY', title: 'Zuständige Personen informieren', state: m.state, detail: `ORBIT meldet sich bei der zuständigen Person, erinnert und eskaliert, wenn niemand reagiert. ${m.text}` });
  } else {
    tasks.push({ key: 'NOTIFY', title: 'Zuständige Personen informieren', state: 'UNAVAILABLE', detail: input.staffCount === 0 ? 'Es ist noch niemand erfasst, den ORBIT informieren könnte.' : 'Nicht alle Personen sind erreichbar oder es fehlt eine Leitung; Meldungen könnten ins Leere laufen.', unlock: { label: 'Mitarbeitende vervollständigen', stepKey: 'STAFF' } });
  }

  const required = steps.filter((s) => s.required);
  const requiredDone = required.filter((s) => s.status === 'DONE').length;
  return { steps, tasks, requiredDone, requiredTotal: required.length, ready: requiredDone === required.length };
}
