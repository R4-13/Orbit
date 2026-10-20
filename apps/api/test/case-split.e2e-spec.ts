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
  const seedTriage = (intents: string[]) =>
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

  it('der Hauptvorgang bleibt offen, solange ein Teilvorgang nicht erledigt ist', async () => {
    const tenantId = await newTenant(true);
    seedTriage(['GENERAL_INQUIRY', 'MAINTENANCE_CONTRACT_CANCELLATION']);
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
    seedTriage(['GENERAL_INQUIRY', 'MAINTENANCE_CONTRACT_CANCELLATION']);
    const result = await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId));
    expect(await children(tenantId, result.case!.id)).toEqual([]);
    expect(await prisma.forTenantId(tenantId).case.count({ where: { parentCaseId: { not: null } } })).toBe(0);
  });

  it('Wirkungsschlüssel (FX-07): wollen beide Teilvorgänge den Eingang bestätigen, geht genau eine Bestätigung hinaus – der zweite ist abgedeckt', async () => {
    const tenantId = await newTenant(true);
    seedTriage(['ANLIEGEN_A', 'ANLIEGEN_B']);
    seedPlan(ackPlan());
    seedPlan(ackPlan());
    const result = await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId));
    const kids = await children(tenantId, result.case!.id);
    expect(kids).toHaveLength(2);
    expect(sent).toEqual([]); // D4: erst die Planbestätigung

    await confirmPlan(tenantId, kids[0]!.id);
    expect(sent).toHaveLength(1);
    await confirmPlan(tenantId, kids[1]!.id);
    expect(sent).toHaveLength(1); // keine zweite Bestätigung

    const second = await prisma.forTenantId(tenantId).processPlanNode.findFirstOrThrow({ where: { nodeKey: 'send', plan: { caseId: kids[1]!.id } } });
    expect(second.state).toBe('SUCCEEDED');
    expect(second.output).toMatchObject({ skipped: 'ALREADY_ACKNOWLEDGED', coveredByCaseId: kids[0]!.id });
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
    expect(sent.map((m) => m.bodyText.includes('Adresse') || m.bodyText.includes('ins Objekt'))).toEqual([true, true]);
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
    expect(reply.case!.id).toBe(kids[0]!.id); // zugeordnet über den Mailfaden der ersten Rückfrage
    const after = await prisma.forTenantId(tenantId).case.findMany({ where: { parentCaseId: result.case!.id }, orderBy: { createdAt: 'asc' } });
    expect(after.map((k) => k.orchestrationStatus)).toEqual(['COMPLETED', 'COMPLETED']); // auch der zweite Teilvorgang hat die Antwort erhalten und wurde fortgesetzt
    const secondWait = await prisma.forTenantId(tenantId).waitSubscription.findFirstOrThrow({ where: { caseId: kids[1]!.id } });
    expect(secondWait.status).toBe('SATISFIED');
    const fanOut = await prisma.forTenantId(tenantId).caseEvent.findFirstOrThrow({ where: { caseId: kids[1]!.id, type: 'communication.received' } });
    expect(fanOut.payload).toMatchObject({ rule: 'SIBLING_FAN_OUT', fanOutFromCaseId: kids[0]!.id });
    // Die Antwort ist für beide Teilvorgänge lesbar (Familie), nicht nur für den, an dem sie hängt.
    const familyIds = await messageCaseIds(prisma, tenantId, kids[1]!.id);
    expect(familyIds).toEqual(expect.arrayContaining([kids[0]!.id, result.case!.id]));
    expect(await prisma.forTenantId(tenantId).emailMessage.count({ where: { caseId: { in: familyIds }, direction: 'INBOUND', bodyText: { contains: 'Hausmeister' } } })).toBe(1);
    expect((await prisma.forTenantId(tenantId).case.findUniqueOrThrow({ where: { id: result.case!.id } })).orchestrationStatus).toBe('COMPLETED');
  });
});
