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
import { TenantsService } from '../src/tenants/tenants.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

const FIXTURES = join(__dirname, '../../../fixtures/process');
const SENDER = 'verwaltung@kunde.example';
const CONTRACT = 'Guten Tag, wir verwalten ein Haus mit 12 Wohneinheiten und suchen einen Betrieb, der unsere Heizungsanlage dauerhaft wartet, mit Bereitschaftsdienst am Wochenende. Wie sehen Ihre Konditionen aus? Bitte melden Sie sich.';
const OFFER = 'Guten Tag, wir möchten unsere alte Gasheizung durch eine Wärmepumpe ersetzen. Das Haus hat ca. 140 m² Wohnfläche. Bitte melden Sie sich.';

/**
 * FX-18: Ein hinterlegter Leitfaden (hier „Anfrage aufnehmen und übergeben“, Kategorie Angebotsanfrage) gilt nur, wenn er den konkreten Fall fachlich trägt. Passt er nicht, wird frei weitergeplant;
 * passt er, läuft er wie bisher – auch mit Vor-Ort-Termin, wenn der Fall ihn braucht. Das Modell antwortet aus der Skript-Warteschlange.
 */
describe('Fachliche Eignung eines Leitfadens (FX-18, e2e)', () => {
  jest.setTimeout(120_000);
  let app: INestApplication;
  let prisma: PrismaService;
  let intake: IntakeService;
  let llm: MockLLMProvider;
  let sent: OutboundMessage[] = [];
  const spies: jest.SpyInstance[] = [];
  const tenants: string[] = [];
  const connectionByTenant = new Map<string, string>();

  async function newTenant(): Promise<string> {
    const suffix = randomUUID();
    const { tenant } = await app.get(TenantsService).bootstrapTenant({ name: `Eignung ${suffix.slice(0, 8)}`, slug: `e2e-eignung-${suffix}`, adminEmail: `admin-${suffix}@e2e-eignung.example`, adminPassword: 'Musterwerk#2026!', adminFirstName: 'A', adminLastName: 'A' });
    tenants.push(tenant.id);
    const integration = await prisma.forTenantId(tenant.id).integration.create({ data: { tenantId: tenant.id, connectorType: 'GMAIL', status: 'CONNECTED', externalAccountDisplayName: 'firma@e2e.example', grantedCapabilities: ['email.read', 'email.send'] } });
    connectionByTenant.set(tenant.id, integration.id);
    for (const action of ['email.send.clarification', 'email.send.acknowledgement', 'meeting.create', 'lead.create', 'staff.notify', 'crm.contact.manage']) {
      await prisma.forTenantId(tenant.id).policyConfig.upsert({ where: { tenantId_action: { tenantId: tenant.id, action } }, create: { tenantId: tenant.id, action, mode: 'AUTONOMOUS' }, update: { mode: 'AUTONOMOUS' } });
    }
    await prisma.forTenantId(tenant.id).tenantProfile.create({ data: { tenantId: tenant.id, industry: 'Heizung und Sanitär', description: 'Wir installieren Heizungen.', services: ['Heizungsinstallation', 'Heizungswartung'], faqs: [] } });
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
  const seedFit = (fits: boolean, reason: string) => seedTool('submit_blueprint_fit', { fits, reason });
  const mail = (tenantId: string, content: string, subject: string): NormalizedIntakeEvent => ({ tenantId, channel: 'SIMULATED', provider: 'simulated', externalEventId: randomUUID(), occurredAt: new Date(), sender: { address: SENDER, displayName: 'Hausverwaltung' }, recipients: [{ address: 'info@betrieb.example' }], direction: 'INBOUND', connectionId: connectionByTenant.get(tenantId), subject, content, threadId: 'thr-fit', rfcMessageId: `<${randomUUID()}@kunde.example>` });
  const caseOf = (tenantId: string, caseId: string) => prisma.forTenantId(tenantId).case.findUniqueOrThrow({ where: { id: caseId } });

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    prisma = app.get(PrismaService);
    intake = app.get(IntakeService);
    llm = app.get(LLM_PROVIDER);
    const live = { providerName: 'scripted-live', modelName: 'scripted', complete: (request: Parameters<MockLLMProvider['complete']>[0]) => llm.complete(request) };
    spies.push(jest.spyOn(app.get(AiProviderResolverService), 'resolveForTenant').mockResolvedValue(live as never));
    spies.push(
      jest.spyOn(app.get<OutboundMailPort>(OUTBOUND_MAIL), 'send').mockImplementation(async (_tenant, message) => {
        sent.push(message);
        return { providerMessageId: `gm-${sent.length}`, threadId: message.threadId ?? 'thr-fit', rfcMessageId: `<sent-${sent.length}@mail.example>`, from: 'firma@e2e.example', executionMode: 'SIMULATED' };
      }),
      jest.spyOn(GmailConnectorService.prototype, 'queryFreeBusy').mockResolvedValue([{ calendarId: 'primary', busy: [] }]),
    );
  });
  beforeEach(() => {
    sent = [];
  });
  afterAll(async () => {
    for (const spy of spies) spy.mockRestore();
    for (const id of tenants) await prisma.withRlsBypass((tx) => tx.tenant.deleteMany({ where: { id } }));
    await app.close();
  });

  it('der Leitfaden passt nicht (Rahmenvertrag statt Einzelangebot): kein Leitfaden, freie Planung; die Begründung der Prüfung steht im Verlauf', async () => {
    const tenantId = await newTenant();
    seedTriage();
    seedFit(false, 'Es geht um einen dauerhaften Wartungsvertrag mit Bereitschaftsdienst, nicht um ein Einzelangebot; der Leitfaden erzwänge einen Angebotsablauf.');
    // Freie Planung: Person informieren (kein Angebotsablauf, keine Terminvorschläge).
    seedTool('submit_process_plan', {
      goalKeys: ['staff.informed', 'human.review'],
      nodes: [
        { id: 'notify', type: 'ACTION', title: 'Person informieren', inputs: { message: { literal: 'Anfrage nach einem Wartungsvertrag: Konditionen und Bereitschaftsdienst klären.' } }, config: {}, capability: { key: 'staff.notify' } },
        { id: 'human', type: 'MANUAL_TASK', title: 'Eine Person klärt Konditionen', inputs: {}, config: {} },
      ],
      edges: [{ id: 'e1', source: 'notify', target: 'human' }],
      unresolvedRequirements: [],
      assumptions: [],
      conciseExplanation: 'Vertragsanfrage: an eine Person übergeben.',
    });
    const result = await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId, CONTRACT, 'Wartungsvertrag für 12 Wohneinheiten'));
    const row = await caseOf(tenantId, result.case!.id);
    expect(row.blueprintKey).toBeNull();
    expect(row.type).toBe('GENERAL');
    const assessed = await prisma.forTenantId(tenantId).caseEvent.findFirstOrThrow({ where: { caseId: row.id, type: 'blueprint.fit_assessed' } });
    expect(assessed.payload).toMatchObject({ blueprintKey: 'REQUEST_FOR_QUOTE', fits: false, assessed: true });
    expect((assessed.payload as { reason: string }).reason).toMatch(/Wartungsvertrag/);
    expect(await prisma.forTenantId(tenantId).caseEvent.count({ where: { caseId: row.id, type: 'appointment.proposed' } })).toBe(0);
    expect(sent).toEqual([]); // kein Angebots-Fragebogen und kein Terminvorschlag an die Kundschaft
    expect(await prisma.forTenantId(tenantId).processPlan.count({ where: { caseId: row.id, source: 'LLM_PLANNER' } })).toBeGreaterThanOrEqual(1);
  });

  it('der Leitfaden passt (Wärmepumpe): er läuft wie bisher, die Prüfung wird festgehalten', async () => {
    const tenantId = await newTenant();
    seedTriage();
    seedFit(true, 'Eine klassische Anfrage für ein Angebot mit Beratung.');
    seedTool('submit_extracted_facts', { facts: [] });
    seedTool('submit_request_analysis', {
      requestType: 'Wärmepumpe',
      summary: 'Ersatz der Gasheizung durch eine Wärmepumpe im Haus mit etwa 140 m² Wohnfläche.',
      knownDetails: [{ key: 'living_area', label: 'Wohnfläche', value: '140 m²', evidence: 'ca. 140 m² Wohnfläche', confidence: 0.95 }],
      missingInformation: [{ key: 'hot_water', label: 'Warmwasser über die Wärmepumpe', question: 'Soll die Wärmepumpe auch das Warmwasser übernehmen?' }],
      siteVisit: { recommended: false, reason: '' },
      nextStep: 'ASK_CUSTOMER',
    });
    const result = await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId, OFFER, 'Wärmepumpe'));
    const row = await caseOf(tenantId, result.case!.id);
    expect(row.blueprintKey).toBe('REQUEST_FOR_QUOTE');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.bodyText).toContain('Soll die Wärmepumpe auch das Warmwasser übernehmen?');
    const assessed = await prisma.forTenantId(tenantId).caseEvent.findFirstOrThrow({ where: { caseId: row.id, type: 'blueprint.fit_assessed' } });
    expect(assessed.payload).toMatchObject({ fits: true, assessed: true });
  });

  it('kann die Eignung nicht geprüft werden (keine verwertbare Antwort der KI), gilt das bisherige Verhalten – und es steht im Verlauf', async () => {
    const tenantId = await newTenant();
    seedTriage();
    llm.seedResponse({ text: 'Ich weiß es nicht.', toolCalls: [], stopReason: 'end_turn' });
    seedTool('submit_extracted_facts', { facts: [] });
    seedTool('submit_request_analysis', {
      requestType: 'Wärmepumpe',
      summary: 'Ersatz der Gasheizung durch eine Wärmepumpe.',
      knownDetails: [],
      missingInformation: [{ key: 'hot_water', label: 'Warmwasser', question: 'Soll die Wärmepumpe auch das Warmwasser übernehmen?' }],
      siteVisit: { recommended: false, reason: '' },
      nextStep: 'ASK_CUSTOMER',
    });
    const result = await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId, OFFER, 'Wärmepumpe'));
    const row = await caseOf(tenantId, result.case!.id);
    expect(row.blueprintKey).toBe('REQUEST_FOR_QUOTE');
    const assessed = await prisma.forTenantId(tenantId).caseEvent.findFirstOrThrow({ where: { caseId: row.id, type: 'blueprint.fit_assessed' } });
    expect(assessed.payload).toMatchObject({ fits: true, assessed: false });
  });
});
