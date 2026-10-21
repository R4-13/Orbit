import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { MockLLMProvider } from '@orbit/agent-core';
import { buildTriageFixture } from '@orbit/shared';
import { LLM_PROVIDER } from '../src/agent/agent.tokens';
import { AiProviderResolverService } from '../src/ai-providers/ai-provider-resolver.service';
import type { NormalizedIntakeEvent } from '../src/intake/channel-event.types';
import { IntakeService } from '../src/intake/intake.service';
import { OUTBOUND_MAIL, type OutboundMailPort, type OutboundMessage } from '../src/integrations/outbound-mail.port';
import { PrismaService } from '../src/prisma/prisma.service';
import { OrchestratorService } from '../src/process/orchestrator.service';
import { TenantsService } from '../src/tenants/tenants.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

const SENDER = 'praxis@kunde.example';
const REQUEST = 'Guten Tag, unsere Zahnarztpraxis zieht Ende Januar um. Wir brauchen drei Behandlungsplätze an Wasser und Druckluft angeschlossen und einen Gasanschluss im Labor. Die Abnahme muss vor dem 3. Februar erfolgt sein. Können Sie das übernehmen?';

/**
 * FX-01 (Konzept Flexible Autonomie, Entscheidung 19.10.): vollständige Zielarbeit bei einem unbekannten Vorgang ohne Leitfaden – Kontext beschaffen, fehlende Angaben auflösen, handeln,
 * fortsetzen, bis ein sachlich notwendiger Warte-, Freigabe- oder Übergabepunkt erreicht ist. Zugleich Entscheidung D4: schreibende Wirkungen beginnen erst nach der Planbestätigung;
 * verstehende und vorbereitende Schritte laufen vorher; der freigegebene Umfang gilt für Neuplanungen innerhalb dieses Umfangs weiter. Modell = Skript-Warteschlange (echte KI simuliert),
 * Versand = Aufzeichnungs-Double – nichts verlässt den Testprozess.
 */
describe('Zielarbeit bei unbekannten Vorgängen (FX-01, e2e)', () => {
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
    const { tenant } = await app.get(TenantsService).bootstrapTenant({ name: `Ziel ${suffix.slice(0, 8)}`, slug: `e2e-ziel-${suffix}`, adminEmail: `admin-${suffix}@e2e-ziel.example`, adminPassword: 'Musterwerk#2026!', adminFirstName: 'A', adminLastName: 'A' });
    tenants.push(tenant.id);
    const integration = await prisma.forTenantId(tenant.id).integration.create({ data: { tenantId: tenant.id, connectorType: 'GMAIL', status: 'CONNECTED', externalAccountDisplayName: 'firma@e2e.example', grantedCapabilities: ['email.read', 'email.send'] } });
    connectionByTenant.set(tenant.id, integration.id);
    for (const action of ['email.send.clarification', 'email.send.acknowledgement', 'staff.notify']) {
      await prisma.forTenantId(tenant.id).policyConfig.upsert({ where: { tenantId_action: { tenantId: tenant.id, action } }, create: { tenantId: tenant.id, action, mode: 'AUTONOMOUS' }, update: { mode: 'AUTONOMOUS' } });
    }
    await prisma.forTenantId(tenant.id).tenantProfile.create({ data: { tenantId: tenant.id, industry: 'Heizung und Sanitär', description: 'Wir installieren Heizungen und Sanitäranlagen.', services: ['Sanitär'], faqs: [] } });
    return tenant.id;
  }

  function seedTool(toolName: string, input: Record<string, unknown>): void {
    llm.seedResponse({ toolCalls: [{ toolCallId: randomUUID(), toolName, input }], stopReason: 'tool_use' });
    llm.seedResponse({ text: 'ok', toolCalls: [], stopReason: 'end_turn' });
  }
  const seedTriage = (over: Record<string, unknown> = {}) =>
    seedTool('submit_triage_result', buildTriageFixture({ businessRelevance: 'RELEVANT', category: 'COMPLAINT_OR_SERVICE', urgency: 'NORMAL', senderRoleHypothesis: 'PROSPECT', conciseReason: 'Anfrage einer Praxis zu einem Umzug.', confidence: { relevance: 0.97, intent: 0.9 }, ...over }) as unknown as Record<string, unknown>);
  const seedAnalysis = () =>
    seedTool('submit_request_analysis', {
      requestType: 'Praxisumzug',
      summary: 'Umzug einer Zahnarztpraxis: Anschluss von drei Behandlungsplätzen und eines Gasanschlusses, Abnahme vor dem 3. Februar.',
      knownDetails: [{ key: 'behandlungsplaetze', label: 'Behandlungsplätze', value: '3', evidence: 'drei Behandlungsplätze', confidence: 0.95 }],
      missingInformation: [{ key: 'standort', label: 'Neuer Standort', question: 'An welcher Adresse liegen die neuen Praxisräume?' }],
      siteVisit: { recommended: false, reason: '' },
      nextStep: 'ASK_CUSTOMER',
    });
  const seedExtraction = (facts: Array<{ key: string; value: string | number; evidence: string }>) => seedTool('submit_extracted_facts', { facts: facts.map((f) => ({ ...f, confidence: 0.9 })) });

  const node = (id: string, type: string, extra: Record<string, unknown> = {}) => ({ id, type, title: id, inputs: {}, config: {}, ...extra });
  const edge = (source: string, target: string) => ({ id: `e_${source}_${target}`, source, target });

  function mail(tenantId: string, over: Partial<NormalizedIntakeEvent> = {}): NormalizedIntakeEvent {
    return { tenantId, channel: 'SIMULATED', provider: 'simulated', externalEventId: randomUUID(), occurredAt: new Date(), sender: { address: SENDER, displayName: 'Praxis Meier' }, recipients: [{ address: 'info@betrieb.example' }], direction: 'INBOUND', connectionId: connectionByTenant.get(tenantId), subject: 'Praxisumzug', content: REQUEST, threadId: 'thr-1', rfcMessageId: '<m1@kunde.example>', ...over };
  }
  const caseOf = (tenantId: string, caseId: string) => prisma.forTenantId(tenantId).case.findUniqueOrThrow({ where: { id: caseId } });
  const planStates = async (tenantId: string, caseId: string, status: 'ACTIVE' | 'AWAITING_APPROVAL') => {
    const plan = await prisma.forTenantId(tenantId).processPlan.findFirst({ where: { caseId, status }, orderBy: { revision: 'desc' }, include: { nodes: true } });
    return { plan, state: (key: string) => plan?.nodes.find((n) => n.nodeKey === key)?.state };
  };
  async function confirmPlan(tenantId: string, caseId: string): Promise<void> {
    const waiting = await prisma.forTenantId(tenantId).processPlan.findFirstOrThrow({ where: { caseId, status: 'AWAITING_APPROVAL' }, orderBy: { revision: 'desc' } });
    await app.get(OrchestratorService).approvePlan(tenantId, 'user-confirm', waiting.id);
    await app.get(OrchestratorService).advance(tenantId, caseId);
  }

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
        return { providerMessageId: `gm-${sent.length}`, threadId: message.threadId ?? 'thr-1', rfcMessageId: `<sent-${sent.length}@mail.example>`, from: 'firma@e2e.example', executionMode: 'SIMULATED' };
      }),
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

  it('Verstehen → Planbestätigung → Rückfrage → Antwort → Neuplanung OHNE erneute Bestätigung → Übergabe mit Zusammenfassung: der Vorgang endet an einem sachlichen Übergabepunkt, nicht nach dem ersten Schritt', async () => {
    const tenantId = await newTenant();
    seedTriage();
    // Plan 1: Kontext → Anforderungen aus der Nachricht → Rückfrage (nur was fehlt) → warten.
    seedTool('submit_process_plan', {
      goalKeys: ['human.review'],
      nodes: [
        node('ctx', 'RESOLVE_CONTEXT', { capability: { key: 'context.lookup' } }),
        node('reqs', 'EVALUATE_REQUIREMENTS', { capability: { key: 'requirements.resolve' } }),
        node('ask_draft', 'PREPARE', { capability: { key: 'communication.draft' }, inputs: { to: { fact: 'contact.email' }, missing: { stepOutput: { node: 'reqs', path: 'missing' } } }, config: { purpose: 'CLARIFICATION' } }),
        node('ask_send', 'ACTION', { capability: { key: 'email.send' }, inputs: { draftId: { stepOutput: { node: 'ask_draft', path: 'draftId' } } }, config: { purpose: 'CLARIFICATION' } }),
        node('wait', 'WAIT_EVENT', { config: { eventType: 'communication.received' }, timeout: { hours: 72 } }),
      ],
      edges: [edge('ctx', 'reqs'), edge('reqs', 'ask_draft'), edge('ask_draft', 'ask_send'), edge('ask_send', 'wait')],
      unresolvedRequirements: [],
      assumptions: [],
      conciseExplanation: 'Verstehen, gezielt nachfragen, auf die Antwort warten.',
    });
    seedAnalysis();
    const first = await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId));
    const caseId = first.case!.id;

    // D4: nichts geht hinaus, der Plan wartet auf die Bestätigung – aber Verstehen und der Entwurf liefen schon.
    expect(sent).toEqual([]);
    expect((await caseOf(tenantId, caseId)).orchestrationStatus).toBe('WAITING_FOR_APPROVAL');
    const waiting = await planStates(tenantId, caseId, 'AWAITING_APPROVAL');
    expect([waiting.state('ctx'), waiting.state('reqs'), waiting.state('ask_draft'), waiting.state('ask_send')]).toEqual(['SUCCEEDED', 'SUCCEEDED', 'SUCCEEDED', 'PLANNED']);

    // Die Person bestätigt den Plan: die Rückfrage geht (Regel: autonom) – gezielt nach dem Standort, ohne Zusagen.
    await confirmPlan(tenantId, caseId);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.bodyText).toContain('An welcher Adresse liegen die neuen Praxisräume?');
    expect(sent[0]!.bodyText).not.toMatch(/€|EUR|garantier|Preis/i);
    expect(sent[0]!.bodyText).not.toMatch(/Angebot erstellen|Wir haben sie so verstanden/); // ohne hinterlegten Prozess: neutrale Rückfrage, keine interne Zusammenfassung, kein Angebotsversprechen
    expect((await caseOf(tenantId, caseId)).orchestrationStatus).toBe('WAITING_FOR_INFORMATION');

    // Antwort der Kundschaft → Neuplanung: Angaben auslesen, prüfen, Person mit Zusammenfassung informieren, Übergabe.
    seedTool('submit_process_plan', {
      goalKeys: ['human.review', 'staff.informed'],
      nodes: [
        // Bereits bestätigte Schritte bleiben unverändert Teil des Plans (keine Wiederholung der Rückfrage).
        node('ctx', 'RESOLVE_CONTEXT', { capability: { key: 'context.lookup' } }),
        node('reqs', 'EVALUATE_REQUIREMENTS', { capability: { key: 'requirements.resolve' } }),
        node('ask_draft', 'PREPARE', { capability: { key: 'communication.draft' }, inputs: { to: { fact: 'contact.email' }, missing: { stepOutput: { node: 'reqs', path: 'missing' } } }, config: { purpose: 'CLARIFICATION' } }),
        node('ask_send', 'ACTION', { capability: { key: 'email.send' }, inputs: { draftId: { stepOutput: { node: 'ask_draft', path: 'draftId' } } }, config: { purpose: 'CLARIFICATION' } }),
        node('extract', 'PREPARE', { capability: { key: 'facts.extract_from_message' }, inputs: { messageId: { sourceRef: 'inbound.latestMessageId' } } }),
        node('notify', 'ACTION', { capability: { key: 'staff.notify' }, inputs: { message: { literal: 'Praxisumzug: Standort und Umfang sind geklärt, bitte Angebot und Frist prüfen (Abnahme vor 3. Februar).' } } }),
        node('human', 'MANUAL_TASK', { title: 'Eine Person prüft Umfang, Preis und Frist' }),
      ],
      edges: [edge('ctx', 'reqs'), edge('reqs', 'ask_draft'), edge('ask_draft', 'ask_send'), edge('ask_send', 'extract'), edge('extract', 'notify'), edge('notify', 'human')],
      unresolvedRequirements: [],
      assumptions: [],
      conciseExplanation: 'Angaben auslesen, Person informieren, übergeben.',
    });
    seedExtraction([{ key: 'ai.standort', value: 'Kölner Str. 12, 50667 Köln', evidence: 'Kölner Str. 12, 50667 Köln' }]);
    await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId, { subject: 'Re: Praxisumzug', content: 'Die neuen Räume sind in der Kölner Str. 12, 50667 Köln.', rfcMessageId: '<m2@kunde.example>', inReplyTo: '<sent-1@mail.example>', references: ['<m1@kunde.example>', '<sent-1@mail.example>'] }));

    // Kein zweites Mal Planbestätigung: die neue Planung wirkt nur mit Meldung an eine Person und Aufgabe (sicherer Rückfallweg), die Rückfrage-Art war schon freigegeben.
    const row = await caseOf(tenantId, caseId);
    expect(row.orchestrationStatus).toBe('MANUAL_REVIEW');
    expect(await prisma.forTenantId(tenantId).processPlan.count({ where: { caseId, status: 'AWAITING_APPROVAL' } })).toBe(0);
    expect(await prisma.forTenantId(tenantId).task.count({ where: { caseId } })).toBeGreaterThanOrEqual(1);
    // Der Planvertrag (Ziele der ersten Planung) blieb erhalten; „Abschluss“ gibt es für ein Ziel bei einer Person nicht – ein Mensch schließt ab.
    const plans = await prisma.forTenantId(tenantId).processPlan.findMany({ where: { caseId }, orderBy: { revision: 'asc' } });
    expect(plans[0]!.goalKeys).toEqual(['human.review']);
    expect(plans.at(-1)!.goalKeys).toEqual(expect.arrayContaining(['human.review']));
    expect(row.completedAt).toBeNull();
  });

  it('Grenzen der Freigabe (Punkt 6): ein anderer Empfänger wird in einer Neuplanung weder frei gewählt noch durch die frühere Freigabe gedeckt – nichts geht an eine fremde Adresse', async () => {
    const tenantId = await newTenant();
    seedTriage();
    const askNodes = () => [
      node('ctx', 'RESOLVE_CONTEXT', { capability: { key: 'context.lookup' } }),
      node('reqs', 'EVALUATE_REQUIREMENTS', { capability: { key: 'requirements.resolve' } }),
      node('ask_draft', 'PREPARE', { capability: { key: 'communication.draft' }, inputs: { to: { fact: 'contact.email' }, missing: { stepOutput: { node: 'reqs', path: 'missing' } } }, config: { purpose: 'CLARIFICATION' } }),
      node('ask_send', 'ACTION', { capability: { key: 'email.send' }, inputs: { draftId: { stepOutput: { node: 'ask_draft', path: 'draftId' } } }, config: { purpose: 'CLARIFICATION' } }),
    ];
    seedTool('submit_process_plan', {
      goalKeys: ['human.review'],
      nodes: [...askNodes(), node('wait', 'WAIT_EVENT', { config: { eventType: 'communication.received' }, timeout: { hours: 72 } })],
      edges: [edge('ctx', 'reqs'), edge('reqs', 'ask_draft'), edge('ask_draft', 'ask_send'), edge('ask_send', 'wait')],
      unresolvedRequirements: [],
      assumptions: [],
      conciseExplanation: 'Gezielt nachfragen.',
    });
    seedAnalysis();
    const first = await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId));
    const caseId = first.case!.id;
    await confirmPlan(tenantId, caseId);
    expect(sent).toHaveLength(1);

    // Neuplanung nach der Antwort: dieselbe Fähigkeit (E-Mail) und derselbe Zweck (Rückfrage), aber an eine ANDERE Adresse.
    seedTool('submit_process_plan', {
      goalKeys: ['human.review'],
      nodes: [
        ...askNodes(),
        node('other_draft', 'PREPARE', { capability: { key: 'communication.draft' }, inputs: { to: { literal: 'fremd@beispiel.de' }, missing: { stepOutput: { node: 'reqs', path: 'missing' } } }, config: { purpose: 'CLARIFICATION' } }),
        node('other_send', 'ACTION', { capability: { key: 'email.send' }, inputs: { draftId: { stepOutput: { node: 'other_draft', path: 'draftId' } } }, config: { purpose: 'CLARIFICATION' } }),
        node('human', 'MANUAL_TASK', { title: 'Eine Person prüft' }),
      ],
      edges: [edge('ctx', 'reqs'), edge('reqs', 'ask_draft'), edge('ask_draft', 'ask_send'), edge('ask_send', 'other_draft'), edge('other_draft', 'other_send'), edge('other_send', 'human')],
      unresolvedRequirements: [],
      assumptions: [],
      conciseExplanation: 'Auch an eine weitere Adresse fragen.',
    });
    await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId, { subject: 'Re: Praxisumzug', content: 'Die neuen Räume sind in der Kölner Str. 12.', rfcMessageId: '<m2@kunde.example>', inReplyTo: '<sent-1@mail.example>', references: ['<m1@kunde.example>', '<sent-1@mail.example>'] }));

    // Erste Schranke: die Planprüfung lässt keinen frei gewählten Empfänger zu (und keine Wiederholung der bereits bestätigten Rückfrage); der Plan wird nicht aktiv, der Vorgang geht zur Prüfung.
    // Zweite Schranke (Freigabeumfang mit Ziel, siehe plan-approval.spec): selbst ein zulässiger Plan mit anderem Ziel wäre durch die frühere Freigabe nicht gedeckt.
    const row = await caseOf(tenantId, caseId);
    expect(row.orchestrationStatus).toBe('MANUAL_REVIEW');
    expect(row.attentionReasons.join(' ')).toMatch(/INVENTED_PARAMETER/);
    expect(await prisma.forTenantId(tenantId).processPlan.count({ where: { caseId, status: 'ACTIVE' } })).toBe(1);
    expect(sent).toHaveLength(1); // an die fremde Adresse ging nichts hinaus
    expect(sent.every((m) => m.to === SENDER)).toBe(true);
  });

  it('Die Freigabe läuft ab: nach Ablauf der Gültigkeit braucht auch eine Wirkung im früheren Umfang wieder die Freigabe', async () => {
    const tenantId = await newTenant();
    seedTriage();
    const askNodes = () => [
      node('ctx', 'RESOLVE_CONTEXT', { capability: { key: 'context.lookup' } }),
      node('reqs', 'EVALUATE_REQUIREMENTS', { capability: { key: 'requirements.resolve' } }),
      node('ask_draft', 'PREPARE', { capability: { key: 'communication.draft' }, inputs: { to: { fact: 'contact.email' }, missing: { stepOutput: { node: 'reqs', path: 'missing' } } }, config: { purpose: 'CLARIFICATION' } }),
      node('ask_send', 'ACTION', { capability: { key: 'email.send' }, inputs: { draftId: { stepOutput: { node: 'ask_draft', path: 'draftId' } } }, config: { purpose: 'CLARIFICATION' } }),
    ];
    seedTool('submit_process_plan', {
      goalKeys: ['human.review'],
      nodes: [...askNodes(), node('wait', 'WAIT_EVENT', { config: { eventType: 'communication.received' }, timeout: { hours: 72 } })],
      edges: [edge('ctx', 'reqs'), edge('reqs', 'ask_draft'), edge('ask_draft', 'ask_send'), edge('ask_send', 'wait')],
      unresolvedRequirements: [],
      assumptions: [],
      conciseExplanation: 'Gezielt nachfragen.',
    });
    seedAnalysis();
    const first = await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId));
    const caseId = first.case!.id;
    await confirmPlan(tenantId, caseId);
    // Die Freigabe liegt 15 Tage zurück (Gültigkeit 14 Tage).
    await prisma.withRlsBypass((tx) => tx.caseEvent.updateMany({ where: { caseId, type: 'plan.scope_approved' }, data: { createdAt: new Date(Date.now() - 15 * 24 * 3600 * 1000) } }));
    seedTool('submit_process_plan', {
      goalKeys: ['human.review'],
      nodes: [...askNodes(), node('human', 'MANUAL_TASK', { title: 'Eine Person prüft' })],
      edges: [edge('ctx', 'reqs'), edge('reqs', 'ask_draft'), edge('ask_draft', 'ask_send'), edge('ask_send', 'human')],
      unresolvedRequirements: [],
      assumptions: [],
      conciseExplanation: 'Gezielt nachfragen und übergeben.',
    });
    await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId, { subject: 'Re: Praxisumzug', content: 'Die neuen Räume sind in der Kölner Str. 12.', rfcMessageId: '<m2@kunde.example>', inReplyTo: '<sent-1@mail.example>', references: ['<m1@kunde.example>', '<sent-1@mail.example>'] }));
    expect(await prisma.forTenantId(tenantId).processPlan.count({ where: { caseId, status: 'AWAITING_APPROVAL' } })).toBe(1);
  });

  it('Auskunft nicht belegbar → freies Weiterplanen: lässt das Modell einen bereits ausgeführten Schritt weg oder ändert ihn, stellt ORBIT ihn selbst unverändert wieder her – der Vorgang geht nicht wegen einer Formfrage ohne Zielarbeit an eine Person', async () => {
    const tenantId = await newTenant();
    for (const action of ['email.send.information', 'knowledge.answer']) {
      await prisma.forTenantId(tenantId).policyConfig.upsert({ where: { tenantId_action: { tenantId, action } }, create: { tenantId, action, mode: 'AUTONOMOUS' }, update: { mode: 'AUTONOMOUS' } });
    }
    seedTriage({ category: 'GENERAL_INQUIRY' });
    seedTool('submit_blueprint_fit', { fits: true, reason: 'Eine Frage, die aus dem Betriebswissen zu beantworten ist.' }); // Eignung des Standardverfahrens (FX-18)
    seedTool('submit_knowledge_answer', { answerable: false, answer: '', sources: [], confidence: 0.2 });
    // Das freie Weiterplanen lässt „notify_staff“ weg (bereits ausgeführt) und setzt die Anforderungsprüfung mit Weiterplanen-Stelle an.
    seedTool('submit_process_plan', {
      goalKeys: ['inquiry.answered', 'human.review'],
      nodes: [
        node('sender_check', 'RESOLVE_CONTEXT', { capability: { key: 'context.lookup' } }),
        node('reqs', 'EVALUATE_REQUIREMENTS', { capability: { key: 'requirements.resolve' } }),
        node('weiter', 'REASSESS', { config: { replan: true } }),
      ],
      edges: [edge('sender_check', 'reqs'), edge('reqs', 'weiter')],
      unresolvedRequirements: [],
      assumptions: [],
      conciseExplanation: 'Erst verstehen, dann mit dem Ergebnis weiterplanen.',
    });
    const result = await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId, { subject: 'Frage', content: 'Können Sie auch Brandschutztüren einbauen?' }));
    const caseId = result.case!.id;
    expect(await prisma.forTenantId(tenantId).caseEvent.count({ where: { caseId, type: 'plan.replan_unavailable' } })).toBe(0);
    const plans = await prisma.forTenantId(tenantId).processPlan.findMany({ where: { caseId }, orderBy: { revision: 'asc' }, include: { nodes: true } });
    expect(plans.length).toBeGreaterThanOrEqual(2);
    const second = plans[1]!;
    expect(second.nodes.find((n) => n.nodeKey === 'notify_staff')?.state).toBe('SUCCEEDED'); // wiederhergestellt, nicht wiederholt
    expect(second.nodes.some((n) => n.nodeKey === 'weiter')).toBe(true);
  });
  it('ein Schritt, der nur am Ergebnis eines übersprungenen Schritts hängt, entfällt (statt „blockiert“): der Vorgang geht nicht wegen dieses Formmangels an eine Person, sondern an seinen eigentlichen Übergabepunkt (Abnahmeprüfung 21.10.)', async () => {
    const tenantId = await newTenant();
    seedTriage();
    seedTool('submit_process_plan', {
      goalKeys: ['human.review', 'staff.informed'],
      nodes: [
        node('ctx', 'RESOLVE_CONTEXT', { capability: { key: 'context.lookup' } }),
        // Der Entwurf entfällt (keine belegte Antwort), der Versand hängt nur an seinem Ergebnis.
        node('draft', 'PREPARE', { capability: { key: 'communication.draft' }, inputs: { to: { fact: 'contact.email' } }, config: { purpose: 'ACKNOWLEDGEMENT' }, preconditions: [{ exists: { fact: 'case.reference' } }] }),
        node('send', 'ACTION', { capability: { key: 'email.send' }, inputs: { draftId: { stepOutput: { node: 'draft', path: 'draftId' } } }, config: { purpose: 'ACKNOWLEDGEMENT' } }),
        node('notify', 'ACTION', { capability: { key: 'staff.notify' }, inputs: { message: { literal: 'Preisfrage zum Warmwasserspeicher: bitte fachlich prüfen und die Kundschaft beantworten.' } } }),
        node('manual', 'MANUAL_TASK', { title: 'Eine Person prüft die Preisfrage und antwortet' }),
      ],
      edges: [edge('ctx', 'draft'), edge('draft', 'send'), edge('send', 'notify'), edge('notify', 'manual')],
      unresolvedRequirements: [],
      assumptions: [],
      conciseExplanation: 'Eingang bestätigen (falls belegt), Person informieren, übergeben.',
    });
    const result = await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId, { subject: 'Preis Warmwasserspeicher', content: 'Was kostet ein neuer Warmwasserspeicher ungefähr?' }));
    const caseId = result.case!.id;
    await confirmPlan(tenantId, caseId);
    const states = await planStates(tenantId, caseId, 'ACTIVE');
    expect(states.state('draft')).toBe('SKIPPED');
    expect(states.state('send')).toBe('SKIPPED'); // vorher: BLOCKED, „Es fehlen Angaben: draftId“
    expect(states.state('notify')).toBe('SUCCEEDED');
    expect(sent).toEqual([]);
    const row = await caseOf(tenantId, caseId);
    expect(row.orchestrationStatus).toBe('MANUAL_REVIEW'); // die Person ist der Übergabepunkt …
    expect(row.attentionReasons.join(' ')).toContain('Eine Person prüft die Preisfrage'); // … und der Grund ist der fachliche, nicht ein fehlender Entwurf
  });
  it('FX-20 im Ablauf: eine Antwort, die eine frühere Angabe selbst korrigiert, wird vor dem Weiterlaufen übernommen – die Neuplanung sieht den aktuellen Stand, der alte Wert bleibt als Verlauf', async () => {
    process.env.FACT_CORRECTION_ENABLED = 'true';
    try {
      const tenantId = await newTenant();
      seedTriage();
      seedTool('submit_process_plan', {
        goalKeys: ['human.review'],
        nodes: [
          node('ctx', 'RESOLVE_CONTEXT', { capability: { key: 'context.lookup' } }),
          node('reqs', 'EVALUATE_REQUIREMENTS', { capability: { key: 'requirements.resolve' } }),
          node('ask_draft', 'PREPARE', { capability: { key: 'communication.draft' }, inputs: { to: { fact: 'contact.email' }, missing: { stepOutput: { node: 'reqs', path: 'missing' } } }, config: { purpose: 'CLARIFICATION' } }),
          node('ask_send', 'ACTION', { capability: { key: 'email.send' }, inputs: { draftId: { stepOutput: { node: 'ask_draft', path: 'draftId' } } }, config: { purpose: 'CLARIFICATION' } }),
          node('wait', 'WAIT_EVENT', { config: { eventType: 'communication.received' }, timeout: { hours: 72 } }),
        ],
        edges: [edge('ctx', 'reqs'), edge('reqs', 'ask_draft'), edge('ask_draft', 'ask_send'), edge('ask_send', 'wait')],
        unresolvedRequirements: [],
        assumptions: [],
        conciseExplanation: 'Verstehen, gezielt nachfragen, auf die Antwort warten.',
      });
      seedAnalysis();
      const first = await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId));
      const caseId = first.case!.id;
      await confirmPlan(tenantId, caseId);
      expect((await caseOf(tenantId, caseId)).orchestrationStatus).toBe('WAITING_FOR_INFORMATION');

      // Die Antwort nennt den Standort und nimmt die frühere Angabe (drei Behandlungsplätze) selbst zurück. Reihenfolge der KI-Aufrufe: erst die Prüfung auf Korrekturen, dann die Neuplanung.
      seedTool('submit_fact_updates', { updates: [{ key: 'ai.behandlungsplaetze', newValue: '4', evidence: 'doch vier Behandlungsplätze', kind: 'CORRECTION', reason: 'nimmt die frühere Zahl zurück' }] });
      seedTool('submit_process_plan', {
        goalKeys: ['human.review'],
        nodes: [
          node('ctx', 'RESOLVE_CONTEXT', { capability: { key: 'context.lookup' } }),
          node('reqs', 'EVALUATE_REQUIREMENTS', { capability: { key: 'requirements.resolve' } }),
          node('ask_draft', 'PREPARE', { capability: { key: 'communication.draft' }, inputs: { to: { fact: 'contact.email' }, missing: { stepOutput: { node: 'reqs', path: 'missing' } } }, config: { purpose: 'CLARIFICATION' } }),
          node('ask_send', 'ACTION', { capability: { key: 'email.send' }, inputs: { draftId: { stepOutput: { node: 'ask_draft', path: 'draftId' } } }, config: { purpose: 'CLARIFICATION' } }),
          node('notify', 'ACTION', { capability: { key: 'staff.notify' }, inputs: { message: { literal: 'Praxisumzug: Standort geklärt, vier Behandlungsplätze – bitte Angebot und Frist prüfen.' } } }),
          node('human', 'MANUAL_TASK', { title: 'Eine Person prüft Umfang, Preis und Frist' }),
        ],
        edges: [edge('ctx', 'reqs'), edge('reqs', 'ask_draft'), edge('ask_draft', 'ask_send'), edge('ask_send', 'notify'), edge('notify', 'human')],
        unresolvedRequirements: [],
        assumptions: [],
        conciseExplanation: 'Person mit dem aktuellen Stand informieren, übergeben.',
      });
      const before = llm.getRequests().length;
      await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId, { subject: 'Re: Praxisumzug', content: 'Die neuen Räume sind in der Kölner Str. 12, 50667 Köln. Und doch vier Behandlungsplätze, nicht drei.', rfcMessageId: '<m2@kunde.example>', inReplyTo: '<sent-1@mail.example>', references: ['<m1@kunde.example>', '<sent-1@mail.example>'] }));

      const history = await prisma.forTenantId(tenantId).caseFact.findMany({ where: { caseId, key: 'ai.behandlungsplaetze' }, orderBy: { revision: 'asc' } });
      expect(history.map((f) => [f.value, f.isCurrent])).toEqual([['3', false], ['4', true]]);
      expect(await prisma.forTenantId(tenantId).caseEvent.count({ where: { caseId, type: 'fact.corrected' } })).toBe(1);
      // Die Neuplanung (nach der Prüfung) erhält den aktuellen Stand.
      const planning = llm.getRequests().slice(before).map((r) => JSON.stringify(r.messages)).find((m) => m.includes('Neuplanung wegen neuer Informationen'));
      expect(planning).toBeDefined();
      expect(planning).toContain('ai.behandlungsplaetze (CONFIRMED, EMAIL): \\"4\\"');
      expect(planning).not.toContain('ai.behandlungsplaetze (CONFIRMED, EMAIL): \\"3\\"');
      expect((await caseOf(tenantId, caseId)).orchestrationStatus).toBe('MANUAL_REVIEW');
    } finally {
      process.env.FACT_CORRECTION_ENABLED = 'false';
    }
  });
  it('Neuplanung, die das erfüllte Warten behält und die Reaktion auf die Antwort dahinter plant: die Reaktion läuft (Person informiert, Aufgabe), der Vorgang bleibt nicht stumm in Bearbeitung', async () => {
    const tenantId = await newTenant();
    seedTriage();
    const askNodes = () => [
      node('ctx', 'RESOLVE_CONTEXT', { capability: { key: 'context.lookup' } }),
      node('reqs', 'EVALUATE_REQUIREMENTS', { capability: { key: 'requirements.resolve' } }),
      node('ask_draft', 'PREPARE', { capability: { key: 'communication.draft' }, inputs: { to: { fact: 'contact.email' }, missing: { stepOutput: { node: 'reqs', path: 'missing' } } }, config: { purpose: 'CLARIFICATION' } }),
      node('ask_send', 'ACTION', { capability: { key: 'email.send' }, inputs: { draftId: { stepOutput: { node: 'ask_draft', path: 'draftId' } } }, config: { purpose: 'CLARIFICATION' } }),
      node('wait', 'WAIT_EVENT', { config: { eventType: 'communication.received' }, timeout: { hours: 72 } }),
    ];
    const askEdges = [edge('ctx', 'reqs'), edge('reqs', 'ask_draft'), edge('ask_draft', 'ask_send'), edge('ask_send', 'wait')];
    seedTool('submit_process_plan', { goalKeys: ['human.review'], nodes: askNodes(), edges: askEdges, unresolvedRequirements: [], assumptions: [], conciseExplanation: 'Verstehen, nachfragen, warten.' });
    seedAnalysis();
    const first = await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId));
    const caseId = first.case!.id;
    await confirmPlan(tenantId, caseId);
    expect((await caseOf(tenantId, caseId)).orchestrationStatus).toBe('WAITING_FOR_INFORMATION');

    // Die Neuplanung behält alle bisherigen Knoten – auch das jetzt erfüllte Warten – und plant die Reaktion auf die Antwort dahinter.
    seedTool('submit_process_plan', {
      goalKeys: ['human.review'],
      nodes: [...askNodes(), node('notify', 'ACTION', { capability: { key: 'staff.notify' }, inputs: { message: { literal: 'Antwort erhalten: Standort geklärt, bitte Angebot und Frist prüfen.' } } }), node('human', 'MANUAL_TASK', { title: 'Eine Person prüft Umfang und Frist' })],
      edges: [...askEdges, edge('wait', 'notify'), edge('notify', 'human')],
      unresolvedRequirements: [],
      assumptions: [],
      conciseExplanation: 'Auf die Antwort reagieren.',
    });
    seedExtraction([{ key: 'ai.standort', value: 'Kölner Str. 12, 50667 Köln', evidence: 'Kölner Str. 12, 50667 Köln' }]);
    await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId, { subject: 'Re: Praxisumzug', content: 'Die neuen Räume sind in der Kölner Str. 12, 50667 Köln.', rfcMessageId: '<m2@kunde.example>', inReplyTo: '<sent-1@mail.example>', references: ['<m1@kunde.example>', '<sent-1@mail.example>'] }));

    const row = await caseOf(tenantId, caseId);
    expect(row.orchestrationStatus).toBe('MANUAL_REVIEW');
    expect(await prisma.forTenantId(tenantId).task.count({ where: { caseId } })).toBeGreaterThanOrEqual(1);
    const notify = await prisma.forTenantId(tenantId).processPlanNode.findFirst({ where: { nodeKey: 'notify', plan: { caseId, status: 'ACTIVE' } } });
    expect(notify?.state).toBe('SUCCEEDED');
  });
  it('eine vom Plan angelegte Aufgabe gehört zum Vorgang: das Ziel „Aufgabe angelegt“ ist nachgewiesen und der Vorgang schließt mit Nachweis ab (Live-Fund: Ablauf lief durch, Ziel blieb unbelegt)', async () => {
    const tenantId = await newTenant();
    await prisma.forTenantId(tenantId).policyConfig.upsert({ where: { tenantId_action: { tenantId, action: 'task.create' } }, create: { tenantId, action: 'task.create', mode: 'AUTONOMOUS' }, update: { mode: 'AUTONOMOUS' } });
    seedTriage();
    seedTool('submit_process_plan', {
      goalKeys: ['staff.informed', 'task.created'],
      nodes: [
        node('ctx', 'RESOLVE_CONTEXT', { capability: { key: 'context.lookup' } }),
        node('notify', 'ACTION', { capability: { key: 'staff.notify' }, inputs: { message: { literal: 'Schlüsselbund im Keller vergessen: bitte den Monteur informieren.' } } }),
        node('task', 'ACTION', { capability: { key: 'task.create' }, inputs: { title: { literal: 'Monteur wegen Schlüsselbund informieren' } } }),
        node('done', 'COMPLETE'),
      ],
      edges: [edge('ctx', 'notify'), edge('notify', 'task'), edge('task', 'done')],
      unresolvedRequirements: [],
      assumptions: [],
      conciseExplanation: 'Person informieren, Aufgabe anlegen.',
    });
    const result = await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId));
    const caseId = result.case!.id;
    if ((await caseOf(tenantId, caseId)).orchestrationStatus === 'WAITING_FOR_APPROVAL') await confirmPlan(tenantId, caseId);
    const row = await caseOf(tenantId, caseId);
    expect(await prisma.forTenantId(tenantId).task.count({ where: { caseId } })).toBe(1);
    expect(row.orchestrationStatus).toBe('COMPLETED');
    expect(row.outcome).toMatchObject({ code: 'ADHOC_GOALS_PROVEN' });
  });
});
