import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { IntakeService } from '../src/intake/intake.service';
import type { NormalizedIntakeEvent } from '../src/intake/channel-event.types';
import { GmailConnectorService } from '../src/integrations/gmail-connector.service';
import { OUTBOUND_MAIL, type OutboundMailPort } from '../src/integrations/outbound-mail.port';
import { PrismaService } from '../src/prisma/prisma.service';
import { BlueprintRegistryService } from '../src/process/blueprint-registry.service';
import { PlanStoreService } from '../src/process/plan-store.service';
import { ReferenceProcessService } from '../src/process/reference/reference-process.service';
import { TenantsService } from '../src/tenants/tenants.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

const FIXTURES = join(__dirname, '../../../fixtures/process');
const LIVE = process.env.LIVE_AI === '1';
const OUT = process.env.ASSESSMENT_OUT;

interface Scenario {
  id: string;
  trade: string;
  title: string;
  sender: { name: string; address: string };
  subject: string;
  body: string;
}

const sig = (s: Scenario['sender']) => `${s.name}`;
const person = (name: string, local: string) => ({ name, address: `${local}@kunde.example` });

/** Realistische Eingänge aus verschiedenen Gewerken und Anlässen – so, wie sie ein Betrieb täglich bekommt. */
const SCENARIOS: Scenario[] = [
  { id: 'S01', trade: 'Heizung/Sanitär', title: 'Angebot Wärmepumpe (Katalog fremd)', sender: person('Petra Hoffmann', 'p.hoffmann'), subject: 'Angebot Wärmepumpe', body: 'Guten Tag, wir möchten unsere 20 Jahre alte Gasheizung im Einfamilienhaus (140 m², Baujahr 1998) durch eine Wärmepumpe ersetzen. Können Sie uns ein Angebot machen? Viele Grüße' },
  { id: 'S02', trade: 'Dachdecker', title: 'Notfall: Sturmschaden, Dach undicht', sender: person('Michael Brandt', 'm.brandt'), subject: 'DRINGEND Dach undicht nach Sturm', body: 'Hallo, nach dem Sturm heute Nacht sind mehrere Ziegel runter und es regnet bei uns ins Obergeschoss. Wir brauchen so schnell wie möglich jemanden, der das provisorisch abdichtet. Bitte melden Sie sich dringend! Telefon 0171 5551234. Gruß' },
  { id: 'S03', trade: 'Elektriker', title: 'Terminanfrage Prüfung Steckdosen', sender: person('Sabine Krüger', 's.krueger'), subject: 'Termin Elektrik', body: 'Guten Tag, in unserer Wohnung funktionieren zwei Steckdosen im Wohnzimmer nicht mehr. Könnte jemand nächste Woche Mittwoch oder Donnerstag vorbeikommen und sich das ansehen? Viele Grüße' },
  { id: 'S04', trade: 'Sanitär', title: 'Notfall: Wasserrohrbruch', sender: person('Jürgen Lehmann', 'j.lehmann'), subject: 'Wasser im Keller!', body: 'Bei uns ist im Keller ein Rohr geplatzt, das Wasser läuft. Den Haupthahn habe ich zugedreht. Bitte kommen Sie heute noch! Hauptstraße 12 in 50667 Köln. Jürgen Lehmann' },
  { id: 'S05', trade: 'Fenster (Katalog)', title: 'Reklamation nach Montage', sender: person('Anna Schulz', 'a.schulz'), subject: 'Fenster schließt nicht richtig', body: 'Guten Tag, Ihre Monteure haben letzte Woche bei uns neue Fenster eingebaut. Das Fenster im Schlafzimmer schließt nicht richtig und es zieht. Bitte schicken Sie jemanden zur Nachbesserung. Anna Schulz' },
  { id: 'S06', trade: 'allgemein', title: 'Statusanfrage zu früherem Angebot', sender: person('Thomas Weber', 't.weber'), subject: 'Mein Angebot von letzter Woche', body: 'Hallo, ich habe vor einer Woche ein Angebot für die Badsanierung angefragt und noch nichts gehört. Wann kann ich damit rechnen? Thomas Weber' },
  { id: 'S07', trade: 'Lieferant', title: 'Rechnung ohne Anhang', sender: person('Buchhaltung Holz Meier', 'buchhaltung'), subject: 'Rechnung 2026-4711', body: 'Guten Tag, anbei unsere Rechnung 2026-4711 über 1.284,50 EUR, fällig in 14 Tagen. Mit freundlichen Grüßen, Buchhaltung Holz Meier' },
  { id: 'S08', trade: 'Lieferant', title: 'Lieferant bietet Material an', sender: person('Rolf Neumann', 'r.neumann'), subject: 'Sonderaktion Dämmstoffe', body: 'Sehr geehrte Damen und Herren, wir bieten Ihnen aktuell Mineralwolle-Dämmplatten mit 15 % Rabatt bei Abnahme ab 10 Paletten an. Gern senden wir Ihnen ein Angebot. Rolf Neumann, Dämmstoff Neumann GmbH' },
  { id: 'S09', trade: 'Personal', title: 'Bewerbung Ausbildung', sender: person('Lea Fischer', 'l.fischer'), subject: 'Bewerbung um einen Ausbildungsplatz', body: 'Sehr geehrte Damen und Herren, ich möchte mich bei Ihnen um einen Ausbildungsplatz zur Anlagenmechanikerin ab September bewerben. Meinen Lebenslauf füge ich gern bei. Lea Fischer' },
  { id: 'S10', trade: 'allgemein', title: 'Allgemeine Auskunft (Leistungen, Zeiten)', sender: person('Karin Vogel', 'k.vogel'), subject: 'Frage zu Ihren Leistungen', body: 'Guten Tag, machen Sie auch Fliesenarbeiten im Bad? Und bis wann sind Sie telefonisch erreichbar? Karin Vogel' },
  { id: 'S11', trade: 'allgemein', title: 'Terminverschiebung (kein Vorgang bekannt)', sender: person('Stefan Roth', 's.roth'), subject: 'Termin am Freitag', body: 'Hallo, ich muss unseren Termin am Freitag leider verschieben. Geht auch der Montag danach? Stefan Roth' },
  { id: 'S12', trade: 'KFZ-Werkstatt', title: 'Anderes Gewerk: Inspektion', sender: person('Ingo Becker', 'i.becker'), subject: 'Inspektion und Reifenwechsel', body: 'Guten Tag, ich brauche für meinen VW Golf (Baujahr 2017) die Inspektion und den Wechsel auf Winterreifen. Was kostet das ungefähr und wann hätten Sie einen Termin frei? Ingo Becker' },
  { id: 'S13', trade: 'Garten-/Landschaftsbau', title: 'Anderes Gewerk: Heckenschnitt mit Besichtigung', sender: person('Martina Albrecht', 'm.albrecht'), subject: 'Hecke und Rasen', body: 'Hallo, unsere Thujahecke (ca. 30 m, 2,5 m hoch) muss dringend geschnitten werden, und der Rasen sollte neu angelegt werden. Können Sie sich das ansehen und mir ein Angebot machen? Martina Albrecht' },
  { id: 'S14', trade: 'allgemein', title: 'Englische Anfrage', sender: person('John Carter', 'j.carter'), subject: 'Quote for solar panels', body: 'Hello, we own a house near Bonn and would like to install solar panels on our roof (about 60 m²). Could you send us a quote and tell us when someone could visit? Best regards, John Carter' },
  { id: 'S15', trade: 'Marketing', title: 'Newsletter', sender: person('Handwerker Magazin', 'newsletter'), subject: 'Ihr Newsletter im Oktober', body: 'Die wichtigsten Neuigkeiten aus dem Handwerk: Fördermittel, Termine, Tipps. Zum Abbestellen klicken Sie hier. Handwerker Magazin' },
];

(LIVE ? describe : describe.skip)('Autonomy assessment with the real model (live)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;
  const sent: Array<{ to: string; subject: string; bodyText: string }> = [];
  const records: unknown[] = [];

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    prisma = app.get(PrismaService);
    const suffix = randomUUID();
    const { tenant } = await app.get(TenantsService).bootstrapTenant({ name: `Musterwerk Bewertung ${suffix.slice(0, 6)}`, slug: `e2e-assess-${suffix}`, adminEmail: `admin-${suffix}@e2e-assess.example`, adminPassword: 'Musterwerk#2026!', adminFirstName: 'E2E', adminLastName: 'Admin' });
    tenantId = tenant.id;
    await prisma.forTenantId(tenantId).integration.create({ data: { tenantId, connectorType: 'GMAIL', status: 'CONNECTED', externalAccountDisplayName: 'handwerker@e2e.example', grantedCapabilities: ['email.read', 'email.send', 'calendar.freebusy'] } });
    await app.get(ReferenceProcessService).loadFixture(tenantId, JSON.parse(readFileSync(join(FIXTURES, 'reference-data.demo.json'), 'utf8')));
    const blueprints = app.get(BlueprintRegistryService);
    const blueprint = JSON.parse(readFileSync(join(FIXTURES, 'request-for-quote.blueprint.json'), 'utf8')) as { key: string; version: string };
    await blueprints.importDraft(tenantId, 'u1', blueprint);
    for (const to of ['VALIDATING', 'TESTING', 'STAGED', 'PUBLISHED'] as const) await blueprints.transition(tenantId, 'u1', blueprint.key, blueprint.version, to);
    await blueprints.activate(tenantId, 'u1', blueprint.key, blueprint.version);
    // Wie im Demo-Mandanten: Rückfragen an Absender gehen selbstständig hinaus (Regel „autonom“).
    await prisma.forTenantId(tenantId).policyConfig.updateMany({ where: { action: 'email.send.clarification' }, data: { mode: 'AUTONOMOUS' } });
    jest.spyOn(app.get<OutboundMailPort>(OUTBOUND_MAIL), 'send').mockImplementation(async (_t, message) => {
      sent.push(message as never);
      return { providerMessageId: `x-${sent.length}`, from: 'handwerker@e2e.example', executionMode: 'SIMULATED' };
    });
    jest.spyOn(GmailConnectorService.prototype, 'queryFreeBusy').mockResolvedValue([{ calendarId: 'primary', busy: [] }]);
  }, 120_000);

  afterAll(async () => {
    if (OUT) writeFileSync(OUT, JSON.stringify(records, null, 2), 'utf8');
    jest.restoreAllMocks();
    await prisma.withRlsBypass((tx) => tx.tenant.delete({ where: { id: tenantId } }));
    await app.close();
  });

  for (const scenario of SCENARIOS) {
    it(`${scenario.id} ${scenario.trade}: ${scenario.title}`, async () => {
      const tasksBefore = await prisma.forTenantId(tenantId).task.count();
      const sentBefore = sent.length;
      const event: NormalizedIntakeEvent = {
        tenantId: '',
        channel: 'SIMULATED',
        provider: 'simulated',
        externalEventId: randomUUID(),
        occurredAt: new Date(),
        sender: { address: scenario.sender.address, displayName: scenario.sender.name },
        recipients: [{ address: 'info@musterwerk.example' }],
        direction: 'INBOUND',
        subject: scenario.subject,
        content: `${scenario.body}\n\n${sig(scenario.sender)}`,
        threadId: randomUUID(),
        rfcMessageId: `<${randomUUID()}@kunde.example>`,
      };
      const started = Date.now();
      let error: string | undefined;
      let result: Awaited<ReturnType<IntakeService['handleIntakeEvent']>> | undefined;
      try {
        result = await app.get(IntakeService).handleIntakeEvent(tenantId, undefined, event);
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
      const scoped = prisma.forTenantId(tenantId);
      const intakeEvent = result ? await scoped.intakeEvent.findUnique({ where: { id: result.intakeEventId } }) : null;
      const decision = result ? await scoped.intakeDecision.findFirst({ where: { intakeEventId: result.intakeEventId } }) : null;
      const triage = (decision?.result ?? {}) as { category?: string; intents?: Array<{ key: string; confidence: number }>; businessRelevance?: string; riskFlags?: string[]; conciseReason?: string; confidence?: { intent?: number } };
      const caseRow = result?.case ? await scoped.case.findUnique({ where: { id: result.case.id } }) : null;
      const graph = caseRow ? await app.get(PlanStoreService).getActive(tenantId, caseRow.id) : undefined;
      const drafts = caseRow ? await scoped.communicationDraft.findMany({ where: { caseId: caseRow.id } }) : [];
      const tasks = (await scoped.task.findMany({ orderBy: { createdAt: 'desc' }, take: Math.max(0, (await scoped.task.count()) - tasksBefore) })).map((t) => t.title);
      const record = {
        id: scenario.id,
        trade: scenario.trade,
        title: scenario.title,
        seconds: Math.round((Date.now() - started) / 100) / 10,
        error,
        triage: { category: triage.category, intent: triage.intents?.[0]?.key, intentConfidence: triage.confidence?.intent, relevance: triage.businessRelevance, riskFlags: triage.riskFlags, reason: triage.conciseReason?.slice(0, 220) },
        intake: { status: intakeEvent?.status, appliedRelevance: intakeEvent?.relevance, domain: intakeEvent?.domainCategory, note: intakeEvent?.errorMessage?.slice(0, 200) },
        case: caseRow ? { type: caseRow.type, status: caseRow.orchestrationStatus, blueprint: caseRow.blueprintKey, attention: caseRow.attentionReasons.slice(0, 2) } : null,
        plan: graph ? graph.nodes.map((n) => `${n.nodeKey}:${n.state}${n.executionMode ? '/' + n.executionMode : ''}`) : null,
        drafts: drafts.map((d) => ({ purpose: d.purpose, excerpt: d.bodyText.replace(/\s+/g, ' ').slice(0, 520) })),
        humanTasks: tasks,
        mailsSentAutonomously: sent.length - sentBefore,
      };
      records.push(record);
      console.log(`ASSESS ${JSON.stringify(record)}`);
    }, 240_000);
  }
});
