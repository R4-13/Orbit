import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import type { NormalizedIntakeEvent } from '../src/intake/channel-event.types';
import { IntakeService } from '../src/intake/intake.service';
import { GmailConnectorService } from '../src/integrations/gmail-connector.service';
import { OUTBOUND_MAIL, type OutboundMailPort } from '../src/integrations/outbound-mail.port';
import { PlatformControlService } from '../src/platform-control/platform-control.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { BlueprintRegistryService } from '../src/process/blueprint-registry.service';
import { CaseFactsService } from '../src/process/case-facts.service';
import { OrchestratorService } from '../src/process/orchestrator.service';
import { ReferenceProcessService } from '../src/process/reference/reference-process.service';
import { TenantsService } from '../src/tenants/tenants.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

const FIXTURES = join(__dirname, '../../../fixtures/process');
const LIVE = process.env.LIVE_AI === '1';
const OUT = process.env.FN_OUT;

/**
 * Begrenzter Funktionsnachweis (docs/FUNKTIONSNACHWEIS_2026-10-23.md): die drei Abläufe mit dem ECHTEN Modell im **autonomen Testmandanten** (Antwort auf Auskünfte ohne Freigabe, Profil wie Musterwerk,
 * Verzeichnis wie Musterwerk – ohne Zuständigkeit für die Weitergabe an Monteure; Versand und Kalender als Double). Menschliche Freigaben (Planfreigabe unbekannter Vorgangsarten) werden gezählt und berichtet.
 * Die Erwartungen stehen vorab im Dokument; dieser Test ändert sie nicht.
 */
(LIVE ? describe : describe.skip)('Funktionsnachweis: autonomer Testmandant (live)', () => {
  jest.setTimeout(1_500_000);
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;
  let sender = 'tom.orbit@kunde.example';
  const sent: Array<{ to: string; subject: string; bodyText: string }> = [];
  const record: Record<string, unknown> = { menschlicheFreigaben: [] as unknown[] };
  const approvals = record.menschlicheFreigaben as Array<{ fall: string; art: string }>;

  const inbound = (over: Partial<NormalizedIntakeEvent> & { subject: string; content: string }): NormalizedIntakeEvent => ({
    tenantId: '',
    channel: 'SIMULATED',
    provider: 'simulated',
    externalEventId: randomUUID(),
    occurredAt: new Date(),
    sender: { address: sender, displayName: 'Tom Orbit' },
    recipients: [{ address: 'info@sanitaer.example' }],
    direction: 'INBOUND',
    threadId: randomUUID(),
    rfcMessageId: `<${randomUUID()}@kunde.example>`,
    ...over,
  });
  const scoped = () => prisma.forTenantId(tenantId);
  const flat = (text: string, max = 700) => text.replace(/\s+/g, ' ').trim().slice(0, max);

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    prisma = app.get(PrismaService);
    const suffix = randomUUID();
    const { tenant } = await app.get(TenantsService).bootstrapTenant({ name: `Funktionsnachweis ${suffix.slice(0, 6)}`, slug: `e2e-fn-${suffix}`, adminEmail: `admin-${suffix}@e2e-fn.example`, adminPassword: 'Musterwerk#2026!', adminFirstName: 'E2E', adminLastName: 'Admin', industry: 'Heizung und Sanitär', automationPreset: 'BALANCED' });
    tenantId = tenant.id;
    await prisma.withRlsBypass((tx) => tx.tenant.update({ where: { id: tenantId }, data: { timezone: 'Europe/Berlin' } }));
    await scoped().integration.create({ data: { tenantId, connectorType: 'GMAIL', status: 'CONNECTED', externalAccountDisplayName: 'info@sanitaer.example', grantedCapabilities: ['email.read', 'email.send', 'calendar.freebusy'] } });
    const profile = JSON.parse(readFileSync(join(FIXTURES, 'funktionsnachweis.musterwerk-profile.json'), 'utf8')) as Record<string, unknown>;
    await scoped().tenantProfile.update({ where: { tenantId }, data: profile as never });
    // Verzeichnis wie Musterwerk: Inhaber und Büro, KEIN Monteur und keine Zuständigkeit „Weitergabe an Monteure“.
    await scoped().staffMember.create({ data: { tenantId, firstName: 'Frank', lastName: 'Test', roleKind: 'OWNER', email: 'chef@sanitaer.example', responsibilities: ['GENERAL', 'COMPLAINTS', 'EMERGENCY'], preferredChannel: 'EMAIL' } as never });
    await scoped().staffMember.create({ data: { tenantId, firstName: 'Test', lastName: 'Person', roleKind: 'OFFICE', email: 'vera@sanitaer.example', responsibilities: ['GENERAL', 'APPOINTMENTS'], preferredChannel: 'EMAIL' } as never });
    await scoped().contact.create({ data: { tenantId, firstName: 'Tom', lastName: 'Orbit', email: sender } as never });
    await app.get(ReferenceProcessService).loadFixture(tenantId, JSON.parse(readFileSync(join(FIXTURES, 'reference-data.demo.json'), 'utf8')));
    const blueprints = app.get(BlueprintRegistryService);
    const blueprint = JSON.parse(readFileSync(join(FIXTURES, 'request-for-quote.handoff.blueprint.json'), 'utf8')) as { key: string; version: string };
    await blueprints.importDraft(tenantId, 'u1', blueprint);
    for (const to of ['VALIDATING', 'TESTING', 'STAGED', 'PUBLISHED'] as const) await blueprints.transition(tenantId, 'u1', blueprint.key, blueprint.version, to);
    await blueprints.activate(tenantId, 'u1', blueprint.key, blueprint.version);
    // Autonomer Testmandant: Rückfragen und Auskünfte gehen selbstständig hinaus (in Musterwerk verlangt die Auskunft eine Einzelfreigabe).
    await scoped().policyConfig.updateMany({ where: { action: 'email.send.clarification' }, data: { mode: 'AUTONOMOUS' } });
    await scoped().policyConfig.updateMany({ where: { action: 'email.send.information' }, data: { mode: 'AUTONOMOUS' } });
    jest.spyOn(app.get<OutboundMailPort>(OUTBOUND_MAIL), 'send').mockImplementation(async (_t, message) => {
      sent.push(message as never);
      return { providerMessageId: `x-${sent.length}`, threadId: (message as { threadId?: string }).threadId ?? `thr-${sent.length}`, rfcMessageId: `<sent-${sent.length}@mail.example>`, from: 'info@sanitaer.example', executionMode: 'SIMULATED' };
    });
    jest.spyOn(GmailConnectorService.prototype, 'queryFreeBusy').mockResolvedValue([{ calendarId: 'primary', busy: [] }]);
    jest.spyOn(GmailConnectorService.prototype, 'createCalendarEvent').mockRejectedValue(new Error('Kalenderbuchungen sind im Funktionsnachweis ausgeschlossen.'));
  }, 240_000);

  afterAll(async () => {
    if (OUT) writeFileSync(OUT, JSON.stringify(record, null, 2), 'utf8');
    jest.restoreAllMocks();
    await prisma.withRlsBypass((tx) => tx.tenant.deleteMany({ where: { id: tenantId } }));
    await app.close();
  });

  const orchestrator = () => app.get(OrchestratorService);
  /** Gibt einen auf Planfreigabe wartenden Plan frei (D4: schreibende Wirkungen eines unbekannten Ablaufs) und zählt das als menschliche Freigabe. */
  async function approveWaitingPlan(caseId: string, label: string): Promise<boolean> {
    const waiting = await scoped().processPlan.findFirst({ where: { caseId, status: 'AWAITING_APPROVAL' }, orderBy: { revision: 'desc' } });
    if (!waiting) return false;
    await orchestrator().approvePlan(tenantId, 'funktionsnachweis-freigabe', waiting.id);
    await orchestrator().advance(tenantId, caseId);
    approvals.push({ fall: label, art: 'Planfreigabe (D4)' });
    return true;
  }
  async function submit(label: string, subject: string, content: string) {
    const before = sent.length;
    const threadId = randomUUID();
    const result = await app.get(IntakeService).handleIntakeEvent(tenantId, undefined, inbound({ subject, content, threadId, rfcMessageId: `<${randomUUID()}@kunde.example>` }));
    if (!result.case) return { caseId: '', mails: sent.slice(before), threadId };
    await approveWaitingPlan(result.case.id, label);
    return { caseId: result.case.id, mails: sent.slice(before), threadId };
  }
  async function reply(label: string, caseId: string, threadId: string, subject: string, content: string) {
    const before = sent.length;
    const last = await scoped().emailMessage.findFirst({ where: { caseId, direction: 'OUTBOUND' }, orderBy: { createdAt: 'desc' } });
    await app.get(IntakeService).handleIntakeEvent(tenantId, undefined, inbound({ subject: `Re: ${subject}`, content, threadId: last?.threadId ?? threadId, inReplyTo: last?.rfcMessageId ?? undefined, references: last?.rfcMessageId ? [last.rfcMessageId] : undefined }));
    await approveWaitingPlan(caseId, label);
    return sent.slice(before);
  }
  async function caseView(caseId: string) {
    const row = await scoped().case.findUniqueOrThrow({ where: { id: caseId } });
    const tasks = await scoped().task.findMany({ where: { caseId }, select: { title: true, description: true } });
    const attention = await scoped().attentionItem.findMany({ where: { caseId }, select: { responsibility: true, state: true, kind: true } });
    const plan = await scoped().processPlan.findFirst({ where: { caseId }, orderBy: { revision: 'desc' }, select: { revision: true, goalKeys: true, requestedOutcomes: true, explanation: true } });
    const effects = await scoped().actionIntent.findMany({ where: { caseId, status: 'CONFIRMED' }, select: { capabilityKey: true, purpose: true } });
    return { status: row.orchestrationStatus, outcome: row.outcome, attentionReasons: row.attentionReasons.slice(0, 3), tasks, attention, plan, effects };
  }
  const outcomeOf = (view: Awaited<ReturnType<typeof caseView>>) => (view.outcome as { code?: string } | null)?.code;

  // ---------------------------------------------------------------- Ablauf A: Auskunft aus belegtem Betriebswissen
  const wordingsA: Array<{ id: string; scenario: string; checks: (body: string) => void }> = [
    {
      id: 'A1',
      scenario: 'fn-a1-badsanierung-leverkusen',
      checks: (body) => {
        expect(body).toMatch(/Badsanierung/i);
        expect(body).toMatch(/Leverkusen/);
        expect(body).not.toMatch(/€|\bEUR\b|\bEuro\b/);
      },
    },
    {
      id: 'A2',
      scenario: 'fn-a2-freitag-elektro',
      checks: (body) => {
        expect(body).toMatch(/16(:00| Uhr)/); // Freitag nur bis 16 Uhr laut Profil
        expect(body).not.toMatch(/bis (zum |um )?17(:00)? ?Uhr (sind|erreichen|erreichbar|sind wir)/i);
        expect(body).toMatch(/Elektro/i);
        expect(body).toMatch(/nicht|leider|keine|ohne/i); // Ausschluss wird als solcher genannt
      },
    },
    {
      id: 'A3',
      scenario: 'fn-a3-angebot-vorab-preis',
      checks: (body) => {
        expect(body).not.toMatch(/\d\s?(€|EUR|Euro)|(€|EUR)\s?\d/);
        expect(body).toMatch(/vor Ort|Besichtigung|ansehen|anschauen/i);
        expect(body).toMatch(/(nicht|keine)[^.]{0,80}Preis|Preise?[^.]{0,80}(nicht|keine)/i);
      },
    },
  ];
  const scenarios = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'tools', 'customer-simulator', 'szenarien', 'szenarien.json'), 'utf8')).szenarien as Array<{ id: string; betreff: string; text: string }>;
  const scenario = (id: string) => {
    const s = scenarios.find((x) => x.id === id);
    if (!s) throw new Error(`Szenario ${id} fehlt`);
    return { subject: s.betreff, content: s.text };
  };

  for (const w of wordingsA) {
    it(`Ablauf ${w.id}: Auskunft aus belegtem Betriebswissen bis zur zugestellten Antwort`, async () => {
      const { subject, content } = scenario(w.scenario);
      const { caseId, mails } = await submit(w.id, subject, content);
      expect(caseId).not.toBe('');
      const view = await caseView(caseId);
      (record[w.id] as unknown) = { status: view.status, abschluss: view.outcome, ziele: view.plan?.goalKeys, anliegen: view.plan?.requestedOutcomes, mails: mails.map((m) => ({ an: m.to, text: flat(m.bodyText, 1200) })) };
      expect(mails.length).toBeGreaterThanOrEqual(1);
      for (const mail of mails) expect(mail.to).toBe(sender);
      const answer = mails.map((m) => m.bodyText).join('\n');
      w.checks(answer);
      expect(view.status).toBe('COMPLETED');
      expect(outcomeOf(view)).toBeDefined();
    });
  }

  // ---------------------------------------------------------------- Ablauf B: fehlende Information und Korrektur
  const wordingsB: Array<{ id: string; scenario: string; details: string; correction: string; old: string; fresh: string }> = [
    { id: 'B1', scenario: 'fn-b1-heizung-knapp', details: 'Es ist eine Gasheizung von 1985, das Haus hat 120 m² Wohnfläche. Wir wohnen in Köln, Musterstraße 12.', correction: 'Entschuldigung, ich habe mich vertan: Es sind nicht 120 m², sondern 140 m².', old: '120', fresh: '140' },
    { id: 'B2', scenario: 'fn-b2-waermepumpe-frechen', details: 'Das Haus ist von 1998 und hat etwa 150 m² Wohnfläche. Anschrift: Hauptstraße 5 in Frechen.', correction: 'Eine Korrektur: Das Baujahr ist 1989, ich habe mich vertippt.', old: '1998', fresh: '1989' },
    { id: 'B3', scenario: 'fn-b3-bad-preisfrage', details: 'Das Bad hat 6 m². Wir wohnen im Musterweg 3 in Leverkusen.', correction: 'Doch etwas größer, es sind nicht 6 m², sondern 7 m².', old: '6 m', fresh: '7' },
  ];
  for (const w of wordingsB) {
    it(`Ablauf ${w.id}: Anfrage mit fehlender Information, Antwort und Korrektur bis zum fachlich richtigen nächsten Ergebnis`, async () => {
      const { subject, content } = scenario(w.scenario);
      const run = await submit(w.id, subject, content);
      expect(run.caseId).not.toBe('');
      const askedMails = run.mails;
      const afterDetails = await reply(w.id, run.caseId, run.threadId, subject, w.details);
      const afterCorrection = await reply(w.id, run.caseId, run.threadId, subject, w.correction);
      const view = await caseView(run.caseId);
      const facts = (await app.get(CaseFactsService).getCurrent(tenantId, run.caseId)).filter((f) => f.status !== 'REJECTED');
      const factLines = facts.map((f) => `${f.key}=${JSON.stringify(f.value)} (${f.status})`);
      const open = await app.get(CaseFactsService).openCorrectionNotes(tenantId, run.caseId);
      (record[w.id] as unknown) = {
        status: view.status,
        abschluss: view.outcome,
        grund: view.attentionReasons,
        wirkungen: view.effects,
        aufgaben: view.tasks,
        fakten: factLines,
        offeneKorrekturhinweise: open.length,
        mails: { rueckfrage: askedMails.map((m) => flat(m.bodyText)), nachAngaben: afterDetails.map((m) => flat(m.bodyText)), nachKorrektur: afterCorrection.map((m) => flat(m.bodyText)) },
      };
      // 1. Die erste Antwort fragt (die Anfrage ist knapp) und geht an den Absender.
      expect(askedMails.length).toBeGreaterThanOrEqual(1);
      for (const mail of [...askedMails, ...afterDetails, ...afterCorrection]) expect(mail.to).toBe(sender);
      // 2. Der korrigierte Wert gilt; der alte gilt nicht mehr (oder die Korrektur ist ausdrücklich offen und sperrt die Wirkungen).
      const valueTexts = facts.map((f) => String(f.value));
      const hasFresh = valueTexts.some((v) => v.includes(w.fresh));
      const hasOldCurrent = facts.some((f) => f.status !== 'SUPERSEDED' && String(f.value).includes(w.old) && !String(f.value).includes(w.fresh));
      expect(hasFresh || open.length > 0).toBe(true);
      if (hasFresh) expect(hasOldCurrent).toBe(false);
      // 3. Keine Folgemail nennt den alten Wert als gültig (ohne den neuen zu nennen).
      for (const mail of afterCorrection) if (mail.bodyText.includes(w.old)) expect(mail.bodyText).toContain(w.fresh);
      // 4. Kein erfundener Preis.
      for (const mail of [...askedMails, ...afterDetails, ...afterCorrection]) expect(mail.bodyText).not.toMatch(/\d\s?(€|EUR|Euro)|(€|EUR)\s?\d/);
      expect(view.status).not.toBe('FAILED');
    });
  }

  // ---------------------------------------------------------------- Ablauf C: mehrere Anliegen, eine gemeinsame Antwort der Kundschaft
  async function setSplit(on: boolean): Promise<void> {
    await prisma.withPlatformScope(async (tx) => {
      const flag = await tx.platformFeatureFlag.findUniqueOrThrow({ where: { key: 'process.split' } });
      const overrides = (flag.tenantOverrides as Array<{ tenantId: string; value: boolean }>).filter((o) => o.tenantId !== tenantId);
      if (on) overrides.push({ tenantId, value: true });
      await tx.platformFeatureFlag.update({ where: { key: 'process.split' }, data: { tenantOverrides: overrides } });
    });
    app.get(PlatformControlService).invalidate();
  }
  async function runC(id: string, subject: string, content: string, commonReply: string) {
    const before = sent.length;
    await setSplit(true);
    try {
      const first = await app.get(IntakeService).handleIntakeEvent(tenantId, undefined, inbound({ subject, content }));
      const parentId = first.case!.id;
      const children = await scoped().case.findMany({ where: { parentCaseId: parentId }, orderBy: { createdAt: 'asc' } });
      for (const child of children) await approveWaitingPlan(child.id, `${id}/${child.title.split(':')[0]}`);
      const mailsAfterFirst = sent.slice(before);
      const lastSent = await scoped().emailMessage.findFirst({ where: { direction: 'OUTBOUND', caseId: { in: [parentId, ...children.map((c) => c.id)] } }, orderBy: { createdAt: 'desc' } });
      const beforeReply = sent.length;
      if (lastSent) {
        await app.get(IntakeService).handleIntakeEvent(tenantId, undefined, inbound({ subject: `Re: ${lastSent.subject ?? subject}`, content: commonReply, threadId: lastSent.threadId ?? randomUUID(), inReplyTo: lastSent.rfcMessageId ?? undefined, references: lastSent.rfcMessageId ? [lastSent.rfcMessageId] : undefined }));
        for (const child of children) await approveWaitingPlan(child.id, `${id}/${child.title.split(':')[0]}/nach Antwort`);
      }
      const perChild: Array<Record<string, unknown>> = [];
      for (const child of children) {
        const view = await caseView(child.id);
        const received = (await scoped().caseEvent.count({ where: { caseId: child.id, type: 'communication.received' } })) + (await scoped().caseEvent.count({ where: { caseId: child.id, type: 'communication.sibling_info' } }));
        perChild.push({ anliegen: child.title, status: view.status, abschluss: (view.outcome as { code?: string } | null)?.code, ziele: view.plan?.goalKeys, anliegenliste: view.plan?.requestedOutcomes, aufgaben: view.tasks, aufmerksamkeit: view.attention, antwortErreicht: received, grund: view.attentionReasons });
      }
      const allMails = sent.slice(before);
      (record[id] as unknown) = { teilvorgaenge: perChild, mailsErsterLauf: mailsAfterFirst.map((m) => flat(m.bodyText, 500)), mailsNachGemeinsamerAntwort: sent.slice(beforeReply).map((m) => flat(m.bodyText, 500)), antwortGesendet: Boolean(lastSent) };
      return { children, perChild, allMails };
    } finally {
      await setSplit(false);
    }
  }

  it('Ablauf C1: drei Anliegen, eine gemeinsame Antwort – jeder Teilvorgang hat ein nachvollziehbares Ergebnis', async () => {
    const { subject, content } = scenario('fn-c1-drei-anliegen');
    const { children, perChild, allMails } = await runC('C1', subject, content, 'Zur Rechnung: es ist die vom September. Zum Termin: der Wartungstermin war bei Herrn Weber. Zum Heizungsregler: es ist eine Vaillant-Anlage von 2012, ein Angebot hätten wir gern für das Wohnhaus Musterstraße 12 in Köln.');
    expect(children.length).toBeGreaterThanOrEqual(3);
    for (const c of perChild) {
      expect(c.status).not.toBe('FAILED');
      // Ergebnis nachvollziehbar: abgeschlossen mit Nachweis, übergeben (Aufgabe/Aufmerksamkeit) oder wartet ausdrücklich auf die Kundschaft
      const traceable = c.status === 'COMPLETED' || (c.aufgaben as unknown[]).length > 0 || (c.aufmerksamkeit as unknown[]).length > 0 || c.status === 'WAITING_FOR_INFORMATION';
      expect(traceable).toBe(true);
    }
    for (const mail of allMails) {
      expect(mail.to).toBe(sender);
      expect(mail.bodyText).not.toMatch(/\d\s?(€|EUR|Euro)|(€|EUR)\s?\d/);
    }
  });

  it('Ablauf C2: Schlüsselbund und Einsatzgebiet – „Monteur informieren“ ohne dokumentierte Weitergabe ist eine Übergabe mit offenem Restziel, kein Erfolg', async () => {
    const { subject, content } = scenario('fn-c2-schluesselbund-frechen');
    const { perChild, allMails } = await runC('C2', subject, content, 'Zu Frechen: Es geht um die Hauptstraße 5. Der Schlüsselbund liegt im Heizungskeller.');
    const key = perChild.find((c) => /monteur|schl[üu]ssel/i.test(String(c.anliegen)) || /monteur|schl[üu]ssel/i.test(JSON.stringify(c.anliegenliste ?? '')));
    expect(key).toBeDefined();
    // Das Restziel „Monteur informieren“ ist NICHT als erreicht abgeschlossen (kein ADHOC_GOALS_PROVEN ohne Person), sondern liegt bei einer Person.
    expect(key!.status).not.toBe('COMPLETED');
    expect(((key!.aufgaben as unknown[]) ?? []).length + ((key!.aufmerksamkeit as unknown[]) ?? []).length).toBeGreaterThan(0);
    for (const mail of allMails) expect(mail.bodyText).not.toMatch(/Monteur[^.]{0,60}(wurde|ist) (informiert|benachrichtigt)|haben (den )?Monteur (informiert|benachrichtigt)|Schlüssel[^.]{0,40}(abgeholt|zurückgegeben)/i);
  });

  it('Ablauf C2b: derselbe Auftrag MIT dokumentierter Weitergabe (Zuständigkeit DISPATCH) – die Meldung geht an die dafür zuständige Person', async () => {
    await scoped().staffMember.updateMany({ where: { tenantId, roleKind: 'OFFICE' }, data: { responsibilities: ['GENERAL', 'APPOINTMENTS', 'DISPATCH'] } });
    const subject = 'Liegengebliebener Schlüsselbund';
    const content = 'Guten Tag,\n\nbei der Wartung gestern ist ein Schlüsselbund Ihres Technikers bei uns im Heizungskeller zurückgeblieben. Bitte geben Sie ihm Bescheid, damit er ihn abholen kann, und bestätigen Sie uns kurz den Eingang dieser Nachricht.\n\nViele Grüße\nTom Orbit';
    const { caseId, mails } = await submit('C2b', subject, content);
    const view = await caseView(caseId);
    (record.C2b as unknown) = { status: view.status, abschluss: view.outcome, ziele: view.plan?.goalKeys, anliegen: view.plan?.requestedOutcomes, aufmerksamkeit: view.attention, aufgaben: view.tasks, mails: mails.map((m) => flat(m.bodyText)) };
    const relayed = view.attention.some((a) => a.responsibility === 'DISPATCH');
    // Entweder Weg über die Weitergabe (dann erreicht) – oder wieder Übergabe mit Restziel; ein Abschluss ohne Weitergabe wäre der Ersatz durch ein leichteres Ziel.
    if (view.status === 'COMPLETED') expect(relayed).toBe(true);
    else expect(view.tasks.length + view.attention.length).toBeGreaterThan(0);
  });

  it('Ablauf C3: Rechnungsklärung und Terminanfrage ohne Buchung', async () => {
    const { subject, content } = scenario('fn-c3-rechnung-doppelt-termin');
    const { children, perChild } = await runC('C3', subject, content, 'Die Rechnung kam am 5. und am 8. Oktober per Post. Der Termin sollte vormittags sein, gern Dienstag oder Mittwoch.');
    expect(children.length).toBeGreaterThanOrEqual(2);
    for (const c of perChild) {
      expect(c.status).not.toBe('FAILED');
      expect(c.status === 'COMPLETED' || (c.aufgaben as unknown[]).length > 0 || (c.aufmerksamkeit as unknown[]).length > 0 || c.status === 'WAITING_FOR_INFORMATION').toBe(true);
    }
  });
});
