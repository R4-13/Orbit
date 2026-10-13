import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { MockLLMProvider } from '@orbit/agent-core';
import { buildTriageFixture, type TriageResult } from '@orbit/shared';
import { LLM_PROVIDER } from '../src/agent/agent.tokens';
import type { NormalizedIntakeEvent } from '../src/intake/channel-event.types';
import { IntakeService } from '../src/intake/intake.service';
import { OUTBOUND_MAIL, type OutboundMailPort, type OutboundMessage } from '../src/integrations/outbound-mail.port';
import { PrismaService } from '../src/prisma/prisma.service';
import { PlanStoreService } from '../src/process/plan-store.service';
import { TenantsService } from '../src/tenants/tenants.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

const SENDER = 'kunde@privat.example';

/**
 * Autonomie ohne hinterlegten Prozess (AUT-01 bis AUT-04) gegen echte Postgres: das feste Notfallverfahren mit Eingangsbestätigung an den Absender (Regel entscheidet),
 * ein von der KI geplanter Ablauf ohne Bestätigung des ganzen Plans (risikobasiert) und der Bezug auf frühere Vorgänge. Modell und Versand sind Aufzeichnungs-Doubles.
 */
describe('Autonomie ohne hinterlegten Prozess (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let intake: IntakeService;
  let store: PlanStoreService;
  let llm: MockLLMProvider;
  let sent: OutboundMessage[] = [];
  const tenants: string[] = [];
  const connectionByTenant = new Map<string, string>();

  async function newTenant(modes: Record<string, 'AUTONOMOUS' | 'REQUIRE_APPROVAL' | 'DISABLED'>): Promise<string> {
    const suffix = randomUUID();
    const { tenant } = await app.get(TenantsService).bootstrapTenant({ name: `Auto ${suffix.slice(0, 8)}`, slug: `e2e-auto-${suffix}`, adminEmail: `admin-${suffix}@e2e-auto.example`, adminPassword: 'Musterwerk#2026!', adminFirstName: 'A', adminLastName: 'A' });
    tenants.push(tenant.id);
    const integration = await prisma.forTenantId(tenant.id).integration.create({ data: { tenantId: tenant.id, connectorType: 'GMAIL', status: 'CONNECTED', externalAccountDisplayName: 'firma@e2e.example', grantedCapabilities: ['email.read', 'email.send'] } });
    connectionByTenant.set(tenant.id, integration.id);
    for (const [action, mode] of Object.entries(modes)) {
      await prisma.forTenantId(tenant.id).policyConfig.upsert({ where: { tenantId_action: { tenantId: tenant.id, action } }, create: { tenantId: tenant.id, action, mode }, update: { mode } });
    }
    return tenant.id;
  }

  function seedTriage(over: Partial<TriageResult>): void {
    llm.seedResponse({
      toolCalls: [{ toolCallId: randomUUID(), toolName: 'submit_triage_result', input: buildTriageFixture({ businessRelevance: 'RELEVANT', category: 'COMPLAINT_OR_SERVICE', senderRoleHypothesis: 'CUSTOMER', conciseReason: 'Anliegen einer Kundin bzw. eines Kunden.', confidence: { relevance: 0.97, intent: 0.95 }, ...over }) as unknown as Record<string, unknown> }],
      stopReason: 'tool_use',
    });
    llm.seedResponse({ text: 'ok', toolCalls: [], stopReason: 'end_turn' });
  }

  function seedPlan(nodes: unknown[], edges: unknown[]): void {
    llm.seedResponse({
      toolCalls: [{ toolCallId: randomUUID(), toolName: 'submit_process_plan', input: { goalKeys: ['acknowledged'], nodes, edges, unresolvedRequirements: [], assumptions: [], conciseExplanation: 'Eingang bestätigen.' } }],
      stopReason: 'tool_use',
    });
    llm.seedResponse({ text: 'ok', toolCalls: [], stopReason: 'end_turn' });
  }

  const node = (id: string, type: string, extra: Record<string, unknown> = {}) => ({ id, type, title: id, inputs: {}, config: {}, ...extra });
  const edge = (source: string, target: string) => ({ id: `e_${source}_${target}`, source, target });

  function mail(tenantId: string, over: Partial<NormalizedIntakeEvent> = {}): NormalizedIntakeEvent {
    return { tenantId, channel: 'SIMULATED', provider: 'simulated', externalEventId: randomUUID(), occurredAt: new Date(), sender: { address: SENDER, displayName: 'Karl Kunde' }, recipients: [{ address: 'info@betrieb.example' }], direction: 'INBOUND', connectionId: connectionByTenant.get(tenantId), subject: 'Rohrbruch im Keller', content: 'Das Wasser läuft, bitte sofort kommen.', ...over };
  }
  const nodeState = async (tenantId: string, caseId: string, key: string) => (await store.getActive(tenantId, caseId))?.nodes.find((n) => n.nodeKey === key)?.state;
  const caseOf = (tenantId: string, caseId: string) => prisma.forTenantId(tenantId).case.findUniqueOrThrow({ where: { id: caseId } });

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    prisma = app.get(PrismaService);
    intake = app.get(IntakeService);
    store = app.get(PlanStoreService);
    llm = app.get(LLM_PROVIDER);
    jest.spyOn(app.get<OutboundMailPort>(OUTBOUND_MAIL), 'send').mockImplementation(async (_tenant, message) => {
      sent.push(message);
      return { providerMessageId: `gm-${sent.length}`, threadId: 'thr', rfcMessageId: `<sent-${sent.length}@mail.example>`, from: 'firma@e2e.example', executionMode: 'SIMULATED' };
    });
  });
  beforeEach(() => {
    sent = [];
  });
  afterAll(async () => {
    jest.restoreAllMocks();
    for (const id of tenants) await prisma.withRlsBypass((tx) => tx.tenant.deleteMany({ where: { id } }));
    await app.close();
  });

  describe('Notfallverfahren', () => {
    it('Regel „Bestätigung nur mit Freigabe“: die Person wird sofort benachrichtigt, die Bestätigung wartet – es geht nichts an den Absender', async () => {
      const tenantId = await newTenant({ 'email.send.acknowledgement': 'REQUIRE_APPROVAL' });
      seedTriage({ urgency: 'CRITICAL' });
      const result = await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId));
      const caseId = result.case!.id;
      expect(await nodeState(tenantId, caseId, 'notify_staff')).toBe('SUCCEEDED');
      expect(sent).toEqual([]);
      const intent = await prisma.forTenantId(tenantId).actionIntent.findFirstOrThrow({ where: { caseId, capabilityKey: 'email.send' } });
      expect(intent).toMatchObject({ purpose: 'ACKNOWLEDGEMENT', status: 'AWAITING_APPROVAL' });
      const requested = await prisma.forTenantId(tenantId).attentionItem.findFirst({ where: { caseId, kind: 'NOTIFY_REQUEST' } });
      expect(requested).toMatchObject({ emergency: true });
      expect((await caseOf(tenantId, caseId)).orchestrationStatus).toBe('WAITING_FOR_APPROVAL');
    });

    it('Regel „Bestätigung autonom“: genau eine Eingangsbestätigung an die absendende Adresse – ohne Zusagen, mit Hinweis auf den Notruf', async () => {
      const tenantId = await newTenant({ 'email.send.acknowledgement': 'AUTONOMOUS' });
      seedTriage({ urgency: 'CRITICAL' });
      const result = await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId));
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ to: SENDER });
      expect(sent[0]!.subject.startsWith('Re:')).toBe(true);
      expect(sent[0]!.bodyText).toContain('Notruf 112');
      expect(sent[0]!.bodyText).not.toMatch(/€|EUR|Preis|garantier/i);
      expect(await nodeState(tenantId, result.case!.id, 'ack_send')).toBe('SUCCEEDED');
    });

    it('ein automatischer Absender bekommt nie eine Bestätigung; die Benachrichtigung der Person bleibt', async () => {
      const tenantId = await newTenant({ 'email.send.acknowledgement': 'AUTONOMOUS' });
      seedTriage({ urgency: 'CRITICAL' });
      const result = await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId, { sender: { address: 'noreply@alarm.example' } }));
      expect(sent).toEqual([]);
      expect(await nodeState(tenantId, result.case!.id, 'notify_staff')).toBe('SUCCEEDED');
    });

    it('ein Lieferant bekommt keine Bestätigung (Verfahren ohne diesen Zweig)', async () => {
      const tenantId = await newTenant({ 'email.send.acknowledgement': 'AUTONOMOUS' });
      seedTriage({ urgency: 'CRITICAL', senderRoleHypothesis: 'SUPPLIER' });
      const result = await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId));
      expect(sent).toEqual([]);
      const graph = await store.getActive(tenantId, result.case!.id);
      expect(graph?.nodes.map((n) => n.nodeKey)).not.toContain('ack_send');
    });

    it('ist die Bestätigung per Regel deaktiviert, entfällt der Zweig – die Person wird trotzdem benachrichtigt', async () => {
      const tenantId = await newTenant({ 'email.send.acknowledgement': 'DISABLED' });
      seedTriage({ urgency: 'CRITICAL' });
      const result = await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId));
      expect(sent).toEqual([]);
      expect(await nodeState(tenantId, result.case!.id, 'notify_staff')).toBe('SUCCEEDED');
    });
  });

  describe('Von der KI geplanter Ablauf (risikobasiert)', () => {
    const ackPlan = () =>
      seedPlan(
        [
          node('sender_check', 'RESOLVE_CONTEXT', { capability: { key: 'context.lookup' } }),
          node('ack_draft', 'PREPARE', { capability: { key: 'communication.draft' }, inputs: { to: { fact: 'contact.email' } }, config: { purpose: 'ACKNOWLEDGEMENT' } }),
          node('ack_send', 'ACTION', { capability: { key: 'email.send' }, inputs: { draftId: { stepOutput: { node: 'ack_draft', path: 'draftId' } } }, config: { purpose: 'ACKNOWLEDGEMENT' } }),
          node('done', 'COMPLETE'),
        ],
        [edge('sender_check', 'ack_draft'), edge('ack_draft', 'ack_send'), edge('ack_send', 'done')],
      );

    it('Regel „Planen ohne Bestätigung“: der Ablauf läuft sofort, die Wirkung nach außen folgt ihrer eigenen Regel', async () => {
      const tenantId = await newTenant({ 'process.plan.activate': 'AUTONOMOUS', 'email.send.acknowledgement': 'AUTONOMOUS' });
      seedTriage({ urgency: 'NORMAL', category: 'GENERAL_INQUIRY' });
      ackPlan();
      const result = await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId, { subject: 'Frage zu Ihren Leistungen', content: 'Machen Sie auch Badsanierung?' }));
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ to: SENDER });
      expect((await caseOf(tenantId, result.case!.id)).orchestrationStatus).not.toBe('WAITING_FOR_APPROVAL');
    });

    it('Regel „Plan nur mit Bestätigung“: der Plan wartet, es geschieht nichts', async () => {
      const tenantId = await newTenant({ 'process.plan.activate': 'REQUIRE_APPROVAL', 'email.send.acknowledgement': 'AUTONOMOUS' });
      seedTriage({ urgency: 'NORMAL', category: 'GENERAL_INQUIRY' });
      ackPlan();
      const result = await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId, { subject: 'Frage', content: 'Machen Sie auch Badsanierung?' }));
      expect(sent).toEqual([]);
      expect((await caseOf(tenantId, result.case!.id)).orchestrationStatus).toBe('WAITING_FOR_APPROVAL');
    });

    it('ohne verwertbaren Plan (keine KI) bleibt der Vorgang wie bisher bei einer Person zur Prüfung', async () => {
      const tenantId = await newTenant({ 'process.plan.activate': 'AUTONOMOUS' });
      seedTriage({ urgency: 'NORMAL', category: 'GENERAL_INQUIRY' });
      const result = await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId, { subject: 'Frage', content: 'Hallo?' }));
      expect(sent).toEqual([]);
      expect((await caseOf(tenantId, result.case!.id)).orchestrationStatus).toBe('MANUAL_REVIEW');
    });
  });

  describe('Bezug auf frühere Vorgänge', () => {
    it('genau ein früherer Vorgang derselben Adresse: der Bezug wird als Fakt bestätigt – ohne Verschmelzung; mehrere: nur im Verlauf genannt', async () => {
      const tenantId = await newTenant({});
      seedTriage({ urgency: 'NORMAL', conversationRelation: 'NEW' });
      const first = await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId, { subject: 'Heizung ausgefallen', content: 'Seit gestern kalt.' }));

      seedTriage({ urgency: 'NORMAL', conversationRelation: 'CONTINUATION' });
      const second = await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId, { subject: 'Wie ist der Stand?', content: 'Wann kommt jemand wegen der Heizung?' }));
      expect(second.case!.id).not.toBe(first.case!.id);
      const reference = await prisma.forTenantId(tenantId).caseFact.findFirst({ where: { caseId: second.case!.id, key: 'case.reference', isCurrent: true } });
      expect(reference).toMatchObject({ value: first.case!.id, status: 'CONFIRMED' });
      const event = await prisma.forTenantId(tenantId).caseEvent.findFirstOrThrow({ where: { caseId: second.case!.id, type: 'case.referenced' } });
      expect(event.payload).toMatchObject({ referenceCaseId: first.case!.id, ambiguous: false });

      seedTriage({ urgency: 'NORMAL', conversationRelation: 'CONTINUATION' });
      const third = await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId, { subject: 'Noch einmal', content: 'Bitte um Rückmeldung.' }));
      expect(await prisma.forTenantId(tenantId).caseFact.count({ where: { caseId: third.case!.id, key: 'case.reference' } })).toBe(0);
      const ambiguous = await prisma.forTenantId(tenantId).caseEvent.findFirstOrThrow({ where: { caseId: third.case!.id, type: 'case.referenced' } });
      expect(ambiguous.payload).toMatchObject({ referenceCaseId: null, ambiguous: true });
    });

    it('eine neue Angelegenheit (kein Bezug laut KI) bekommt keinen Bezug', async () => {
      const tenantId = await newTenant({});
      seedTriage({ urgency: 'NORMAL', conversationRelation: 'NEW' });
      await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId, { subject: 'Erste', content: 'Eins.' }));
      seedTriage({ urgency: 'NORMAL', conversationRelation: 'NEW' });
      const other = await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId, { subject: 'Zweite', content: 'Zwei.' }));
      expect(await prisma.forTenantId(tenantId).caseEvent.count({ where: { caseId: other.case!.id, type: 'case.referenced' } })).toBe(0);
    });
  });
});
