import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { MockLLMProvider } from '@orbit/agent-core';
import { buildTriageFixture } from '@orbit/shared';
import { LLM_PROVIDER } from '../src/agent/agent.tokens';
import { AiProviderResolverService } from '../src/ai-providers/ai-provider-resolver.service';
import type { NormalizedIntakeEvent } from '../src/intake/channel-event.types';
import { IntakeService } from '../src/intake/intake.service';
import { OUTBOUND_MAIL, type OutboundMailPort, type OutboundMessage } from '../src/integrations/outbound-mail.port';
import { PlatformControlService } from '../src/platform-control/platform-control.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { messageCaseIds } from '../src/process/case-scope';
import { OrchestratorService } from '../src/process/orchestrator.service';
import { FamilyReplyService } from '../src/process/family-reply.service';
import { TenantsService } from '../src/tenants/tenants.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

const SENDER = 'karl@kunde.example';
const MESSAGE = 'Guten Tag, machen Sie auch Badsanierungen im Raum Berlin? Außerdem möchte ich unseren Wartungsvertrag zum Jahresende kündigen.';

/**
 * FX-02 / FX-06 (Konzept Flexible Autonomie ADD-3.1): eine Nachricht mit mehreren Anliegen wird – nur mit dem Betreiber-Flag `process.split` – in verknüpfte Teilvorgänge aufgeteilt;
 * jedes Anliegen hat sein Ziel, seine Planung und seinen Abschluss, der Hauptvorgang schließt mit allen. Wirkungsschlüssel (FX-07) verhindern doppelte Eingangsbestätigungen.
 * Modell = Skript-Warteschlange, Versand = Aufzeichnungs-Double.
 */
describe('Aufteilung mehrerer Anliegen (FX-02/FX-06, e2e)', () => {
  jest.setTimeout(120_000);
  let app: INestApplication;
  let prisma: PrismaService;
  let intake: IntakeService;
  let llm: MockLLMProvider;
  let sent: OutboundMessage[] = [];
  const spies: jest.SpyInstance[] = [];
  const tenants: string[] = [];
  const connectionByTenant = new Map<string, string>();

  async function setSplit(tenantId: string, on: boolean): Promise<void> {
    await prisma.withPlatformScope(async (tx) => {
      const flag = await tx.platformFeatureFlag.findUniqueOrThrow({ where: { key: 'process.split' } });
      const overrides = (flag.tenantOverrides as Array<{ tenantId: string; value: boolean }>).filter((o) => o.tenantId !== tenantId);
      if (on) overrides.push({ tenantId, value: true });
      await tx.platformFeatureFlag.update({ where: { key: 'process.split' }, data: { tenantOverrides: overrides } });
    });
    app.get(PlatformControlService).invalidate();
  }

  async function newTenant(split: boolean): Promise<string> {
    const suffix = randomUUID();
    const { tenant } = await app.get(TenantsService).bootstrapTenant({ name: `Split ${suffix.slice(0, 8)}`, slug: `e2e-split-${suffix}`, adminEmail: `admin-${suffix}@e2e-split.example`, adminPassword: 'Musterwerk#2026!', adminFirstName: 'A', adminLastName: 'A' });
    tenants.push(tenant.id);
    const integration = await prisma.forTenantId(tenant.id).integration.create({ data: { tenantId: tenant.id, connectorType: 'GMAIL', status: 'CONNECTED', externalAccountDisplayName: 'firma@e2e.example', grantedCapabilities: ['email.read', 'email.send'] } });
    connectionByTenant.set(tenant.id, integration.id);
    for (const action of ['email.send.information', 'email.send.acknowledgement', 'email.send.clarification', 'knowledge.answer', 'staff.notify']) {
      await prisma.forTenantId(tenant.id).policyConfig.upsert({ where: { tenantId_action: { tenantId: tenant.id, action } }, create: { tenantId: tenant.id, action, mode: 'AUTONOMOUS' }, update: { mode: 'AUTONOMOUS' } });
    }
    await prisma.forTenantId(tenant.id).tenantProfile.create({
      data: { tenantId: tenant.id, industry: 'Heizung und Sanitär', description: 'Wir installieren Heizungen.', services: ['Badsanierung'], faqs: [{ question: 'Machen Sie Badsanierung?', answer: 'Ja, wir führen Badsanierungen im Raum Berlin aus.' }] },
    });
    await setSplit(tenant.id, split);
    return tenant.id;
  }

  function seedTool(toolName: string, input: Record<string, unknown>): void {
    llm.seedResponse({ toolCalls: [{ toolCallId: randomUUID(), toolName, input }], stopReason: 'tool_use' });
    llm.seedResponse({ text: 'ok', toolCalls: [], stopReason: 'end_turn' });
  }
  /** Die Zerlegung der Nachricht (Erkennung mehrerer Anliegen) liefert hier keine verwertbare Antwort: es gilt die Einstufung. Die gezielten Tests dazu stehen unten. */
  const seedNoSegmentation = () => llm.seedResponse({ text: 'keine Zerlegung', toolCalls: [], stopReason: 'end_turn' });
  const seedTriage = (intents: string[], withSegmentationFallback = true) => {
    seedTriageOnly(intents);
    if (withSegmentationFallback) seedNoSegmentation();
  };
  const seedTriageOnly = (intents: string[]) =>
    seedTool(
      'submit_triage_result',
      buildTriageFixture({
        businessRelevance: 'RELEVANT',
        category: 'UNKNOWN',
        urgency: 'NORMAL',
        senderRoleHypothesis: 'CUSTOMER',
        intents: intents.map((key) => ({ key, confidence: 0.9, evidenceRefs: ['body'] })),
        proposedBusinessGoals: [],
        riskFlags: ['MULTIPLE_INTENTS'],
        conciseReason: 'Zwei getrennte Anliegen in einer Nachricht.',
        confidence: { relevance: 0.97, intent: 0.9 },
      }) as unknown as Record<string, unknown>,
    );
  const node = (id: string, type: string, extra: Record<string, unknown> = {}) => ({ id, type, title: id, inputs: {}, config: {}, ...extra });
  const edge = (source: string, target: string) => ({ id: `e_${source}_${target}`, source, target });
  const seedPlan = (proposal: Record<string, unknown>) => seedTool('submit_process_plan', proposal);
  const notifyPlan = () => ({
    goalKeys: ['staff.informed'],
    nodes: [node('notify', 'ACTION', { capability: { key: 'staff.notify' }, inputs: { message: { literal: 'Kundenwunsch: Wartungsvertrag zum Jahresende kündigen – bitte prüfen.' } } }), node('done', 'COMPLETE')],
    edges: [edge('notify', 'done')],
    unresolvedRequirements: [],
    assumptions: [],
    conciseExplanation: 'Zuständige Person über die Kündigung informieren.',
  });
  const ackPlan = () => ({
    goalKeys: ['receipt.acknowledged'],
    nodes: [
      node('ctx', 'RESOLVE_CONTEXT', { capability: { key: 'context.lookup' } }),
      node('draft', 'PREPARE', { capability: { key: 'communication.draft' }, inputs: { to: { fact: 'contact.email' } }, config: { purpose: 'ACKNOWLEDGEMENT' } }),
      node('send', 'ACTION', { capability: { key: 'email.send' }, inputs: { draftId: { stepOutput: { node: 'draft', path: 'draftId' } } }, config: { purpose: 'ACKNOWLEDGEMENT' } }),
      node('done', 'COMPLETE'),
    ],
    edges: [edge('ctx', 'draft'), edge('draft', 'send'), edge('send', 'done')],
    unresolvedRequirements: [],
    assumptions: [],
    conciseExplanation: 'Eingang bestätigen.',
  });

  function mail(tenantId: string): NormalizedIntakeEvent {
    return { tenantId, channel: 'SIMULATED', provider: 'simulated', externalEventId: randomUUID(), occurredAt: new Date(), sender: { address: SENDER, displayName: 'Karl Kunde' }, recipients: [{ address: 'info@betrieb.example' }], direction: 'INBOUND', connectionId: connectionByTenant.get(tenantId), subject: 'Zwei Fragen', content: MESSAGE, threadId: 'thr-split', rfcMessageId: '<split@kunde.example>' };
  }
  const children = (tenantId: string, parentId: string) => prisma.forTenantId(tenantId).case.findMany({ where: { parentCaseId: parentId }, orderBy: { createdAt: 'asc' } });
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
        return { providerMessageId: `gm-${sent.length}`, threadId: message.threadId ?? 'thr-split', rfcMessageId: `<sent-${sent.length}@mail.example>`, from: 'firma@e2e.example', executionMode: 'SIMULATED' };
      }),
    );
  });
  beforeEach(() => {
    sent = [];
  });
  afterAll(async () => {
    for (const spy of spies) spy.mockRestore();
    await prisma.withPlatformScope(async (tx) => {
      const flag = await tx.platformFeatureFlag.findUniqueOrThrow({ where: { key: 'process.split' } });
      const overrides = (flag.tenantOverrides as Array<{ tenantId: string; value: boolean }>).filter((o) => !tenants.includes(o.tenantId));
      await tx.platformFeatureFlag.update({ where: { key: 'process.split' }, data: { tenantOverrides: overrides } });
    });
    for (const id of tenants) await prisma.withRlsBypass((tx) => tx.tenant.deleteMany({ where: { id } }));
    await app.close();
  });

  it('zwei Anliegen → zwei verknüpfte Teilvorgänge mit eigenem Ziel; jedes erreicht sein Ziel, der Hauptvorgang schließt mit beiden', async () => {
    const tenantId = await newTenant(true);
    seedTriage(['GENERAL_INQUIRY', 'MAINTENANCE_CONTRACT_CANCELLATION']);
    seedTool('submit_blueprint_fit', { fits: true, reason: 'Eine Frage, die aus dem Betriebswissen zu beantworten ist.' }); // Eignung des Standardverfahrens (FX-18)
    seedTool('submit_knowledge_answer', { answerable: true, answer: 'Ja, wir führen Badsanierungen im Raum Berlin aus.', sources: ['FAQ: Machen Sie Badsanierung?'], confidence: 0.95 });
    seedPlan(notifyPlan());
    const result = await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId));
    const parentId = result.case!.id;

    const kids = await children(tenantId, parentId);
    expect(kids).toHaveLength(2);
    expect(kids.map((k) => k.currentIntent)).toEqual(['GENERAL_INQUIRY', 'MAINTENANCE_CONTRACT_CANCELLATION']);
    expect(kids.every((k) => k.parentCaseId === parentId)).toBe(true);

    // Anliegen 1: Auskunft aus dem Betriebswissen – die Antwort geht an die Absenderin bzw. den Absender (die Nachricht liegt am Hauptvorgang).
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: SENDER });
    expect(sent[0]!.bodyText).toContain('Badsanierungen im Raum Berlin');
    // Anliegen 2: freie Planung mit eigenem Ziel (Person informieren).
    const states = Object.fromEntries(kids.map((k) => [k.currentIntent, k.orchestrationStatus]));
    expect(states).toEqual({ GENERAL_INQUIRY: 'COMPLETED', MAINTENANCE_CONTRACT_CANCELLATION: 'COMPLETED' });

    // Der Hauptvorgang trägt die Nachricht, führt selbst nichts aus und schließt erst mit allen Teilvorgängen.
    const parent = await prisma.forTenantId(tenantId).case.findUniqueOrThrow({ where: { id: parentId } });
    expect(parent.orchestrationStatus).toBe('COMPLETED');
    expect(parent.outcome).toMatchObject({ code: 'CHILDREN_SETTLED' });
    expect(parent.businessGoals).toHaveLength(2);
    expect(await prisma.forTenantId(tenantId).processPlan.count({ where: { caseId: parentId } })).toBe(0);
    const split = await prisma.forTenantId(tenantId).caseEvent.findFirstOrThrow({ where: { caseId: parentId, type: 'case.split' } });
    expect((split.payload as { children: unknown[] }).children).toHaveLength(2);
    expect(await prisma.forTenantId(tenantId).caseEvent.count({ where: { caseId: kids[0]!.id, type: 'case.split_from' } })).toBe(1);
  });

  it('ein Teilvorgang liest die Angaben aus der Nachricht des Hauptvorgangs (Fund Messlauf 21.10.: „Es fehlen Angaben: messageId“ blockierte die Auslese jedes Teilvorgangs)', async () => {
    const tenantId = await newTenant(true);
    seedTriage(['GENERAL_INQUIRY', 'MAINTENANCE_CONTRACT_CANCELLATION']);
    seedTool('submit_blueprint_fit', { fits: true, reason: 'Eine Frage, die aus dem Betriebswissen zu beantworten ist.' }); // Eignung des Standardverfahrens (FX-18)
    seedTool('submit_knowledge_answer', { answerable: true, answer: 'Ja, wir führen Badsanierungen im Raum Berlin aus.', sources: ['FAQ: Machen Sie Badsanierung?'], confidence: 0.95 });
    seedPlan({
      goalKeys: ['staff.informed'],
      nodes: [
        node('extract', 'PREPARE', { capability: { key: 'facts.extract_from_message' }, inputs: { messageId: { sourceRef: 'inbound.latestMessageId' } } }),
        node('notify', 'ACTION', { capability: { key: 'staff.notify' }, inputs: { message: { literal: 'Kundenwunsch: Wartungsvertrag zum Jahresende kündigen – bitte prüfen.' } } }),
        node('done', 'COMPLETE'),
      ],
      edges: [edge('extract', 'notify'), edge('notify', 'done')],
      unresolvedRequirements: [],
      assumptions: [],
      conciseExplanation: 'Angaben auslesen, Person informieren.',
    });
    seedTool('submit_extracted_facts', { facts: [{ key: 'ai.kuendigung', value: 'zum Jahresende', evidence: 'Wartungsvertrag', confidence: 0.9 }] });
    const result = await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId));
    const kids = await children(tenantId, result.case!.id);
    const second = kids.find((k) => k.currentIntent === 'MAINTENANCE_CONTRACT_CANCELLATION')!;
    const nodes = await prisma.forTenantId(tenantId).processPlanNode.findMany({ where: { plan: { caseId: second.id } }, select: { nodeKey: true, state: true, errorMessage: true } });
    expect(nodes.find((n) => n.nodeKey === 'extract')).toMatchObject({ state: 'SUCCEEDED' }); // vorher: BLOCKED, „Es fehlen Angaben: messageId“
    expect(nodes.filter((n) => n.errorMessage?.includes('messageId'))).toEqual([]);
  });

  it('der Hauptvorgang bleibt offen, solange ein Teilvorgang nicht erledigt ist', async () => {
    const tenantId = await newTenant(true);
    seedTriage(['GENERAL_INQUIRY', 'MAINTENANCE_CONTRACT_CANCELLATION']);
    seedTool('submit_blueprint_fit', { fits: true, reason: 'Eine Frage, die aus dem Betriebswissen zu beantworten ist.' }); // Eignung des Standardverfahrens (FX-18)
    seedTool('submit_knowledge_answer', { answerable: true, answer: 'Ja, wir führen Badsanierungen im Raum Berlin aus.', sources: ['FAQ: Machen Sie Badsanierung?'], confidence: 0.95 });
    // Anliegen 2: kein brauchbarer Plan → der Teilvorgang geht zur Prüfung an eine Person.
    seedTool('submit_process_plan', { goalKeys: ['x'], nodes: [], edges: [], unresolvedRequirements: [], assumptions: [], conciseExplanation: 'leer' });
    const result = await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId));
    const kids = await children(tenantId, result.case!.id);
    expect(kids.map((k) => k.orchestrationStatus)).toContain('MANUAL_REVIEW');
    const parent = await prisma.forTenantId(tenantId).case.findUniqueOrThrow({ where: { id: result.case!.id } });
    expect(parent.orchestrationStatus).toBe('IN_PROGRESS');
  });

  it('ohne das Betreiber-Flag wird nicht aufgeteilt – der Vorgang läuft wie bisher als ein Vorgang', async () => {
    const tenantId = await newTenant(false);
    seedTriage(['GENERAL_INQUIRY', 'MAINTENANCE_CONTRACT_CANCELLATION'], false);
    const result = await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId));
    expect(await children(tenantId, result.case!.id)).toEqual([]);
    expect(await prisma.forTenantId(tenantId).case.count({ where: { parentCaseId: { not: null } } })).toBe(0);
  });

  it('Wollen beide Teilvorgänge den Eingang bestätigen, geht genau eine Bestätigung hinaus – in der gemeinsamen Antwort (Meilenstein C; zuvor Wirkungsschlüssel FX-07)', async () => {
    const tenantId = await newTenant(true);
    seedTriage(['ANLIEGEN_A', 'ANLIEGEN_B']);
    seedPlan(ackPlan());
    seedPlan(ackPlan());
    const result = await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId));
    const kids = await children(tenantId, result.case!.id);
    expect(kids).toHaveLength(2);
    expect(sent).toEqual([]); // D4: erst die Planbestätigung

    await confirmPlan(tenantId, kids[0]!.id);
    expect(sent).toHaveLength(0); // der zweite Teilvorgang wartet gerade erst auf seine Planfreigabe: die gemeinsame Antwort wartet kurz
    await confirmPlan(tenantId, kids[1]!.id);
    expect(sent).toHaveLength(1); // beide Bestätigungen gehen in EINER Nachricht hinaus
    expect(sent[0]!.bodyText.match(/eingegangen/g)).toHaveLength(1);

    for (const kid of kids) {
      const node = await prisma.forTenantId(tenantId).processPlanNode.findFirstOrThrow({ where: { nodeKey: 'send', plan: { caseId: kid.id } } });
      expect(node.state).toBe('SUCCEEDED');
      expect(node.output).toMatchObject({ heldForFamilyReply: true, familyCaseId: result.case!.id }); // ehrlich: an die gemeinsame Antwort übergeben, nicht selbst gesendet
    }
  });

  it('fünf Anliegen: vier werden bearbeitet, das fünfte bleibt ausdrücklich offen und wird gestartet, sobald ein Platz frei ist – der Hauptvorgang schließt erst, wenn alle fünf berücksichtigt sind', async () => {
    const tenantId = await newTenant(true);
    seedTriage(['ANLIEGEN_A', 'ANLIEGEN_B', 'ANLIEGEN_C', 'ANLIEGEN_D', 'ANLIEGEN_E']);
    for (let i = 0; i < 4; i += 1) seedPlan(ackPlan()); // vier Teilvorgänge wollen den Eingang bestätigen und warten auf die Planbestätigung
    const result = await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId));
    const parentId = result.case!.id;
    let kids = await children(tenantId, parentId);
    expect(kids).toHaveLength(5);
    expect(kids.map((k) => k.orchestrationStatus)).toEqual(['WAITING_FOR_APPROVAL', 'WAITING_FOR_APPROVAL', 'WAITING_FOR_APPROVAL', 'WAITING_FOR_APPROVAL', 'RECEIVED']);
    let parent = await prisma.forTenantId(tenantId).case.findUniqueOrThrow({ where: { id: parentId } });
    expect(parent.orchestrationStatus).toBe('IN_PROGRESS');
    expect(parent.attentionReasons).toEqual(['1 Anliegen wartet auf die Bearbeitung.']);
    expect(await prisma.forTenantId(tenantId).processPlan.count({ where: { caseId: kids[4]!.id } })).toBe(0); // nicht begonnen, aber nicht verloren

    // Der erste Teilvorgang wird erledigt → ein Platz wird frei → das fünfte Anliegen wird gestartet (und erledigt).
    seedPlan(notifyPlan());
    await confirmPlan(tenantId, kids[0]!.id);
    kids = await children(tenantId, parentId);
    expect(kids[0]!.orchestrationStatus).toBe('COMPLETED');
    expect(kids[4]!.orchestrationStatus).toBe('COMPLETED');
    parent = await prisma.forTenantId(tenantId).case.findUniqueOrThrow({ where: { id: parentId } });
    expect(parent.orchestrationStatus).toBe('IN_PROGRESS'); // drei Teilvorgänge sind noch offen

    for (const kid of kids.slice(1, 4)) await confirmPlan(tenantId, kid.id);
    parent = await prisma.forTenantId(tenantId).case.findUniqueOrThrow({ where: { id: parentId } });
    expect((await children(tenantId, parentId)).map((k) => k.orchestrationStatus)).toEqual(['COMPLETED', 'COMPLETED', 'COMPLETED', 'COMPLETED', 'COMPLETED']);
    expect(parent.orchestrationStatus).toBe('COMPLETED');
    expect(parent.outcome).toMatchObject({ code: 'CHILDREN_SETTLED' });
    expect(sent).toHaveLength(1); // eine Eingangsbestätigung für fünf Anliegen
  });

  it('eine Antwort mit Angaben für mehrere Teilvorgänge: sie hängt am Mailfaden eines Teilvorgangs, geht aber nicht für die übrigen verloren', async () => {
    const tenantId = await newTenant(true);
    seedTriage(['ANLIEGEN_STANDORT', 'ANLIEGEN_ZUGANG']);
    const askPlan = () => ({
      goalKeys: ['staff.informed'],
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
      conciseExplanation: 'Gezielt nachfragen und auf die Antwort warten.',
    });
    // Nach der Antwort plant ORBIT neu (hinter dem Warten wird nichts vorausgeplant): die Antwort wird ausgewertet, die zuständige Person informiert.
    const afterReply = (note: string) => ({
      goalKeys: ['staff.informed'],
      nodes: [
        node('ctx', 'RESOLVE_CONTEXT', { capability: { key: 'context.lookup' } }),
        node('reqs', 'EVALUATE_REQUIREMENTS', { capability: { key: 'requirements.resolve' } }),
        node('ask_draft', 'PREPARE', { capability: { key: 'communication.draft' }, inputs: { to: { fact: 'contact.email' }, missing: { stepOutput: { node: 'reqs', path: 'missing' } } }, config: { purpose: 'CLARIFICATION' } }),
        node('ask_send', 'ACTION', { capability: { key: 'email.send' }, inputs: { draftId: { stepOutput: { node: 'ask_draft', path: 'draftId' } } }, config: { purpose: 'CLARIFICATION' } }),
        node('notify', 'ACTION', { capability: { key: 'staff.notify' }, inputs: { message: { literal: note } } }),
        node('done', 'COMPLETE'),
      ],
      edges: [edge('ctx', 'reqs'), edge('reqs', 'ask_draft'), edge('ask_draft', 'ask_send'), edge('ask_send', 'notify'), edge('notify', 'done')],
      unresolvedRequirements: [],
      assumptions: [],
      conciseExplanation: 'Antwort ausgewertet, Person informiert.',
    });
    const analysis = (key: string, label: string, question: string) =>
      seedTool('submit_request_analysis', {
        requestType: label,
        summary: `${label} klären.`,
        knownDetails: [],
        missingInformation: [{ key, label, question }],
        siteVisit: { recommended: false, reason: '' },
        nextStep: 'ASK_CUSTOMER',
      });
    seedPlan(askPlan());
    analysis('standort', 'Standort', 'An welcher Adresse liegt das Objekt?');
    seedPlan(askPlan());
    analysis('zugang', 'Zugang', 'Wie kommen wir ins Objekt?');
    const result = await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId));
    const kids = await children(tenantId, result.case!.id);
    expect(kids).toHaveLength(2);
    await confirmPlan(tenantId, kids[0]!.id);
    await confirmPlan(tenantId, kids[1]!.id);
    expect(sent).toHaveLength(1); // beide Rückfragen in EINER gemeinsamen Antwort
    expect(sent[0]!.bodyText).toContain('Adresse');
    expect(sent[0]!.bodyText).toContain('ins Objekt');
    expect((await prisma.forTenantId(tenantId).case.findMany({ where: { parentCaseId: result.case!.id }, orderBy: { createdAt: 'asc' } })).map((k) => k.orchestrationStatus)).toEqual(['WAITING_FOR_INFORMATION', 'WAITING_FOR_INFORMATION']);

    // Eine einzige Antwort – im Mailfaden der ersten Rückfrage – beantwortet beide Fragen. Jeder Teilvorgang plant danach selbst neu.
    seedPlan(afterReply('Standort geklärt.'));
    seedPlan(afterReply('Zugang geklärt.'));
    const reply = await intake.handleIntakeEvent(tenantId, undefined, {
      ...mail(tenantId),
      subject: 'Re: Zwei Fragen',
      content: 'Das Objekt ist in der Kölner Str. 12 in Köln. Den Zugang erhalten Sie über den Hausmeister, Herrn Weber.',
      rfcMessageId: '<antwort@kunde.example>',
      inReplyTo: '<sent-1@mail.example>',
      references: ['<split@kunde.example>', '<sent-1@mail.example>'],
    });
    expect(reply.case!.id).toBe(result.case!.id); // zugeordnet über den Mailfaden der gemeinsamen Antwort: sie hängt am Hauptvorgang
    const after = await prisma.forTenantId(tenantId).case.findMany({ where: { parentCaseId: result.case!.id }, orderBy: { createdAt: 'asc' } });
    if (after.some((k) => k.orchestrationStatus !== 'COMPLETED')) {
      for (const k of after) {
        const nodes = await prisma.forTenantId(tenantId).processPlanNode.findMany({ where: { plan: { caseId: k.id } }, select: { nodeKey: true, state: true, errorMessage: true, plan: { select: { revision: true, status: true } } } });
        const ev = await prisma.forTenantId(tenantId).caseEvent.findMany({ where: { caseId: k.id }, select: { type: true, payload: true }, orderBy: { sequence: 'asc' } });
        console.log('DIAG', k.id, k.orchestrationStatus, k.attentionReasons, JSON.stringify(nodes), JSON.stringify(ev.map((e) => e.type)));
      }
    }
    expect(after.map((k) => k.orchestrationStatus)).toEqual(['COMPLETED', 'COMPLETED']); // beide Teilvorgänge haben die Antwort erhalten und wurden fortgesetzt
    const secondWait = await prisma.forTenantId(tenantId).waitSubscription.findFirstOrThrow({ where: { caseId: kids[1]!.id } });
    expect(secondWait.status).toBe('SATISFIED');
    const fanOut = await prisma.forTenantId(tenantId).caseEvent.findFirstOrThrow({ where: { caseId: kids[1]!.id, type: 'communication.received' } });
    expect(fanOut.payload).toMatchObject({ rule: 'FAMILY_FAN_OUT', familyCaseId: result.case!.id });
    // Die Antwort ist für beide Teilvorgänge lesbar (Familie), nicht nur für den, an dem sie hängt.
    const familyIds = await messageCaseIds(prisma, tenantId, kids[1]!.id);
    expect(familyIds).toEqual(expect.arrayContaining([kids[0]!.id, result.case!.id]));
    expect(await prisma.forTenantId(tenantId).emailMessage.count({ where: { caseId: { in: familyIds }, direction: 'INBOUND', bodyText: { contains: 'Hausmeister' } } })).toBe(1);
    expect((await prisma.forTenantId(tenantId).case.findUniqueOrThrow({ where: { id: result.case!.id } })).orchestrationStatus).toBe('COMPLETED');
  });
  it('eine Antwort erreicht auch einen Teilvorgang, der gerade nicht wartet (z. B. auf eine Freigabe): er startet nicht neu, aber die Antwort ist ihm nachvollziehbar zugeordnet und für die nächste Bearbeitung lesbar', async () => {
    const tenantId = await newTenant(true);
    seedTriage(['ANLIEGEN_STANDORT', 'ANLIEGEN_ZUGANG']);
    const askPlan = () => ({
      goalKeys: ['staff.informed'],
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
      conciseExplanation: 'Gezielt nachfragen und auf die Antwort warten.',
    });
    const analysis = (key: string, label: string, question: string) =>
      seedTool('submit_request_analysis', { requestType: label, summary: `${label} klären.`, knownDetails: [], missingInformation: [{ key, label, question }], siteVisit: { recommended: false, reason: '' }, nextStep: 'ASK_CUSTOMER' });
    seedPlan(askPlan());
    analysis('standort', 'Standort', 'An welcher Adresse liegt das Objekt?');
    seedPlan(askPlan());
    analysis('zugang', 'Zugang', 'Wie kommen wir ins Objekt?');
    const result = await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId));
    const kids = await children(tenantId, result.case!.id);
    expect(kids).toHaveLength(2);
    await confirmPlan(tenantId, kids[0]!.id); // nur der erste Teilvorgang läuft und wartet auf die Antwort; der zweite wartet auf die Freigabe seines Plans
    expect((await children(tenantId, result.case!.id)).map((k) => k.orchestrationStatus)).toEqual(['WAITING_FOR_INFORMATION', 'WAITING_FOR_APPROVAL']);
    // Wer gerade erst auf eine Freigabe wartet, hält die gemeinsame Antwort kurz zurück; nach der Karenzzeit geht der Stand (Rückfrage + „wird geprüft“) hinaus.
    expect(sent).toHaveLength(0);
    await prisma.withRlsBypass((tx) => tx.$executeRaw`UPDATE cases SET updated_at = now() - interval '2 hours' WHERE id = ${kids[1]!.id}`);
    await app.get(FamilyReplyService).settle(tenantId, result.case!.id);
    expect(sent).toHaveLength(1);

    const base = askPlan();
    seedPlan({
      ...base,
      nodes: [...base.nodes.filter((n) => n.id !== 'wait'), node('notify', 'ACTION', { capability: { key: 'staff.notify' }, inputs: { message: { literal: 'Standort geklärt.' } } }), node('done', 'COMPLETE')],
      edges: [...base.edges.filter((e) => e.target !== 'wait'), edge('ask_send', 'notify'), edge('notify', 'done')],
    });
    const reply = await intake.handleIntakeEvent(tenantId, undefined, {
      ...mail(tenantId),
      subject: 'Re: Zwei Fragen',
      content: 'Das Objekt ist in der Kölner Str. 12 in Köln. Den Zugang erhalten Sie über den Hausmeister, Herrn Weber.',
      rfcMessageId: '<antwort2@kunde.example>',
      inReplyTo: '<sent-1@mail.example>',
      references: ['<split@kunde.example>', '<sent-1@mail.example>'],
    });
    expect(reply.case!.id).toBe(result.case!.id);
    const after = await children(tenantId, result.case!.id);
    expect(after.map((k) => k.orchestrationStatus)).toEqual(['COMPLETED', 'WAITING_FOR_APPROVAL']); // der zweite startet nicht neu und behält seinen Status
    const trace = await prisma.forTenantId(tenantId).caseEvent.findFirstOrThrow({ where: { caseId: kids[1]!.id, type: 'communication.sibling_info' } });
    expect(trace.payload).toMatchObject({ fromCaseId: result.case!.id });
    const familyIds = await messageCaseIds(prisma, tenantId, kids[1]!.id);
    expect(await prisma.forTenantId(tenantId).emailMessage.count({ where: { caseId: { in: familyIds }, direction: 'INBOUND', bodyText: { contains: 'Hausmeister' } } })).toBe(1);
  });
  describe('Erkennung und Abgrenzung der Anliegen unabhängig vom Merkmal der Einstufung', () => {
    const MULTI =
      'Guten Tag, wir ziehen zum 1. Dezember um. Bitte ändern Sie unsere Rechnungsanschrift auf Hauptstraße 5 in Berlin. Außerdem möchten wir einen Wartungsvertrag für die Heizung. Was würde der pro Jahr kosten? Könnten Sie uns zusätzlich mitteilen, wann der Schornsteinfeger kommt? Viele Grüße Karl';
    const concerns = () => ({
      concerns: [
        { title: 'Rechnungsanschrift ändern', category: 'UNKNOWN', goal: 'Rechnungsanschrift geändert', excerpt: 'Bitte ändern Sie unsere Rechnungsanschrift auf Hauptstraße 5 in Berlin.' },
        { title: 'Wartungsvertrag', category: 'UNKNOWN', goal: 'Konditionen für einen Wartungsvertrag genannt', excerpt: 'Außerdem möchten wir einen Wartungsvertrag für die Heizung. Was würde der pro Jahr kosten?' },
      ],
      sharedContext: 'wir ziehen zum 1. Dezember um.',
    });
    const fact = (key: string, value: string) => ({ key, value, confidence: 0.9, evidenceRefs: ['body'] });
    const seedUnflaggedTriage = () =>
      seedTool(
        'submit_triage_result',
        buildTriageFixture({
          businessRelevance: 'RELEVANT',
          category: 'UNKNOWN',
          urgency: 'NORMAL',
          senderRoleHypothesis: 'CUSTOMER',
          intents: [{ key: 'ADDRESS_CHANGE', confidence: 0.9, evidenceRefs: ['body'] }], // die Einstufung sieht nur EIN Anliegen und setzt MULTIPLE_INTENTS nicht
          riskFlags: [],
          extractedFactCandidates: [fact('billing.address', 'Hauptstraße 5 in Berlin'), fact('move.date', '1. Dezember'), fact('contact.name', 'Karl')],
          confidence: { relevance: 0.97, intent: 0.9 },
        }) as unknown as Record<string, unknown>,
      );
    const multiMail = (tenantId: string): NormalizedIntakeEvent => ({ ...mail(tenantId), subject: 'Umzug und mehr', content: MULTI, rfcMessageId: '<multi@kunde.example>' });

    it('die Einstufung nennt nur ein Anliegen (kein MULTIPLE_INTENTS): die Zerlegung erkennt drei – eines ergänzt, weil seine Frage sonst keinem Anliegen zugeordnet wäre', async () => {
      const tenantId = await newTenant(true);
      seedUnflaggedTriage();
      seedTool('submit_concerns', concerns());
      for (let i = 0; i < 3; i += 1) seedPlan(notifyPlan());
      const result = await intake.handleIntakeEvent(tenantId, undefined, multiMail(tenantId));
      const kids = await children(tenantId, result.case!.id);
      expect(kids).toHaveLength(3);
      expect(kids.map((k) => k.businessGoals[0])).toEqual(['Rechnungsanschrift geändert', 'Konditionen für einen Wartungsvertrag genannt', expect.stringContaining('übrigen Fragen und Wünsche')]);
      const split = await prisma.forTenantId(tenantId).caseEvent.findFirstOrThrow({ where: { caseId: result.case!.id, type: 'case.split' } });
      expect((split.payload as { coverage: { supplemented: string[] } }).coverage.supplemented).toEqual([expect.stringContaining('Schornsteinfeger')]);
      const from = await prisma.forTenantId(tenantId).caseEvent.findFirstOrThrow({ where: { caseId: kids[2]!.id, type: 'case.split_from' } });
      expect((from.payload as { segment: string }).segment).toContain('Schornsteinfeger');
      expect((from.payload as { sharedContext: string }).sharedContext).toContain('1. Dezember');
    });

    it('Angaben werden nicht ungeprüft anderen Teilvorgängen zugeordnet: jede Angabe gehört zu ihrem Anliegen oder zum gemeinsamen Kontext, der Rest bleibt am Hauptvorgang', async () => {
      const tenantId = await newTenant(true);
      seedUnflaggedTriage();
      seedTool('submit_concerns', concerns());
      for (let i = 0; i < 3; i += 1) seedPlan(notifyPlan());
      const result = await intake.handleIntakeEvent(tenantId, undefined, multiMail(tenantId));
      const kids = await children(tenantId, result.case!.id);
      const keysOf = async (caseId: string) => (await prisma.forTenantId(tenantId).caseFact.findMany({ where: { caseId } })).map((f) => f.key).sort();
      expect(await keysOf(kids[0]!.id)).toEqual(['billing.address', 'move.date']);
      expect(await keysOf(kids[1]!.id)).toEqual(['move.date']); // die Anschrift gehört nicht zum Wartungsvertrag
      expect(await keysOf(kids[2]!.id)).toEqual(['move.date']);
      expect(await keysOf(result.case!.id)).toEqual(['contact.name']); // in keinem Auszug: nicht verloren, aber auch keinem Anliegen zugeschrieben
    });

    it('der Teilvorgang plant mit seinem Auszug: sein Anliegen und der gemeinsame Kontext stehen vorn, die ganze Nachricht nur als Verständnishilfe', async () => {
      const tenantId = await newTenant(true);
      seedUnflaggedTriage();
      seedTool('submit_concerns', concerns());
      for (let i = 0; i < 3; i += 1) seedPlan(notifyPlan());
      const before = llm.getRequests().length;
      await intake.handleIntakeEvent(tenantId, undefined, multiMail(tenantId));
      const planningPrompts = llm
        .getRequests()
        .slice(before)
        .map((r) => JSON.stringify(r.messages))
        .filter((m) => m.includes('DEIN ANLIEGEN'));
      const forGoal = (goal: string) => planningPrompts.find((m) => m.includes(`DEIN ANLIEGEN (maßgeblich): ${goal}`));
      for (const goal of ['Rechnungsanschrift geändert', 'Konditionen für einen Wartungsvertrag genannt']) {
        const prompt = forGoal(goal);
        expect(prompt).toBeDefined();
        expect(prompt).toContain('GEMEINSAMER KONTEXT');
        expect(prompt).toContain('GANZE NACHRICHT (nur zum Verständnis');
      }
      // Das Anliegen „Wartungsvertrag“ liest seinen Auszug, nicht den der Anschrift, als maßgeblichen Teil.
      expect(forGoal('Konditionen für einen Wartungsvertrag genannt')).toContain('Was würde der pro Jahr kosten?');
    });

    it('erfundene Auszüge zählen nicht als Beleg', async () => {
      const tenantId = await newTenant(true);
      seedTool(
        'submit_triage_result',
        buildTriageFixture({ businessRelevance: 'RELEVANT', category: 'UNKNOWN', urgency: 'NORMAL', senderRoleHypothesis: 'CUSTOMER', intents: ['A', 'B'].map((key) => ({ key, confidence: 0.9, evidenceRefs: [] })), riskFlags: ['MULTIPLE_INTENTS'], confidence: { relevance: 0.97, intent: 0.9 } }) as unknown as Record<string, unknown>,
      );
      seedTool('submit_concerns', { concerns: [{ title: 'Erfunden', category: 'UNKNOWN', goal: 'Etwas, das nicht in der Nachricht steht', excerpt: 'Bitte senden Sie sofort einen Monteur nach Hamburg.' }, concerns().concerns[1]], sharedContext: '' });
      for (let i = 0; i < 4; i += 1) seedPlan(notifyPlan());
      const result = await intake.handleIntakeEvent(tenantId, undefined, multiMail(tenantId));
      const kids = await children(tenantId, result.case!.id);
      const first = await prisma.forTenantId(tenantId).caseEvent.findFirstOrThrow({ where: { caseId: kids[0]!.id, type: 'case.split_from' } });
      expect(first.payload).not.toHaveProperty('segment'); // nicht belegt → kein Auszug
      const split = await prisma.forTenantId(tenantId).caseEvent.findFirstOrThrow({ where: { caseId: result.case!.id, type: 'case.split' } });
      expect((split.payload as { coverage: { ungrounded: string[] } }).coverage.ungrounded).toEqual(['Erfunden']);
    });
  });
});
