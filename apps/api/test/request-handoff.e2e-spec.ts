import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { MockLLMProvider } from '@orbit/agent-core';
import { triageFixtureForScenario } from '@orbit/shared';
import { LLM_PROVIDER } from '../src/agent/agent.tokens';
import { AiProviderResolverService } from '../src/ai-providers/ai-provider-resolver.service';
import type { NormalizedIntakeEvent } from '../src/intake/channel-event.types';
import { IntakeService } from '../src/intake/intake.service';
import { GmailConnectorService } from '../src/integrations/gmail-connector.service';
import { OUTBOUND_MAIL, type OutboundMailPort, type OutboundMessage } from '../src/integrations/outbound-mail.port';
import { PrismaService } from '../src/prisma/prisma.service';
import { BlueprintRegistryService } from '../src/process/blueprint-registry.service';
import { PlanStoreService } from '../src/process/plan-store.service';
import { TenantsService } from '../src/tenants/tenants.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

const FIXTURES = join(__dirname, '../../../fixtures/process');
const SENDER = 'tom@kunde.example';
const REQUEST = 'Guten Tag, wir möchten unsere alte Gasheizung durch eine Wärmepumpe ersetzen. Das Haus hat ca. 140 m² Wohnfläche. Bitte melden Sie sich. Tom Kunde';

/**
 * Der Ablauf „Anfrage aufnehmen und übergeben“ (REQUEST_FOR_QUOTE 2.0.0) Ende zu Ende gegen echte Postgres: Klärungsrunden (höchstens drei), Termin nur mit angebundenem
 * Kalender, Übergabe an das CRM mit Zusammenfassung, Benachrichtigung, Bestätigung an die Kundschaft. Das Modell zählt als echte KI und antwortet aus der Skript-Warteschlange;
 * Versand und Kalender sind Aufzeichnungs-Doubles – nichts verlässt den Testprozess. ORBIT erstellt in diesem Ablauf weder ein Angebot noch einen Preis.
 */
describe('Anfrage aufnehmen und übergeben (e2e)', () => {
  jest.setTimeout(120_000); // mehrere Klärungsrunden mit je eigener Auswertung
  let app: INestApplication;
  let prisma: PrismaService;
  let intake: IntakeService;
  let store: PlanStoreService;
  let llm: MockLLMProvider;
  let sent: OutboundMessage[] = [];
  let created: Array<Record<string, unknown>> = [];
  const spies: jest.SpyInstance[] = [];
  const tenants: string[] = [];
  const connectionByTenant = new Map<string, string>();

  async function newTenant(options: { calendar?: boolean } = {}): Promise<string> {
    const suffix = randomUUID();
    const { tenant } = await app.get(TenantsService).bootstrapTenant({ name: `Handoff ${suffix.slice(0, 8)}`, slug: `e2e-handoff-${suffix}`, adminEmail: `admin-${suffix}@e2e-handoff.example`, adminPassword: 'Musterwerk#2026!', adminFirstName: 'A', adminLastName: 'A' });
    tenants.push(tenant.id);
    const grantedCapabilities = ['email.read', 'email.send', ...(options.calendar ? ['calendar.freebusy', 'calendar.write'] : [])];
    const integration = await prisma.forTenantId(tenant.id).integration.create({ data: { tenantId: tenant.id, connectorType: 'GMAIL', status: 'CONNECTED', externalAccountDisplayName: 'firma@e2e.example', grantedCapabilities } });
    connectionByTenant.set(tenant.id, integration.id);
    for (const action of ['email.send.clarification', 'email.send.acknowledgement', 'meeting.create', 'lead.create', 'staff.notify', 'crm.contact.manage']) {
      await prisma.forTenantId(tenant.id).policyConfig.upsert({ where: { tenantId_action: { tenantId: tenant.id, action } }, create: { tenantId: tenant.id, action, mode: 'AUTONOMOUS' }, update: { mode: 'AUTONOMOUS' } });
    }
    await prisma.forTenantId(tenant.id).tenantProfile.create({ data: { tenantId: tenant.id, industry: 'Heizung und Sanitär', description: 'Wir installieren Heizungen.', services: ['Heizungsinstallation'], faqs: [] } });
    const blueprints = app.get(BlueprintRegistryService);
    const blueprint = JSON.parse(readFileSync(join(FIXTURES, 'request-for-quote.handoff.blueprint.json'), 'utf8')) as { key: string; version: string };
    await blueprints.importDraft(tenant.id, 'u1', blueprint);
    for (const to of ['VALIDATING', 'TESTING', 'STAGED', 'PUBLISHED'] as const) await blueprints.transition(tenant.id, 'u1', blueprint.key, blueprint.version, to);
    await blueprints.activate(tenant.id, 'u1', blueprint.key, blueprint.version);
    return tenant.id;
  }

  function seedTool(toolName: string, input: Record<string, unknown>): void {
    llm.seedResponse({ toolCalls: [{ toolCallId: randomUUID(), toolName, input }], stopReason: 'tool_use' });
    llm.seedResponse({ text: 'ok', toolCalls: [], stopReason: 'end_turn' });
  }
  const seedTriage = () => seedTool('submit_triage_result', triageFixtureForScenario('REQUEST_FOR_QUOTE') as unknown as Record<string, unknown>);
  const seedExtraction = (facts: Array<{ key: string; value: string | number; evidence: string }> = []) => seedTool('submit_extracted_facts', { facts: facts.map((f) => ({ ...f, confidence: 0.9 })) });
  const seedAnalysis = (over: Record<string, unknown> = {}) =>
    seedTool('submit_request_analysis', {
      requestType: 'Wärmepumpe',
      summary: 'Ersatz der Gasheizung durch eine Wärmepumpe im Haus mit etwa 140 m² Wohnfläche.',
      knownDetails: [{ key: 'living_area', label: 'Wohnfläche', value: '140 m²', evidence: 'ca. 140 m² Wohnfläche', confidence: 0.95 }],
      missingInformation: [{ key: 'hot_water', label: 'Warmwasser über die Wärmepumpe', question: 'Soll die Wärmepumpe auch das Warmwasser übernehmen?' }],
      siteVisit: { recommended: false, reason: '' },
      nextStep: 'ASK_CUSTOMER',
      ...over,
    });

  function mail(tenantId: string, over: Partial<NormalizedIntakeEvent> = {}): NormalizedIntakeEvent {
    return { tenantId, channel: 'SIMULATED', provider: 'simulated', externalEventId: randomUUID(), occurredAt: new Date(), sender: { address: SENDER, displayName: 'Tom Kunde' }, recipients: [{ address: 'info@betrieb.example' }], direction: 'INBOUND', connectionId: connectionByTenant.get(tenantId), subject: 'Wärmepumpe', content: REQUEST, threadId: 'thr-1', rfcMessageId: '<m1@kunde.example>', ...over };
  }
  /** Die Antwort der Kundschaft auf die zuletzt gesendete Nachricht (gleicher Faden, Bezug auf deren Message-ID). */
  const reply = (tenantId: string, content: string, n: number) =>
    intake.handleIntakeEvent(tenantId, undefined, mail(tenantId, { subject: 'Re: Wärmepumpe', content, rfcMessageId: `<m${n + 1}@kunde.example>`, inReplyTo: `<sent-${sent.length}@mail.example>`, references: [`<m1@kunde.example>`, `<sent-${sent.length}@mail.example>`] }));

  const caseOf = (tenantId: string, caseId: string) => prisma.forTenantId(tenantId).case.findUniqueOrThrow({ where: { id: caseId } });
  const nodeState = async (tenantId: string, caseId: string, key: string) => (await store.getActive(tenantId, caseId))?.nodes.find((n) => n.nodeKey === key)?.state;

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    prisma = app.get(PrismaService);
    intake = app.get(IntakeService);
    store = app.get(PlanStoreService);
    llm = app.get(LLM_PROVIDER);
    const live = { providerName: 'scripted-live', modelName: 'scripted', complete: (request: Parameters<MockLLMProvider['complete']>[0]) => llm.complete(request) };
    spies.push(jest.spyOn(app.get(AiProviderResolverService), 'resolveForTenant').mockResolvedValue(live as never));
    spies.push(
      jest.spyOn(app.get<OutboundMailPort>(OUTBOUND_MAIL), 'send').mockImplementation(async (_tenant, message) => {
        sent.push(message);
        return { providerMessageId: `gm-${sent.length}`, threadId: message.threadId ?? 'thr-1', rfcMessageId: `<sent-${sent.length}@mail.example>`, from: 'firma@e2e.example', executionMode: 'SIMULATED' };
      }),
      jest.spyOn(GmailConnectorService.prototype, 'queryFreeBusy').mockResolvedValue([{ calendarId: 'primary', busy: [] }]),
      jest.spyOn(GmailConnectorService.prototype, 'createCalendarEvent').mockImplementation(async (_tenant, input) => {
        created.push(input as unknown as Record<string, unknown>);
        return { eventId: input.eventId, alreadyExisted: false };
      }),
    );
  });
  beforeEach(() => {
    sent = [];
    created = [];
  });
  afterAll(async () => {
    for (const spy of spies) spy.mockRestore();
    for (const id of tenants) await prisma.withRlsBypass((tx) => tx.tenant.deleteMany({ where: { id } }));
    await app.close();
  });

  it('eine Rückfrage, die Antwort genügt: Übergabe an das CRM mit Zusammenfassung, Benachrichtigung und Eingangsbestätigung – kein Angebot, kein Preis', async () => {
    const tenantId = await newTenant();
    seedTriage();
    seedExtraction();
    seedAnalysis();
    const first = await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId));
    const caseId = first.case!.id;

    // Rückfrage: nur das, was fehlt; ohne ein Wort über ein Angebot.
    expect(sent).toHaveLength(1);
    expect(sent[0]!.bodyText).toContain('Soll die Wärmepumpe auch das Warmwasser übernehmen?');
    expect(sent[0]!.bodyText).toContain('Damit wir Ihre Anfrage gut vorbereiten können');
    expect(sent[0]!.bodyText).not.toMatch(/Angebot/);
    expect(sent[0]!.bodyText).not.toContain('Wohnfläche?'); // schon bekannte Angaben werden nicht erfragt
    expect(sent[0]!.bodyText).not.toContain('so verstanden'); // die KI-Zusammenfassung bleibt intern (CRM)
    expect(await nodeState(tenantId, caseId, 'wait1')).toBe('WAITING');

    seedExtraction([{ key: 'ai.hot_water', value: 'ja', evidence: 'auch das Warmwasser' }]);
    await reply(tenantId, 'Ja, die Wärmepumpe soll auch das Warmwasser übernehmen.', 1);

    // Alles da: keine zweite Runde, Übergabe, Benachrichtigung, Eingangsbestätigung (ohne Kalender keine Buchung).
    expect(await nodeState(tenantId, caseId, 'ask2')).toBe('SKIPPED');
    expect(await nodeState(tenantId, caseId, 'book')).toBe('SKIPPED');
    expect(await nodeState(tenantId, caseId, 'lead')).toBe('SUCCEEDED');
    expect(await nodeState(tenantId, caseId, 'notify')).toBe('SUCCEEDED');
    expect(sent).toHaveLength(2);
    expect(sent[1]!.bodyText).toContain('Sie ist bei uns eingegangen');
    expect(sent[1]!.bodyText).toContain('zu „Wärmepumpe“'); // ohne „Re:“

    const lead = await prisma.forTenantId(tenantId).lead.findFirstOrThrow({ where: { caseId } });
    expect(lead.notes).toContain('Kundschaft: Tom Kunde <tom@kunde.example>');
    expect(lead.notes).toContain('- Wohnfläche: 140 m²');
    expect(lead.notes).toContain('- Warmwasser über die Wärmepumpe: ja');
    expect(lead.notes).not.toContain('Noch offen');
    expect(await prisma.forTenantId(tenantId).quote.count({ where: { caseId } })).toBe(0);
    expect(await prisma.forTenantId(tenantId).attentionItem.count({ where: { caseId, kind: 'NOTIFY_REQUEST' } })).toBe(1);

    const row = await caseOf(tenantId, caseId);
    expect(row).toMatchObject({ blueprintKey: 'REQUEST_FOR_QUOTE', blueprintVersion: '2.0.1', orchestrationStatus: 'COMPLETED' });
    expect(row.outcome).toMatchObject({ code: 'COMPLETION_CRITERIA_MET' });
  });

  it('bleibt die Antwort unvollständig, wird höchstens dreimal gefragt – danach geht die Anfrage mit den offenen Punkten an einen Menschen', async () => {
    const tenantId = await newTenant();
    seedTriage();
    seedExtraction();
    seedAnalysis();
    const first = await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId));
    const caseId = first.case!.id;
    expect(sent).toHaveLength(1);

    for (const n of [1, 2]) {
      seedExtraction();
      await reply(tenantId, `Das weiß ich leider nicht (${n}).`, n);
      expect(sent).toHaveLength(n + 1);
      expect(sent[n]!.bodyText).toContain('vielen Dank für Ihre Antwort');
      expect(sent[n]!.bodyText).toContain('fehlen uns noch folgende Angaben');
    }
    seedExtraction();
    await reply(tenantId, 'Tut mir leid, dazu kann ich nichts sagen (3).', 3);

    // Nach der dritten Antwort keine vierte Frage: Übergabe mit offenem Punkt, dann Eingangsbestätigung.
    expect(await nodeState(tenantId, caseId, 'ask3')).toBe('SUCCEEDED');
    expect(await nodeState(tenantId, caseId, 'lead')).toBe('SUCCEEDED');
    expect(sent.map((m) => m.bodyText.includes('Sie ist bei uns eingegangen'))).toEqual([false, false, false, true]);
    const lead = await prisma.forTenantId(tenantId).lead.findFirstOrThrow({ where: { caseId } });
    expect(lead.notes).toContain('Noch offen:\n- Soll die Wärmepumpe auch das Warmwasser übernehmen?');
    expect(lead.notes).toContain('- Wohnfläche: 140 m²');
    expect((await caseOf(tenantId, caseId)).orchestrationStatus).toBe('COMPLETED');
  });

  it('mit angebundenem Kalender: Terminvorschlag, gewählter Termin wird gebucht, die Kundschaft bekommt die Terminbestätigung und das CRM den gebuchten Termin', async () => {
    const tenantId = await newTenant({ calendar: true });
    seedTriage();
    seedExtraction();
    seedAnalysis({ missingInformation: [{ key: 'preferred_visit_times', label: 'Mögliche Besichtigungstermine', question: 'Welche Tage oder Zeitfenster passen Ihnen für eine Besichtigung?' }], siteVisit: { recommended: true, reason: 'Die Auslegung braucht die Gegebenheiten vor Ort.' }, nextStep: 'PROPOSE_SITE_VISIT' });
    const first = await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId));
    const caseId = first.case!.id;
    expect(sent).toHaveLength(1);
    expect(sent[0]!.bodyText).toContain('vor Ort an');
    expect(sent[0]!.bodyText).toContain('eine verlässliche Einschätzung');
    expect(sent[0]!.bodyText).not.toContain('Welche Tage oder Zeitfenster'); // die Terminzeiten kommen nur als Vorschläge, nicht zusätzlich als Frage
    expect(sent[0]!.bodyText).not.toMatch(/Angebot/);
    const proposed = await prisma.forTenantId(tenantId).caseEvent.findFirstOrThrow({ where: { caseId, type: 'appointment.proposed' } });
    expect((proposed.payload as { slots: unknown[] }).slots.length).toBeGreaterThan(0);

    seedExtraction([{ key: 'appointment.agreed', value: 'Der erste Termin passt mir gut.', evidence: 'Der erste Termin passt mir gut' }]);
    seedTool('submit_slot_choice', { slotIndex: 0, evidence: 'Der erste Termin passt mir gut' });
    await reply(tenantId, 'Der erste Termin passt mir gut.', 1);

    expect(created).toHaveLength(1);
    expect(await nodeState(tenantId, caseId, 'book')).toBe('SUCCEEDED');
    expect(await nodeState(tenantId, caseId, 'ack')).toBe('SKIPPED'); // statt der Eingangsbestätigung geht die Terminbestätigung
    expect(sent).toHaveLength(2);
    expect(sent[1]!.to).toBe(SENDER);
    const lead = await prisma.forTenantId(tenantId).lead.findFirstOrThrow({ where: { caseId } });
    expect(lead.notes).toMatch(/Termin: Vor-Ort-Termin gebucht für /);
    expect((await caseOf(tenantId, caseId)).orchestrationStatus).toBe('COMPLETED');
  });
});
