import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import type { NormalizedIntakeEvent } from '../src/intake/channel-event.types';
import { ConcernSegmentationService } from '../src/intake/concern-segmentation.service';
import { IntakeService } from '../src/intake/intake.service';
import { GmailConnectorService } from '../src/integrations/gmail-connector.service';
import { OUTBOUND_MAIL, type OutboundMailPort } from '../src/integrations/outbound-mail.port';
import { PlatformControlService } from '../src/platform-control/platform-control.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { BlueprintRegistryService } from '../src/process/blueprint-registry.service';
import { CaseFactsService } from '../src/process/case-facts.service';
import { FactCorrectionService } from '../src/process/fact-correction.service';
import { OrchestratorService } from '../src/process/orchestrator.service';
import { ReferenceProcessService } from '../src/process/reference/reference-process.service';
import { TenantsService } from '../src/tenants/tenants.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

const FIXTURES = join(__dirname, '../../../fixtures/process');
const LIVE = process.env.LIVE_AI === '1';
const OUT = process.env.ABNAHME_OUT;

/**
 * Gezielte Prüfung der Korrekturen vom 21.10.2026 mit dem ECHTEN Modell auf einem festen Stand (nur mit `LIVE_AI=1`). Die erwarteten fachlichen Ergebnisse stehen vorab in
 * `docs/ABNAHMEPRUEFUNG_2026-10-21.md` (dort festgelegt und eingecheckt, bevor dieser Test lief). Eigener Test-Betrieb mit dem hinterlegten Prozess „Anfrage aufnehmen und übergeben“,
 * Kalender-Double (keine Buchung im echten Kalender), Versand als Double (nichts verlässt den Testprozess).
 */
(LIVE ? describe : describe.skip)('Abnahmeprüfung der Korrekturen vom 21.10. mit dem echten Modell (live)', () => {
  jest.setTimeout(1_800_000);
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;
  const sent: Array<{ to: string; subject: string; bodyText: string }> = [];
  const bookings: unknown[] = [];
  const record: Record<string, unknown> = {};

  const inbound = (over: Partial<NormalizedIntakeEvent> & { subject: string; content: string }): NormalizedIntakeEvent => ({
    tenantId: '',
    channel: 'SIMULATED',
    provider: 'simulated',
    externalEventId: randomUUID(),
    occurredAt: new Date(),
    sender: { address: 'hausverwaltung@kunde.example', displayName: 'Hausverwaltung Lindner' },
    recipients: [{ address: 'info@sanitaer.example' }],
    direction: 'INBOUND',
    threadId: randomUUID(),
    rfcMessageId: `<${randomUUID()}@kunde.example>`,
    ...over,
  });
  const scoped = () => prisma.forTenantId(tenantId);

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    prisma = app.get(PrismaService);
    const suffix = randomUUID();
    const { tenant } = await app.get(TenantsService).bootstrapTenant({ name: `Abnahme ${suffix.slice(0, 6)}`, slug: `e2e-abnahme-${suffix}`, adminEmail: `admin-${suffix}@e2e-abnahme.example`, adminPassword: 'Musterwerk#2026!', adminFirstName: 'E2E', adminLastName: 'Admin', industry: 'Heizung und Sanitär', automationPreset: 'BALANCED' });
    tenantId = tenant.id;
    await prisma.withRlsBypass((tx) => tx.tenant.update({ where: { id: tenantId }, data: { timezone: 'Europe/Berlin' } }));
    await scoped().integration.create({ data: { tenantId, connectorType: 'GMAIL', status: 'CONNECTED', externalAccountDisplayName: 'info@sanitaer.example', grantedCapabilities: ['email.read', 'email.send', 'calendar.freebusy'] } });
    await scoped().tenantProfile.update({
      where: { tenantId },
      data: {
        description: 'Meisterbetrieb für Heizung und Sanitär in Köln.',
        services: ['Heizungswartung', 'Badsanierung', 'Rohrreinigung', 'Gasinstallation', 'Wärmepumpen'],
        exclusions: ['Elektroarbeiten'],
        serviceArea: 'Köln und Umgebung (30 km)',
        openingHours: [{ days: ['MON', 'TUE', 'WED', 'THU', 'FRI'], from: '07:30', to: '16:00' }],
        emergencyService: true,
        languages: ['de'],
      },
    });
    await scoped().staffMember.create({ data: { tenantId, firstName: 'Clara', lastName: 'Chef', roleKind: 'OWNER', email: 'chef@sanitaer.example', responsibilities: ['GENERAL', 'COMPLAINTS', 'EMERGENCY'], preferredChannel: 'EMAIL' } as never });
    await scoped().staffMember.create({ data: { tenantId, firstName: 'Vera', lastName: 'Büro', roleKind: 'OFFICE', email: 'vera@sanitaer.example', responsibilities: ['GENERAL', 'APPOINTMENTS'], preferredChannel: 'EMAIL' } as never });
    await app.get(ReferenceProcessService).loadFixture(tenantId, JSON.parse(readFileSync(join(FIXTURES, 'reference-data.demo.json'), 'utf8')));
    const blueprints = app.get(BlueprintRegistryService);
    const blueprint = JSON.parse(readFileSync(join(FIXTURES, 'request-for-quote.handoff.blueprint.json'), 'utf8')) as { key: string; version: string };
    await blueprints.importDraft(tenantId, 'u1', blueprint);
    for (const to of ['VALIDATING', 'TESTING', 'STAGED', 'PUBLISHED'] as const) await blueprints.transition(tenantId, 'u1', blueprint.key, blueprint.version, to);
    await blueprints.activate(tenantId, 'u1', blueprint.key, blueprint.version);
    // Wie im Betrieb: Rückfragen und Bestätigungen an die Absender gehen selbstständig hinaus.
    await scoped().policyConfig.updateMany({ where: { action: 'email.send.clarification' }, data: { mode: 'AUTONOMOUS' } });
    // Test-Betrieb für das erreichbare Geschäftsziel (P6): die Auskunft aus dem Betriebswissen geht selbstständig hinaus. Im Betrieb Musterwerk verlangt die Regel email.send.information dagegen eine Einzelfreigabe.
    await scoped().policyConfig.updateMany({ where: { action: 'email.send.information' }, data: { mode: 'AUTONOMOUS' } });
    jest.spyOn(app.get<OutboundMailPort>(OUTBOUND_MAIL), 'send').mockImplementation(async (_t, message) => {
      sent.push(message as never);
      return { providerMessageId: `x-${sent.length}`, threadId: (message as { threadId?: string }).threadId ?? `thr-${sent.length}`, rfcMessageId: `<sent-${sent.length}@mail.example>`, from: 'info@sanitaer.example', executionMode: 'SIMULATED' };
    });
    jest.spyOn(GmailConnectorService.prototype, 'queryFreeBusy').mockResolvedValue([{ calendarId: 'primary', busy: [] }]);
    jest.spyOn(GmailConnectorService.prototype, 'createCalendarEvent').mockImplementation(async (_t, input) => {
      bookings.push(input);
      return { eventId: (input as { eventId: string }).eventId, alreadyExisted: false };
    });
  }, 240_000);

  afterAll(async () => {
    if (OUT) writeFileSync(OUT, JSON.stringify(record, null, 2), 'utf8');
    jest.restoreAllMocks();
    await prisma.withRlsBypass((tx) => tx.tenant.deleteMany({ where: { id: tenantId } }));
    await app.close();
  });

  /** Neue Anfrage: der Lauf wird vollständig durchgespielt (Freigaben des Testbetriebs eingeschlossen); liefert, was für die Bewertung nötig ist. */
  async function submit(subject: string, content: string): Promise<{ caseId: string; first: typeof sent; threadId: string; rfc: string; intakeStatus?: string }> {
    const before = sent.length;
    const threadId = randomUUID();
    const rfc = `<${randomUUID()}@kunde.example>`;
    const result = await app.get(IntakeService).handleIntakeEvent(tenantId, undefined, inbound({ subject, content, threadId, rfcMessageId: rfc }));
    // Ohne Vorgang (der Eingang liegt in der Prüfliste) gibt es nichts zu bearbeiten; der Aufrufer bewertet das (Mails und Terminvorschläge bleiben aus).
    if (!result.case) {
      const intake = await scoped().intakeEvent.findUnique({ where: { id: result.intakeEventId }, select: { status: true } });
      return { caseId: '', first: sent.slice(before), threadId, rfc, intakeStatus: intake?.status };
    }
    const caseId = result.case.id;
    const waiting = await scoped().processPlan.findFirst({ where: { caseId, status: 'AWAITING_APPROVAL' }, orderBy: { revision: 'desc' } });
    if (waiting) {
      await app.get(OrchestratorService).approvePlan(tenantId, 'abnahme-freigabe', waiting.id);
      await app.get(OrchestratorService).advance(tenantId, caseId);
    }
    return { caseId, first: sent.slice(before), threadId, rfc };
  }
  async function reply(caseId: string, threadId: string, subject: string, content: string): Promise<typeof sent> {
    const before = sent.length;
    const last = await scoped().emailMessage.findFirst({ where: { caseId, direction: 'OUTBOUND' }, orderBy: { createdAt: 'desc' } });
    await app.get(IntakeService).handleIntakeEvent(
      tenantId,
      undefined,
      inbound({ subject: `Re: ${subject}`, content, threadId: last?.threadId ?? threadId, inReplyTo: last?.rfcMessageId ?? undefined, references: last?.rfcMessageId ? [last.rfcMessageId] : undefined }),
    );
    return sent.slice(before);
  }
  const events = (caseId: string, type: string) => scoped().caseEvent.findMany({ where: { caseId, type }, orderBy: { sequence: 'asc' } });
  const appointmentWords = /termin|vor ort|besichtig|minuten|\bab \d{2}:\d{2}\b/i;

  // ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  it('P1 reine Preisfrage: kein automatischer Wechsel in den Terminablauf, kein erfundener Preis – fünf Formulierungen (drei davon waren nicht Grundlage der Reparaturen)', async () => {
    const wordings: Array<[string, string]> = [
      ['Preis Heizkörper', 'Hallo, was kostet es ungefähr, vier Heizkörper zu tauschen? Tom'],
      ['Kosten Heizkörpertausch', 'Guten Tag, können Sie mir sagen, mit welchen Kosten man beim Austausch von sechs Heizkörpern rechnen muss? Viele Grüße, A. Lindner'],
      ['Warmwasserspeicher', 'Mich würde interessieren, was ein neuer Warmwasserspeicher ungefähr kostet. Danke und Gruß, M. Krämer'],
      ['Preisrahmen Thermostate', 'Ungefähr welcher Preisrahmen gilt für den Tausch von zwei Thermostaten? Freundliche Grüße, Familie Roth'],
      ['Armaturen im Bad', 'Wie teuer wird es etwa, wenn wir drei Armaturen im Bad austauschen lassen? Danke, S. Winter'],
    ];
    const runs: Array<Record<string, unknown>> = [];
    for (const [subject, content] of wordings) {
      const { caseId, first, intakeStatus } = await submit(subject, content);
      if (!caseId) {
        runs.push({ subject, ohneVorgang: intakeStatus ?? 'unbekannt', mails: first.length });
        expect(first).toHaveLength(0); // ohne Vorgang geht nichts an die Kundschaft
        continue;
      }
      const proposed = await events(caseId, 'appointment.proposed');
      const row = await scoped().case.findUniqueOrThrow({ where: { id: caseId } });
      const openNodes = (await scoped().processPlanNode.findMany({ where: { plan: { caseId } }, select: { nodeKey: true, state: true, errorCode: true, errorMessage: true } })).filter((n) => !['SUCCEEDED', 'PLANNED', 'SKIPPED', 'SUPERSEDED'].includes(n.state)).map((n) => `${n.nodeKey}:${n.state}${n.errorCode ? `:${n.errorCode}:${(n.errorMessage ?? '').slice(0, 120)}` : ''}`);
      const plans = await scoped().processPlan.findMany({ where: { caseId }, orderBy: { revision: 'asc' }, select: { revision: true, status: true, goalKeys: true, explanation: true } });
      const done = (await scoped().processPlanNode.findMany({ where: { plan: { caseId }, state: 'SUCCEEDED' }, select: { nodeKey: true } })).map((n) => n.nodeKey);
      runs.push({ subject, status: row.orchestrationStatus, outcome: row.outcome, plaene: plans.map((pl) => `${pl.revision}:${pl.status}:${pl.goalKeys.join(',')}:${pl.explanation.slice(0, 160)}`), erledigt: done, gruende: row.attentionReasons.slice(0, 2), offeneSchritte: openNodes, mails: first.map((m) => m.bodyText.replace(/\s+/g, ' ').slice(0, 400)), appointmentsProposed: proposed.length });
      for (const mail of first) {
        expect(mail.to).toBe('hausverwaltung@kunde.example');
        expect(mail.bodyText).not.toMatch(/€|\bEUR\b|\bEuro\b/); // kein erfundener Preis
        expect(mail.bodyText).not.toMatch(appointmentWords); // kein Termin-/Besichtigungsablauf für eine reine Preisfrage
      }
      expect(proposed).toHaveLength(0);
      expect(row.orchestrationStatus).not.toBe('FAILED');
    }
    record.preisfrage = runs;
    // Der Aufbau muss zustande gekommen sein (ein Vorgang mit Bearbeitung), sonst beweist der Pfad nichts.
    expect(runs.filter((r) => !('ohneVorgang' in r)).length).toBeGreaterThanOrEqual(4);
  });

  // ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  it('P2 Wartungsvertrag: ein Vor-Ort-Termin und seine Dauer nur mit fallbezogener Grundlage – drei Läufe, die Variante und zwei neue Formulierungen', async () => {
    const scenarios = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'tools', 'customer-simulator', 'szenarien', 'szenarien.json'), 'utf8')).szenarien as Array<{ id: string; betreff: string; text: string }>;
    const pick = (id: string) => scenarios.find((s) => s.id === id)!;
    const wordings: Array<[string, string, string]> = [
      ['Standard', pick('unbekannt-wartungsvertrag').betreff, pick('unbekannt-wartungsvertrag').text],
      ['Standard', pick('unbekannt-wartungsvertrag').betreff, pick('unbekannt-wartungsvertrag').text],
      ['Standard', pick('unbekannt-wartungsvertrag').betreff, pick('unbekannt-wartungsvertrag').text],
      ['Variante', pick('wartungsvertrag-variante').betreff, pick('wartungsvertrag-variante').text],
      ['Neu 1', 'Betreuung unserer Heizzentrale', 'Guten Tag, wir sind eine Eigentümergemeinschaft mit 8 Wohnungen und suchen jemanden, der unsere Gasheizung (Baujahr 2014) regelmäßig wartet und bei Störungen kommt. Was würde das pro Jahr ungefähr kosten? Viele Grüße, WEG Rheinblick'],
      ['Neu 2', 'Jährliche Wartung gesucht', 'Hallo, wir bräuchten für unser Gewerbeobjekt mit zwei Ölkesseln einen festen Wartungsvertrag, gern mit Notdienst. Wie läuft das bei Ihnen und ab wann ginge das? Gruß, Weber Immobilien'],
    ];
    const runs: Array<Record<string, unknown>> = [];
    for (const [kind, subject, content] of wordings) {
      const { caseId, first } = await submit(subject, content.replace(/\{\{\w+\}\}/g, '1'));
      const row = await scoped().case.findUniqueOrThrow({ where: { id: caseId } });
      const analysis = (await events(caseId, 'requirements.analyzed')).at(-1)?.payload as { analysis?: { siteVisit?: { recommended?: boolean; reason?: string }; appointmentMinutes?: number; appointmentBasis?: string; inquiryKind?: string; nextStep?: string } } | undefined;
      runs.push({ kind, subject, status: row.orchestrationStatus, blueprint: row.blueprintKey, analysis: analysis?.analysis ?? null, mails: first.map((m) => m.bodyText.replace(/\s+/g, ' ').slice(0, 500)) });
      for (const mail of first) {
        expect(mail.to).toBe('hausverwaltung@kunde.example');
        const minutes = /ca\. (\d+) Minuten/.exec(mail.bodyText)?.[1];
        // Eine Dauer steht nur, wenn sie begründet ist (Betriebsvorgabe oder aus dem Umfang der Anfrage).
        if (minutes) expect(analysis?.analysis?.appointmentMinutes).toBe(Number(minutes));
        if (/Folgende Termine hätten wir frei/.test(mail.bodyText)) expect(analysis?.analysis?.appointmentBasis).toBeDefined(); // ein Terminvorschlag hat eine Grundlage
        expect(mail.bodyText).not.toMatch(/90 Minuten/);
      }
      expect(row.orchestrationStatus).not.toBe('FAILED');
    }
    record.wartungsvertrag = runs;
  });

  // ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  it('P3 Antwort mit Terminvertagung: derselbe Vorschlag wird nicht noch einmal gesendet, nichts wird gebucht – vier Formulierungen (zwei neu)', async () => {
    const request = {
      subject: 'Wärmepumpe im Altbau',
      content: 'Guten Tag, wir möchten die 30 Jahre alte Ölheizung in unserem Altbau (Baujahr 1962, Heizraum im Keller, schmaler Zugang) durch eine Wärmepumpe ersetzen. Bitte kommen Sie zur Besichtigung vorbei und machen Sie uns ein Angebot. Viele Grüße, Familie Kern',
    };
    const deferrals = [
      'Die Wärmepumpe soll auch das Warmwasser übernehmen. Welcher der Termine passt, sage ich Ihnen noch.',
      'Ja, auch das Warmwasser. Den Termin kann ich erst nächste Woche festlegen, ich melde mich dazu.',
      'Das Warmwasser soll mit versorgt werden. Wann genau ich Zeit habe, weiß ich noch nicht – ich gebe Ihnen Bescheid.',
      'Warmwasser bitte mit. Zum Termin: Ich muss erst mit meiner Frau sprechen und schreibe Ihnen dann.',
    ];
    const runs: Array<Record<string, unknown>> = [];
    for (const deferral of deferrals) {
      const { caseId, first, threadId } = await submit(request.subject, request.content);
      const proposedFirst = (await events(caseId, 'appointment.proposed')).length;
      const bookedBefore = bookings.length;
      const second = proposedFirst > 0 ? await reply(caseId, threadId, request.subject, deferral) : [];
      const proposedAfter = (await events(caseId, 'appointment.proposed')).length;
      const row = await scoped().case.findUniqueOrThrow({ where: { id: caseId } });
      runs.push({ deferral, aufbau: proposedFirst > 0, status: row.orchestrationStatus, firstMail: first.map((m) => m.bodyText.replace(/\s+/g, ' ').slice(0, 300)), nachAntwort: second.map((m) => m.bodyText.replace(/\s+/g, ' ').slice(0, 300)), vorschlaegeNachher: proposedAfter, gebucht: bookings.length - bookedBefore });
      if (proposedFirst > 0) {
        expect(proposedAfter).toBe(proposedFirst); // kein erneuter Vorschlag ohne Ablehnung
        for (const mail of second) expect(mail.bodyText).not.toContain('Folgende Termine hätten wir frei');
        expect(bookings.length).toBe(bookedBefore); // nichts gebucht
        expect(row.orchestrationStatus).not.toBe('FAILED');
      }
    }
    record.terminvertagung = runs;
    // Der Aufbau (ein Terminvorschlag in der ersten Antwort) muss in mindestens drei von vier Läufen zustande gekommen sein, sonst beweist der Test nichts.
    expect(runs.filter((r) => r.aufbau).length).toBeGreaterThanOrEqual(3);
  });

  // ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  it('P4 Korrektur ohne Zahl: nichts geht still verloren – erkannt und übernommen, als Widerspruch sichtbar oder als ungeklärter Hinweis, der Wirkungen sperrt – vier Formulierungen (zwei neu)', async () => {
    const facts = app.get(CaseFactsService);
    const corrections = app.get(FactCorrectionService);
    const replies = [
      'Eine Änderung noch: Wir möchten keine bodengleiche Dusche mehr, sondern doch eine Badewanne mit Duschabtrennung.',
      'Korrektur zu unserer Anfrage: Statt der bodengleichen Dusche hätten wir jetzt gern eine normale Wanne.',
      'Wir haben uns umentschieden – die Dusche streichen wir, es kommt eine freistehende Badewanne hinein.',
      'Bitte berücksichtigen Sie: Die Fliesen sollen nicht mehr in Weiß, sondern in Anthrazit sein.',
      // Ohne jedes Änderungswort (nur die Bedeutung): bekannte Grenze – hier trägt allein die Einschätzung des Modells; das Ergebnis wird festgehalten, ist aber keine harte Erwartung.
      'Die Dusche lassen wir weg, dafür nehmen wir die Wanne mit Duschabtrennung.',
    ];
    const keys = ['bathroom.shower', 'bathroom.shower', 'bathroom.shower', 'bathroom.tiles', 'bathroom.shower'];
    const runs: Array<Record<string, unknown>> = [];
    for (const [index, text] of replies.entries()) {
      const row = await scoped().case.create({ data: { tenantId, type: 'GENERAL', title: `Korrektur ohne Zahl ${index}`, status: 'OPEN' } as never });
      const firstText = 'Das Bad hat ca. 7 m², wir wünschen eine bodengleiche Dusche und neue Fliesen in Weiß. Bitte um ein Angebot.';
      const first = await scoped().emailMessage.create({ data: { tenantId, caseId: row.id, direction: 'INBOUND', fromAddress: 'hausverwaltung@kunde.example', toAddresses: ['info@sanitaer.example'], subject: 'Badsanierung', bodyText: firstText, bodyPreview: firstText, receivedAt: new Date() } });
      const proposed = await facts.propose(tenantId, row.id, [
        { key: 'bathroom.shower', value: 'bodengleiche Dusche', valueType: 'string', sourceType: 'EMAIL', sourceRef: `message:${first.id}`, evidenceRefs: ['bodengleiche Dusche'] },
        { key: 'bathroom.tiles', value: 'Fliesen in Weiß', valueType: 'string', sourceType: 'EMAIL', sourceRef: `message:${first.id}`, evidenceRefs: ['neue Fliesen in Weiß'] },
      ]);
      for (const f of proposed) await facts.confirmBySchema(tenantId, f.id, 'string');
      const message = await scoped().emailMessage.create({ data: { tenantId, caseId: row.id, direction: 'INBOUND', fromAddress: 'hausverwaltung@kunde.example', toAddresses: ['info@sanitaer.example'], subject: 'Re: Badsanierung', bodyText: text, bodyPreview: text.slice(0, 100), receivedAt: new Date() } });
      const outcome = await corrections.processInbound(tenantId, row.id, message.id);
      const open = await facts.openCorrectionNotes(tenantId, row.id);
      const handled = outcome.corrected.some((c) => c.key === keys[index]) || outcome.conflicts.some((c) => c.key === keys[index]) || open.length > 0;
      runs.push({ text, corrected: outcome.corrected, conflicts: outcome.conflicts.map((c) => c.key), ungeklaerterHinweis: open.length, erfasst: handled });
      if (index < 4) expect(handled).toBe(true); // nicht still verloren (Formulierungen mit Änderungswort); die fünfte ist die dokumentierte Grenze
    }
    record.korrekturOhneZahl = runs;
  });

  // ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  it('P5 fünf Anliegen mit Gruß und Dank: genau fünf Anliegen, kein zusätzlicher Vorgang für Gruß/Dank, echte Restanliegen bleiben – drei Läufe, Variante, zwei neue Formulierungen', async () => {
    const segmenter = app.get(ConcernSegmentationService);
    const scenarios = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'tools', 'customer-simulator', 'szenarien', 'szenarien.json'), 'utf8')).szenarien as Array<{ id: string; betreff: string; text: string }>;
    const pick = (id: string) => scenarios.find((s) => s.id === id)!;
    const texts: Array<{ name: string; subject: string; text: string; expect: number; supplemented: boolean }> = [
      ...[1, 2, 3].map((n) => ({ name: `Standard ${n}`, subject: pick('fuenf-anliegen').betreff, text: pick('fuenf-anliegen').text.replace(/\{\{\w+\}\}/g, '1'), expect: 5, supplemented: false })),
      { name: 'Variante', subject: pick('fuenf-anliegen-variante').betreff, text: pick('fuenf-anliegen-variante').text, expect: 5, supplemented: false },
      {
        name: 'Neu 1',
        subject: 'Mehrere Punkte',
        text: 'Hallo Team,\n\nvier Dinge: Erstens brauche ich die Rechnung vom 12.09. noch einmal als Kopie. Zweitens soll unser Wartungstermin am 3.11. auf den 10.11. verlegt werden. Drittens: Was kostet ein neues Thermostat für das Wohnzimmer ungefähr? Viertens tropft der Wasserhahn in der Küche, könnten Sie dafür einen Termin anbieten?\n\nVielen Dank für Ihre Mühe und viele Grüße\nPeter Brandt',
        expect: 4,
        supplemented: false,
      },
      {
        name: 'Neu 2 (Dank mit echter Bitte)',
        subject: 'Zwei Dinge und noch eine Bitte',
        text: 'Guten Tag,\n\nerstens würde ich gern wissen, ob Sie samstags erreichbar sind. Zweitens möchte ich den Wartungstermin am 5.11. auf den 12.11. verschieben.\n\nDanke und bitte rufen Sie mich auch noch kurz wegen der Garagenheizung zurück.\nGruß, P. Brandt',
        expect: 3,
        supplemented: true,
      },
    ];
    const runs: Array<Record<string, unknown>> = [];
    for (const t of texts) {
      const verified = await segmenter.segment(tenantId, { subject: t.subject, text: t.text });
      expect(verified).toBeDefined();
      runs.push({ name: t.name, concerns: verified!.concerns.map((c) => c.title), supplemented: verified!.concerns.filter((c) => c.supplemented).length, ungrounded: verified!.coverage.ungrounded.length, unassigned: verified!.coverage.unassigned.length });
      if (t.supplemented) {
        expect(verified!.concerns.length).toBeGreaterThanOrEqual(t.expect); // die echte Bitte bleibt erhalten (als eigenes Anliegen oder vom Modell erkannt)
        expect(verified!.concerns.map((c) => c.excerpt).join(' ')).toMatch(/Garagenheizung/);
      } else {
        expect(verified!.concerns.length).toBe(t.expect);
        expect(verified!.concerns.filter((c) => c.supplemented)).toHaveLength(0); // Gruß/Dank erzeugen kein Anliegen
        expect(verified!.concerns.map((c) => c.excerpt).join(' ')).not.toMatch(/^\s*(vielen dank|danke)/i);
      }
    }
    record.fuenfAnliegen = runs;
  });

  // ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  it('P5b Mehrfachanliegen vollständig: Originalnachricht lesen → Fakten zuordnen → zulässige Handlung → Antwort auswerten → Status; Information erreicht auch nicht wartende Geschwister', async () => {
    const setSplit = async (on: boolean): Promise<void> => {
      await prisma.withPlatformScope(async (tx) => {
        const flag = await tx.platformFeatureFlag.findUniqueOrThrow({ where: { key: 'process.split' } });
        const overrides = (flag.tenantOverrides as Array<{ tenantId: string; value: boolean }>).filter((o) => o.tenantId !== tenantId);
        if (on) overrides.push({ tenantId, value: true });
        await tx.platformFeatureFlag.update({ where: { key: 'process.split' }, data: { tenantOverrides: overrides } });
      });
      app.get(PlatformControlService).invalidate();
    };
    const wordings = [
      { subject: 'Zwei Dinge', content: 'Guten Tag, erstens interessiert mich ein Angebot für einen neuen Heizungsregler im Haus Rheinweg 8, zweitens tropft im Gäste-WC im Rheinweg 8 ein Wasserhahn, bitte um einen Reparaturtermin. Vielen Dank und Gruß, F. Lindner' },
      { subject: 'Reparatur und Angebot', content: 'Hallo, im Gäste-WC im Rheinweg 8 tropft der Wasserhahn, könnten Sie dafür einen Reparaturtermin anbieten? Außerdem hätte ich gern ein Angebot für einen neuen Heizungsregler. Danke, F. Lindner' },
      { subject: 'Zwei Bitten', content: 'Guten Morgen, wir brauchen bitte einen Termin für die Reparatur eines tropfenden Wasserhahns im Gäste-WC (Rheinweg 8). Und: Was würde ein neuer Heizungsregler für dieses Haus kosten? Danke, Hausverwaltung Lindner' },
    ];
    const results: Array<Record<string, unknown>> = [];
    await setSplit(true);
    try {
      for (const w of wordings) {
        const sentBefore = sent.length;
        const first = await app.get(IntakeService).handleIntakeEvent(tenantId, undefined, inbound({ subject: w.subject, content: w.content }));
        const children = await scoped().case.findMany({ where: { parentCaseId: first.case!.id }, orderBy: { createdAt: 'asc' } });
        for (const child of children) {
          const waiting = await scoped().processPlan.findFirst({ where: { caseId: child.id, status: 'AWAITING_APPROVAL' }, orderBy: { revision: 'desc' } });
          if (waiting) {
            await app.get(OrchestratorService).approvePlan(tenantId, 'abnahme-freigabe', waiting.id);
            await app.get(OrchestratorService).advance(tenantId, child.id);
          }
        }
        const nodes = await scoped().processPlanNode.findMany({ where: { plan: { caseId: { in: children.map((c) => c.id) } } }, select: { nodeKey: true, state: true, errorMessage: true } });
        const missingMessage = nodes.filter((n) => /messageId/.test(n.errorMessage ?? ''));
        const lastSent = await scoped().emailMessage.findFirst({ where: { direction: 'OUTBOUND', caseId: { in: [first.case!.id, ...children.map((c) => c.id)] } }, orderBy: { createdAt: 'desc' } });
        if (lastSent) {
          await app.get(IntakeService).handleIntakeEvent(
            tenantId,
            undefined,
            inbound({ subject: `Re: ${lastSent.subject ?? w.subject}`, content: 'Zum Regler: die Heizung ist von 2012 und ein Vaillant-Gerät. Zum Wasserhahn: es ist der Hahn am Waschbecken, Montagvormittag passt uns gut.', threadId: lastSent.threadId ?? randomUUID(), inReplyTo: lastSent.rfcMessageId ?? undefined, references: lastSent.rfcMessageId ? [lastSent.rfcMessageId] : undefined }),
          );
        }
        const perChild: Array<Record<string, unknown>> = [];
        for (const child of children) {
          const row = await scoped().case.findUniqueOrThrow({ where: { id: child.id } });
          const trace = await events(child.id, 'communication.sibling_info');
          const received = (await events(child.id, 'communication.received')).length;
          perChild.push({ anliegen: row.title.split(':')[0], status: row.orchestrationStatus, siblingInfo: trace.length, antwortErhalten: received });
        }
        results.push({ subject: w.subject, children: children.length, mailsGesendet: sent.length - sentBefore, replySent: Boolean(lastSent), fehlendeMessageId: missingMessage.length, perChild });
        expect(children.length).toBeGreaterThanOrEqual(2);
        expect(missingMessage).toHaveLength(0); // die Auslese der Teilvorgänge liest die Nachricht des Hauptvorgangs
        for (const c of perChild) expect(c.status).not.toBe('FAILED');
        // Jeder offene Teilvorgang hat die Antwort bekommen: als Fortsetzung (wartete) oder als Zuordnung (wartete nicht) – nichts geht verloren.
        if (lastSent) for (const c of perChild) if (!['COMPLETED', 'CANCELLED'].includes(c.status as string)) expect(Number(c.antwortErhalten) + Number(c.siblingInfo)).toBeGreaterThan(0);
      }
    } finally {
      await setSplit(false);
    }
    record.mehrfachVollstaendig = results;
  });

  // ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  it('P6 tatsächlich erreichbares Geschäftsziel: Auskunft aus dem Betriebswissen wird autonom beantwortet, der Vorgang schließt mit Nachweis – drei Läufe, Variante, neue Formulierung', async () => {
    const wordings: Array<[string, string]> = [
      ['Frage zu Ihren Leistungen', 'Guten Tag, machen Sie auch Badsanierungen, und bis wann sind Sie am Freitag erreichbar? Viele Grüße, Tom Orbit'],
      ['Frage zu Ihren Leistungen', 'Guten Tag, machen Sie auch Badsanierungen, und bis wann sind Sie am Freitag erreichbar? Viele Grüße, Tom Orbit'],
      ['Frage zu Ihren Leistungen', 'Guten Tag, machen Sie auch Badsanierungen, und bis wann sind Sie am Freitag erreichbar? Viele Grüße, Tom Orbit'],
      ['Leistungen und Zeiten', 'Hallo, bieten Sie Wärmepumpen an und wann kann ich Sie montags telefonisch erreichen? Danke, M. Krämer'],
      ['Kommen Sie nach Bergisch Gladbach?', 'Guten Tag, ist Bergisch Gladbach noch in Ihrem Einsatzgebiet, und machen Sie dort auch Rohrreinigung? Gruß, S. Winter'],
    ];
    const runs: Array<Record<string, unknown>> = [];
    for (const [subject, content] of wordings) {
      const { caseId, first } = await submit(subject, content);
      const row = await scoped().case.findUniqueOrThrow({ where: { id: caseId } });
      runs.push({ subject, status: row.orchestrationStatus, outcome: row.outcome, mails: first.map((m) => ({ to: m.to, body: m.bodyText.replace(/\s+/g, ' ').slice(0, 400) })) });
      expect(first.length).toBeGreaterThanOrEqual(1);
      for (const mail of first) {
        expect(mail.to).toBe('hausverwaltung@kunde.example');
        expect(mail.bodyText).not.toMatch(/€|\bEUR\b/);
      }
      expect(row.orchestrationStatus).toBe('COMPLETED');
      expect((row.outcome as { code?: string } | null)?.code).toBeDefined();
    }
    record.erreichbaresZiel = runs;
  });

  // ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  it('P7 Schlüsselbund: ursprünglicher Auftrag, gewählte Ziele, Nachweis und ausdrücklich nicht Nachgewiesenes – vier Läufe', async () => {
    const body = 'Guten Tag, Ihr Monteur hat gestern bei uns im Haus Rheinweg 8 einen Schlüsselbund im Keller liegen lassen. Bitte sagen Sie ihm Bescheid, damit er ihn bei uns abholt, und bestätigen Sie uns kurz, dass diese Nachricht angekommen ist. Viele Grüße, Fritz Lindner';
    const texts: Array<[string, string]> = [
      ['Schlüsselbund im Keller vergessen', body],
      ['Vergessener Schlüsselbund bei uns im Keller', body],
      ['Schlüssel im Keller: bitte Monteur informieren', body],
      ['Liegengebliebene Schlüssel – Rückgabe', 'Hallo, bei der Wartung gestern im Rheinweg 8 ist ein Schlüsselbund im Heizungskeller zurückgeblieben. Könnten Sie dem Techniker ausrichten, dass er ihn abholen kann? Eine kurze Eingangsbestätigung würde uns reichen. Danke, F. Lindner'],
    ];
    const runs: Array<Record<string, unknown>> = [];
    for (const [subject, content] of texts) {
      const { caseId, first } = await submit(subject, content);
      const row = await scoped().case.findUniqueOrThrow({ where: { id: caseId } });
      const plan = await scoped().processPlan.findFirst({ where: { caseId, status: 'ACTIVE' }, orderBy: { revision: 'desc' }, select: { goalKeys: true, explanation: true } });
      const notified = await scoped().processPlanNode.findMany({ where: { plan: { caseId }, nodeKey: { contains: 'notify' } }, select: { nodeKey: true, state: true, output: true } });
      runs.push({ auftrag: content, status: row.orchestrationStatus, ziele: plan?.goalKeys, erklaerung: plan?.explanation?.slice(0, 300), abschluss: row.outcome, meldung: notified.map((n) => ({ knoten: n.nodeKey, zustand: n.state })), mails: first.map((m) => m.bodyText.replace(/\s+/g, ' ').slice(0, 300)) });
      const outcome = row.outcome as { code?: string; goals?: Array<{ goal: string; evidence: string[] }>; notProven?: string } | null;
      if (row.orchestrationStatus === 'COMPLETED') {
        expect(outcome?.code).toBe('ADHOC_GOALS_PROVEN');
        expect(outcome?.goals?.length).toBeGreaterThan(0); // der Abschluss nennt die Ziele und ihre Nachweise
        expect(outcome?.notProven).toMatch(/Dritter|Person/); // und sagt ausdrücklich, was nicht nachgewiesen ist
      }
      for (const mail of first) expect(mail.bodyText).not.toMatch(/abgeholt|zurückgegeben|erledigt/i); // keine Aussage, der Schlüssel sei zurück
    }
    record.schluesselbund = runs;
  });
});
