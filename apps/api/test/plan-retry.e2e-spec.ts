import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { MockLLMProvider } from '@orbit/agent-core';
import { buildTriageFixture } from '@orbit/shared';
import { LLM_PROVIDER } from '../src/agent/agent.tokens';
import { AiProviderResolverService } from '../src/ai-providers/ai-provider-resolver.service';
import type { NormalizedIntakeEvent } from '../src/intake/channel-event.types';
import { IntakeService } from '../src/intake/intake.service';
import { OUTBOUND_MAIL, type OutboundMailPort } from '../src/integrations/outbound-mail.port';
import { PrismaService } from '../src/prisma/prisma.service';
import { OrchestratorService, PLAN_RETRY_DELAYS_MINUTES } from '../src/process/orchestrator.service';
import { TenantsService } from '../src/tenants/tenants.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

/**
 * FX-19: ein vorübergehender KI-Ausfall beim Planen gibt den Vorgang nicht sofort an eine Person. Die Planung wird begrenzt, zeitversetzt und persistent wiederholt; bereits ausgeführte
 * Wirkungen werden dabei nie wiederholt; nach der letzten Wiederholung geht der Vorgang mit nachvollziehbarer Begründung an eine Person. Modell = Skript-Warteschlange, Ausfall = abgelehnter Aufruf.
 */
describe('Wiederholung der Planung bei vorübergehendem KI-Ausfall (FX-19, e2e)', () => {
  jest.setTimeout(120_000);
  let app: INestApplication;
  let prisma: PrismaService;
  let intake: IntakeService;
  let llm: MockLLMProvider;
  const spies: jest.SpyInstance[] = [];
  const tenants: string[] = [];
  const connectionByTenant = new Map<string, string>();
  /** Wie viele der nächsten Modellaufrufe ausfallen; der erste Aufruf (Einstufung) läuft immer durch. */
  let failFrom = 0;
  let failCount = 0;
  let calls = 0;

  async function newTenant(): Promise<string> {
    const suffix = randomUUID();
    const { tenant } = await app.get(TenantsService).bootstrapTenant({ name: `Retry ${suffix.slice(0, 8)}`, slug: `e2e-retry-${suffix}`, adminEmail: `admin-${suffix}@e2e-retry.example`, adminPassword: 'Musterwerk#2026!', adminFirstName: 'A', adminLastName: 'A' });
    tenants.push(tenant.id);
    const integration = await prisma.forTenantId(tenant.id).integration.create({ data: { tenantId: tenant.id, connectorType: 'GMAIL', status: 'CONNECTED', externalAccountDisplayName: 'firma@e2e.example', grantedCapabilities: ['email.read', 'email.send'] } });
    connectionByTenant.set(tenant.id, integration.id);
    for (const action of ['email.send.information', 'knowledge.answer', 'staff.notify']) {
      await prisma.forTenantId(tenant.id).policyConfig.upsert({ where: { tenantId_action: { tenantId: tenant.id, action } }, create: { tenantId: tenant.id, action, mode: 'AUTONOMOUS' }, update: { mode: 'AUTONOMOUS' } });
    }
    await prisma.forTenantId(tenant.id).tenantProfile.create({ data: { tenantId: tenant.id, industry: 'Heizung und Sanitär', description: 'Wir installieren Heizungen.', services: ['Heizung'], faqs: [] } });
    return tenant.id;
  }
  function seedTool(toolName: string, input: Record<string, unknown>): void {
    llm.seedResponse({ toolCalls: [{ toolCallId: randomUUID(), toolName, input }], stopReason: 'tool_use' });
    llm.seedResponse({ text: 'ok', toolCalls: [], stopReason: 'end_turn' });
  }
  const seedTriage = (category: string) =>
    seedTool('submit_triage_result', buildTriageFixture({ businessRelevance: 'RELEVANT', category, urgency: 'NORMAL', senderRoleHypothesis: 'CUSTOMER', conciseReason: 'Anfrage.', confidence: { relevance: 0.97, intent: 0.9 } }) as unknown as Record<string, unknown>);
  const node = (id: string, type: string, extra: Record<string, unknown> = {}) => ({ id, type, title: id, inputs: {}, config: {}, ...extra });
  const notifyPlan = () => ({
    goalKeys: ['staff.informed'],
    nodes: [node('notify', 'ACTION', { capability: { key: 'staff.notify' }, inputs: { message: { literal: 'Bitte prüfen: neue Anfrage.' } } }), node('done', 'COMPLETE')],
    edges: [{ id: 'e1', source: 'notify', target: 'done' }],
    unresolvedRequirements: [],
    assumptions: [],
    conciseExplanation: 'Person informieren.',
  });
  const mail = (tenantId: string): NormalizedIntakeEvent => ({ tenantId, channel: 'SIMULATED', provider: 'simulated', externalEventId: randomUUID(), occurredAt: new Date(), sender: { address: 'kunde@kunde.example', displayName: 'Kunde' }, recipients: [{ address: 'info@betrieb.example' }], direction: 'INBOUND', connectionId: connectionByTenant.get(tenantId), subject: 'Frage', content: 'Haben Sie eine Lösung für unser besonderes Problem?', threadId: 'thr-r', rfcMessageId: `<${randomUUID()}@kunde.example>` });
  const waits = (tenantId: string, caseId: string) => prisma.forTenantId(tenantId).waitSubscription.findMany({ where: { caseId, eventType: 'plan.retry' }, orderBy: { createdAt: 'asc' } });
  const caseOf = (tenantId: string, caseId: string) => prisma.forTenantId(tenantId).case.findUniqueOrThrow({ where: { id: caseId } });
  /** Die Frist der offenen Wiederholung ist erreicht (die Zeit wird nicht abgewartet, sondern die Frist vorgezogen) und der Vorgang wird vorangebracht. */
  async function dueAndAdvance(tenantId: string, caseId: string): Promise<void> {
    await prisma.withRlsBypass((tx) => tx.waitSubscription.updateMany({ where: { caseId, eventType: 'plan.retry', status: 'WAITING' }, data: { deadlineAt: new Date(Date.now() - 1000) } }));
    await app.get(OrchestratorService).advance(tenantId, caseId);
  }

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    prisma = app.get(PrismaService);
    intake = app.get(IntakeService);
    llm = app.get(LLM_PROVIDER);
    const original = llm.complete.bind(llm);
    const live = {
      providerName: 'scripted-live',
      modelName: 'scripted',
      complete: async (request: Parameters<MockLLMProvider['complete']>[0]) => {
        calls += 1;
        if (calls > failFrom && calls <= failFrom + failCount) throw new Error('fetch failed');
        return original(request);
      },
    };
    spies.push(jest.spyOn(app.get(AiProviderResolverService), 'resolveForTenant').mockResolvedValue(live as never));
    spies.push(
      jest.spyOn(app.get<OutboundMailPort>(OUTBOUND_MAIL), 'send').mockImplementation(async () => ({ providerMessageId: `gm-${randomUUID()}`, threadId: 'thr-r', rfcMessageId: `<sent-${randomUUID()}@mail.example>`, from: 'firma@e2e.example', executionMode: 'SIMULATED' })),
    );
  });
  beforeEach(() => {
    calls = 0;
    failFrom = 0;
    failCount = 0;
  });
  afterAll(async () => {
    for (const spy of spies) spy.mockRestore();
    for (const id of tenants) await prisma.withRlsBypass((tx) => tx.tenant.deleteMany({ where: { id } }));
    await app.close();
  });

  it('der Ausfall beim Planen wird zeitversetzt wiederholt; gelingt die Wiederholung, läuft der Vorgang weiter – nichts wird doppelt gemeldet', async () => {
    const tenantId = await newTenant();
    seedTriage('COMPLAINT_OR_SERVICE');
    failFrom = 2; // die Einstufung (zwei Modellaufrufe) gelingt, der erste Planungsaufruf fällt aus
    failCount = 1;
    const result = await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId));
    const caseId = result.case!.id;

    // Nicht sofort an eine Person: der Vorgang wartet auf das System, die Wiederholung ist persistent geplant.
    let row = await caseOf(tenantId, caseId);
    expect(row.orchestrationStatus).toBe('WAITING_FOR_EXTERNAL_SYSTEM');
    expect(row.attentionReasons.join(' ')).toMatch(/versucht es automatisch erneut/);
    const scheduled = await waits(tenantId, caseId);
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]!.deadlineAt!.getTime()).toBeGreaterThan(Date.now() + (PLAN_RETRY_DELAYS_MINUTES[0]! - 1) * 60_000 - 5_000);
    expect(await prisma.forTenantId(tenantId).caseEvent.count({ where: { caseId, type: 'plan.retry_scheduled' } })).toBe(1);
    expect(await prisma.forTenantId(tenantId).task.count({ where: { caseId } })).toBe(0);

    // Vor der Frist geschieht nichts, auch nicht bei erneutem Anstoßen.
    await app.get(OrchestratorService).advance(tenantId, caseId);
    expect(await prisma.forTenantId(tenantId).processPlan.count({ where: { caseId } })).toBe(0);
    expect((await caseOf(tenantId, caseId)).orchestrationStatus).toBe('WAITING_FOR_EXTERNAL_SYSTEM');

    // Frist erreicht → der Plan entsteht und wird ausgeführt.
    seedTool('submit_process_plan', notifyPlan());
    await dueAndAdvance(tenantId, caseId);
    row = await caseOf(tenantId, caseId);
    expect(row.orchestrationStatus).toBe('COMPLETED');
    expect(await prisma.forTenantId(tenantId).attentionItem.count({ where: { caseId } })).toBe(1);
    expect((await waits(tenantId, caseId))[0]!.status).toBe('SATISFIED');
  });

  it('die Wiederholungen sind begrenzt: nach der letzten geht der Vorgang mit Begründung an eine Person – keine Endlosschleife', async () => {
    const tenantId = await newTenant();
    seedTriage('COMPLAINT_OR_SERVICE');
    failFrom = 2;
    failCount = 1000; // dauerhaft nicht erreichbar
    const result = await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId));
    const caseId = result.case!.id;
    for (let i = 0; i < PLAN_RETRY_DELAYS_MINUTES.length; i += 1) {
      expect((await caseOf(tenantId, caseId)).orchestrationStatus).toBe('WAITING_FOR_EXTERNAL_SYSTEM');
      await dueAndAdvance(tenantId, caseId);
    }
    const row = await caseOf(tenantId, caseId);
    expect(row.orchestrationStatus).toBe('MANUAL_REVIEW');
    expect(row.attentionReasons.join(' ')).toMatch(new RegExp(`nach ${PLAN_RETRY_DELAYS_MINUTES.length} zeitversetzten Wiederholungen`));
    expect(await waits(tenantId, caseId)).toHaveLength(PLAN_RETRY_DELAYS_MINUTES.length);
    expect(await prisma.forTenantId(tenantId).caseEvent.count({ where: { caseId, type: 'plan.retry_exhausted' } })).toBe(1);
    // Danach wird nichts mehr versucht.
    const before = calls;
    await app.get(OrchestratorService).advance(tenantId, caseId);
    expect(calls).toBe(before);
  });

  it('Weiterplanen nach einem festen Ablauf: fällt die KI aus, bleibt der Rückfallweg zur Person zurückgestellt; die bereits erfolgte Meldung wird nie wiederholt', async () => {
    const tenantId = await newTenant();
    seedTriage('GENERAL_INQUIRY');
    seedTool('submit_knowledge_answer', { answerable: false, answer: '', sources: [], confidence: 0.2 });
    failFrom = 4; // Einstufung und Auskunft (je zwei Modellaufrufe), dann fällt das Weiterplanen aus
    failCount = 1;
    const result = await intake.handleIntakeEvent(tenantId, undefined, mail(tenantId));
    const caseId = result.case!.id;
    let row = await caseOf(tenantId, caseId);
    expect(row.orchestrationStatus).toBe('WAITING_FOR_EXTERNAL_SYSTEM');
    const held = await prisma.forTenantId(tenantId).processPlanNode.findMany({ where: { plan: { caseId } } });
    expect(held.find((n) => n.nodeKey === 'plan_further')?.state).toBe('WAITING'); // das Weiterplanen ist noch nicht entschieden
    expect(held.find((n) => n.nodeKey === 'human_answers')?.state).toBe('PLANNED'); // der Rückfallweg zur Person läuft noch nicht
    expect(await prisma.forTenantId(tenantId).attentionItem.count({ where: { caseId } })).toBe(1); // die Meldung aus dem festen Ablauf ist erfolgt

    // Die Wiederholung gelingt: der Plan setzt die bereits ausgeführte Meldung unverändert fort.
    seedTool('submit_process_plan', {
      goalKeys: ['inquiry.answered', 'staff.informed'],
      nodes: [node('sender_check', 'RESOLVE_CONTEXT', { capability: { key: 'context.lookup' } }), node('notify_staff', 'ACTION', { capability: { key: 'staff.notify' }, inputs: { message: { literal: 'x' } } }), node('human', 'MANUAL_TASK', { title: 'Eine Person antwortet' })],
      edges: [{ id: 'e1', source: 'sender_check', target: 'notify_staff' }, { id: 'e2', source: 'notify_staff', target: 'human' }],
      unresolvedRequirements: [],
      assumptions: [],
      conciseExplanation: 'Fortsetzen.',
    });
    await dueAndAdvance(tenantId, caseId);
    row = await caseOf(tenantId, caseId);
    expect(row.orchestrationStatus).toBe('MANUAL_REVIEW'); // die Person antwortet – aber erst nach dem gelungenen Planen
    expect(await prisma.forTenantId(tenantId).attentionItem.count({ where: { caseId, kind: 'NOTIFY_REQUEST' } })).toBe(1); // nicht doppelt
    expect(await prisma.forTenantId(tenantId).actionIntent.count({ where: { caseId, capabilityKey: 'staff.notify', status: 'CONFIRMED' } })).toBe(1);
  });
});
