import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { MockLLMProvider } from '@orbit/agent-core';
import { SHADOW_PLAN_LIMIT_PER_TENANT, type PlanProposal } from '@orbit/shared';
import { LLM_PROVIDER } from '../src/agent/agent.tokens';
import { OUTBOUND_MAIL, type OutboundMailPort } from '../src/integrations/outbound-mail.port';
import { PlatformControlService } from '../src/platform-control/platform-control.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { OrchestratorService } from '../src/process/orchestrator.service';
import { PlanStoreService } from '../src/process/plan-store.service';
import { PlannerService } from '../src/process/planner.service';
import { ShadowPlanService } from '../src/process/shadow-plan.service';
import { TenantsService } from '../src/tenants/tenants.service';
import { bootstrapE2eApp } from './utils/bootstrap-e2e-app';

type Node = PlanProposal['nodes'][number];
const node = (id: string, type: Node['type'], extra: Partial<Node> = {}): Node => ({ id, type, title: id, inputs: {}, preconditions: [], optional: false, onFailure: 'REVIEW', config: {}, evidenceRefs: [], ...extra });

/**
 * Technischer Nachweis zum Schattenbetrieb (Entscheidung vom 19.10.2026): der Schattenpfad löst **keine** geschäftlichen Schreibaktionen, Nachrichten, Freigaben oder Folgeaufträge aus und verändert den
 * aktiven Plan nicht; zulässig sind nur das Schattenprotokoll (ein Ereignis) und die Messung des Verbrauchs (Agentenlauf). Die Obergrenze von 60 Planungen je Mandant gilt hart.
 * Eigener Mandant, Modell und Versand sind Testdoubles – nichts verlässt den Testprozess.
 */
describe('Schattenbetrieb (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let shadow: ShadowPlanService;
  let llm: MockLLMProvider;
  let send: jest.SpyInstance;
  const tenants: string[] = [];

  async function newTenant(): Promise<string> {
    const suffix = randomUUID();
    const { tenant } = await app.get(TenantsService).bootstrapTenant({ name: `Sh ${suffix.slice(0, 8)}`, slug: `e2e-shadow-${suffix}`, adminEmail: `admin-${suffix}@e2e-shadow.example`, adminPassword: 'Musterwerk#2026!', adminFirstName: 'S', adminLastName: 'H' });
    tenants.push(tenant.id);
    await prisma.forTenantId(tenant.id).integration.create({ data: { tenantId: tenant.id, connectorType: 'GMAIL', status: 'CONNECTED', externalAccountDisplayName: 'firma@e2e.example', grantedCapabilities: ['email.read', 'email.send'] } });
    return tenant.id;
  }

  /** Betreiber-Schalter `planner.shadow` für genau diesen Mandanten (wie im Betrieb: Mandanten-Override am Plattform-Flag). */
  async function setShadow(tenantId: string, on: boolean): Promise<void> {
    await prisma.withPlatformScope(async (tx) => {
      const flag = await tx.platformFeatureFlag.findUniqueOrThrow({ where: { key: 'planner.shadow' } });
      const overrides = (flag.tenantOverrides as Array<{ tenantId: string; value: boolean }>).filter((o) => o.tenantId !== tenantId);
      if (on) overrides.push({ tenantId, value: true });
      await tx.platformFeatureFlag.update({ where: { key: 'planner.shadow' }, data: { tenantOverrides: overrides } });
    });
    app.get(PlatformControlService).invalidate();
  }

  const seedPlan = (proposal: unknown) => {
    llm.seedResponse({ toolCalls: [{ toolCallId: randomUUID(), toolName: 'submit_process_plan', input: proposal as Record<string, unknown> }], stopReason: 'tool_use' });
    llm.seedResponse({ text: 'ok', toolCalls: [], stopReason: 'end_turn' });
  };
  const goodPlan = () => ({
    goalKeys: ['inquiry.answered'],
    nodes: [node('ctx', 'RESOLVE_CONTEXT', { capability: { key: 'context.lookup' } }), node('notify', 'ACTION', { capability: { key: 'staff.notify' }, inputs: { message: { literal: 'Bitte antworten.' } } }), node('human', 'MANUAL_TASK', { title: 'Eine Person antwortet' })],
    edges: [{ id: 'e1', source: 'ctx', target: 'notify' }, { id: 'e2', source: 'notify', target: 'human' }],
    unresolvedRequirements: [],
    assumptions: [],
    conciseExplanation: 'Person informieren und übergeben.',
  });

  /** Alles, was ein Schattenpfad NICHT verändern darf – als Zählung und Zustand. */
  async function snapshot(tenantId: string, caseId: string) {
    const s = prisma.forTenantId(tenantId);
    const plan = await s.processPlan.findFirst({ where: { caseId, status: 'ACTIVE' }, include: { nodes: { orderBy: { nodeKey: 'asc' }, select: { nodeKey: true, state: true, attempts: true } } } });
    const row = await s.case.findUniqueOrThrow({ where: { id: caseId }, select: { orchestrationStatus: true, revision: true, outcome: true, completedAt: true } });
    return {
      counts: {
        plans: await s.processPlan.count({ where: { caseId } }),
        nodes: await s.processPlanNode.count({ where: { plan: { caseId } } }),
        intents: await s.actionIntent.count({ where: { caseId } }),
        receipts: await s.actionReceipt.count({ where: { intent: { caseId } } }),
        mails: await s.emailMessage.count({ where: { caseId } }),
        drafts: await s.communicationDraft.count({ where: { caseId } }),
        approvals: await s.approval.count({ where: { tenantId } }),
        tasks: await s.task.count({ where: { caseId } }),
        waits: await s.waitSubscription.count({ where: { caseId } }),
        facts: await s.caseFact.count({ where: { caseId } }),
        leads: await s.lead.count({ where: { caseId } }),
        attention: await s.attentionItem.count({ where: { caseId } }),
        quotes: await s.quote.count({ where: { caseId } }),
      },
      activePlan: plan ? { id: plan.id, revision: plan.revision, hash: plan.planHash, nodes: plan.nodes } : null,
      caseRow: row,
    };
  }

  beforeAll(async () => {
    app = await bootstrapE2eApp();
    prisma = app.get(PrismaService);
    shadow = app.get(ShadowPlanService);
    llm = app.get(LLM_PROVIDER);
    send = jest.spyOn(app.get<OutboundMailPort>(OUTBOUND_MAIL), 'send').mockImplementation(async () => {
      throw new Error('Der Schattenpfad darf nichts versenden.');
    });
  });

  afterAll(async () => {
    for (const id of tenants) await setShadow(id, false).catch(() => undefined);
    await prisma.withRlsBypass((tx) => tx.tenant.deleteMany({ where: { id: { in: tenants } } }));
    jest.restoreAllMocks();
    await app.close();
  });

  it('ohne Betreiberfreigabe (Standard) passiert nichts: kein Planeraufruf, kein Ereignis', async () => {
    const tenantId = await newTenant();
    const c = await prisma.forTenantId(tenantId).case.create({ data: { tenantId, type: 'SALES', title: 'Aus' } });
    expect(await shadow.record(tenantId, c.id)).toBe('DISABLED');
    expect(await prisma.forTenantId(tenantId).caseEvent.count({ where: { caseId: c.id, type: 'shadow.plan_proposed' } })).toBe(0);
  });

  it('NACHWEIS: mit Freigabe entsteht genau ein Schattenprotokoll – keine Schreibaktion, keine Nachricht, keine Freigabe, keine Aufgabe, kein Folgeauftrag, der aktive Plan bleibt unverändert', async () => {
    const tenantId = await newTenant();
    await setShadow(tenantId, true);
    const c = await prisma.forTenantId(tenantId).case.create({ data: { tenantId, type: 'SALES', title: 'Mit Schattenplan' } });
    // Ein laufender, aktiver Plan des tatsächlichen Wegs (wartet auf eine Antwort) – er darf sich nicht verändern.
    const live: PlanProposal = {
      goalKeys: ['inquiry.answered'],
      nodes: [node('look', 'INTERPRET', { title: 'Verstehen' }), node('wait', 'WAIT_EVENT', { title: 'Antwort', config: { eventType: 'communication.received' }, timeout: { hours: 72 } })],
      edges: [{ id: 'e_look_wait', source: 'look', target: 'wait' }],
      unresolvedRequirements: [],
      assumptions: [],
      conciseExplanation: 'Warten.',
    };
    await app.get(OrchestratorService).startProcedure(tenantId, c.id, live, { intentSummary: 'Tatsächlicher Weg' });
    await app.get(OrchestratorService).advance(tenantId, c.id);

    const before = await snapshot(tenantId, c.id);
    const runsBefore = await prisma.forTenantId(tenantId).agentRun.count({ where: { tenantId } });
    expect(before.activePlan).not.toBeNull();

    seedPlan(goodPlan());
    expect(await shadow.record(tenantId, c.id, 'Frage zu Leistungen')).toBe('RECORDED');

    const after = await snapshot(tenantId, c.id);
    expect(after.counts).toEqual(before.counts);
    expect(after.activePlan).toEqual(before.activePlan);
    expect(after.caseRow).toEqual(before.caseRow);
    expect(send).not.toHaveBeenCalled();

    // Zulässig und erwartet: genau ein Schattenprotokoll und die Verbrauchsmessung (ein Agentenlauf mit dem Zweck „Schatten“).
    const events = await prisma.forTenantId(tenantId).caseEvent.findMany({ where: { caseId: c.id, type: 'shadow.plan_proposed' } });
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({ stage: 'DONE', available: true, valid: true, rating: { needsPlanApproval: false, plansHandover: true } });
    expect(await prisma.forTenantId(tenantId).agentRun.count({ where: { tenantId } })).toBe(runsBefore + 1);
    const run = await prisma.forTenantId(tenantId).agentRun.findFirstOrThrow({ where: { tenantId }, orderBy: { startedAt: 'desc' } });
    expect(run.input).toMatchObject({ purpose: 'process-planning-shadow' });
    // Der Schattenplan wurde nirgends als Plan abgelegt.
    expect(await prisma.forTenantId(tenantId).processPlan.count({ where: { caseId: c.id } })).toBe(1);
  });

  it('ein zweiter Aufruf für denselben Vorgang plant nicht noch einmal (einmal je Vorgang)', async () => {
    const tenantId = await newTenant();
    await setShadow(tenantId, true);
    const c = await prisma.forTenantId(tenantId).case.create({ data: { tenantId, type: 'SALES', title: 'Doppelt' } });
    seedPlan(goodPlan());
    expect(await shadow.record(tenantId, c.id)).toBe('RECORDED');
    expect(await shadow.record(tenantId, c.id)).toBe('ALREADY_DONE');
    expect(await prisma.forTenantId(tenantId).caseEvent.count({ where: { caseId: c.id, type: 'shadow.plan_proposed' } })).toBe(1);
  });

  it(`harte Obergrenze: ab der ${SHADOW_PLAN_LIMIT_PER_TENANT + 1}. Planung wird nicht mehr geplant (kein Modellaufruf), der Grund steht im Protokoll`, async () => {
    const tenantId = await newTenant();
    await setShadow(tenantId, true);
    const holder = await prisma.forTenantId(tenantId).case.create({ data: { tenantId, type: 'SALES', title: 'Zähler' } });
    await prisma.forTenantId(tenantId).caseEvent.createMany({
      data: Array.from({ length: SHADOW_PLAN_LIMIT_PER_TENANT }, (_, i) => ({ tenantId, caseId: holder.id, sequence: 1000 + i, type: 'shadow.plan_proposed', payload: { stage: 'DONE', available: true }, dedupeKey: `test-shadow-${i}` })),
    });
    const next = await prisma.forTenantId(tenantId).case.create({ data: { tenantId, type: 'SALES', title: 'Nummer 61' } });
    const spy = jest.spyOn(app.get(PlannerService), 'shadowPropose');
    expect(await shadow.record(tenantId, next.id)).toBe('LIMIT_REACHED');
    expect(spy).not.toHaveBeenCalled();
    const event = await prisma.forTenantId(tenantId).caseEvent.findFirstOrThrow({ where: { caseId: next.id, type: 'shadow.plan_proposed' } });
    expect(event.payload).toMatchObject({ available: false, limit: SHADOW_PLAN_LIMIT_PER_TENANT });
    spy.mockRestore();
  });

  it('ist die Planung nicht verfügbar (z. B. Kill-Switch), steht das ehrlich im Protokoll – nichts wird ersatzweise ausgeführt', async () => {
    const tenantId = await newTenant();
    await setShadow(tenantId, true);
    const c = await prisma.forTenantId(tenantId).case.create({ data: { tenantId, type: 'SALES', title: 'Ohne Plan' } });
    // Kein Plan geseedet: der simulierte Provider liefert keinen Plan → „nicht verfügbar“.
    expect(await shadow.record(tenantId, c.id)).toBe('UNAVAILABLE');
    const event = await prisma.forTenantId(tenantId).caseEvent.findFirstOrThrow({ where: { caseId: c.id, type: 'shadow.plan_proposed' } });
    expect(event.payload).toMatchObject({ stage: 'DONE', available: false });
    expect(send).not.toHaveBeenCalled();
  });

  it('PlanStoreService bleibt unberührt: der Schattenplan erscheint in keiner Planliste des Vorgangs', async () => {
    const tenantId = await newTenant();
    await setShadow(tenantId, true);
    const c = await prisma.forTenantId(tenantId).case.create({ data: { tenantId, type: 'SALES', title: 'Planliste' } });
    seedPlan(goodPlan());
    await shadow.record(tenantId, c.id);
    expect(await app.get(PlanStoreService).listRevisions(tenantId, c.id)).toHaveLength(0);
  });
});
