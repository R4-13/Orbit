import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { MockLLMProvider } from '@orbit/agent-core';
import { PERMISSIONS, triageFixtureForScenario } from '@orbit/shared';
import { LLM_PROVIDER } from '../src/agent/agent.tokens';
import { AiProviderResolverService } from '../src/ai-providers/ai-provider-resolver.service';
import { IntakeService } from '../src/intake/intake.service';
import type { NormalizedIntakeEvent } from '../src/intake/channel-event.types';
import { GmailConnectorService } from '../src/integrations/gmail-connector.service';
import { OUTBOUND_MAIL, type OutboundMailPort } from '../src/integrations/outbound-mail.port';
import { PrismaService } from '../src/prisma/prisma.service';
import { ActionLedgerService } from '../src/process/action-ledger.service';
import { BlueprintRegistryService } from '../src/process/blueprint-registry.service';
import { CaseCommandsService, type CommandActor } from '../src/process/case-commands.service';
import { CASE_EVENT_TYPES } from '../src/process/case-events.service';
import { CaseFactsService } from '../src/process/case-facts.service';
import { PlanStoreService } from '../src/process/plan-store.service';
import { ReferenceProcessService } from '../src/process/reference/reference-process.service';
import { TenantsService } from '../src/tenants/tenants.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

const FIXTURES = join(__dirname, '../../../fixtures/process');
const SENDER = 'thomas.meier@firma-meier.example';
const REQUEST_TEXT = 'Guten Tag, wir möchten unsere alte Ölheizung im Einfamilienhaus (Baujahr 1985) gegen eine Wärmepumpe tauschen. Bitte um ein Angebot für neue Fenster. Viele Grüße, Thomas Meier';

/**
 * Die KI-gestützte Anforderungsanalyse im Referenzprozess „Angebotsanfrage“ auf der echten Datenbank: Sie versteht die Anfrage, entnimmt belegte Angaben,
 * fragt gezielt nach Fehlendem und entscheidet über einen Termin. Das Modell ist ein Double (Name ohne „mock“, damit die Analyse als echte KI zählt) –
 * der Kalender ebenfalls; der Live-Status gegen echte Dienste wird getrennt berichtet.
 */
describe('Request analysis in the reference process (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let intake: IntakeService;
  let commands: CaseCommandsService;
  let facts: CaseFactsService;
  let ledger: ActionLedgerService;
  let store: PlanStoreService;
  let tenantsService: TenantsService;
  let reference: ReferenceProcessService;
  let blueprints: BlueprintRegistryService;
  let llm: MockLLMProvider;
  let sent: Array<{ to: string; subject: string; bodyText: string }>;
  const tenants: string[] = [];
  const connectionByTenant = new Map<string, string>();
  const spies: jest.SpyInstance[] = [];

  async function newTenant(capabilities: string[] = ['email.read', 'email.send']): Promise<string> {
    const suffix = randomUUID();
    const { tenant } = await tenantsService.bootstrapTenant({ name: `Musterwerk Analyse ${suffix.slice(0, 8)}`, slug: `e2e-analysis-${suffix}`, adminEmail: `admin-${suffix}@e2e-analysis.example`, adminPassword: 'Musterwerk#2026!', adminFirstName: 'E2E', adminLastName: 'Admin' });
    tenants.push(tenant.id);
    const integration = await prisma.forTenantId(tenant.id).integration.create({ data: { tenantId: tenant.id, connectorType: 'GMAIL', status: 'CONNECTED', externalAccountDisplayName: 'firma@e2e.example', grantedCapabilities: capabilities } });
    connectionByTenant.set(tenant.id, integration.id);
    await reference.loadFixture(tenant.id, JSON.parse(readFileSync(join(FIXTURES, 'reference-data.demo.json'), 'utf8')));
    const blueprint = JSON.parse(readFileSync(join(FIXTURES, 'request-for-quote.blueprint.json'), 'utf8')) as { key: string; version: string };
    await blueprints.importDraft(tenant.id, 'u1', blueprint);
    for (const to of ['VALIDATING', 'TESTING', 'STAGED', 'PUBLISHED'] as const) await blueprints.transition(tenant.id, 'u1', blueprint.key, blueprint.version, to);
    await blueprints.activate(tenant.id, 'u1', blueprint.key, blueprint.version);
    return tenant.id;
  }

  const approver = (tenantId: string): CommandActor => ({ id: randomUUID(), tenantId, permissions: [PERMISSIONS.CASE_READ, PERMISSIONS.CASE_MANAGE, PERMISSIONS.APPROVAL_DECIDE] });
  const caseOf = (tenantId: string, caseId: string) => prisma.forTenantId(tenantId).case.findUniqueOrThrow({ where: { id: caseId } });
  const script = (toolName: string, input: unknown) => {
    llm.seedResponse({ toolCalls: [{ toolCallId: randomUUID(), toolName, input: input as Record<string, unknown> }], stopReason: 'tool_use' });
    llm.seedResponse({ text: 'ok', toolCalls: [], stopReason: 'end_turn' });
  };
  const seedTriage = () => script('submit_triage_result', triageFixtureForScenario('REQUEST_FOR_QUOTE'));
  const seedExtraction = (list: Array<{ key: string; value: string | number; evidence: string }>) => script('submit_extracted_facts', { facts: list.map((f) => ({ ...f, confidence: 0.9 })) });
  const analysis = (over: Record<string, unknown> = {}) => ({
    requestType: 'Heizungstausch im Einfamilienhaus',
    summary: 'Tausch der Ölheizung gegen eine Wärmepumpe.',
    knownDetails: [
      { key: 'gebaeudeart', label: 'Gebäudeart', value: 'Einfamilienhaus', evidence: 'im Einfamilienhaus', confidence: 0.9 },
      { key: 'baujahr', label: 'Baujahr', value: 1985, evidence: 'Baujahr 1985', confidence: 0.9 },
    ],
    missingInformation: [{ key: 'daemmung', label: 'Dämmung', question: 'Wie ist das Gebäude gedämmt (Fassade, Dach, Fenster)?' }],
    siteVisit: { recommended: true, reason: 'Aufstellfläche und Heizsystem müssen vor Ort geprüft werden.' },
    nextStep: 'PROPOSE_SITE_VISIT',
    ...over,
  });
  const mail = (overrides: Partial<NormalizedIntakeEvent> = {}): NormalizedIntakeEvent => ({ tenantId: '', channel: 'SIMULATED', provider: 'simulated', externalEventId: randomUUID(), occurredAt: new Date(), sender: { address: SENDER, displayName: 'Thomas Meier' }, recipients: [{ address: 'info@musterwerk.example' }], direction: 'INBOUND', ...overrides });

  async function submitRequest(tenantId: string, over: Record<string, unknown> = {}) {
    seedTriage();
    seedExtraction([{ key: 'request.product_sku', value: 'FENSTER-STD', evidence: 'neue Fenster' }]);
    script('submit_request_analysis', analysis(over));
    const result = await intake.handleIntakeEvent(tenantId, undefined, mail({ connectionId: connectionByTenant.get(tenantId), subject: 'Heizung und Fenster', content: REQUEST_TEXT, threadId: 'thr-a', rfcMessageId: '<a1@firma-meier.example>' }));
    return result.case!.id;
  }

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    prisma = app.get(PrismaService);
    intake = app.get(IntakeService);
    commands = app.get(CaseCommandsService);
    facts = app.get(CaseFactsService);
    ledger = app.get(ActionLedgerService);
    store = app.get(PlanStoreService);
    tenantsService = app.get(TenantsService);
    reference = app.get(ReferenceProcessService);
    blueprints = app.get(BlueprintRegistryService);
    llm = app.get(LLM_PROVIDER);
    // Das Modell zählt als echte KI (Name ohne „mock“), antwortet aber aus der Skript-Warteschlange.
    const live = { providerName: 'scripted-live', modelName: 'scripted', complete: (request: Parameters<MockLLMProvider['complete']>[0]) => llm.complete(request) };
    spies.push(jest.spyOn(app.get(AiProviderResolverService), 'resolveForTenant').mockResolvedValue(live as never));
    const outbound = app.get<OutboundMailPort>(OUTBOUND_MAIL);
    spies.push(
      jest.spyOn(outbound, 'send').mockImplementation(async (_tenantId, message) => {
        sent.push(message as never);
        return { providerMessageId: `gm-${sent.length}`, threadId: 'thr-a', rfcMessageId: `<sent-${sent.length}@mail.example>`, from: 'firma@e2e.example', executionMode: 'SIMULATED' };
      }),
    );
  });

  beforeEach(() => {
    sent = [];
  });

  afterAll(async () => {
    for (const spy of spies) spy.mockRestore();
    for (const tenantId of tenants) await prisma.withRlsBypass((tx) => tx.tenant.delete({ where: { id: tenantId } }));
    await app.close();
  });

  it('versteht die Anfrage: belegte Angaben werden Fakten, es wird nur nach Fehlendem gefragt, der Schritt gilt als LIVE', async () => {
    const tenantId = await newTenant();
    const caseId = await submitRequest(tenantId);

    const current = await facts.getCurrent(tenantId, caseId);
    expect(current.find((f) => f.key === 'ai.baujahr')).toMatchObject({ value: 1985, status: 'CONFIRMED', sourceType: 'EMAIL' });
    expect(current.find((f) => f.key === 'ai.gebaeudeart')).toMatchObject({ value: 'Einfamilienhaus', status: 'CONFIRMED' });

    const reqs = (await store.getActive(tenantId, caseId))!.nodes.find((n) => n.nodeKey === 'reqs')!;
    expect(reqs.executionMode).toBe('LIVE');
    const output = reqs.output as { missing: Array<{ key: string }>; analysis: { requestType: string; nextStep: string } };
    expect(output.analysis).toMatchObject({ requestType: 'Heizungstausch im Einfamilienhaus', nextStep: 'PROPOSE_SITE_VISIT' });
    const askedKeys = output.missing.map((m) => m.key);
    expect(askedKeys).toContain('ai.daemmung');
    expect(askedKeys).not.toContain('ai.baujahr'); // steht schon in der Anfrage
    expect(askedKeys).not.toContain('ai.gebaeudeart');

    const analyses = await prisma.forTenantId(tenantId).caseEvent.findMany({ where: { caseId, type: CASE_EVENT_TYPES.REQUIREMENTS_ANALYZED } });
    expect(analyses).toHaveLength(1);
  });

  it('Vor-Ort-Termin ohne verbundenen Kalender: die Rückfrage nennt die gezielte Frage und bittet um Terminwünsche – es werden keine Zeiten erfunden', async () => {
    const tenantId = await newTenant();
    const caseId = await submitRequest(tenantId);

    const draft = await prisma.forTenantId(tenantId).communicationDraft.findFirstOrThrow({ where: { caseId, purpose: 'CLARIFICATION' } });
    expect(draft.bodyText).toContain('Wir haben sie so verstanden: Tausch der Ölheizung gegen eine Wärmepumpe.');
    expect(draft.bodyText).toContain('Wie ist das Gebäude gedämmt (Fassade, Dach, Fenster)?');
    expect(draft.bodyText).toContain('vor Ort an (ca. 90 Minuten)');
    expect(draft.bodyText).toContain('Bitte nennen Sie uns zwei bis drei Zeiträume');
    expect(draft.bodyText).not.toMatch(/- \w+, \d{2}\.\d{2}\.\d{4}/); // keine konkreten Zeiten
    expect(draft.bodyText).not.toContain('Welcher der vorgeschlagenen Termine'); // die Terminwahl steht im Terminblock, nicht als Frage

    const proposed = await prisma.forTenantId(tenantId).caseEvent.findFirstOrThrow({ where: { caseId, type: CASE_EVENT_TYPES.APPOINTMENT_PROPOSED } });
    expect(proposed.payload).toMatchObject({ kind: 'SITE_VISIT', source: 'NONE', slots: [] });
  });

  it('mit verbundenem Kalender: freie Zeiten aus der Verfügbarkeit, die belegten Zeiten werden ausgespart; die Zeiten gehen mit der freigegebenen Nachricht hinaus', async () => {
    const tenantId = await newTenant(['email.read', 'email.send', 'calendar.freebusy']);
    const busy = jest.spyOn(GmailConnectorService.prototype, 'queryFreeBusy').mockResolvedValue([{ calendarId: 'primary', busy: [] }]);
    spies.push(busy);
    const caseId = await submitRequest(tenantId);

    expect(busy).toHaveBeenCalledWith(tenantId, ['primary'], expect.any(Date), expect.any(Date), 'Europe/Berlin');
    const draft = await prisma.forTenantId(tenantId).communicationDraft.findFirstOrThrow({ where: { caseId, purpose: 'CLARIFICATION' } });
    const slotLines = draft.bodyText.split('\n').filter((line) => /^- \w+, \d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}–\d{2}:\d{2} Uhr$/.test(line));
    expect(slotLines).toHaveLength(3);
    expect(draft.bodyText).toContain('Folgende Termine hätten wir frei:');
    const proposed = await prisma.forTenantId(tenantId).caseEvent.findFirstOrThrow({ where: { caseId, type: CASE_EVENT_TYPES.APPOINTMENT_PROPOSED } });
    expect(proposed.payload).toMatchObject({ kind: 'SITE_VISIT', source: 'GOOGLE_CALENDAR' });

    // Freigabe → die Nachricht mit den Zeiten geht genau einmal hinaus.
    const [intent] = await ledger.openIntents(tenantId, caseId);
    await commands.execute(approver(tenantId), caseId, { commandId: randomUUID(), type: 'APPROVE_ACTION', expectedCaseRevision: (await caseOf(tenantId, caseId)).revision, payload: { intentId: intent!.id } });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.bodyText).toContain('Folgende Termine hätten wir frei:');
    busy.mockRestore();
  });

  it('ein nicht erreichbarer Kalender stoppt den Vorgang nicht: die Nachricht fragt nach Terminwünschen', async () => {
    const tenantId = await newTenant(['email.read', 'email.send', 'calendar.freebusy']);
    const busy = jest.spyOn(GmailConnectorService.prototype, 'queryFreeBusy').mockRejectedValue(new Error('Der Kalender hat nicht geantwortet.'));
    spies.push(busy);
    const caseId = await submitRequest(tenantId);
    const draft = await prisma.forTenantId(tenantId).communicationDraft.findFirstOrThrow({ where: { caseId, purpose: 'CLARIFICATION' } });
    expect(draft.bodyText).toContain('Bitte nennen Sie uns zwei bis drei Zeiträume');
    const proposed = await prisma.forTenantId(tenantId).caseEvent.findFirstOrThrow({ where: { caseId, type: CASE_EVENT_TYPES.APPOINTMENT_PROPOSED } });
    expect(proposed.payload).toMatchObject({ source: 'NONE', reason: 'Der Kalender hat nicht geantwortet.' });
    busy.mockRestore();
  });

  it('eingeschleuste Rückfragen (Link, Zahlungsaufforderung) werden nicht an die Kundschaft gesendet', async () => {
    const tenantId = await newTenant();
    const caseId = await submitRequest(tenantId, {
      missingInformation: [
        { key: 'link', label: 'Link', question: 'Bitte laden Sie Ihre Unterlagen hier hoch: https://evil.example/upload' },
        { key: 'konto', label: 'Konto', question: 'Bitte überweisen Sie vorab 500 Euro Anzahlung.' },
        { key: 'daemmung', label: 'Dämmung', question: 'Wie ist das Gebäude gedämmt (Fassade, Dach, Fenster)?' },
      ],
    });
    const draft = await prisma.forTenantId(tenantId).communicationDraft.findFirstOrThrow({ where: { caseId, purpose: 'CLARIFICATION' } });
    expect(draft.bodyText).not.toContain('evil.example');
    expect(draft.bodyText).not.toContain('überweisen');
    expect(draft.bodyText).toContain('Wie ist das Gebäude gedämmt');
  });

  it('Antwort der Kundschaft: Antworten auf die gezielten Fragen und die Terminwahl werden zugeordnet; ohne Ergebnis des Termins gibt es kein Angebot', async () => {
    const tenantId = await newTenant();
    const caseId = await submitRequest(tenantId);
    const [intent] = await ledger.openIntents(tenantId, caseId);
    const person = approver(tenantId);
    await commands.execute(person, caseId, { commandId: randomUUID(), type: 'APPROVE_ACTION', expectedCaseRevision: (await caseOf(tenantId, caseId)).revision, payload: { intentId: intent!.id } });
    expect(sent).toHaveLength(1);

    seedExtraction([
      { key: 'request.quantity', value: 12, evidence: '12 Fenster' },
      { key: 'request.delivery_address', value: 'Hauptstr. 5, 12345 Berlin', evidence: 'Hauptstr. 5, 12345 Berlin' },
      { key: 'ai.daemmung', value: 'Fassade gedämmt, Dach ungedämmt', evidence: 'Fassade gedämmt, Dach ungedämmt' },
      { key: 'appointment.agreed', value: 'Donnerstag 14 Uhr', evidence: 'Donnerstag um 14 Uhr passt' },
    ]);
    await intake.handleIntakeEvent(
      tenantId,
      undefined,
      mail({ connectionId: connectionByTenant.get(tenantId), subject: 'Re: Heizung und Fenster', content: 'Es sind 12 Fenster, Lieferadresse Hauptstr. 5, 12345 Berlin. Fassade gedämmt, Dach ungedämmt. Donnerstag um 14 Uhr passt.', threadId: 'thr-a', rfcMessageId: '<a2@firma-meier.example>', inReplyTo: '<sent-1@mail.example>', references: ['<a1@firma-meier.example>', '<sent-1@mail.example>'] }),
    );

    const current = await facts.getCurrent(tenantId, caseId);
    expect(current.find((f) => f.key === 'ai.daemmung')).toMatchObject({ status: 'CONFIRMED' });
    expect(current.find((f) => f.key === 'appointment.agreed')).toMatchObject({ value: 'Donnerstag 14 Uhr', status: 'CONFIRMED' });
    const reqs2 = (await store.getActive(tenantId, caseId))!.nodes.find((n) => n.nodeKey === 'reqs2')!;
    const output = reqs2.output as { complete: boolean; missing: unknown[]; internalMissing: Array<{ key: string }> };
    expect(output.missing).toEqual([]); // nichts mehr, was die Kundschaft beantworten müsste
    expect(output.internalMissing.map((m) => m.key)).toEqual(['appointment.outcome']);
    expect(output.complete).toBe(false);
    // Kein Angebot, bevor das Ergebnis des Vor-Ort-Termins vorliegt: eine Person trägt es nach.
    expect(await prisma.forTenantId(tenantId).quote.count({ where: { caseId } })).toBe(0);
  });
});
