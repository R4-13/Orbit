import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { MockLLMProvider } from '@orbit/agent-core';
import { buildTriageFixture, type TriageResult } from '@orbit/shared';
import { LLM_PROVIDER } from '../src/agent/agent.tokens';
import { AiProviderResolverService } from '../src/ai-providers/ai-provider-resolver.service';
import type { NormalizedIntakeEvent } from '../src/intake/channel-event.types';
import { ContactsService } from '../src/contacts/contacts.service';
import { IntakeService } from '../src/intake/intake.service';
import { GmailConnectorService } from '../src/integrations/gmail-connector.service';
import { OUTBOUND_MAIL, type OutboundMailPort, type OutboundMessage } from '../src/integrations/outbound-mail.port';
import { PolicyEnforcementService } from '../src/policy/policy-enforcement.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { CaseEventsService } from '../src/process/case-events.service';
import { CaseFactsService } from '../src/process/case-facts.service';
import { OrchestratorService } from '../src/process/orchestrator.service';
import { PlanStoreService } from '../src/process/plan-store.service';
import { TenantsService } from '../src/tenants/tenants.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

const SENDER = 'karl@kunde.example';

/**
 * Die Fähigkeiten der Autonomie-Erweiterung einzeln und Ende zu Ende gegen echte Postgres: Auskunft aus dem Betriebswissen, Statusauskunft, Anhang anfordern,
 * Interessent anlegen, Termin buchen (mit Kalender-Doubles). Das Modell zählt als echte KI (Name ohne „mock“) und antwortet aus der Skript-Warteschlange; Versand und
 * Kalender sind Aufzeichnungs-Doubles – nichts verlässt den Testprozess.
 */
describe('Autonomie: Fähigkeiten (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let intake: IntakeService;
  let store: PlanStoreService;
  let llm: MockLLMProvider;
  let sent: OutboundMessage[] = [];
  let created: Array<Record<string, unknown>> = [];
  const spies: jest.SpyInstance[] = [];

  /** Die berechtigte Person bestätigt den wartenden Plan (Entscheidung D4); danach läuft er weiter. */
  async function confirmPlan(tenantId: string, caseId: string): Promise<void> {
    const waiting = await prisma.forTenantId(tenantId).processPlan.findFirst({ where: { caseId, status: 'AWAITING_APPROVAL' }, orderBy: { revision: 'desc' } });
    if (!waiting) return;
    await app.get(OrchestratorService).approvePlan(tenantId, 'user-confirm', waiting.id);
    await app.get(OrchestratorService).advance(tenantId, caseId);
  }
  const tenants: string[] = [];
  const connectionByTenant = new Map<string, string>();

  async function newTenant(options: { calendar?: boolean; profile?: boolean } = {}): Promise<string> {
    const suffix = randomUUID();
    const { tenant } = await app.get(TenantsService).bootstrapTenant({ name: `Cap ${suffix.slice(0, 8)}`, slug: `e2e-cap-${suffix}`, adminEmail: `admin-${suffix}@e2e-cap.example`, adminPassword: 'Musterwerk#2026!', adminFirstName: 'A', adminLastName: 'A' });
    tenants.push(tenant.id);
    const grantedCapabilities = ['email.read', 'email.send', ...(options.calendar ? ['calendar.freebusy', 'calendar.write'] : [])];
    const integration = await prisma.forTenantId(tenant.id).integration.create({ data: { tenantId: tenant.id, connectorType: 'GMAIL', status: 'CONNECTED', externalAccountDisplayName: 'firma@e2e.example', grantedCapabilities } });
    connectionByTenant.set(tenant.id, integration.id);
    for (const action of ['process.plan.activate', 'email.send.acknowledgement', 'email.send.information', 'knowledge.answer', 'meeting.create', 'lead.create', 'staff.notify']) {
      await prisma.forTenantId(tenant.id).policyConfig.upsert({ where: { tenantId_action: { tenantId: tenant.id, action } }, create: { tenantId: tenant.id, action, mode: 'AUTONOMOUS' }, update: { mode: 'AUTONOMOUS' } });
    }
    if (options.profile !== false) {
      await prisma.forTenantId(tenant.id).tenantProfile.create({
        data: { tenantId: tenant.id, industry: 'Heizung und Sanitär', description: 'Wir installieren und warten Heizungen.', services: ['Heizungswartung', 'Badsanierung'], faqs: [{ question: 'Machen Sie Badsanierung?', answer: 'Ja, wir führen Badsanierungen im Raum Berlin aus.' }] },
      });
    }
    return tenant.id;
  }

  function seedTriage(over: Partial<TriageResult> = {}): void {
    llm.seedResponse({
      toolCalls: [{ toolCallId: randomUUID(), toolName: 'submit_triage_result', input: buildTriageFixture({ businessRelevance: 'RELEVANT', category: 'COMPLAINT_OR_SERVICE', urgency: 'NORMAL', senderRoleHypothesis: 'CUSTOMER', conciseReason: 'Frage einer Kundin bzw. eines Kunden.', confidence: { relevance: 0.97, intent: 0.95 }, ...over }) as unknown as Record<string, unknown> }],
      stopReason: 'tool_use',
    });
    llm.seedResponse({ text: 'ok', toolCalls: [], stopReason: 'end_turn' });
  }
  function seedTool(toolName: string, input: Record<string, unknown>): void {
    llm.seedResponse({ toolCalls: [{ toolCallId: randomUUID(), toolName, input }], stopReason: 'tool_use' });
    llm.seedResponse({ text: 'ok', toolCalls: [], stopReason: 'end_turn' });
  }
  const seedPlan = (nodes: unknown[], edges: unknown[]) =>
    seedTool('submit_process_plan', { goalKeys: ['answered'], nodes, edges, unresolvedRequirements: [], assumptions: [], conciseExplanation: 'Antworten.' });

  const node = (id: string, type: string, extra: Record<string, unknown> = {}) => ({ id, type, title: id, inputs: {}, config: {}, ...extra });
  const edge = (source: string, target: string) => ({ id: `e_${source}_${target}`, source, target });
  const ctxNode = () => node('sender_check', 'RESOLVE_CONTEXT', { capability: { key: 'context.lookup' } });
  const draftNode = (id: string, purpose: string, inputs: Record<string, unknown> = {}) => node(id, 'PREPARE', { capability: { key: 'communication.draft' }, inputs: { to: { fact: 'contact.email' }, ...inputs }, config: { purpose } });
  const sendNode = (id: string, draft: string, purpose: string) => node(id, 'ACTION', { capability: { key: 'email.send' }, inputs: { draftId: { stepOutput: { node: draft, path: 'draftId' } } }, config: { purpose } });

  function mail(tenantId: string, over: Partial<NormalizedIntakeEvent> = {}): NormalizedIntakeEvent {
    return { tenantId, channel: 'SIMULATED', provider: 'simulated', externalEventId: randomUUID(), occurredAt: new Date(), sender: { address: SENDER, displayName: 'Karl Kunde' }, recipients: [{ address: 'info@betrieb.example' }], direction: 'INBOUND', connectionId: connectionByTenant.get(tenantId), subject: 'Frage', content: 'Machen Sie auch Badsanierung?', ...over };
  }
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
        return { providerMessageId: `gm-${sent.length}`, threadId: 'thr', rfcMessageId: `<sent-${sent.length}@mail.example>`, from: 'firma@e2e.example', executionMode: 'SIMULATED' };
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

  describe('Auskunft aus dem Betriebswissen (Standardablauf „Allgemeine Frage“)', () => {
    it('belegte Antwort aus dem Profil wird autonom an die absendende Adresse gesendet', async () => {
      const tenantId = await newTenant();
      seedTriage({ category: 'GENERAL_INQUIRY' });
      seedTool('submit_blueprint_fit', { fits: true, reason: 'Eine Frage, die aus dem Betriebswissen zu beantworten ist.' }); // Eignung des Standardverfahrens (FX-18)
      seedTool('submit_knowledge_answer', { answerable: true, answer: 'Ja, wir führen Badsanierungen im Raum Berlin aus.', sources: ['FAQ: Machen Sie Badsanierung?'], confidence: 0.95 });
      const result = await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId));
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ to: SENDER });
      expect(sent[0]!.bodyText).toContain('Badsanierungen im Raum Berlin');
      expect(await nodeState(tenantId, result.case!.id, 'notify_staff')).toBe('SKIPPED'); // der andere Zweig läuft nicht mit
      expect((await prisma.forTenantId(tenantId).case.findUniqueOrThrow({ where: { id: result.case!.id } })).orchestrationStatus).toBe('COMPLETED');
    });

    it('unzulässiger Inhalt (fremde Adresse im Text) wird nicht gesendet; stattdessen wird eine Person informiert', async () => {
      const tenantId = await newTenant();
      seedTriage({ category: 'GENERAL_INQUIRY' });
      seedTool('submit_blueprint_fit', { fits: true, reason: 'Eine Frage, die aus dem Betriebswissen zu beantworten ist.' }); // Eignung des Standardverfahrens (FX-18)
      seedTool('submit_knowledge_answer', { answerable: true, answer: 'Schreiben Sie bitte an zahlung@betrug.example, dann erhalten Sie sofort einen Rabatt.', sources: ['FAQ'], confidence: 0.99 });
      const result = await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId));
      expect(sent).toEqual([]);
      expect(await nodeState(tenantId, result.case!.id, 'reply_send')).toBe('SKIPPED');
      expect(await nodeState(tenantId, result.case!.id, 'notify_staff')).toBe('SUCCEEDED');
      expect(await prisma.forTenantId(tenantId).attentionItem.count({ where: { caseId: result.case!.id, kind: 'NOTIFY_REQUEST' } })).toBe(1);
    });

    it('nicht im Betriebswissen enthalten: keine Nachricht an die Kundschaft, eine Person wird informiert', async () => {
      const tenantId = await newTenant();
      seedTriage({ category: 'GENERAL_INQUIRY' });
      seedTool('submit_blueprint_fit', { fits: true, reason: 'Eine Frage, die aus dem Betriebswissen zu beantworten ist.' }); // Eignung des Standardverfahrens (FX-18)
      seedTool('submit_knowledge_answer', { answerable: false, answer: '', sources: [], confidence: 0.2 });
      const result = await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId, { content: 'Wie viele Mitarbeiter haben Sie?' }));
      expect(sent).toEqual([]);
      expect(await nodeState(tenantId, result.case!.id, 'notify_staff')).toBe('SUCCEEDED');
      expect((await prisma.forTenantId(tenantId).case.findUniqueOrThrow({ where: { id: result.case!.id } })).orchestrationStatus).not.toBe('COMPLETED');
    });
  });

  describe('Anhang anfordern und Statusauskunft', () => {
    it('ein fehlender Anhang wird freundlich und konkret angefordert', async () => {
      const tenantId = await newTenant();
      seedTriage();
      seedPlan([ctxNode(), draftNode('ask_draft', 'ATTACHMENT_REQUEST', { what: { literal: 'der Anhang mit der Rechnung' } }), sendNode('ask_send', 'ask_draft', 'ATTACHMENT_REQUEST'), node('done', 'COMPLETE')], [edge('sender_check', 'ask_draft'), edge('ask_draft', 'ask_send'), edge('ask_send', 'done')]);
      const result = await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId, { subject: 'Rechnung', content: 'Anbei die Rechnung.' }));
      await confirmPlan(tenantId, result.case!.id); // D4: der Versand eines unbekannten Vorgangs beginnt erst nach der Planbestätigung
      expect(sent).toHaveLength(1);
      expect(sent[0]!.bodyText).toContain('der Anhang mit der Rechnung');
    });

    it('die Nachfrage nach einem früheren Vorgang wird aus dessen Stand beantwortet – nur für die beteiligte Adresse', async () => {
      const tenantId = await newTenant();
      seedTriage({ conversationRelation: 'NEW' });
      await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId, { subject: 'Heizung ausgefallen', content: 'Seit gestern kalt.' }));
      sent = [];

      seedTriage({ category: 'GENERAL_INQUIRY', conversationRelation: 'CONTINUATION' });
      await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId, { subject: 'Wie ist der Stand?', content: 'Wann kommt jemand?' }));
      expect(sent).toHaveLength(1);
      expect(sent[0]!.bodyText).toContain('Heizung ausgefallen');
      expect(sent[0]!.bodyText).not.toMatch(/€|EUR|garantier/i);
    });
  });

  describe('Interessent anlegen', () => {
    it('legt zum bekannten Kontakt einen Interessenten an – höchstens einmal je Vorgang', async () => {
      const tenantId = await newTenant({ profile: false });
      await app.get(ContactsService).upsert(tenantId, undefined, { firstName: 'Karl', lastName: 'Kunde', email: SENDER });
      seedTriage({ senderRoleHypothesis: 'PROSPECT' });
      seedPlan([ctxNode(), node('lead', 'ACTION', { capability: { key: 'crm.lead.create' } }), node('done', 'COMPLETE')], [edge('sender_check', 'lead'), edge('lead', 'done')]);
      const result = await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId));
      await confirmPlan(tenantId, result.case!.id); // D4: die Übergabe an das CRM ist eine Wirkung
      expect(await prisma.forTenantId(tenantId).lead.count({ where: { caseId: result.case!.id } })).toBe(1);
    });
  });

  describe('Termin buchen', () => {
    async function caseWithProposal(tenantId: string, agreed: string, sender = SENDER, subject = 'Termin') {
      seedTriage();
      const result = await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId, { subject, content: 'Ich hätte gern einen Termin.', sender: { address: sender, displayName: 'Kunde' } }));
      const caseId = result.case!.id;
      const start = new Date(Date.now() + 3 * 24 * 3600 * 1000);
      start.setMinutes(0, 0, 0);
      const slots = [0, 1].map((i) => ({ start: new Date(start.getTime() + i * 24 * 3600 * 1000).toISOString(), end: new Date(start.getTime() + i * 24 * 3600 * 1000 + 3600 * 1000).toISOString() }));
      await app.get(CaseEventsService).append(tenantId, caseId, { type: 'appointment.proposed', payload: { kind: 'SITE_VISIT', slots } });
      await app.get(CaseFactsService).setByHuman(tenantId, caseId, randomUUID(), { key: 'appointment.agreed', value: agreed });
      return { caseId, slots };
    }
    const bookingProcedure = () => ({
      goalKeys: ['appointment.booked'],
      nodes: [
        ctxNode(),
        node('book', 'ACTION', { capability: { key: 'calendar.book' }, inputs: { choice: { fact: 'appointment.agreed' } } }),
        draftNode('confirm_draft', 'APPOINTMENT_CONFIRMATION', { start: { stepOutput: { node: 'book', path: 'start' } }, end: { stepOutput: { node: 'book', path: 'end' } }, kind: { stepOutput: { node: 'book', path: 'kind' } } }),
        sendNode('confirm_send', 'confirm_draft', 'APPOINTMENT_CONFIRMATION'),
        node('done', 'COMPLETE'),
      ],
      edges: [edge('sender_check', 'book'), edge('book', 'confirm_draft'), edge('confirm_draft', 'confirm_send'), edge('confirm_send', 'done')],
      unresolvedRequirements: [],
      assumptions: [],
      conciseExplanation: 'Termin buchen und bestätigen.',
    });

    it('der gewählte, vorgeschlagene Termin wird nach erneuter Freiprüfung gebucht und der Kundschaft bestätigt', async () => {
      const tenantId = await newTenant({ calendar: true, profile: false });
      const { caseId, slots } = await caseWithProposal(tenantId, 'Der erste Termin passt mir gut.');
      seedTool('submit_slot_choice', { slotIndex: 0, evidence: 'Der erste Termin passt mir gut' });
      const orchestrator = app.get(OrchestratorService);
      const started = await orchestrator.startProcedure(tenantId, caseId, bookingProcedure() as never);
      expect(started.outcome).toBe('RUNNING');
      await orchestrator.advance(tenantId, caseId);
      expect(created).toHaveLength(1);
      expect(new Date(created[0]!.start as Date).toISOString()).toBe(slots[0]!.start);
      expect(created[0]!.eventId).toMatch(/^[a-v0-9]{5,200}$/);
      expect(sent).toHaveLength(1);
      expect(sent[0]!.to).toBe(SENDER);
      expect(await prisma.forTenantId(tenantId).caseEvent.count({ where: { caseId, type: 'appointment.booked' } })).toBe(1);
    });

    it('Wirkungsschlüssel (FA-10): dasselbe Terminfenster wird nur einem Vorgang gegeben – der zweite bucht nicht doppelt, auch wenn der Kalender es noch frei meldet', async () => {
      const tenantId = await newTenant({ calendar: true, profile: false });
      const first = await caseWithProposal(tenantId, 'Der erste Termin passt mir gut.', 'eins@kunde.example');
      const second = await caseWithProposal(tenantId, 'Der erste Termin passt mir gut.', 'zwei@kunde.example', 'Anderer Termin');
      expect(second.caseId).not.toBe(first.caseId);
      expect(second.slots[0]!.start).toBe(first.slots[0]!.start);
      const orchestrator = app.get(OrchestratorService);

      seedTool('submit_slot_choice', { slotIndex: 0, evidence: 'Der erste Termin passt mir gut' });
      await orchestrator.startProcedure(tenantId, first.caseId, bookingProcedure() as never);
      await orchestrator.advance(tenantId, first.caseId);
      expect(created).toHaveLength(1);
      const intent = await prisma.forTenantId(tenantId).actionIntent.findFirstOrThrow({ where: { caseId: first.caseId, capabilityKey: 'calendar.book' } });
      expect(intent.resourceKey).toMatch(/^calendar:primary:/);

      seedTool('submit_slot_choice', { slotIndex: 0, evidence: 'Der erste Termin passt mir gut' });
      await orchestrator.startProcedure(tenantId, second.caseId, bookingProcedure() as never);
      await orchestrator.advance(tenantId, second.caseId);
      expect(created).toHaveLength(1); // kein zweiter Termin im selben Fenster
      expect(await nodeState(tenantId, second.caseId, 'book')).toBe('FAILED');
      const row = await prisma.forTenantId(tenantId).case.findUniqueOrThrow({ where: { id: second.caseId } });
      expect(row.orchestrationStatus).toBe('MANUAL_REVIEW');
      expect(row.attentionReasons.join(' ')).toMatch(/vergeben/);
      expect(sent).toHaveLength(1); // nur die Bestätigung des ersten Vorgangs
    });

    it('Prüfung unmittelbar vor der Wirkung (FX-08): wird der Vorgang zwischen Regelprüfung und Ausführung angehalten, wird nichts gebucht', async () => {
      const tenantId = await newTenant({ calendar: true, profile: false });
      const { caseId } = await caseWithProposal(tenantId, 'Der erste Termin passt mir gut.');
      seedTool('submit_slot_choice', { slotIndex: 0, evidence: 'Der erste Termin passt mir gut' });
      const policy = app.get(PolicyEnforcementService);
      const original = policy.resolveMode.bind(policy);
      const spy = jest.spyOn(policy, 'resolveMode').mockImplementation(async (tenant: string, action: never) => {
        const mode = await original(tenant, action);
        const running = await prisma.forTenantId(tenant).processPlanNode.count({ where: { nodeKey: 'book', state: 'RUNNING' } });
        if ((action as string) === 'meeting.create' && running > 0) await prisma.withRlsBypass((tx) => tx.case.update({ where: { id: caseId }, data: { orchestrationStatus: 'PAUSED' } }));
        return mode;
      });
      try {
        const orchestrator = app.get(OrchestratorService);
        await orchestrator.startProcedure(tenantId, caseId, bookingProcedure() as never);
        await orchestrator.advance(tenantId, caseId);
      } finally {
        spy.mockRestore();
      }
      expect(created).toEqual([]);
      expect(sent).toEqual([]);
      const node = await prisma.forTenantId(tenantId).processPlanNode.findFirstOrThrow({ where: { nodeKey: 'book' } });
      expect(node).toMatchObject({ state: 'BLOCKED', errorCode: 'CASE_STATE_CHANGED' });
      expect((await prisma.forTenantId(tenantId).case.findUniqueOrThrow({ where: { id: caseId } })).orchestrationStatus).toBe('PAUSED');
    });

    it('Rücklesung (FX-08): steht der Termin nicht wie gebucht im Kalender, ist das Ergebnis ungewiss und die Bestätigung geht nicht hinaus; bei bestätigter Rücklesung ist es belegt', async () => {
      const readBack = jest.spyOn(GmailConnectorService.prototype, 'getCalendarEvent');
      try {
        const tenantA = await newTenant({ calendar: true, profile: false });
        const a = await caseWithProposal(tenantA, 'Der erste Termin passt mir gut.');
        seedTool('submit_slot_choice', { slotIndex: 0, evidence: 'Der erste Termin passt mir gut' });
        readBack.mockImplementationOnce(async (_tenant, input) => ({ eventId: input.eventId, status: 'cancelled' }));
        const orchestrator = app.get(OrchestratorService);
        await orchestrator.startProcedure(tenantA, a.caseId, bookingProcedure() as never);
        await orchestrator.advance(tenantA, a.caseId);
        expect(created).toHaveLength(1);
        expect(sent).toEqual([]);
        expect(await nodeState(tenantA, a.caseId, 'book')).toBe('OUTCOME_UNKNOWN');
        expect((await prisma.forTenantId(tenantA).case.findUniqueOrThrow({ where: { id: a.caseId } })).orchestrationStatus).toBe('MANUAL_REVIEW');

        const tenantB = await newTenant({ calendar: true, profile: false });
        const b = await caseWithProposal(tenantB, 'Der erste Termin passt mir gut.');
        seedTool('submit_slot_choice', { slotIndex: 0, evidence: 'Der erste Termin passt mir gut' });
        readBack.mockImplementationOnce(async (_tenant, input) => ({ eventId: input.eventId, status: 'confirmed', start: new Date(b.slots[0]!.start), end: new Date(b.slots[0]!.end) }));
        await orchestrator.startProcedure(tenantB, b.caseId, bookingProcedure() as never);
        await orchestrator.advance(tenantB, b.caseId);
        expect(sent).toHaveLength(1);
        const booked = await prisma.forTenantId(tenantB).processPlanNode.findFirstOrThrow({ where: { nodeKey: 'book' } });
        expect(booked.output).toMatchObject({ readBack: 'CONFIRMED' });
      } finally {
        readBack.mockRestore();
      }
    });

    it('ohne eindeutige oder belegte Wahl wird nichts gebucht', async () => {
      const tenantId = await newTenant({ calendar: true, profile: false });
      const { caseId } = await caseWithProposal(tenantId, 'Vielleicht nächste Woche, mal sehen.');
      seedTool('submit_slot_choice', { slotIndex: null, evidence: '' });
      const orchestrator = app.get(OrchestratorService);
      await orchestrator.startProcedure(tenantId, caseId, bookingProcedure() as never);
      await orchestrator.advance(tenantId, caseId);
      expect(created).toEqual([]);
      expect(sent).toEqual([]);
    });

    describe('Ausfall eines Systems: der Vorgang wird nicht abgebrochen, ORBIT wiederholt selbstständig', () => {
      async function bookingDuringOutage() {
        const tenantId = await newTenant({ calendar: true, profile: false });
        const { caseId, slots } = await caseWithProposal(tenantId, 'Der erste Termin passt mir gut.');
        const failure = jest.spyOn(llm, 'complete').mockRejectedValueOnce(new Error('fetch failed'));
        const procedure = bookingProcedure();
        (procedure.nodes[1] as Record<string, unknown>).optional = true; // auch ein optionaler Schritt wird bei einem Ausfall nicht gestrichen
        (procedure.nodes[1] as Record<string, unknown>).onFailure = 'SKIP';
        const orchestrator = app.get(OrchestratorService);
        await orchestrator.startProcedure(tenantId, caseId, procedure as never);
        await orchestrator.advance(tenantId, caseId);
        failure.mockRestore();
        return { tenantId, caseId, slots, orchestrator };
      }
      const caseStatus = async (tenantId: string, caseId: string) => (await prisma.forTenantId(tenantId).case.findUniqueOrThrow({ where: { id: caseId } })).orchestrationStatus;
      const makeDue = (tenantId: string) => prisma.withRlsBypass((tx) => tx.processPlanNode.updateMany({ where: { tenantId, nodeKey: 'book', state: 'PLANNED' }, data: { retryAt: new Date(Date.now() - 1000) } }));

      it('der Schritt bleibt geplant und wird mit Wartezeit wiederholt; der Vorgang wartet auf das System, niemand wird gestört', async () => {
        const { tenantId, caseId } = await bookingDuringOutage();
        expect(await nodeState(tenantId, caseId, 'book')).toBe('PLANNED');
        expect(await caseStatus(tenantId, caseId)).toBe('WAITING_FOR_EXTERNAL_SYSTEM');
        expect(created).toEqual([]);
        const retry = await prisma.forTenantId(tenantId).caseEvent.findFirstOrThrow({ where: { caseId, type: 'node.retry_scheduled' } });
        expect(retry.payload).toMatchObject({ nodeKey: 'book', attempt: 1, errorCode: 'AI_UNAVAILABLE' });
        const node = await prisma.forTenantId(tenantId).processPlanNode.findFirstOrThrow({ where: { nodeKey: 'book' } });
        expect(node.retryAt!.getTime()).toBeGreaterThan(Date.now());
        expect(await prisma.forTenantId(tenantId).attentionItem.count({ where: { caseId } })).toBe(0);
      });

      it('ist das System wieder da, wird der Termin ohne jede Handarbeit gebucht und bestätigt', async () => {
        const { tenantId, caseId, orchestrator } = await bookingDuringOutage();
        await makeDue(tenantId);
        seedTool('submit_slot_choice', { slotIndex: 0, evidence: 'Der erste Termin passt mir gut' });
        await orchestrator.advance(tenantId, caseId);
        expect(created).toHaveLength(1);
        expect(sent).toHaveLength(1);
        expect(await nodeState(tenantId, caseId, 'book')).toBe('SUCCEEDED');
        expect(await caseStatus(tenantId, caseId)).toBe('COMPLETED');
      });

      it('bleibt das System länger als zwei Arbeitstage unerreichbar, wird ein Mensch eingeschaltet – vorher nicht', async () => {
        const { tenantId, caseId, orchestrator } = await bookingDuringOutage();
        const failAgain = jest.spyOn(llm, 'complete').mockRejectedValue(new Error('fetch failed'));
        // Ein Versuch nach einem Tag: ORBIT wiederholt weiter.
        await prisma.withRlsBypass((tx) => tx.caseEvent.updateMany({ where: { caseId, type: 'node.retry_scheduled' }, data: { createdAt: new Date(Date.now() - 24 * 3600 * 1000) } }));
        await makeDue(tenantId);
        await orchestrator.advance(tenantId, caseId);
        expect(await nodeState(tenantId, caseId, 'book')).toBe('PLANNED');
        expect(await caseStatus(tenantId, caseId)).toBe('WAITING_FOR_EXTERNAL_SYSTEM');
        // Der Ausfall dauert nun schon sieben Tage (mindestens drei volle Arbeitstage dazwischen): jetzt geht der Vorgang an einen Menschen.
        await prisma.withRlsBypass((tx) => tx.caseEvent.updateMany({ where: { caseId, type: 'node.retry_scheduled' }, data: { createdAt: new Date(Date.now() - 7 * 24 * 3600 * 1000) } }));
        await makeDue(tenantId);
        await orchestrator.advance(tenantId, caseId);
        failAgain.mockRestore();
        expect(await nodeState(tenantId, caseId, 'book')).toBe('FAILED');
        const row = await prisma.forTenantId(tenantId).case.findUniqueOrThrow({ where: { id: caseId } });
        expect(row.orchestrationStatus).toBe('MANUAL_REVIEW');
        expect(row.attentionReasons.join(' ')).toMatch(/Arbeitstagen/);
        expect(created).toEqual([]);
      });
    });

    it('ist der Termin inzwischen belegt, wird nicht gebucht', async () => {
      const tenantId = await newTenant({ calendar: true, profile: false });
      const { caseId, slots } = await caseWithProposal(tenantId, 'Der erste Termin passt mir gut.');
      seedTool('submit_slot_choice', { slotIndex: 0, evidence: 'Der erste Termin passt mir gut' });
      (GmailConnectorService.prototype.queryFreeBusy as jest.Mock).mockResolvedValueOnce([{ calendarId: 'primary', busy: [{ start: new Date(slots[0]!.start), end: new Date(slots[0]!.end) }] }]);
      const orchestrator = app.get(OrchestratorService);
      await orchestrator.startProcedure(tenantId, caseId, bookingProcedure() as never);
      await orchestrator.advance(tenantId, caseId);
      expect(created).toEqual([]);
      expect(sent).toEqual([]);
    });

    it('der Termin kommt in den Kalender des freien Monteurs; eine Person mit Abwesenheit wird übersprungen (BPF-08)', async () => {
      const tenantId = await newTenant({ calendar: true, profile: false });
      const scoped = prisma.forTenantId(tenantId);
      const today = new Date().toISOString().slice(0, 10);
      const staff = (firstName: string, calendarId: string, absences?: unknown) =>
        scoped.staffMember.create({ data: { tenantId, firstName, lastName: 'Monteur', roleKind: 'TECHNICIAN', email: `${firstName.toLowerCase()}@e2e.example`, calendarId, responsibilities: ['APPOINTMENTS'], ...(absences ? { absences } : {}) } as never });
      await staff('Anton', 'anton@kalender.example', [{ from: '2000-01-01', until: '2099-12-31' }]); // dauerhaft abwesend
      await staff('Ben', 'ben@kalender.example');
      const { caseId, slots } = await caseWithProposal(tenantId, 'Der erste Termin passt mir gut.');
      seedTool('submit_slot_choice', { slotIndex: 0, evidence: 'Der erste Termin passt mir gut' });
      // Alle gefragten Kalender melden sich als frei: Anton ist nur wegen seiner Abwesenheit im Verzeichnis nicht verfügbar.
      (GmailConnectorService.prototype.queryFreeBusy as jest.Mock).mockImplementationOnce(async (_t: string, ids: string[]) => ids.map((id) => ({ calendarId: id, busy: [] })));
      const orchestrator = app.get(OrchestratorService);
      await orchestrator.startProcedure(tenantId, caseId, bookingProcedure() as never);
      await orchestrator.advance(tenantId, caseId);
      expect(today).toMatch(/^\d{4}-/);
      expect(created).toHaveLength(1);
      expect(created[0]).toMatchObject({ calendarId: 'ben@kalender.example' });
      expect(String(created[0]!.description)).toContain('Zuständig: Ben Monteur');
      const booked = await scoped.caseEvent.findFirst({ where: { caseId, type: 'appointment.booked' } });
      expect((booked?.payload as { assignee?: { name?: string } }).assignee?.name).toBe('Ben Monteur');
      expect(slots[0]).toBeDefined();
    });

    it('ohne Kalender-Schreibberechtigung ist die Fähigkeit nicht ausführbar: der Plan wird nicht aktiviert', async () => {
      const tenantId = await newTenant({ calendar: false, profile: false });
      const { caseId } = await caseWithProposal(tenantId, 'Der erste Termin passt mir gut.');
      const started = await app.get(OrchestratorService).startProcedure(tenantId, caseId, bookingProcedure() as never);
      expect(started.outcome).toBe('MANUAL_REVIEW');
      expect(created).toEqual([]);
    });
  });
});
